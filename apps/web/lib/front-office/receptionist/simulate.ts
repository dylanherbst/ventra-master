// Receptionist Test Lab (task A-4): a simulated inbound call through the real Receptionist pipeline. Each caller turn
// is built as a Vapi custom-LLM request (the same shape Vapi POSTs to .../voice/vapi/chat/completions), parsed with the
// real parseVapiChat, and handled the way lib/front-office/vapi-route.ts vapiChat does: fo_voice_turn, the live gate,
// the fixed greeting or the not-live message, then runReceptionistTurn with its real tools (booking, reschedule,
// cancel, transfer, messages). The call ends with a Vapi-shaped end-of-call report parsed by parseVapiEvent and
// recorded with fo_voice_end, as vapiWebhook does.
//
// What is fake, on purpose: the model (a script or a few keyword rules, no API key), the database (an in-memory copy
// of the fo_* RPCs with the same rules as the migrations), the calendar (in memory) and the senders (they only record
// what would have gone out). Nothing here places or answers a call, reads env, touches the network or sends anything.
import type { CalendarEventInput, CalendarProvider } from '../calendar/google';
import type { Interval } from '../calendar/slots';
import type { EmailSender } from '../email';
import { streamOf } from '../llm';
import type { Block, Llm, LlmRequest, StreamLlm, ToolResultBlock, ToolUseBlock } from '../llm';
import type { ChannelAuth, Rpc } from '../orchestrator';
import { checkedAgentSettings, templateSettings } from '../settings';
import type { AgentSettings } from '../settings';
import type { SmsSender } from '../sms-send';
import { canTransition, isContactState } from '../state';
import type { ContactState } from '../state';
import { chunkWriter, parseVapiChat, parseVapiEvent } from '../vapi';
import { receptionistSession, runReceptionistTurn } from './agent';
import { recordDroppedCall } from './dropped';
import type { CallerTurn, TurnSummary } from './agent';
import { greeting, notLiveMessage, RECEPTIONIST_GREETING_VERSION, RECEPTIONIST_NOT_LIVE_VERSION, RECEPTIONIST_PROMPT_VERSION } from './prompt';

/** A made-up voice channel: never a real one, so nothing here can be mistaken for a live channel key. */
export const SIM_AUTH: ChannelAuth = { channel: '00000000-0000-4000-8000-00000000a4a4', key: 'simulated-receptionist-lab-key-not-real' };
/** Monday 9 November 2026, 8:30 am Perth: fixed so every run offers the same times. */
export const SIM_NOW = Date.parse('2026-11-09T00:30:00Z');
const MIN = 60_000;

// ---------------------------------------------------------------------------------------------------------------
// In-memory store: the fo_* RPCs the voice pipeline calls, with the same rules as the SQL (state machine, opt-out,
// idempotent turns, one call row per Vapi call id). Every write is logged so the lab can show it.

export type SimContact = { id: string; phone: string | null; name: string | null; email: string | null; state: ContactState; optedOut: boolean; answers: Record<string, string> };
export type SimCall = { id: string; provider_call_id: string; contact_id: string | null; caller: string | null; outcomes: string[]; ended_reason: string | null; summary: string | null; transcript: string | null; ended: boolean };
export type SimMessage = { contact_id: string; direction: 'inbound' | 'outbound'; body: string; agent: string | null; prompt_version: string | null; provider_id: string | null };
export type SimAppointment = { id: string; contact_id: string; starts: string; ends: string; status: 'booked' | 'cancelled'; provider_event_id: string };
export type SimJob = { id: string; contact_id: string; kind: string; step: number; appointment_id: string | null; due: string; status: string };
export type SimEvent = { contact_id: string; kind: string; detail: string };
export type SimWrite = { rpc: string; table: string; op: 'insert' | 'update'; detail: string };
export type SimTables = {
  fo_calls: SimCall[]; fo_contacts: SimContact[]; fo_messages: SimMessage[]; fo_appointments: SimAppointment[];
  fo_jobs: SimJob[]; fo_events: SimEvent[]; handoffs: Record<string, unknown>[];
};
export type SimSeed = { caller: string | null; contact?: { state: ContactState; name?: string; answers?: Record<string, string>; booking?: { starts: string; eventId: string } } };

const E164 = /^\+[1-9][0-9]{6,14}$/, CALL_ID = /^[A-Za-z0-9_-]{8,100}$/;
const OUTCOMES = ['faq', 'faq-miss', 'qualified', 'booked', 'rescheduled', 'cancelled', 'message', 'transfer', 'not-live'];

/** `restore` (Receptionist Lab Live AI Test, lab-live.ts): carry on from tables and an id counter saved after an earlier
 * turn, instead of starting empty. The seed is ignored when restoring. */
