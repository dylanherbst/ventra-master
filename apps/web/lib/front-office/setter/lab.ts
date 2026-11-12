// Setter Test Lab (task A-3): one customer message at a time through the real Setter pipeline. Each message goes in
// through orchestrator.ts handleInboundSms (opt-out check, routeByState, dispatch), then setter/agent.ts runSetterTurn
// runs with its real tools (save_answers, set_stage, offer_times, book_time with booking.ts bookSlot and jobs.ts).
//
// Booking goes through the shared permission check: when the model asks to book, the lab calls pending-actions.ts gate()
// (which asks permissions.ts decide()) before the tool reaches the pipeline. perform: book_time runs as normal. Held:
// the action waits in the in-memory owner approval queue and the customer hears decide()'s "held" line. Refused: the
// Setter hands the lead to a person (escalate_human) and says decide()'s "refused" line. Approving a held booking runs
// booking.ts bookSlot and jobs.ts scheduleReminders exactly once through approvePendingAction.
//
// IMPORTANT: production setter/agent.ts does NOT call gate() yet; its book_time books directly in every mode. The
// permission check shown here is the intended wiring, applied by the lab in front of book_time. Wiring it into the
// production Setter is task A-8.
//
// What is fake, on purpose: the model (scripted keyword rules; the /tools page never uses a paid model), the
// database (an in-memory copy of the fo_* RPCs the Setter uses), the calendar (in memory) and the SMS sender (records
// only). Nothing is sent, nothing is booked in a real calendar, nothing is written to Supabase.
//
// Live AI Test (task A-23, lab-live.ts) swaps ONLY the scripted model for the real, metered Anthropic model through
// runLabTurnWith. The store, calendar, SMS sender and gate() wiring above stay exactly the same, so the sandbox holds
// whatever the model says and whatever *_LIVE switches are set.
import { bookSlot, offerTimes } from '../booking';
import type { CalendarEventInput, CalendarProvider } from '../calendar/google';
import type { Interval } from '../calendar/slots';
import { formatSlot } from '../calendar/slots';
import type { OperatingMode, PermissionDecision } from '../contracts';
import { isOperatingMode } from '../contracts';
import { scheduleReminders } from '../jobs';
import { isMetered } from '../lab-usage';
import type { Block, Llm, LlmRequest, LlmResponse, ToolResultBlock, ToolUseBlock } from '../llm';
import { handleInboundSms } from '../orchestrator';
import type { ChannelAuth, Rpc } from '../orchestrator';
import { approvePendingAction, createMemoryPendingActionStore, gate, rejectPendingAction } from '../pending-actions';
import type { ActionExecutor, PendingActionRecord } from '../pending-actions';
import type { SmsSender } from '../sms-send';
import { canTransition, isContactState } from '../state';
import type { ContactState } from '../state';
import { withPerson } from './actions';
import { runSetterTurn, setterHooks } from './agent';
import { checkedSetterConfig, ventraSetterConfig } from './config';
import type { SetterConfig } from './config';

/** A made-up channel, never a real one. */
export const LAB_AUTH: ChannelAuth = { channel: '00000000-0000-4000-8000-00000000a3a3', key: 'setter-lab-key-not-real' };
export const LAB_WORKSPACE = '00000000-0000-4000-8000-0000000a3000';
/** The lab's stand-in owner, who approves and rejects held actions. */
export const LAB_OWNER = '00000000-0000-4000-8000-0000000a3001';
/** Monday 9 November 2026, 8:30 am Perth: fixed so every run offers the same times. */
export const LAB_NOW = Date.parse('2026-11-09T00:30:00Z');
export const LAB_PHONE = '+61411112222';
export const LAB_CONFIG: SetterConfig = checkedSetterConfig(ventraSetterConfig);