export function simulationStore(settings: AgentSettings, seed: SimSeed, slotMinutes = settings.bookingMinutes, restore?: { tables: SimTables; seq: number }) {
  const t: SimTables = restore ? structuredClone(restore.tables) : { fo_calls: [], fo_contacts: [], fo_messages: [], fo_appointments: [], fo_jobs: [], fo_events: [], handoffs: [] };
  const writes: SimWrite[] = [];
  let n = restore ? restore.seq : 0;
  const id = (p: string) => `${p}-${String(++n).padStart(4, '0')}`;
  const w = (rpc: string, table: string, op: SimWrite['op'], detail: string) => { writes.push({ rpc, table, op, detail }); };

  if (!restore && seed.contact && seed.caller) {
    const c: SimContact = { id: 'contact-seed', phone: seed.caller, name: seed.contact.name ?? null, email: null, state: seed.contact.state, optedOut: false, answers: { ...seed.contact.answers } };
    t.fo_contacts.push(c);
    const b = seed.contact.booking;
    if (b) t.fo_appointments.push({ id: 'appt-seed', contact_id: c.id, starts: b.starts, ends: new Date(Date.parse(b.starts) + slotMinutes * MIN).toISOString(), status: 'booked', provider_event_id: b.eventId });
  }

  const contactByPhone = (phone: string, rpc: string, detail: string): SimContact => {
    let c = t.fo_contacts.find(x => x.phone === phone);
    if (!c) {
      c = { id: id('contact'), phone, name: null, email: null, state: 'new', optedOut: false, answers: {} };
      t.fo_contacts.push(c); w(rpc, 'fo_contacts', 'insert', `New contact ${phone} (${detail})`);
      t.fo_events.push({ contact_id: c.id, kind: 'created', detail }); w(rpc, 'fo_events', 'insert', `created: ${detail}`);
    }
    return c;
  };
  /** fo_voice_call_row: the call row for this Vapi call id, created on first sight; the caller becomes a contact. */
  const callRow = (rpc: string, callId: unknown, caller: unknown): SimCall => {
    if (typeof callId !== 'string' || !CALL_ID.test(callId)) throw new Error('Call id required.');
    const who = typeof caller === 'string' && E164.test(caller) ? caller : null;
    let k = t.fo_calls.find(x => x.provider_call_id === callId);
    if (!k) { k = { id: id('call'), provider_call_id: callId, contact_id: null, caller: who, outcomes: [], ended_reason: null, summary: null, transcript: null, ended: false }; t.fo_calls.push(k); w(rpc, 'fo_calls', 'insert', `Call ${callId} from ${who ?? 'a withheld number'}`); }
    if (!k.contact_id && (k.caller ?? who)) {
      const c = contactByPhone((k.caller ?? who) as string, rpc, 'First call');
      k.contact_id = c.id; k.caller = k.caller ?? who; w(rpc, 'fo_calls', 'update', `Call linked to contact ${c.id}`);
    }
    return k;
  };
  const contact = (cid: unknown): SimContact => {
    const c = t.fo_contacts.find(x => x.id === cid);
    if (!c) throw new Error('Contact not found.');
    return c;
  };
  const event = (rpc: string, contactId: string, kind: string, detail: string) => { t.fo_events.push({ contact_id: contactId, kind, detail }); w(rpc, 'fo_events', 'insert', `${kind}: ${detail}`); };

  const rpc: Rpc = async (fn, a) => {
    if (a.channel !== SIM_AUTH.channel || a.channel_key !== SIM_AUTH.key) throw new Error('Channel not recognised.');
    switch (fn) {
      case 'fo_channel_settings': return structuredClone(settings);
      case 'fo_voice_turn': {
        const k = callRow(fn, a.call_id, a.caller);
        let duplicate = false;
        const c = k.contact_id ? contact(k.contact_id) : null;
        const turn = typeof a.turn === 'number' ? a.turn : null, message = typeof a.message === 'string' ? a.message.trim() : '';
        if (c && turn !== null && turn >= 1 && turn <= 500 && message) {
          const providerId = `vapi:${k.provider_call_id}:${turn}`;
          if (t.fo_messages.some(m => m.provider_id === providerId)) duplicate = true;
          else {
            t.fo_messages.push({ contact_id: c.id, direction: 'inbound', body: message.slice(0, 4000), agent: null, prompt_version: null, provider_id: providerId });
            w(fn, 'fo_messages', 'insert', `Caller said (turn ${turn}): ${message.slice(0, 120)}`);
            event(fn, c.id, 'inbound', 'voice');
            for (const j of t.fo_jobs) if (j.contact_id === c.id && j.status === 'pending' && (j.kind === 'follow-up' || j.kind === 'no-show-rescue')) { j.status = 'cancelled'; w(fn, 'fo_jobs', 'update', `${j.kind} cancelled: contact called`); }
          }
        }
        return { call: k.id, contact: k.contact_id, state: c?.state ?? null, optedOut: c?.optedOut ?? false, caller: k.caller, outcomes: [...k.outcomes], duplicate };
      }
      case 'fo_voice_contact': {
        if (typeof a.phone_number !== 'string' || !E164.test(a.phone_number)) throw new Error('Mobile number is not valid.');
        const k = callRow(fn, a.call_id, null);
        const c = contactByPhone(a.phone_number, fn, 'Number given on a call');
        const name = typeof a.contact_name === 'string' ? a.contact_name.trim().slice(0, 160) : '';
        if (name && !c.name) { c.name = name; w(fn, 'fo_contacts', 'update', `Name set to ${name}`); }
        k.contact_id = c.id; w(fn, 'fo_calls', 'update', `Call linked to contact ${c.id}`);
        return c.id;
      }
      case 'fo_voice_reply': {
        if (typeof a.prompt !== 'string' || !a.prompt) throw new Error('Prompt version required.');
        const k = t.fo_calls.find(x => x.provider_call_id === a.call_id);
        const message = typeof a.message === 'string' ? a.message.trim() : '';
        if (!k?.contact_id || !message) return null;
        t.fo_messages.push({ contact_id: k.contact_id, direction: 'outbound', body: message.slice(0, 4000), agent: 'receptionist', prompt_version: a.prompt, provider_id: null });
        w(fn, 'fo_messages', 'insert', `Receptionist said (${a.prompt}): ${message.slice(0, 120)}`);
        return id('msg');
      }
      case 'fo_voice_outcome': {
        if (!OUTCOMES.includes(a.outcome as string)) throw new Error('Unknown outcome.');
        const k = callRow(fn, a.call_id, null);
        if (!k.outcomes.includes(a.outcome as string)) { k.outcomes.push(a.outcome as string); w(fn, 'fo_calls', 'update', `Outcome added: ${a.outcome}`); }
        return null;
      }
      case 'fo_voice_end': {
        const k = callRow(fn, a.call_id, a.caller);
        const first = !k.ended; // same as the database: true once per call
        k.ended = true; k.ended_reason = String(a.reason ?? '').slice(0, 120);
        k.summary = String(a.call_summary ?? '').slice(0, 4000) || null; k.transcript = String(a.call_transcript ?? '').slice(0, 20000) || null;
        w(fn, 'fo_calls', 'update', `Call ended (${k.ended_reason}); summary and transcript saved`);
        if (k.contact_id) event(fn, k.contact_id, 'call', `Call ended (${k.ended_reason || 'unknown'})${k.outcomes.length ? ': ' + k.outcomes.join(', ') : ''}`);
        return { call: k.id, contact: k.contact_id, outcomes: [...k.outcomes], first };
      }
      case 'fo_log_dispatch': {
        if (typeof a.contact === 'string') event(fn, contact(a.contact).id, 'dispatch', String(a.reason ?? '').slice(0, 500));
        return null;
      }
      case 'fo_contact_context': {
        const c = contact(a.contact);
        const appt = t.fo_appointments.find(x => x.contact_id === c.id && x.status === 'booked') ?? null;
        // Like the database: this contact's hand-offs (the Receptionist reads them to know a call already failed the identity check).
        const handoffs = (t.handoffs as { contact?: { id?: string }; intent?: string; summary?: string; owner?: string; from?: string }[]).filter(h => h.contact?.id === c.id).map(h => ({ from: h.from, owner: h.owner, intent: h.intent, summary: h.summary }));
        return structuredClone({ contact: c, appointment: appt && { id: appt.id, starts: appt.starts, ends: appt.ends, status: appt.status }, handoffs });
      }
      case 'fo_save_details': {
        const c = contact(a.contact);
        Object.assign(c.answers, a.new_answers as Record<string, string>);
        if (a.contact_name) c.name = a.contact_name as string;
        if (a.contact_email) c.email = a.contact_email as string;
        if (a.contact_phone) c.phone = a.contact_phone as string;
        w(fn, 'fo_contacts', 'update', `Saved ${Object.keys((a.new_answers ?? {}) as object).join(', ') || 'details'}${a.contact_name ? `, name ${a.contact_name}` : ''}`);
        return { answers: { ...c.answers }, skipped: [] };
      }
      case 'fo_set_state': {
        const c = contact(a.contact);
        if (!isContactState(a.new_state) || !canTransition(c.state, a.new_state)) throw new Error(`Contact cannot move from ${c.state} to ${String(a.new_state)}.`);
        const from = c.state; c.state = a.new_state;
        w(fn, 'fo_contacts', 'update', `State ${from} -> ${c.state}`); event(fn, c.id, 'state', `${from} -> ${c.state}: ${a.reason}`);
        return c.state;
      }
      case 'fo_record_handoff': {
        const c = contact(a.contact);
        t.handoffs.push(a.handoff as Record<string, unknown>);
        const h = a.handoff as { owner?: string; intent?: string };
        event(fn, c.id, 'handoff', `to ${h.owner}: ${h.intent}`);
        return id('handoff');
      }
      case 'fo_log_outbound': {
        const c = contact(a.contact);
        if (c.optedOut && a.prompt !== 'system/opt-out-confirmation@1') throw new Error('Contact opted out.');
        if (!a.prompt) throw new Error('Prompt version required.');
        t.fo_messages.push({ contact_id: c.id, direction: 'outbound', body: String(a.message), agent: String(a.agent_name), prompt_version: String(a.prompt), provider_id: null });
        w(fn, 'fo_messages', 'insert', `Logged before sending (${a.prompt}): ${String(a.message).slice(0, 120)}`);
        return id('msg');
      }
      case 'fo_schedule_job': {
        if (a.job_kind === 'follow-up' || a.job_kind === 'no-show-rescue') for (const j of t.fo_jobs) if (j.kind === a.job_kind && j.status === 'pending') j.status = 'cancelled';
        t.fo_jobs.push({ id: id('job'), contact_id: String(a.contact), kind: String(a.job_kind), step: Number(a.job_step), appointment_id: (a.appointment as string | null) ?? null, due: String(a.due), status: 'pending' });
        w(fn, 'fo_jobs', 'insert', `${a.job_kind} due ${a.due}`);
        return 'job';
      }
      case 'fo_booking_for_event': return t.fo_appointments.find(x => x.provider_event_id === a.event_id && x.status === 'booked')?.id ?? null;
      case 'fo_book': {
        const c = contact(a.contact);
        const dup = t.fo_appointments.find(x => x.provider_event_id === a.event_id);
        if (dup) return { appointment: dup.id, state: c.state, duplicate: true };
        if (!canTransition(c.state, 'booked')) throw new Error(`Contact cannot move from ${c.state} to booked.`);
        const appt: SimAppointment = { id: id('appt'), contact_id: c.id, starts: String(a.starts), ends: String(a.ends), status: 'booked', provider_event_id: String(a.event_id) };
        t.fo_appointments.push(appt); w(fn, 'fo_appointments', 'insert', `Booked ${appt.starts}`);
        const from = c.state; c.state = 'booked'; w(fn, 'fo_contacts', 'update', `State ${from} -> booked`);
        event(fn, c.id, 'booking', `Booked ${appt.starts}`);
        return { appointment: appt.id, state: 'booked', duplicate: false };
      }
      case 'fo_reschedule': {
        const appt = t.fo_appointments.find(x => x.id === a.appointment && x.contact_id === a.contact && x.status === 'booked');
        if (!appt) throw new Error('No booking to move.');
        appt.starts = String(a.starts); appt.ends = String(a.ends); w(fn, 'fo_appointments', 'update', `Moved to ${appt.starts}`);
        for (const j of t.fo_jobs) if (j.appointment_id === appt.id && j.status === 'pending') { j.status = 'cancelled'; w(fn, 'fo_jobs', 'update', `${j.kind} cancelled: booking moved`); }
        event(fn, appt.contact_id, 'booking', `Moved to ${appt.starts}`);
        return { appointment: appt.id, eventId: appt.provider_event_id, provider: 'google' };
      }
      case 'fo_cancel_booking': {
        const appt = t.fo_appointments.find(x => x.id === a.appointment && x.contact_id === a.contact && x.status === 'booked');
        if (!appt) throw new Error('No booking to cancel.');
        appt.status = 'cancelled'; w(fn, 'fo_appointments', 'update', 'Cancelled');
        for (const j of t.fo_jobs) if (j.appointment_id === appt.id && j.status === 'pending') { j.status = 'cancelled'; w(fn, 'fo_jobs', 'update', `${j.kind} cancelled: booking cancelled`); }
        event(fn, appt.contact_id, 'booking', `Cancelled: ${String(a.reason || 'no reason given')}`);
        const c = contact(appt.contact_id);
        if (c.state === 'booked') { c.state = 'qualified'; w(fn, 'fo_contacts', 'update', 'State booked -> qualified'); }
        return { appointment: appt.id, eventId: appt.provider_event_id, provider: 'google' };
      }
      default: throw new Error(`The simulation has no ${fn}.`);
    }
  };
  return { tables: t, writes, rpc, seq: () => n };
}