export type LabContact = { id: string; name: string | null; phone: string | null; email: string | null; state: ContactState; optedOut: boolean; answers: Record<string, string> };
export type LabMessage = { contact_id: string; direction: 'inbound' | 'outbound'; body: string; agent: string | null; prompt_version: string | null; msg_id: string | null; at: string };
export type LabAppointment = { id: string; contact_id: string; starts: string; ends: string; status: 'booked'; event_id: string };
export type LabJob = { id: string; contact_id: string; kind: string; step: number; appointment_id: string | null; due: string; status: 'pending' | 'cancelled' };
export type LabHandoff = { contact_id: string; from: string; owner: string; intent: string; summary: string };
export type LabTables = { contacts: LabContact[]; messages: LabMessage[]; appointments: LabAppointment[]; jobs: LabJob[]; handoffs: LabHandoff[]; dispatches: { contact_id: string; agent: string; reason: string }[] };
export type LabCalendarEvent = { id: string; start: number; end: number; summary: string };
export type LabWrite = { rpc: string; detail: string };
export type LabToolCall = { id: string; name: string; input: Record<string, unknown>; result: string | null; isError: boolean };
export type BookingProposal = {
  start: string; label: string;
  /** From decide() through gate(). */
  decision: PermissionDecision; mode: OperatingMode; reason: string; say: string;
  pendingId: string | null;
  /** perform only: whether the pipeline's book_time then booked it. */
  booked: boolean | null;
};
/** Live AI Test only (lab-live.ts): what the real model calls of one turn used. All costs are estimates. */
export type LabTurnUsage = {
  estimate: true; model: string; priceKnown: boolean; calls: number;
  inputTokens: number; outputTokens: number; latencyMs: number; costAud: number;
  /** false when at least one call reported no usage, so its worst case was counted instead. */
  usageReported: boolean; note: string;
};
export type LabModel = 'scripted' | 'live';
export type LabTurn = {
  n: number; customer: string; reply: string | null; model: LabModel;
  /** Present on live turns only. */
  usage?: LabTurnUsage;
  route: string; contactId: string | null; state: ContactState | null; answers: Record<string, string>; missing: string[];
  detected: { needs: string | null; budget: string; timing: string | null; business: string | null };
  objection: string; offer: string; tools: LabToolCall[]; handedTo: string | null; writes: LabWrite[];
  booking: BookingProposal | null; error: string | null;
};
export type LabDecision = { id: string; decision: 'approve' | 'reject'; outcome: string; note: string | null; writes: LabWrite[] };
export type LabState = {
  v: 1; mode: OperatingMode; phone: string; seq: number; now: number;
  tables: LabTables; calendar: LabCalendarEvent[]; wouldSend: { to: string; body: string; sent: false }[];
  pending: PendingActionRecord[]; turns: LabTurn[]; decisions: LabDecision[];
};

export const OBJECTION_NOTE = 'not exposed: the Setter pipeline has no objection-handling step or field (only its prompt rules).';
/** Shown on a lab turn the AI did not answer because a person owns the conversation (as live, task A-61). */
export const LAB_WITH_PERSON_NOTE = 'A person is looking after this contact, so the AI did not reply (no model call).';
export const BUDGET_NOTE = 'not asked: this Setter config has no budget question, and prices go to a person.';

export function newLab(mode: OperatingMode = 'owner_approval', phone = LAB_PHONE): LabState {
  return { v: 1, mode, phone, seq: 0, now: LAB_NOW, tables: { contacts: [], messages: [], appointments: [], jobs: [], handoffs: [], dispatches: [] }, calendar: [], wouldSend: [], pending: [], turns: [], decisions: [] };
}

/** Limits on a lab state that comes back from the browser. */
export const LAB_LIMITS = {
  bytes: 400_000, turns: 40, contacts: 3, messages: 300, appointments: 10, jobs: 150, handoffs: 50, dispatches: 60,
  calendar: 10, pending: 20, decisions: 40, wouldSend: 40, string: 4000, depth: 8,
} as const;
const E164 = /^\+[1-9][0-9]{6,14}$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Checks a lab state that came back from the browser before anything runs: shape, sizes, phone and answer keys.
 * Anything oversize or malformed is refused with a plain error. Returns a copy. */
export function checkedLab(v: unknown): LabState {
  const bad = (why: string): never => { throw new Error(`The lab state is not valid (${why}). Start a new conversation.`); };
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('not an object');
  let size = 0;
  try { size = JSON.stringify(v).length; } catch { bad('not plain data'); }
  if (size > LAB_LIMITS.bytes) bad('too large');
  // Every string bounded, no prototype keys, no deep nesting.
  const walk = (x: unknown, depth: number): void => {
    if (depth > LAB_LIMITS.depth) bad('nested too deeply');
    if (typeof x === 'string') { if (x.length > LAB_LIMITS.string) bad('a text is too long'); return; }
    if (x === null || typeof x !== 'object') return;
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    for (const k of Object.keys(x)) { if (BAD_KEYS.has(k) || k.length > 100) bad('unexpected key'); walk((x as Record<string, unknown>)[k], depth + 1); }
  };
  walk(v, 0);
  const s = v as LabState;
  if (s.v !== 1 || !isOperatingMode(s.mode) || !Number.isSafeInteger(s.seq) || s.seq < 0 || s.seq > 100_000 || s.now !== LAB_NOW) bad('header');
  if (typeof s.phone !== 'string' || !E164.test(s.phone)) bad('phone');
  if (!s.tables || typeof s.tables !== 'object') bad('tables');
  const t = s.tables;
  const cap = (a: unknown, max: number, name: string) => { if (!Array.isArray(a)) bad(name); else if (a.length > max) bad(`too many ${name}`); };
  cap(t.contacts, LAB_LIMITS.contacts, 'contacts'); cap(t.messages, LAB_LIMITS.messages, 'messages'); cap(t.appointments, LAB_LIMITS.appointments, 'appointments');
  cap(t.jobs, LAB_LIMITS.jobs, 'jobs'); cap(t.handoffs, LAB_LIMITS.handoffs, 'handoffs'); cap(t.dispatches, LAB_LIMITS.dispatches, 'dispatches');
  cap(s.calendar, LAB_LIMITS.calendar, 'calendar events'); cap(s.pending, LAB_LIMITS.pending, 'held actions'); cap(s.decisions, LAB_LIMITS.decisions, 'decisions');
  cap(s.wouldSend, LAB_LIMITS.wouldSend, 'would-send items'); cap(s.turns, LAB_LIMITS.turns, 'turns');
  const ids = new Set(LAB_CONFIG.questions.map(q => q.id));
  for (const c of t.contacts) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !isContactState(c.state) || typeof c.optedOut !== 'boolean') bad('contact');
    if (c.phone !== null && (typeof c.phone !== 'string' || !E164.test(c.phone))) bad('contact phone');
    if (!c.answers || typeof c.answers !== 'object' || Array.isArray(c.answers)) bad('answers');
    for (const [k, a] of Object.entries(c.answers)) if (!ids.has(k) || typeof a !== 'string') bad('answer key');
  }
  for (const e of s.calendar) if (!e || typeof e.id !== 'string' || !Number.isFinite(e.start) || !Number.isFinite(e.end)) bad('calendar event');
  return structuredClone(s);
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ---------------------------------------------------------------------------------------------------------------
// In-memory store: the fo_* RPCs the inbound router, the Setter, booking and jobs call. Same rules as the SQL where
// it matters here (state machine, opt-out, duplicate message ids, one booking per calendar event).