// ---------------------------------------------------------------------------------------------------------------
// In-memory calendar and senders that only record.

export type SimCalendarEvent = { id: string; start: number; end: number; summary?: string; cancelled?: boolean };
export function simulatedCalendar(seed: SimCalendarEvent[] = []) {
  const events = new Map<string, { start: number; end: number; summary: string; cancelled: boolean }>();
  for (const e of seed) events.set(e.id, { start: e.start, end: e.end, summary: e.summary ?? 'Existing booking', cancelled: e.cancelled === true });
  const log: string[] = [];
  const iso = (x: number) => new Date(x).toISOString();
  const provider: CalendarProvider = {
    async busy(from, to): Promise<Interval[]> { return [...events.values()].filter(e => !e.cancelled && e.start < to && e.end > from).map(e => ({ start: e.start, end: e.end })); },
    async hasEvent(eventId) { const e = events.get(eventId); return !!e && !e.cancelled; },
    async createEvent(e: CalendarEventInput) { events.set(e.id, { start: e.start, end: e.end, summary: e.summary, cancelled: false }); log.push(`created ${e.id} at ${iso(e.start)} (${e.summary})`); return { id: e.id, htmlLink: null, existed: false }; },
    async moveEvent(eventId, start, end) { const e = events.get(eventId); if (!e) throw new Error('Calendar event not found.'); e.start = start; e.end = end; log.push(`moved ${eventId} to ${iso(start)}`); },
    async cancelEvent(eventId) { const e = events.get(eventId); if (e) e.cancelled = true; log.push(`cancelled ${eventId}`); },
  };
  /** Every event, cancelled ones included, so a later turn can carry on from them. */
  const snapshot = (): Required<SimCalendarEvent>[] => [...events].map(([id, e]) => ({ id, ...e }));
  return { provider, log, snapshot };
}