/** Exported for tests. */
export function labStore(s: LabState) {
  const t = s.tables;
  const writes: LabWrite[] = [];
  const w = (rpc: string, detail: string) => { writes.push({ rpc, detail }); };
  const at = () => new Date(s.now).toISOString();
  const contact = (id: unknown) => {
    const c = t.contacts.find(x => x.id === id);
    if (!c) throw new Error('Contact not found.');
    return c;
  };
  const rpc: Rpc = async (fn, a) => {
    if (a.channel !== LAB_AUTH.channel || a.channel_key !== LAB_AUTH.key) throw new Error('Channel not recognised.');
    switch (fn) {
      case 'fo_ingest_sms': {
        const phone = String(a.from_number);
        let c = t.contacts.find(x => x.phone === phone), created = false;
        if (!c) { c = { id: uuid(++s.seq), name: null, phone, email: null, state: 'new', optedOut: false, answers: {} }; t.contacts.push(c); created = true; w(fn, `fo_contacts insert: new contact ${c.id} (${phone}), lead status new`); }
        if (t.messages.some(m => m.msg_id === a.msg_id)) return { contact: c.id, state: c.state, created, duplicate: true, optedOut: c.optedOut };
        if (a.opt_out === true && !c.optedOut) { c.optedOut = true; w(fn, 'fo_contacts update: opted out'); }
        if (a.opt_in === true && c.optedOut) { c.optedOut = false; w(fn, 'fo_contacts update: opted back in'); }
        t.messages.push({ contact_id: c.id, direction: 'inbound', body: String(a.message).slice(0, 4000), agent: null, prompt_version: null, msg_id: String(a.msg_id), at: at() });
        w(fn, `fo_messages insert: inbound "${String(a.message).slice(0, 80)}"`);
        for (const j of t.jobs) if (j.contact_id === c.id && j.status === 'pending' && j.kind === 'follow-up') { j.status = 'cancelled'; w(fn, 'fo_jobs update: follow-up cancelled (contact replied)'); }
        return { contact: c.id, state: c.state, created, duplicate: false, optedOut: c.optedOut };
      }
      case 'fo_log_dispatch': t.dispatches.push({ contact_id: String(a.contact), agent: String(a.agent_name), reason: String(a.reason) }); w(fn, `fo_events insert: dispatched to ${a.agent_name}`); return null;
      case 'fo_contact_context': {
        const c = contact(a.contact);
        const appt = t.appointments.find(x => x.contact_id === c.id) ?? null;
        return structuredClone({
          contact: c,
          messages: t.messages.filter(m => m.contact_id === c.id).map(m => ({ direction: m.direction, body: m.body, agent: m.agent, at: m.at })),
          appointment: appt && { id: appt.id, starts: appt.starts, ends: appt.ends, status: appt.status },
          handoffs: t.handoffs.filter(h => h.contact_id === c.id).map(h => ({ from: h.from, owner: h.owner, intent: h.intent, summary: h.summary })),
        });
      }
      case 'fo_save_details': {
        const c = contact(a.contact);
        // Only the config's question ids are kept (as fo_save_details does), so keys like __proto__ are ignored.
        const answers: Record<string, string> = {};
        const raw = a.new_answers && typeof a.new_answers === 'object' ? a.new_answers as Record<string, unknown> : {};
        for (const q of LAB_CONFIG.questions) if (Object.hasOwn(raw, q.id) && typeof raw[q.id] === 'string') answers[q.id] = (raw[q.id] as string).slice(0, 1000);
        for (const [k, x] of Object.entries(answers)) c.answers[k] = x;
        if (typeof a.contact_name === 'string' && a.contact_name) c.name = a.contact_name;
        if (typeof a.contact_email === 'string' && a.contact_email) c.email = a.contact_email.toLowerCase();
        if (typeof a.contact_phone === 'string' && a.contact_phone) c.phone = a.contact_phone;
        w(fn, `fo_contacts update: saved ${Object.keys(answers).join(', ') || 'details'}${a.contact_name ? `, name ${a.contact_name}` : ''}`);
        return { answers: { ...c.answers }, skipped: [] };
      }
      case 'fo_set_state': {
        const c = contact(a.contact);
        if (!isContactState(a.new_state) || !canTransition(c.state, a.new_state)) throw new Error(`Contact cannot move from ${c.state} to ${String(a.new_state)}.`);
        w(fn, `fo_contacts update: lead status ${c.state} -> ${a.new_state}`);
        c.state = a.new_state;
        return c.state;
      }
      case 'fo_record_handoff': {
        const h = a.handoff as { from?: string; owner?: string; intent?: string; summary?: string };
        contact(a.contact);
        t.handoffs.push({ contact_id: String(a.contact), from: String(h.from), owner: String(h.owner), intent: String(h.intent), summary: String(h.summary) });
        w(fn, `fo_handoffs insert: ${h.from} -> ${h.owner} (${h.intent})`);
        return uuid(++s.seq);
      }
      case 'fo_log_outbound': {
        const c = contact(a.contact);
        if (c.optedOut && a.prompt !== 'system/opt-out-confirmation@1') throw new Error('Contact opted out.');
        if (!a.prompt) throw new Error('Prompt version required.');
        t.messages.push({ contact_id: c.id, direction: 'outbound', body: String(a.message), agent: String(a.agent_name), prompt_version: String(a.prompt), msg_id: null, at: at() });
        w(fn, `fo_messages insert: outbound (${a.prompt}) "${String(a.message).slice(0, 80)}"`);
        return uuid(++s.seq);
      }
      case 'fo_schedule_job': {
        if (a.job_kind === 'follow-up') for (const j of t.jobs) if (j.contact_id === a.contact && j.kind === 'follow-up' && j.status === 'pending') j.status = 'cancelled';
        t.jobs.push({ id: uuid(++s.seq), contact_id: String(a.contact), kind: String(a.job_kind), step: Number(a.job_step), appointment_id: (a.appointment as string | null) ?? null, due: String(a.due), status: 'pending' });
        w(fn, `fo_jobs insert: ${a.job_kind} due ${a.due}`);
        return 'job';
      }
      case 'fo_booking_for_event': return t.appointments.find(x => x.event_id === a.event_id)?.id ?? null;
      case 'fo_book': {
        const c = contact(a.contact);
        const dup = t.appointments.find(x => x.event_id === a.event_id);
        if (dup) return { appointment: dup.id, state: c.state, duplicate: true };
        if (!canTransition(c.state, 'booked')) throw new Error(`Contact cannot move from ${c.state} to booked.`);
        const appt: LabAppointment = { id: uuid(++s.seq), contact_id: c.id, starts: String(a.starts), ends: String(a.ends), status: 'booked', event_id: String(a.event_id) };
        t.appointments.push(appt);
        w(fn, `fo_appointments insert: booked ${appt.starts}; lead status ${c.state} -> booked`);
        c.state = 'booked';
        return { appointment: appt.id, state: 'booked', duplicate: false };
      }
      default: throw new Error(`The lab has no ${fn}.`);
    }
  };
  const calendar: CalendarProvider = {
    async busy(from, to): Promise<Interval[]> { return s.calendar.filter(e => e.start < to && e.end > from).map(e => ({ start: e.start, end: e.end })); },
    async hasEvent(id) { return s.calendar.some(e => e.id === id); },
    async createEvent(e: CalendarEventInput) { s.calendar.push({ id: e.id, start: e.start, end: e.end, summary: e.summary }); w('calendar', `in-memory event ${e.id} at ${new Date(e.start).toISOString()}`); return { id: e.id, htmlLink: null, existed: false }; },
  };
  const send: SmsSender = async (to, body) => { s.wouldSend.push({ to, body, sent: false }); w('sms', `would send to ${to} (not sent)`); return { sent: false, sid: null }; };
  const pending = createMemoryPendingActionStore({ workspaceId: LAB_WORKSPACE, modes: () => ({ setter: s.mode, receptionist: 'enquiry_only' }), now: () => s.now, newId: () => uuid(++s.seq) });
  pending.items.push(...s.pending);
  return { rpc, writes, calendar, send, pending };
}