export type WouldSend = { channel: 'sms' | 'email'; to: string; body: string; sent: false };
export function recordingSenders() {
  const out: WouldSend[] = [];
  const send: SmsSender = async (to, body) => { out.push({ channel: 'sms', to, body, sent: false }); return { sent: false, sid: null }; };
  const email: EmailSender = async (to, subject, text) => { out.push({ channel: 'email', to, body: `${subject}: ${text}`, sent: false }); return { sent: false, id: null }; };
  return { out, send, email };
}

// ---------------------------------------------------------------------------------------------------------------
// Models. Both are plain functions of the request: no network and no key.

/** One step of a scripted model: fixed blocks, or blocks built from the tool results just passed back. */
export type ScriptStep = Block[] | ((results: ToolResultBlock[]) => Block[]);
export const say = (text: string): Block => ({ type: 'text', text });
export const tool = (name: string, input: Record<string, unknown> = {}): Block => ({ type: 'tool_use', id: name, name, input });
const resultsOf = (req: LlmRequest): ToolResultBlock[] => { const last = req.messages.at(-1); return last && Array.isArray(last.content) ? last.content.filter((b): b is ToolResultBlock => b.type === 'tool_result') : []; };
const reply = (content: Block[]) => ({ content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' });

/** Steps in order, one per model request in the turn. Past the end: says nothing more. */
export function scriptedModel(steps: ScriptStep[]): Llm {
  let i = 0;
  return async (req) => { const s = steps[i++]; return reply(!s ? [] : typeof s === 'function' ? s(resultsOf(req)) : s); };
}

type Offered = { label: string; start: string };
const offersIn = (r: ToolResultBlock[]): Offered[] => { for (const b of r) { try { const v = JSON.parse(b.content); if (Array.isArray(v) && v[0]?.start) return v as Offered[]; } catch { /* not JSON */ } } return []; };
const faqAnswer = (r: ToolResultBlock[]): string | null => { for (const b of r) { try { const v = JSON.parse(b.content); if (Array.isArray(v) && v[0]?.answer) return String(v[0].answer); } catch { /* not JSON */ } } return null; };
const firstSentence = (s: string) => (s.match(/^[^.]*\./)?.[0] ?? s).trim();

const URGENT = /\b(urgent|emergency|hurt|injur|bleeding|chest pain|can'?t breathe|ambulance)/i;
const PERSON = /\b(someone|somebody|a person|a human|manager|owner|staff|bill|billing|refund|complain|complaint)\b/i;
const CANCEL = /\bcancel/i, MOVE = /\b(move|reschedule|change)\b/i, BOOK = /\b(book|trial|appointment|tour|come in|first one|last one|earliest|that one|second one)\b/i, BYE = /\b(bye|that'?s all|that is all|nothing else)\b/i;

/** The second factor, as far as the caller has said it in the transcript ("my name is Sam", "it's Sam"). */
function verifyFrom(req: LlmRequest): { verify_name?: string } {
  for (const m of [...req.messages].reverse()) {
    if (m.role !== 'user' || typeof m.content !== 'string') continue;
    const n = m.content.match(/\b(?:my name is|name'?s|it'?s|this is|i'?m|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if (n) return { verify_name: n[1] };
  }
  return {};
}

/** Keyword rules standing in for the model when the lab is given its own caller lines. Deliberately simple: it only
 * shows how the real tools and safety rules respond, not how well a model talks. */
export function ruleModel(): Llm {
  return async (req) => {
    const results = resultsOf(req);
    const lastCaller = [...req.messages].reverse().find(m => m.role === 'user' && typeof m.content === 'string');
    const caller = typeof lastCaller?.content === 'string' ? lastCaller.content.split('\n').at(-1) ?? '' : '';
    if (!results.length) {
      if (URGENT.test(caller)) return reply([tool('transfer', { reason: `Urgent: ${caller.slice(0, 200)}` })]);
      if (PERSON.test(caller)) return reply([tool('transfer', { reason: caller.slice(0, 200) })]);
      if (CANCEL.test(caller)) return reply([say('One moment. '), tool('cancel', { reason: caller.slice(0, 200), ...verifyFrom(req) })]);
      if (MOVE.test(caller) || BOOK.test(caller)) return reply([say('One moment, let me check. '), tool('check_availability')]);
      if (BYE.test(caller)) return reply([say('Thanks for calling. Bye for now. '), tool('end_call')]);
      return reply([tool('answer_faq', { question: caller.slice(0, 300) })]);
    }
    const prev = req.messages.at(-2);
    const names = Array.isArray(prev?.content) ? prev.content.filter((b): b is ToolUseBlock => b.type === 'tool_use').map(b => b.name) : [];
    const r = results[0]?.content ?? '';
    switch (names[0]) {
      case 'answer_faq': {
        const a = faqAnswer(results);
        return reply(a ? [say(a)] : [say('I don’t have that in front of me. I’ll pass it to the team so they can call you back. '), tool('take_message', { message: `Asked: ${caller.slice(0, 300)}` })]);
      }
      case 'take_message': return reply([say(/no number/.test(r) ? 'I’ve noted that. What’s the best mobile to call you back on?' : 'I’ve passed that on and the team will call you back.')]);
      case 'transfer': return reply(/^Transferring/.test(r) ? [say('Putting you through now.')] : [say('No one is free to take the call right now, so I’ll take a message. '), tool('take_message', { message: caller.slice(0, 300), urgent: URGENT.test(caller) })]);
      case 'check_availability': {
        const offers = offersIn(results);
        if (!offers.length) return reply([say('I can’t see open times right now, so I’ll ask the team to book you in. '), tool('take_message', { message: `Wants a booking: ${caller.slice(0, 300)}` })]);
        const pick = /second/i.test(caller) ? offers[1] ?? offers[0] : /\blast\b/i.test(caller) ? offers.at(-1) : /\b(first|earliest|that one)\b/i.test(caller) ? offers[0] : null;
        if (pick) { const move = MOVE.test(caller) || /They have a booking on file/.test(req.system); return reply([tool(move ? 'reschedule' : 'book', { start: pick.start, ...(move ? verifyFrom(req) : {}) })]); }
        return reply([say(`I have ${offers.map(o => o.label).join(', or ')}. Which suits?`)]);
      }
      case 'book': case 'reschedule': case 'cancel':
        if (/^Not done yet: before changing a booking/.test(r)) return reply([say('Before I change that, can you tell me the name the booking is under, or its day and time?')]);
        if (/^Not done, and nothing was changed/.test(r)) return reply([say('I can’t change that booking on this call, so I’ve passed it to the team and someone will call you back.')]);
        return reply([say(/^Ask these first/.test(r) ? 'Before I book you in, can I ask a few quick questions first?' : firstSentence(r))]);
      default: return reply([]);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures: who calls, what they say, and (for the scripted model) what the model does on each request.

export type CallFixture = {
  id: string; title: string; covers: string;
  caller: string | null;
  contact?: SimSeed['contact'];
  settings?: Partial<AgentSettings>;
  turns: { says: string; script?: ScriptStep[] }[];
};

/** Demo business. Every value is sample data for the lab, never a real business's prices or policies. */
export function demoSettings(extra: Partial<AgentSettings> = {}): AgentSettings {
  const weekday: [string, string][] = [['09:00', '17:00']];
  return checkedAgentSettings({
    ...templateSettings('gym', 'Harbour Fitness (demo)'),
    hours: { 1: weekday, 2: weekday, 3: weekday, 4: weekday, 5: weekday },
    faqs: [
      { q: 'What are your opening hours?', a: 'We are open 5 am to 9 pm on weekdays and 7 am to 1 pm on weekends.' },
      { q: 'Is there parking?', a: 'Yes, there is free parking behind the building.' },
    ],
    staffPhone: '+61400000001', staffEmail: 'team@harbour-fitness.example', transferNumber: '+61890000001',
    recordingNotice: 'This call is recorded for training.', voiceOn: true,
    ...extra,
  });
}

const QUALIFIED = { goal: 'Get fitter', experience: 'New to training, no injuries', preferred_times: 'Weekday mornings', start_timeframe: 'This week' };
const offerLine = (r: ToolResultBlock[]): Block[] => { const o = offersIn(r); return [say(o.length ? `I have ${o.map(x => x.label).join(', or ')}. Which suits?` : firstSentence(r[0]?.content ?? 'Sorry, I cannot see the calendar.'))]; };
const resultLine = (r: ToolResultBlock[]): Block[] => [say(firstSentence(r[0]?.content ?? ''))];
const transferOrMessage = (urgent: boolean): ScriptStep => r => /^Transferring/.test(r[0]?.content ?? '')
  ? [say('Putting you through now.')]
  : [say('No one is free right now, so I’ll take a message for the team. '), tool('take_message', { message: urgent ? 'Hurt their back in a class and it is getting worse. Needs a call back now.' : 'Wants to talk about their bill.', urgent })];

export const fixtures: CallFixture[] = [
  {
    id: 'faq', title: 'FAQ answer', covers: 'A factual question answered only from the business’s own FAQ.',
    caller: '+61411110001',
    turns: [
      { says: 'Hi, what are your opening hours?', script: [[tool('answer_faq', { question: 'What are your opening hours?' })], r => [say(faqAnswer(r) ?? 'I don’t have that in front of me.')]] },
      { says: 'Great, thanks. Bye.', script: [[say('Thanks for calling. Bye for now. '), tool('end_call')]] },
    ],
  },
  {
    id: 'dont-know', title: '"I don’t know" safety', covers: 'A question the FAQ cannot answer: no guess, a message for the team instead.',
    caller: '+61411110002',
    turns: [{ says: 'Do you have a sauna?', script: [
      [tool('answer_faq', { question: 'Do you have a sauna?' })],
      r => faqAnswer(r) ? [say(faqAnswer(r) as string)] : [say('I don’t have that in front of me. '), tool('take_message', { message: 'Asked whether there is a sauna.', name: 'Riley' })],
      [say('I’ve passed that on and the team will call you back.')],
    ] }],
  },
  {
    id: 'new-caller', title: 'New caller qualification', covers: 'A new caller answers the qualifying questions over two turns.',
    caller: '+61411110003',
    turns: [
      { says: 'Hi, I’m Sam Lee. I want to get fitter. I’m new to training and have no injuries.', script: [[tool('qualify', { answers: { goal: QUALIFIED.goal, experience: QUALIFIED.experience }, name: 'Sam Lee' })], [say('Thanks Sam. Which days and times suit you to train?')]] },
      { says: 'Weekday mornings, and I’d like to start this week.', script: [[tool('qualify', { answers: { preferred_times: QUALIFIED.preferred_times, start_timeframe: QUALIFIED.start_timeframe } })], [say('Thanks, that’s everything I need. Would you like to book a free trial?')]] },
      { says: 'Not yet, I’ll think about it. Bye.', script: [[say('No worries. Thanks for calling. Bye for now. '), tool('end_call')]] },
    ],
  },
  {
    id: 'book', title: 'Booking', covers: 'Qualify, offer real open times, book the one the caller picks; reminders and a confirmation text (recorded, not sent).',
    caller: '+61411110004',
    turns: [
      { says: 'I’d like to book a free trial. I’m Alex. I want to get fitter, I’m new with no injuries, weekday mornings suit and I can start this week.', script: [
        [tool('qualify', { answers: QUALIFIED, name: 'Alex' })],
        [say('One moment, let me check. '), tool('check_availability')],
        offerLine,
      ] },
      // Tool results do not carry over between turns (only spoken words do), so the model checks the calendar again.
      { says: 'The last one, please.', script: [[say('One moment. '), tool('check_availability')], r => [tool('book', { start: offersIn(r).at(-1)?.start ?? '' })], resultLine] },
      { says: 'That’s all, thanks.', script: [[say('See you then. Bye for now. '), tool('end_call')]] },
    ],
  },
  {
    id: 'book-too-early', title: 'Booking before the questions', covers: 'Booking is refused until the required questions are answered, and only at an offered time.',
    caller: '+61411110005',
    turns: [{ says: 'Just book me in for Tuesday at 10.', script: [[tool('book', { start: '2026-11-10T02:00:00.000Z' })], r => [say(/^Ask these first/.test(r[0]?.content ?? '') ? 'Happy to. First, what would you like to achieve?' : firstSentence(r[0]?.content ?? ''))]] }],
  },
  {
    id: 'reschedule', title: 'Reschedule', covers: 'A booked caller moves their trial to another open time.',
    caller: '+61411110006',
    contact: { state: 'booked', name: 'Jordan', answers: QUALIFIED, booking: { starts: '2026-11-11T02:00:00.000Z', eventId: 'vbseedbooking0001' } },
    turns: [
      { says: 'Hi, it’s Jordan. I need to move my trial.', script: [[say('One moment, let me check. '), tool('check_availability')], offerLine] },
      { says: 'The second one works.', script: [[tool('check_availability')], r => [tool('reschedule', { start: (offersIn(r)[1] ?? offersIn(r)[0])?.start ?? '', verify_name: 'Jordan' })], resultLine] },
    ],
  },
  {
    id: 'cancel', title: 'Cancel', covers: 'A booked caller cancels after confirming; reminders stop and the calendar event is removed.',
    caller: '+61411110007',
    contact: { state: 'booked', name: 'Casey', answers: QUALIFIED, booking: { starts: '2026-11-11T02:00:00.000Z', eventId: 'vbseedbooking0002' } },
    turns: [
      { says: 'I need to cancel my trial on Wednesday.', script: [[say('Just to confirm, you’d like to cancel your trial on Wednesday?')]] },
      { says: 'Yes please, I’m away that week.', script: [[say('One moment. '), tool('cancel', { reason: 'Away that week', verify_name: 'Casey' })], resultLine] },
    ],
  },
  {
    id: 'transfer', title: 'Transfer', covers: 'A billing question is put through to the team’s number (or becomes a message when no number is set).',
    caller: '+61411110008',
    turns: [{ says: 'Can I talk to someone about my bill?', script: [[tool('transfer', { reason: 'Billing question' })], transferOrMessage(false), [say('I’ve passed that on and the team will call you back.')]] }],
  },
  {
    id: 'urgent', title: 'Urgent situation', covers: 'An injury is treated as urgent: put through to the team, or an urgent message when no one can take the call.',
    caller: '+61411110009',
    turns: [{ says: 'I hurt my back in a class yesterday and it’s getting worse. I need to speak to someone now.', script: [[tool('transfer', { reason: 'Urgent: injury after a class' })], transferOrMessage(true), [say('I’ve marked it urgent and the team will call you back as soon as they can.')]] }],
  },
];

export const fixtureById = (fixtureId: string) => fixtures.find(f => f.id === fixtureId) ?? null;

// ---------------------------------------------------------------------------------------------------------------
// The simulation.

export type SimOptions = {
  /** Stands in for FRONT_OFFICE_VOICE_LIVE inside the simulation only. The real switch is never read or changed. */
  liveSwitch?: boolean;
  receptionistOn?: boolean;
  /** Whether the demo business has a transfer number. */
  transfer?: boolean;
  /** Whether a (simulated) calendar is connected. */
  calendar?: boolean;
  /** The caller's own lines instead of the fixture's; answered by ruleModel. */
  callerLines?: string[];
  /** Use ruleModel even for a fixture with a script. */
  rules?: boolean;
  now?: number;
};
/** Where the operating-mode decision would come from. Per-business modes (automatic / owner_approval / enquiry_only)
 * do not exist in the pipeline yet (task A-2), so every action runs automatically once the Receptionist is live. */
export type ModeDecision = { action: 'book' | 'reschedule' | 'cancel' | 'transfer' | 'send'; mode: 'automatic'; enforced: false; note: string };
export type SimToolCall = { turn: number; id: string; name: string; input: Record<string, unknown>; result: string | null; isError: boolean; mode: ModeDecision | null };
export type SimTurn = {
  turn: number; caller: string | null; route: 'not-live' | 'greeting' | 'agent' | 'error'; said: string; prompt: string | null;
  vapiRequest: unknown; chunks: string[]; vapiActions: { name: string; args: unknown }[];
  summary: TurnSummary | null; system: string | null; error: string | null;
};
export type SimResult = {
  fixture: { id: string; title: string; covers: string };
  demo: true;
  gate: { live: boolean; liveSwitch: boolean; receptionistOn: boolean; voiceOn: boolean; settingsSaved: true; model: 'scripted' | 'rules'; note: string };
  modes: { available: string[]; perBusiness: false; note: string };
  transcript: { who: 'AI' | 'Caller'; text: string }[];
  turns: SimTurn[]; toolCalls: SimToolCall[];
  writes: SimWrite[]; tables: SimTables; calendar: string[]; wouldSend: WouldSend[];
  endOfCall: { report: unknown; endedReason: string; summary: string; outcomes: string[] };
};

const MODE_NOTE = 'No per-business operating mode exists yet (task A-2). Today every action runs automatically once the Receptionist is live.';
const ACTION: Record<string, ModeDecision['action']> = { book: 'book', reschedule: 'reschedule', cancel: 'cancel', transfer: 'transfer', take_message: 'send' };
const modeFor = (name: string): ModeDecision | null => ACTION[name] ? { action: ACTION[name], mode: 'automatic', enforced: false, note: MODE_NOTE } : null;
const PHRASE: Record<string, string> = { faq: 'answered a question from the FAQ', 'faq-miss': 'asked something the FAQ does not cover', qualified: 'answered the qualifying questions', booked: 'booked a session', rescheduled: 'moved their booking', cancelled: 'cancelled their booking', message: 'left a message for the team', transfer: 'was put through to the team', 'not-live': 'called while the AI receptionist was off' };

/** Run one simulated inbound call, start to end-of-call report. */
export async function simulateCall(fixture: CallFixture, opts: SimOptions = {}): Promise<SimResult> {
  const now = opts.now ?? SIM_NOW;
  const custom = (opts.callerLines ?? []).map(l => l.trim().slice(0, 300)).filter(Boolean).slice(0, 8);
  const turnsIn = custom.length ? custom.map(says => ({ says, script: undefined })) : fixture.turns;
  const useRules = opts.rules === true || custom.length > 0;
  const settings = demoSettings({ ...fixture.settings, ...(opts.transfer === false ? { transferNumber: null } : {}), ...(opts.receptionistOn === false ? { receptionistOn: false } : {}) });
  const db = simulationStore(settings, { caller: fixture.caller, contact: fixture.contact });
  const booking = fixture.contact?.booking;
  const cal = simulatedCalendar(booking ? [{ id: booking.eventId, start: Date.parse(booking.starts), end: Date.parse(booking.starts) + settings.bookingMinutes * MIN }] : []);
  const calendar = opts.calendar === false ? null : cal.provider;
  const senders = recordingSenders();
  const liveSwitch = opts.liveSwitch !== false;
  // vapi-route.ts voiceLive(): env switch, a model, saved settings, Receptionist on, voice on. Here the switch is the
  // simulated one and the model is always present (scripted).
  const live = liveSwitch && settings.receptionistOn && settings.voiceOn;
  const callId = 'call_sim_' + fixture.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const a = { channel: SIM_AUTH.channel, channel_key: SIM_AUTH.key };

  const conversation: CallerTurn[] = [];
  const transcript: SimResult['transcript'] = [];
  const turns: SimTurn[] = [], toolCalls: SimToolCall[] = [];
  let ended: 'transfer' | 'end' | null = null;

  for (let i = 0; i <= turnsIn.length && !ended; i++) {
    const says = i > 0 ? turnsIn[i - 1].says : null;
    if (says) { conversation.push({ role: 'user', content: says }); transcript.push({ who: 'Caller', text: says }); }
    // The custom-LLM request Vapi sends: its own system prompt (ignored), the conversation, the call and the caller.
    const vapiRequest = { model: 'ventra-receptionist', stream: true, temperature: 0.5, messages: [{ role: 'system', content: '(Vapi assistant prompt: ignored, VENTRA runs its own)' }, ...conversation], call: { id: callId, customer: fixture.caller ? { number: fixture.caller } : {} } };
    const chat = parseVapiChat(structuredClone(vapiRequest));
    const w = chunkWriter(vapiRequest.model, now);
    const chunks: string[] = [w.start()];
    const rec: SimTurn = { turn: i, caller: says, route: 'agent', said: '', prompt: null, vapiRequest, chunks, vapiActions: [], summary: null, system: null, error: null };
    turns.push(rec);

    let contact: string | null = null;
    if (chat.callId) {
      try { contact = ((await db.rpc('fo_voice_turn', { ...a, call_id: chat.callId, caller: chat.caller, turn: chat.turn, message: chat.lastUser || null })) as { contact: string | null })?.contact ?? null; }
      catch { contact = null; }
    }
    try {
      if (!live) {
        rec.route = 'not-live';
        const text = notLiveMessage(settings, !!contact);
        chunks.push(w.text(text)); rec.said = text; rec.prompt = RECEPTIONIST_NOT_LIVE_VERSION;
        if (chat.callId) {
          await db.rpc('fo_voice_outcome', { ...a, call_id: chat.callId, outcome: 'not-live' }).catch(() => undefined);
          await db.rpc('fo_voice_reply', { ...a, call_id: chat.callId, message: text, prompt: RECEPTIONIST_NOT_LIVE_VERSION }).catch(() => undefined);
        }
        if (contact) {
          const session = await receptionistSession({ rpc: db.rpc, auth: SIM_AUTH, calendar: null, send: senders.send, email: senders.email, settings, now, call: { id: chat.callId, caller: chat.caller, contact } });
          const input = { message: 'Called while the AI receptionist was off. Please call back.' };
          let result: string | null = null, isError = false;
          try { result = await session.run({ type: 'tool_use', id: 'not-live', name: 'take_message', input }); } catch (e) { result = e instanceof Error ? e.message : 'failed'; isError = true; }
          toolCalls.push({ turn: i, id: 'not-live', name: 'take_message', input, result, isError, mode: modeFor('take_message') });
        }
        chunks.push(w.tool('endCall', {})); ended = 'end';
      } else if (!chat.turn) {
        rec.route = 'greeting';
        const text = greeting(settings);
        chunks.push(w.text(text)); rec.said = text; rec.prompt = RECEPTIONIST_GREETING_VERSION;
        if (chat.callId) await db.rpc('fo_voice_reply', { ...a, call_id: chat.callId, message: text, prompt: RECEPTIONIST_GREETING_VERSION }).catch(() => undefined);
        chunks.push(w.stop());
      } else {
        const script = turnsIn[i - 1].script;
        const base = !useRules && script ? scriptedModel(script) : ruleModel();
        const llm = recordingModel(base, i, toolCalls, sys => { rec.system ??= sys; });
        const gen = runReceptionistTurn({ llm, rpc: db.rpc, auth: SIM_AUTH, calendar, send: senders.send, email: senders.email, settings, now, call: { id: chat.callId, caller: chat.caller, contact }, conversation: [...chat.conversation] });
        let r = await gen.next();
        while (!r.done) {
          const out = r.value;
          if (out.type === 'text') { chunks.push(w.text(out.text)); rec.said += out.text; }
          else if (out.type === 'transfer') { chunks.push(w.tool('transferCall', { destination: out.number })); ended = 'transfer'; }
          else { chunks.push(w.tool('endCall', {})); ended = 'end'; }
          r = await gen.next();
        }
        rec.summary = r.value; rec.prompt = RECEPTIONIST_PROMPT_VERSION;
        if (!ended) chunks.push(w.stop());
      }
    } catch (e) {
      rec.route = 'error';
      const text = ' Sorry, I am having trouble right now. Please call back shortly, or leave a message after the call ends.';
      chunks.push(w.text(text), w.stop()); rec.said += text;
      rec.error = e instanceof Error ? e.message : 'unknown';
    }
    chunks.push(w.done());
    rec.vapiActions = vapiActionsIn(chunks);
    rec.said = rec.said.trim();
    if (rec.said) { transcript.push({ who: 'AI', text: rec.said }); conversation.push({ role: 'assistant', content: rec.said }); }
  }
  for (const t of toolCalls) if (t.result === null) t.result = '(Not passed back to the model: the turn ended straight after this tool.)';

  // Vapi's end-of-call report. On a real call Vapi writes the summary; the lab writes a plain one from the outcomes.
  const call = db.tables.fo_calls.find(k => k.provider_call_id === callId);
  const outcomes = call?.outcomes ?? [];
  const endedReason = ended === 'transfer' ? 'assistant-forwarded-call' : ended === 'end' ? 'assistant-ended-call' : 'customer-ended-call';
  const summary = `Simulated summary (on a real call Vapi writes this): the caller ${outcomes.length ? outcomes.map(o => PHRASE[o] ?? o).join(', ') : 'did not complete anything'}.`;
  const report = { message: { type: 'end-of-call-report', endedReason, call: { id: callId, customer: fixture.caller ? { number: fixture.caller } : {} }, artifact: { transcript: transcript.map(l => `${l.who === 'AI' ? 'AI' : 'User'}: ${l.text}`).join('\n'), messages: [] }, analysis: { summary } } };
  const ev = parseVapiEvent(structuredClone(report));
  if (ev.callId) {
    const reason = ev.endedReason || 'ended';
    const end = await db.rpc('fo_voice_end', { ...a, call_id: ev.callId, caller: ev.caller, reason, call_summary: ev.summary.slice(0, 4000), call_transcript: ev.transcript.slice(0, 20000) }) as { contact: string | null; outcomes: string[] | null; first?: boolean } | null;
    // Same dropped-call call-back as the live webhook.
    if (end) await recordDroppedCall(db.rpc, SIM_AUTH, end, { id: ev.callId, caller: ev.caller, reason, transcript: ev.transcript });
  }
  const finalOutcomes = db.tables.fo_calls.find(k => k.provider_call_id === callId)?.outcomes ?? [];

  return {
    fixture: { id: custom.length ? 'custom' : fixture.id, title: custom.length ? 'Your own caller lines' : fixture.title, covers: custom.length ? 'Your lines, answered by simple keyword rules standing in for the model.' : fixture.covers },
    demo: true,
    gate: { live, liveSwitch, receptionistOn: settings.receptionistOn, voiceOn: settings.voiceOn, settingsSaved: true, model: useRules ? 'rules' : 'scripted', note: live ? 'Simulated live: the switch here is the lab’s own. The real FRONT_OFFICE_VOICE_LIVE is not read or changed.' : 'Not switched on: the caller hears the honest "not switched on yet" message and the team gets a call-back message.' },
    modes: { available: ['automatic'], perBusiness: false, note: MODE_NOTE },
    transcript, turns, toolCalls,
    writes: db.writes, tables: structuredClone(db.tables), calendar: [...cal.log], wouldSend: senders.out,
    endOfCall: { report, endedReason, summary, outcomes: [...finalOutcomes] },
  };
}

/** Wraps a model to record each tool call it makes and the result the pipeline passes back to it. Tool ids are made
 * unique per call so results can be matched. */
export function recordingModel(llm: Llm, turn: number, sink: SimToolCall[], onSystem: (system: string) => void): StreamLlm {
  let n = 0;
  return streamOf(async (req) => {
    onSystem(req.system);
    for (const b of resultsOf(req)) {
      const c = sink.find(x => x.turn === turn && x.id === b.tool_use_id);
      if (c && c.result === null) { c.result = b.content; c.isError = b.is_error === true; }
    }
    const res = await llm(req);
    const content = res.content.map(b => {
      if (b.type !== 'tool_use') return b;
      const id = `toolu_t${turn}_${++n}`;
      sink.push({ turn, id, name: b.name, input: b.input, result: null, isError: false, mode: modeFor(b.name) });
      return { ...b, id };
    });
    return { ...res, content };
  });
}

/** The function calls Vapi itself would carry out (transferCall, endCall), read back from the streamed chunks. */
function vapiActionsIn(chunks: string[]): { name: string; args: unknown }[] {
  const out: { name: string; args: unknown }[] = [];
  for (const block of chunks.join('').split('\n\n')) {
    const data = block.replace(/^data: /, '');
    if (!data || data === '[DONE]') continue;
    try {
      const j = JSON.parse(data) as { choices: { delta: { tool_calls?: { function: { name: string; arguments: string } }[] } }[] };
      for (const c of j.choices[0]?.delta.tool_calls ?? []) out.push({ name: c.function.name, args: JSON.parse(c.function.arguments) });
    } catch { /* not a tool chunk */ }
  }
  return out;
}