// ---------------------------------------------------------------------------------------------------------------
// Scripted model: keyword rules standing in for the model. Deterministic, no key, no network. It only shows how the
// real tools, state machine and permission check respond, not how well a model talks.

const say = (text: string): Block => ({ type: 'text', text });
const tool = (name: string, input: Record<string, unknown> = {}): Block => ({ type: 'tool_use', id: `${name}_1`, name, input });
const reply = (content: Block[]): LlmResponse => ({ content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' });
const resultsOf = (req: LlmRequest): ToolResultBlock[] => { const last = req.messages.at(-1); return last && Array.isArray(last.content) ? last.content.filter((b): b is ToolResultBlock => b.type === 'tool_result') : []; };
const lastUserText = (req: LlmRequest) => { const m = [...req.messages].reverse().find(x => x.role === 'user' && typeof x.content === 'string'); return typeof m?.content === 'string' ? m.content.split('\n').at(-1) ?? '' : ''; };

const DETECT: Record<string, RegExp> = {
  business: /\b(gym|studio|clinic|salon|plumb\w*|electric\w*|coach\w*|caf[eé]|dental|dentist|physio\w*|trades?\w*|my business|we run|I run|I own)\b/i,
  lead_flow: /\b(\d+\s*(leads|enquiries|inquiries|calls|messages)|(a|per) week)\b/i,
  problem: /\b(slow|miss\w*|no-?shows?|follow(-| )?ups?|los(e|ing)|nobody|no one|not replying|too busy)\b/i,
  timing: /\b(asap|right away|this week|next week|this month|next month|soon|straight away|urgent\w*|in \d+ (days|weeks|months))\b/i,
  decision_maker: /\b(I decide|my partner|business partner|I make the decision|decision maker)\b/i,
};
// A-59 (G7): a plain request for a person. Checked before every other rule so it always reaches escalate_human.
const PERSON = /\b(?:(?:talk|speak|chat)(?:ing)?\s+(?:to|with)\s+(?:a|an|the|your|someone|somebody|anyone)?\s*(?:real\s+|actual\s+|live\s+)?(?:person|people|human|owner|manager|someone|somebody)|(?:a\s+)?(?:real|actual|live)\s+(?:person|human)|(?:get|put)\s+(?:me\s+)?(?:a|the)\s+(?:person|human|owner))\b/i;
const ESCALATE =/\b(discount|refund|price|pricing|cost|how much|legal|guarantee|deal)\b/i;
const SUPPORT = /\b(existing customer|my account|billing|complaint|complain)\b/i;
const BOOK = /\b(book|call|time|slot|meeting|available|availability)\b/i;
const PICK = /\b(first|second|third|last|earliest)\b/i;
const CANCEL = /\bcancel\w*\b/i;
const MOVE = /\b(reschedul\w*|move|change|different (time|day)|another (time|day)|push (it )?back)\b/i;

/** What the scripted model would read out of one customer message: answers by question id, and contact details. */
export function detectAnswers(text: string, config: SetterConfig = LAB_CONFIG): { answers: Record<string, string>; name?: string; email?: string; phone?: string } {
  const sentences = text.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  const answers: Record<string, string> = {};
  for (const q of config.questions) {
    const re = DETECT[q.id];
    const hit = re && sentences.find(x => re.test(x));
    if (hit) answers[q.id] = hit.slice(0, 300);
  }
  const out: { answers: Record<string, string>; name?: string; email?: string; phone?: string } = { answers };
  const name = /\b(?:I'?m|I am|my name is|this is|it'?s)\s+([A-Z][a-z]+)\b/.exec(text)?.[1];
  if (name) out.name = name;
  const email = /[^\s@,]+@[^\s@,]+\.[A-Za-z]{2,}/.exec(text)?.[0];
  if (email) out.email = email;
  const phone = /\+[1-9]\d{7,14}/.exec(text)?.[0];
  if (phone) out.phone = phone;
  return out;
}

export function scriptedSetterModel(config: SetterConfig = LAB_CONFIG): Llm {
  return async (req) => {
    const text = lastUserText(req);
    const stage = /Contact stage: ([a-z-]+)\./.exec(req.system)?.[1] ?? 'new';
    let known: Record<string, string> = {};
    try { known = JSON.parse(/Answers so far: (\{.*\})\./.exec(req.system)?.[1] ?? '{}') as Record<string, string>; } catch { known = {}; }
    const name = /Name: ([^.]+)\./.exec(req.system)?.[1];
    const hi = name && name !== 'unknown' ? ` ${name.split(' ')[0]}` : '';
    const ask = (missing: string[]) => {
      const q = config.questions.find(x => x.id === missing[0]);
      return q ? say(`Thanks${hi}. Could you tell me ${q.ask.charAt(0).toLowerCase()}${q.ask.slice(1)}?`) : say(`Thanks${hi}. Would you like me to find a time for a ${config.meetingTitle}?`);
    };
    const missingNow = () => config.questions.filter(q => q.required && !known[q.id]).map(q => q.id);
    const results = resultsOf(req);
    if (!results.length && PERSON.test(text)) return reply([tool('escalate_human', { intent: 'Asked to talk to a person', summary: text.slice(0, 300) })]);
    if (!results.length && stage === 'booked') {
      // A-54: a booked contact writing again. Only what the returning prompt gives: the booking line, and a person for changes.
      const change = CANCEL.test(text) ? 'cancel' : MOVE.test(text) ? 'reschedule' : null;
      if (change) return reply([tool('escalate_human', { intent: `${change} booking`, summary: text.slice(0, 300), booking_change: change })]);
      if (ESCALATE.test(text)) return reply([tool('escalate_human', { intent: 'Pricing or deal question', summary: text.slice(0, 300) })]);
      if (SUPPORT.test(text)) return reply([tool('handoff_receptionist', { intent: 'Existing customer or support', summary: text.slice(0, 300) })]);
      const booking = /^Their booking: (.+?)\.?$/m.exec(req.system)?.[1];
      if (!booking || booking.startsWith('none upcoming')) return reply([tool('escalate_human', { intent: 'check booking', summary: 'Booked, but no upcoming booking is on file.' })]);
      return reply([say(`Welcome back${hi}. You're booked for your ${booking}. Would you like to keep it, or should I ask the team to move or cancel it?`)]);
    }
    if (!results.length) {
      if (ESCALATE.test(text)) return reply([tool('escalate_human', { intent: 'Pricing or deal question', summary: text.slice(0, 300) })]);
      if (SUPPORT.test(text)) return reply([tool('handoff_receptionist', { intent: 'Existing customer or support', summary: text.slice(0, 300) })]);
      const d = detectAnswers(text, config);
      const fresh = Object.fromEntries(Object.entries(d.answers).filter(([k]) => !known[k]));
      if (Object.keys(fresh).length || d.name || d.email || d.phone) return reply([tool('save_answers', { answers: fresh, ...(d.name ? { name: d.name } : {}), ...(d.email ? { email: d.email } : {}), ...(d.phone ? { phone: d.phone } : {}) })]);
      if (['qualified', 'nurture', 'no-show'].includes(stage) && (BOOK.test(text) || PICK.test(text) || /\b(yes|yep|sure|ok|okay)\b/i.test(text))) return reply([tool('offer_times')]);
      if (!missingNow().length && stage !== 'qualified') return reply([tool('set_stage', { stage: 'qualified', reason: 'All required answers are in' })]);
      return reply([ask(missingNow())]);
    }
    const prev = req.messages.at(-2);
    const used = Array.isArray(prev?.content) ? prev.content.filter((b): b is ToolUseBlock => b.type === 'tool_use').map(b => b.name) : [];
    const r = results[0]?.content ?? '';
    switch (used[0]) {
      case 'save_answers': {
        if (/All required answers are in/.test(r)) return reply(stage === 'qualified' ? [tool('offer_times')] : [tool('set_stage', { stage: 'qualified', reason: 'All required answers are in' })]);
        const missing = (/Still needed: ([^.]+)\./.exec(r)?.[1] ?? '').split(',').map(x => x.trim()).filter(Boolean);
        return reply([ask(missing)]);
      }
      case 'set_stage': return reply(/Stage is now qualified/.test(r) ? [tool('offer_times')] : [say(r.split('.')[0] + '.')]);
      case 'offer_times': {
        let offers: { label: string; start: string }[] = [];
        try { const v = JSON.parse(r); if (Array.isArray(v)) offers = v as typeof offers; } catch { /* not JSON */ }
        if (!offers.length) return reply([say(r)]);
        const p = PICK.exec(text)?.[1]?.toLowerCase();
        const pick = p === 'second' ? offers[1] : p === 'third' ? offers[2] : p === 'last' ? offers.at(-1) : p ? offers[0] : null;
        if (pick) return reply([tool('book_time', { start: pick.start })]);
        return reply([say(`Great, you are a good fit for a ${config.meetingTitle} (${config.where}). I can do ${offers.map(o => o.label).join(', or ')}. Which suits you?`)]);
      }
      case 'book_time': return reply([say(r.split('.')[0] + '.')]);
      default: return reply([say('Thanks. Someone from the team will be in touch soon.')]);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The turn.

type Ctx = ReturnType<typeof labStore>;

/** Wraps the model so every book_time call asks gate() first, and records each tool call and its result. */
function gatedModel(base: Llm, s: LabState, db: Ctx, contactId: string, tools: LabToolCall[], onProposal: (p: BookingProposal) => void): Llm {
  let forced: string | null = null;
  return async (req) => {
    for (const b of resultsOf(req)) { const c = tools.find(x => x.id === b.tool_use_id); if (c && c.result === null) { c.result = b.content; c.isError = b.is_error === true; } }
    const track = (b: ToolUseBlock): ToolUseBlock => { const id = `toolu_lab_${tools.length + 1}`; tools.push({ id, name: b.name, input: b.input, result: null, isError: false }); return { ...b, id }; };
    if (forced !== null) { const text = forced; forced = null; return reply([say(text)]); }
    const res = await base(req);
    const out: Block[] = [];
    for (const b of res.content) {
      if (b.type !== 'tool_use') { out.push(b); continue; }
      if (b.name === 'book_time') {
        const start = Date.parse(String(b.input?.start ?? ''));
        const offers = Number.isFinite(start) ? await offerTimes(db.calendar, LAB_CONFIG.availability, s.now, 12) : [];
        const offer = offers.find(o => o.start === start);
        if (offer) {
          const c = s.tables.contacts.find(x => x.id === contactId);
          const label = offer.label;
          const g = await gate({
            store: db.pending, product: 'setter', action: 'book',
            request: {
              payload: { kind: 'book', start: new Date(offer.start).toISOString(), end: new Date(offer.end).toISOString(), timeZone: LAB_CONFIG.availability.timeZone },
              summary: `Book ${c?.name ?? c?.phone ?? 'lead'} for a ${LAB_CONFIG.meetingTitle} on ${label}`.slice(0, 300),
              idempotencyKey: `setter-lab:${contactId}:${offer.start}`, contactId,
            },
            // perform: the gate allows it and the Setter's own book_time tool then books it (below).
            execute: async () => ({ ok: true, note: 'Allowed: the Setter pipeline books it with book_time.' }),
          });
          const p: BookingProposal = { start: new Date(offer.start).toISOString(), label, decision: g.decision, mode: g.permission.mode, reason: g.permission.reason, say: g.permission.say, pendingId: g.decision === 'hold_for_approval' ? g.item.id : null, booked: null };
          onProposal(p);
          if (g.decision === 'hold_for_approval') { db.writes.push({ rpc: 'gate', detail: `owner approval queue insert: ${g.item.summary}` }); out.push(say(g.permission.say)); forced = g.permission.say; continue; } // forced: like production forcedReply, a later model text cannot replace the held words (G12)
          if (g.decision === 'refuse') {
            // enquiry_only: the AI takes a message for a person instead of booking.
            out.push(track(tool('escalate_human', { intent: 'book a call', summary: `Wants the ${LAB_CONFIG.meetingTitle} on ${label}. Enquiry only mode: please arrange it by hand.` }) as ToolUseBlock));
            forced = g.permission.say; continue;
          }
        }
      }
      out.push(track(b));
    }
    return reply(out);
  };
}

const detected = (answers: Record<string, string>) => ({ needs: answers.problem ?? null, budget: BUDGET_NOTE, timing: answers.timing ?? null, business: answers.business ?? null });

/** One customer message through the real inbound router and Setter, with the scripted model. Returns the next lab state
 * (the input is not changed). */
export async function runLabTurn(state: LabState, input: { message: string; mode?: OperatingMode }): Promise<LabState> {
  return runLabTurnWith(state, input, { base: scriptedSetterModel(), model: 'scripted' });
}

/** The same turn with a given base model. Used by lab-live.ts (Live AI Test), which passes the metered Anthropic model
 * and is the only place that may pass a paid one. Whatever the model is, it only ever reaches the lab's in-memory store,
 * calendar and recording SMS sender, and every book_time goes through gate() first. */
export async function runLabTurnWith(state: LabState, input: { message: string; mode?: OperatingMode }, m: { base: Llm; model: LabModel }): Promise<LabState> {
  // A live (paid) model must come through lab-live.ts meteredLlm, which checks the daily cap before every call.
  if (m.model === 'live' && !isMetered(m.base)) throw new Error('Live AI Test refused: the model is not metered against the daily cap.');
  const s = checkedLab(state);
  if (input.mode && isOperatingMode(input.mode)) s.mode = input.mode;
  if (s.turns.length >= LAB_LIMITS.turns) throw new Error(`This lab conversation has reached ${LAB_LIMITS.turns} messages. Start a new one.`);
  const message = input.message.trim().slice(0, 1000);
  if (!message) throw new Error('Type a message first.');
  const db = labStore(s);
  const n = s.turns.length + 1;
  const turn: LabTurn = { n, customer: message, reply: null, model: m.model, route: '', contactId: null, state: null, answers: {}, missing: [], detected: detected({}), objection: OBJECTION_NOTE, offer: `${LAB_CONFIG.meetingTitle} (${LAB_CONFIG.where}), the one offer in the Setter config. The pipeline does not pick a different offer per lead.`, tools: [], handedTo: null, writes: db.writes, booking: null, error: null };
  try {
    let setterContact: string | null = null;
    // setterHooks: the same hooks as web chat, so a booked contact writing again gets the returning-booked answer (A-54).
    const r = await handleInboundSms(db.rpc, LAB_AUTH, { from: s.phone, to: '+61400000000', body: message, messageSid: `SMlab${String(n).padStart(6, '0')}` }, setterHooks(c => { setterContact = c; }));
    turn.route = r.route.agent ? `${r.route.agent}: ${r.route.reason}` : `no agent: ${r.route.reason}`;
    turn.contactId = r.contact;
    turn.reply = r.reply;
    if (setterContact && withPerson(s.tables.handoffs.filter(h => h.contact_id === setterContact))) {
      // Task A-61: live parity. The live routes pass the permission check, so runSetterTurn stays silent while a person
      // owns the conversation (agent.ts withPerson). The lab does the same from its own handoff records: the message is
      // stored, no model call, no reply, and the turn says why.
      turn.reply = null;
      turn.route = `${turn.route}. ${LAB_WITH_PERSON_NOTE}`;
    } else if (setterContact) {
      const contactId: string = setterContact;
      const gated = gatedModel(m.base, s, db, contactId, turn.tools, p => { turn.booking = p; });
      // Task A-55: a failed model call no longer fails the turn. runSetterTurn sends the fixed fallback reply and hands
      // the lead to a person; the lab keeps the model's own error message (the provider status or the cap refusal,
      // already free of keys and provider bodies) so the tester sees why.
      const caught: { message?: string } = {};
      const llm: Llm = async (req) => { try { return await gated(req); } catch (e) { caught.message = e instanceof Error ? e.message : 'The AI model call failed.'; throw e; } };
      const out = await runSetterTurn(contactId, { llm, rpc: db.rpc, auth: LAB_AUTH, calendar: db.calendar, send: db.send, config: LAB_CONFIG, now: s.now, channel: 'sms' });
      turn.reply = out.reply; turn.handedTo = out.handedTo;
      if (out.modelFailure) turn.error = `${caught.message ?? `The AI model call failed (${out.modelFailure}).`} The fixed fallback reply was sent and the lead was handed to a person.`;
      if (turn.booking?.decision === 'perform') turn.booking.booked = out.booked;
    }
  } catch (e) {
    turn.error = e instanceof Error ? e.message : 'The turn failed.';
  }
  for (const t of turn.tools) if (t.result === null) t.result = '(Not passed back to the model: the turn ended after this tool.)';
  const c = s.tables.contacts.find(x => x.id === turn.contactId);
  if (c) {
    turn.state = c.state; turn.answers = { ...c.answers };
    turn.missing = LAB_CONFIG.questions.filter(q => q.required && !c.answers[q.id]).map(q => q.id);
    turn.detected = detected(c.answers);
  }
  s.pending = db.pending.items.map(x => structuredClone(x));
  s.turns.push(turn);
  return s;
}

/** The owner approves or rejects a held action. Approve runs the original booking once (bookSlot, then reminders). */
export async function decideLabAction(state: LabState, id: string, decision: 'approve' | 'reject'): Promise<LabState> {
  const s = checkedLab(state);
  const db = labStore(s);
  const execute: ActionExecutor = async ({ payload, contactId }) => {
    if (payload?.kind !== 'book' || !contactId) return { ok: false, note: 'The lab only performs held bookings.' };
    const c = s.tables.contacts.find(x => x.id === contactId);
    if (!c) return { ok: false, note: 'Contact not found.' };
    if (c.state !== 'qualified' && canTransition(c.state, 'qualified')) await db.rpc('fo_set_state', { channel: LAB_AUTH.channel, channel_key: LAB_AUTH.key, contact: c.id, new_state: 'qualified', agent_name: 'setter', reason: 'Owner approved the booking' });
    const start = Date.parse(payload.start);
    const r = await bookSlot({ calendar: db.calendar, rpc: db.rpc, auth: LAB_AUTH, send: db.send, availability: LAB_CONFIG.availability, contact: c, start, now: s.now, businessName: LAB_CONFIG.businessName, where: LAB_CONFIG.where, meetingTitle: LAB_CONFIG.meetingTitle });
    if (!r.duplicate) await scheduleReminders(db.rpc, LAB_AUTH, c.id, r.appointment, start, s.now);
    return { ok: true, note: r.duplicate ? 'Already booked.' : `Booked ${formatSlot(start, LAB_CONFIG.availability.timeZone)}. Confirmation logged; not sent (lab).` };
  };
  const out = decision === 'approve' ? await approvePendingAction(db.pending, id, LAB_OWNER, execute) : await rejectPendingAction(db.pending, id, LAB_OWNER);
  s.pending = db.pending.items.map(x => structuredClone(x));
  s.decisions.push({ id, decision, outcome: out.outcome, note: out.item.note, writes: db.writes });
  return s;
}
