// The AI Setter (tracker 1.1, 1.3, 1.6, 1.7). One turn: read the contact's full context, let the model ask the next
// qualification question or book, run the tools it calls against the real store and calendar, and return the SMS to send
// (already logged with the prompt version). Booking hands the contact to Sales with the full handoff object; an existing
// customer or a support question goes to the Receptionist; anything outside the config goes to a human.
//
// Permission check (task A-8): with deps.permissions, booking, the follow-up ladder and handing the lead to a person go
// through pending-actions.ts gate(), which asks permissions.ts decide() for the business's Setter mode
// (automatic | owner_approval | enquiry_only), and are performed by setter/actions.ts (the same functions the owner
// approval queue runs). Held or refused actions get decide()'s own words as the reply, so the AI never promises what did
// not happen. Without deps.permissions the turn behaves exactly as before A-8 (direct booking, the old follow-up start,
// no hand-off silence); every new rule applies only with deps.permissions. The live routes in app/api/front-office/*
// must pass channelPermissions(rpc, auth) (task A-17); that wiring is outside this module.
//
// Model failure (task A-55, gap G2): when the model call throws (provider error, timeout) or returns no content list,
// the turn does not fail. The contact gets SETTER_FALLBACK_REPLY (fixed text, logged with SETTER_FALLBACK_PROMPT), the
// lead is handed to a person exactly as escalate_human does (through the permission check when one is given), no
// follow-up is started and nothing is booked. Only a safe code is logged and returned (turn.modelFailure).
//
// Returning booked contact (task A-54, gap G1): a contact in state 'booked' who writes again gets an answer instead of
// silence. The turn uses setterReturningPrompt (their upcoming booking, built in code from fo_contact_context's
// appointment: meeting, time, time zone, where) and only two tools, handoff_receptionist and escalate_human. The Setter
// has no tool that moves or cancels a booking, so a change request is passed to a person (escalate_human with
// booking_change, a 'transfer' through the permission check) and the contact hears a fixed line that never says it was
// changed (BOOKING_CHANGE_SAY; decide()'s refused words in enquiry_only). Enforced in code, not only by the prompt: any
// escalate_human on a returning turn ends with a fixed line, a model reply matching BOOKING_CHANGE_CLAIM is replaced by
// RETURNING_HANDOFF_SAY with a hand-off to a person, and a booked contact with no upcoming booking on file is handed to a
// person without a model call (NO_BOOKING_SAY). A person who owns the conversation (withPerson) still silences the AI.
// Web chat and the Setter Lab route booked contacts here with setterHooks().
import { bookSlot, offerTimes, SlotTaken } from '../booking';
import type { Offer } from '../booking';
import type { CalendarProvider } from '../calendar/google';
import { formatSlot } from '../calendar/slots';
import type { OperatingMode, PendingActionKind, PendingActionPayload, PermissionDecision } from '../contracts';
import { readPhone } from '../crm';
import { checkedHandoff } from '../handoff';
import type { Agent, Channel, Handoff } from '../handoff';
import { FOLLOW_UP_PROMPT, scheduleReminders, startFollowUps } from '../jobs';
import type { Llm, LlmMessage, LlmResponse, ToolResultBlock, ToolSpec, ToolUseBlock } from '../llm';
import type { AgentHooks, ChannelAuth, Rpc } from '../orchestrator';
import { gate } from '../pending-actions';
import type { ExecutionResult } from '../pending-actions';
import { decide } from '../permissions';
import { canTransition, isContactState } from '../state';
import type { ContactState } from '../state';
import type { SmsSender } from '../sms-send';
import { checkFollowUp, failSafeStore, performBook, performFollowUp, withPerson } from './actions';
import type { BookOutcome, SetterActionDeps, SetterActionRecord, SetterContext, SetterPermissions, StatusTransition } from './actions';
import { fillTemplate } from './config';
import type { SetterConfig } from './config';
import { plainText } from '../text';
import { SETTER_PROMPT_VERSION, SETTER_RETURNING_PROMPT_VERSION, setterReturningPrompt, setterSystemPrompt } from './prompt';

type Context = SetterContext;
/** Matches contracts.ts SetterRunResult, plus what each action did and the lead status changes (timestamped). */
export type SetterTurn = {
  reply: string | null; state: ContactState; booked: boolean; handedTo: Agent | null; tools: string[];
  /** The Setter mode applied. 'automatic' when no permissions were given (behaviour before A-8). */
  mode: OperatingMode;
  /** Actions held for the owner this turn (owner_approval only). */
  pendingActionIds: string[];
  actions: SetterActionRecord[];
  transitions: StatusTransition[];
  /** Present only when the model call failed this turn (task A-55): a safe code such as 'provider_500', 'timeout',
   * 'malformed_response' or 'model_error'. Never the provider's message or body. The reply is then SETTER_FALLBACK_REPLY. */
  modelFailure?: string;
};
/** logReply false: the caller queues the reply for approval and logs it only once it is sent (social DMs). */
export type SetterDeps = { llm: Llm; rpc: Rpc; auth: ChannelAuth; calendar: CalendarProvider | null; send: SmsSender; config: SetterConfig; now: number; channel?: Channel; logReply?: boolean; permissions?: SetterPermissions };

/** What the AI says when a hand-off to a person is held (decide() has no words for it today). */
const TRANSFER_HELD_SAY = 'I have asked a person from the team to get back to you.';
/** Task A-55 (G2): the fixed reply when the model call fails (provider error, timeout, malformed response). Approved
 * template text, never AI-written; the lead is handed to a person the same way escalate_human does. */
export const SETTER_FALLBACK_REPLY = 'Thanks for your message. Someone from the team will get back to you shortly.';
/** Prompt version logged with the fallback reply, so it is never mistaken for model output. */
export const SETTER_FALLBACK_PROMPT = 'setter/fallback@1';

class MalformedModelResponse extends Error { constructor() { super('The model response had no content list.'); this.name = 'MalformedModelResponse'; } }

/** A safe code for a failed model call: the error class or provider status only, never its message or body. */
export function modelFailureCode(e: unknown): string {
  if (e instanceof MalformedModelResponse) return 'malformed_response';
  if (e instanceof Error) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'timeout';
    const m = /^AI provider error \((\d{3}|stream)\)\.?$/.exec(e.message);
    if (m) return `provider_${m[1]}`;
  }
  return 'model_error';
}
const replyLimit: Record<Channel, number> = { sms: 320, 'web-chat': 600, email: 1500, voice: 400, form: 600, instagram: 450, messenger: 450 };

export const setterTools: ToolSpec[] = [
  { name: 'save_answers', description: 'Save qualification answers by question id, and the contact name, email or mobile if given.', input_schema: { type: 'object', properties: { answers: { type: 'object', additionalProperties: { type: 'string' } }, name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string', description: 'Mobile as the person gave it, e.g. 0412 345 678 or +61412345678' } }, required: ['answers'] } },
  { name: 'set_stage', description: 'Move the contact to qualifying, qualified, disqualified or nurture.', input_schema: { type: 'object', properties: { stage: { type: 'string', enum: ['qualifying', 'qualified', 'disqualified', 'nurture'] }, reason: { type: 'string' } }, required: ['stage', 'reason'] } },
  { name: 'offer_times', description: 'Get two or three open times from the live calendar. Only once the contact is qualified.', input_schema: { type: 'object', properties: {} } },
  { name: 'book_time', description: 'Book one of the times returned by offer_times, using its start value.', input_schema: { type: 'object', properties: { start: { type: 'string' } }, required: ['start'] } },
  { name: 'handoff_receptionist', description: 'Existing customer, support, billing or complaint: hand to the Receptionist.', input_schema: { type: 'object', properties: { intent: { type: 'string' }, summary: { type: 'string' } }, required: ['intent', 'summary'] } },
  { name: 'escalate_human', description: 'Discounts, custom deals, legal or refund questions, or anything not in the facts: hand to a person.', input_schema: { type: 'object', properties: { intent: { type: 'string' }, summary: { type: 'string' } }, required: ['intent', 'summary'] } },
];

/** Task A-54: the only tools for a booked contact writing again. No booking tools; a change goes to a person. */
export const returningTools: ToolSpec[] = [
  setterTools.find(t => t.name === 'handoff_receptionist') as ToolSpec,
  { name: 'escalate_human', description: 'Hand to a person: to move or cancel the booking (set booking_change), or anything not in the facts.', input_schema: { type: 'object', properties: { intent: { type: 'string' }, summary: { type: 'string', description: 'What they want, and the time they would prefer if moving it' }, booking_change: { type: 'string', enum: ['reschedule', 'cancel'] } }, required: ['intent', 'summary'] } },
];
/** What a booked contact hears after asking to move or cancel, in automatic and owner_approval mode (the AI cannot change
 * bookings, so a person does it and no approval item is created). enquiry_only uses decide()'s own refused words. */
export const BOOKING_CHANGE_SAY: Record<'reschedule' | 'cancel', string> = {
  reschedule: "I've passed this to the team and they'll get back to you to sort out the new time. Your current booking stays as it is until then.",
  cancel: "I've passed your cancellation request to the team and they'll get back to you to confirm it.",
};
/** Any other hand-off to a person on a booked contact's turn (escalate_human without booking_change, or a model reply that
 * claimed the booking changed). Fixed text: never model wording. */
export const RETURNING_HANDOFF_SAY = "I've passed your message to the team and a person will get back to you. Your booking stays as it is.";
/** Booked, but no upcoming booking on file (it may have already happened): a person checks; no model call, no guessed time. */
export const NO_BOOKING_SAY = "Thanks for your message. I can't see an upcoming booking on file, so I've asked a person from the team to check and get back to you.";
/** A returning-turn reply that claims a booking was moved, rescheduled, rebooked, cancelled or changed. Matched replies are
 * never sent: the fixed line goes instead and the contact is handed to a person. Broad on purpose (fails safe). */
export const BOOKING_CHANGE_CLAIM = /\b(moved|re-?scheduled|re-?booked|cancell?ed|changed|shifted)\b/i;

/** The agent hooks for web chat and the Setter Lab (task A-54): the Setter takes new and unqualified contacts, and booked
 * contacts writing again (router 'sales'), whose turn runs the returning-booked path. One place, so chat and lab match.
 * Until the owner approves the Sales agent, no route passes a separate sales hook. */
export function setterHooks(take: (contact: string) => void): AgentHooks {
  return { setter: take, sales: take };
}

const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const ACTIVE_STATES: readonly ContactState[] = ['new', 'contacted', 'qualifying', 'qualified', 'nurture', 'no-show', 'disqualified'];

/** Conversation as alternating user/assistant turns, newest last (the Messages API needs a user turn first and last). */
export function transcript(messages: Context['messages']): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of messages) {
    const role = m.direction === 'inbound' ? 'user' : 'assistant';
    const last = out.at(-1);
    if (last && last.role === role) last.content = `${last.content as string}\n${m.body}`;
    else out.push({ role, content: m.body || '(empty message)' });
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: '(The business messaged first.)' });
  if (out.at(-1)?.role !== 'user') out.push({ role: 'user', content: '(No new message from the contact.)' });
  return out;
}

export async function runSetterTurn(contactId: string, d: SetterDeps): Promise<SetterTurn> {
  const a = { channel: d.auth.channel, channel_key: d.auth.key };
  const channel: Channel = d.channel ?? 'sms';
  const ctx = await d.rpc('fo_contact_context', { ...a, contact: contactId }) as Context;
  const used: string[] = [], actions: SetterActionRecord[] = [], transitions: StatusTransition[] = [], held: string[] = [];
  let state = ctx.contact.state, booked = false, handedTo: Agent | null = null, offers: Offer[] = [], bookedReply: string | null = null;
  let forcedReply: string | null = null, bookingHeld = false, modelFailure: string | null = null;
  const store = d.permissions ? failSafeStore(d.permissions.store) : null;
  const mode: OperatingMode = store ? await store.mode('setter') : 'automatic';
  const x: SetterActionDeps = { rpc: d.rpc, auth: d.auth, calendar: d.calendar, config: d.config, now: d.now, send: d.send, channel, via: d.channel ?? null, quietHours: d.permissions?.quietHours };
  const result = (reply: string | null): SetterTurn => ({ reply, state, booked, handedTo, tools: used, mode, pendingActionIds: held, actions, transitions, ...(modelFailure ? { modelFailure } : {}) });
  // A booked contact writing again (A-54): answered about their booking, with no booking tools.
  const returning = state === 'booked';
  if (ctx.contact.optedOut || (!ACTIVE_STATES.includes(state) && !returning)) return result(null);
  // A person owns this conversation: the AI does not reply (or start follow-ups) until it is handed back.
  // Only with the permission check; without it the turn runs as before A-8.
  if (store && withPerson(ctx.handoffs)) return result(null);
  const who = plainText(ctx.contact.name, 160) || ctx.contact.phone || ctx.contact.email || 'this lead';
  const tz = d.config.availability.timeZone;
  const apptStart = ctx.appointment ? Date.parse(ctx.appointment.starts) : NaN;
  /** "<meeting> on <time> (<time zone>), <where>": from the stored appointment only, never from the model. */
  const bookingLine = returning && Number.isFinite(apptStart) ? `${d.config.meetingTitle} on ${formatSlot(apptStart, tz)} (${tz}), ${d.config.where}` : null;

  const contactLine = [
    `Contact stage: ${state}.`,
    `Name: ${plainText(ctx.contact.name, 160) || 'unknown'}. Email: ${ctx.contact.email ?? 'unknown'}.`,
    `Answers so far: ${Object.keys(ctx.contact.answers).length ? JSON.stringify(ctx.contact.answers) : 'none'}.`,
    ctx.appointment ? `Already booked: ${formatSlot(Date.parse(ctx.appointment.starts), d.config.availability.timeZone)}.` : '',
    ctx.handoffs.length ? `Earlier handoffs: ${ctx.handoffs.map(h => `${h.from} to ${h.owner}: ${h.intent}`).join('; ')}.` : '',
  ].filter(Boolean).join('\n');
  const nowLabel = formatSlot(d.now, tz);
  const system = (returning ? setterReturningPrompt(d.config, nowLabel, channel, bookingLine, d.now) : setterSystemPrompt(d.config, nowLabel, channel)) + '\n\n' + contactLine;
  const tools = returning ? returningTools : setterTools;
  const promptVersion = returning ? SETTER_RETURNING_PROMPT_VERSION : SETTER_PROMPT_VERSION;
  const messages = transcript(ctx.messages);

  async function moveTo(target: ContactState, reason: string) {
    if (state === target) return;
    // Pass through qualifying when the model jumps straight from a fresh lead to qualified.
    if (!canTransition(state, target) && canTransition(state, 'qualifying') && canTransition('qualifying', target)) await moveTo('qualifying', reason);
    if (!canTransition(state, target)) throw new Error(`Cannot move from ${state} to ${target}.`);
    const from = state;
    state = await d.rpc('fo_set_state', { ...a, contact: contactId, new_state: target, agent_name: 'setter', reason: reason.slice(0, 500) }) as ContactState;
    transitions.push({ from, to: state, at: new Date(d.now).toISOString(), reason: reason.slice(0, 500) });
  }
  async function handoff(owner: Agent, intent: string, summary: string, nextAction: string) {
    const h: Handoff = checkedHandoff({
      contact: { id: contactId, name: plainText(ctx.contact.name, 160) || null, phone: ctx.contact.phone, email: ctx.contact.email, state },
      channel, intent: plainText(intent, 200) || 'follow up', answers: ctx.contact.answers, summary: plainText(summary, 1500) || 'See the conversation.', nextAction, from: 'setter', owner,
    });
    await d.rpc('fo_record_handoff', { ...a, contact: contactId, handoff: h });
    handedTo = owner;
  }

  /** One action through the shared permission check. Without a store it is performed directly (automatic). */
  /** decided: the status of an earlier item with the same key that is no longer waiting (rejected, expired, failed,
   * performed, cancelled): nothing new was held, so the caller must not say it is held. */
  async function act(kind: PendingActionKind, payload: PendingActionPayload, summary: string, key: string, perform: () => Promise<ExecutionResult>): Promise<{ decision: PermissionDecision; say: string; ok: boolean | null; decided: string | null }> {
    const rec: SetterActionRecord = { action: kind as SetterActionRecord['action'], decision: 'perform', reason: '', pendingActionId: null, summary: summary.slice(0, 300), payload, ok: null, note: null };
    actions.push(rec);
    if (!store) {
      const r = await perform();
      Object.assign(rec, { reason: 'Performed: no permission check was configured, so the Setter ran as automatic.', ok: r.ok, note: r.note ?? null });
      return { decision: 'perform', say: '', ok: r.ok, decided: null };
    }
    const g = await gate({ store, product: 'setter', action: kind, request: { payload, summary: rec.summary, idempotencyKey: key, contactId, ttlMinutes: d.permissions?.ttlMinutes }, execute: perform, channelId: d.auth.channel });
    rec.decision = g.decision; rec.reason = g.permission.reason;
    if (g.decision === 'perform') { rec.ok = g.result.ok; rec.note = g.result.note ?? null; }
    let decided: string | null = null;
    if (g.decision === 'hold_for_approval') {
      // The owner sees exactly what would happen: the stored summary and payload.
      rec.pendingActionId = g.item.id; rec.summary = g.item.summary; rec.payload = g.item.payload;
      if (!g.created && g.item.status !== 'pending' && g.item.status !== 'approved') {
        decided = g.item.status;
        rec.note = `Already decided earlier (${g.item.status}); nothing new was held.`;
      } else if (!held.includes(g.item.id)) held.push(g.item.id);
    }
    return { decision: g.decision, say: g.permission.say, ok: rec.ok, decided };
  }
  /** Taking a message for the team: always allowed (decide('take_message')); recorded as a handoff to a person. */
  async function takeMessage(intentIn: string, summaryIn: string) {
    const intent = plainText(intentIn, 200), summary = plainText(summaryIn, 1500);
    const rec: SetterActionRecord = { action: 'take_message', decision: 'perform', reason: '', pendingActionId: null, summary: `Message for the team about ${who}: ${intent}`.slice(0, 300), payload: null, ok: null, note: null };
    actions.push(rec);
    const perform = async () => { await handoff('human', intent, summary, 'A person gets back to the contact (message taken)'); return { ok: true, note: 'Message taken for the team.' }; };
    if (!store) { const r = await perform(); Object.assign(rec, { reason: 'Taking a message is always allowed.', ok: r.ok, note: r.note }); return; }
    const g = await gate({ store, product: 'setter', action: 'take_message', execute: perform });
    rec.decision = g.decision; rec.reason = g.permission.reason;
    if (g.decision === 'perform') { rec.ok = g.result.ok; rec.note = g.result.note ?? null; }
  }
  /** Hands the lead to a person (a 'transfer'). Returns what to tell the contact when it did not happen right away. */
  async function toPerson(intentIn: string, summaryIn: string, nextAction: string): Promise<string | null> {
    const intent = plainText(intentIn, 200), summary = plainText(summaryIn, 1500);
    // TODO(A-14): whether a hand-off to a person is allowed in every mode is an open owner decision. This relies on
    // decide('transfer') as it is today (always 'perform'); the hold and refuse branches below follow whatever it answers.
    const g = await act('transfer', { kind: 'transfer', reason: `${intent || 'follow up'}: ${summary}`.slice(0, 400) }, `Hand ${who} to a person: ${intent || 'follow up'}`, `setter:transfer:${contactId}:${d.now}:${actions.length}`, async () => {
      await handoff('human', intent, summary, nextAction);
      return { ok: true, note: 'Handed to a person. The AI stops replying to this contact.' };
    });
    if (g.decision === 'perform' && g.ok === false) throw new Error('The hand-off could not be recorded.');
    if (g.decision === 'refuse') { await takeMessage(intent, summary); return g.say || null; }
    if (g.decision === 'hold_for_approval') return g.say || TRANSFER_HELD_SAY;
    return null;
  }

  async function run(t: ToolUseBlock): Promise<string> {
    used.push(t.name);
    const input = t.input ?? {};
    // A booked contact: only the returning tools run, whatever the model asks for (nothing is re-qualified or re-booked).
    if (returning && !tools.some(x => x.name === t.name)) return 'Not available: this contact is already booked. Tell them their booking; a person moves or cancels it (escalate_human with booking_change).';
    switch (t.name) {
      case 'save_answers': {
        const answers: Record<string, string> = {};
        const ids = new Set(d.config.questions.map(q => q.id));
        for (const [k, v] of Object.entries((input.answers ?? {}) as Record<string, unknown>)) if (ids.has(k) && typeof v === 'string' && v.trim()) answers[k] = v.trim().slice(0, 1000);
        const email = str(input.email, 254);
        // Local Australian formats ("0412 345 678", "(08) 9123 4567") are read by the shared CRM rule (task A-31), so
        // the number is stored in the same E.164 form every other channel uses; a refused number gets the rule's reason.
        const rawPhone = typeof input.phone === 'string' ? input.phone.trim() : '';
        const reading = rawPhone ? readPhone(rawPhone) : null;
        const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), okPhone = reading?.ok === true;
        const phone = reading?.ok ? reading.phone : '';
        const r = await d.rpc('fo_save_details', { ...a, contact: contactId, new_answers: answers, contact_name: plainText(input.name, 160) || null, contact_email: okEmail ? email : null, contact_phone: okPhone ? phone : null }) as { answers: Record<string, string>; skipped: string[] } | null;
        ctx.contact.answers = r?.answers ?? { ...ctx.contact.answers, ...answers };
        const skipped = r?.skipped ?? [];
        if (plainText(input.name, 160)) ctx.contact.name = plainText(input.name, 160);
        if (okEmail && !skipped.includes('email')) ctx.contact.email = email.toLowerCase();
        if (okPhone && !skipped.includes('phone')) ctx.contact.phone = phone;
        const note = (reading && !reading.ok ? ` The mobile was not saved: ${reading.reason} Ask again.` : '') + (skipped.length ? ` Not saved (already on another record): ${skipped.join(', ')}. A person will check.` : '');
        const missing = d.config.questions.filter(q => q.required && !ctx.contact.answers[q.id]).map(q => q.id);
        return (missing.length ? `Saved. Still needed: ${missing.join(', ')}.` : 'Saved. All required answers are in.') + note;
      }
      case 'set_stage': {
        const stage = input.stage;
        if (!isContactState(stage) || !['qualifying', 'qualified', 'disqualified', 'nurture'].includes(stage)) return 'Unknown stage.';
        if (stage === 'qualified') {
          const missing = d.config.questions.filter(q => q.required && !ctx.contact.answers[q.id]).map(q => q.id);
          if (missing.length) return `Not yet: save these answers first: ${missing.join(', ')}.`;
        }
        await moveTo(stage, plainText(input.reason, 500) || stage);
        return `Stage is now ${state}.`;
      }
      case 'offer_times': {
        if (state !== 'qualified' && state !== 'no-show' && state !== 'nurture') return 'Qualify the contact first (set_stage qualified).';
        // Offering times is the first half of booking: in enquiry only mode no times are offered at all.
        if (store && decide(mode, 'book').decision === 'refuse') return 'You cannot offer or book times. Ask which day and time would suit them, and say the team will get back to them to arrange it.';
        if (!d.calendar) {
          const say = await toPerson('book a call', 'Calendar not connected; please book this qualified lead by hand.', 'Call the lead to book');
          if (say) { forcedReply = say; return 'Passed to the team.'; }
          return 'The calendar is not connected. Tell the contact a person will text them a time today.';
        }
        offers = await offerTimes(d.calendar, d.config.availability, d.now);
        return offers.length ? JSON.stringify(offers.map(o => ({ label: o.label, start: new Date(o.start).toISOString() }))) : 'No open times in the next days. Say a person will be in touch.';
      }
      case 'book_time': {
        const start = Date.parse(str(input.start, 40));
        if (!d.calendar) return 'The calendar is not connected.';
        if (!ctx.contact.phone && !ctx.contact.email) return 'Ask for their mobile or email first, and save it, so the confirmation reaches them.';
        if (!offers.length) offers = await offerTimes(d.calendar, d.config.availability, d.now, 12);
        const offer = offers.find(o => o.start === start);
        if (!offer) return 'That is not one of the offered times. Call offer_times and use a start value from it.';
        if (state !== 'qualified') await moveTo('qualified', 'Picked a time');
        if (!store) {
          // Without the permission check: the path before A-8, unchanged (books directly, errors surface as before).
          try {
            const r = await bookSlot({ calendar: d.calendar, rpc: d.rpc, auth: d.auth, send: async () => ({ sent: false, sid: null }), availability: d.config.availability, contact: ctx.contact, start, now: d.now, businessName: d.config.businessName, where: d.config.where, meetingTitle: d.config.meetingTitle });
            state = 'booked'; booked = true; bookedReply = r.confirmation || null;
            await handoff('sales', 'run the booked call', `Booked ${formatSlot(start, d.config.availability.timeZone)}. ` + (Object.entries(ctx.contact.answers).map(([k, v]) => `${k}: ${v}`).join('; ') || 'No answers saved.'), `Run the ${d.config.meetingTitle} at ${new Date(start).toISOString()}`);
            await scheduleReminders(d.rpc, d.auth, contactId, r.appointment, start, d.now);
            return 'Booked. The confirmation text is sent automatically; you do not need to write one.';
          } catch (e) {
            if (e instanceof SlotTaken) { offers = []; return 'That time was just taken. Call offer_times again and offer the new times.'; }
            throw e;
          }
        }
        const tz = d.config.availability.timeZone, label = formatSlot(start, tz);
        const box: { r?: BookOutcome } = {};
        const g = await act('book', { kind: 'book', start: new Date(start).toISOString(), end: new Date(offer.end).toISOString(), timeZone: tz },
          `Book ${who} for a ${d.config.meetingTitle} on ${label} (${tz})`, `setter:book:${contactId}:${start}`,
          async () => { box.r = await performBook(x, contactId, start, { confirm: false }); return { ok: box.r.ok, note: box.r.note }; });
        if (g.decision === 'hold_for_approval' && g.decided) {
          // The same time was already put to the owner and is no longer waiting: do not tell the contact it is held.
          offers = offers.filter(o => o.start !== start);
          return `Not booked: that time was put to the team earlier and was not confirmed (${g.decided}). Offer a different time from offer_times.`;
        }
        if (g.decision === 'hold_for_approval') { bookingHeld = true; forcedReply = g.say; return 'Held for the owner to confirm. Nothing is booked yet.'; }
        if (g.decision === 'refuse') {
          // enquiry_only: the AI takes a message for a person instead of booking.
          await takeMessage('book a call', `Wants the ${d.config.meetingTitle} on ${label}. Enquiry only mode: please arrange it by hand.`);
          forcedReply = g.say; return 'Not booked: a message was taken for the team.';
        }
        const r = box.r;
        if (r?.ok) {
          transitions.push(...r.transitions);
          // A retry of a booking already made has no new confirmation: say it is booked rather than reply nothing.
          state = 'booked'; booked = true; handedTo = 'sales';
          bookedReply = r.confirmation ?? `You're already booked with ${d.config.businessName} for ${label}. Reply here to change it, or STOP to opt out.`;
          return 'Booked. The confirmation text is sent automatically; you do not need to write one.';
        }
        if (r?.slotTaken) { offers = []; return 'That time was just taken. Call offer_times again and offer the new times.'; }
        return `Not booked: ${r?.note ?? 'the booking could not be completed.'} Tell the contact a person will confirm a time.`;
      }
      case 'handoff_receptionist':
        await handoff('receptionist', str(input.intent, 200), str(input.summary, 4000), 'Answer the customer');
        return 'Handed to the Receptionist. Tell the contact the team will help them shortly.';
      case 'escalate_human': {
        const bc = input.booking_change;
        const change: 'reschedule' | 'cancel' | null = returning && (bc === 'reschedule' || bc === 'cancel') ? bc : null;
        if (change) {
          // A-54: the Setter cannot move or cancel a booking, so a person does it. The hand-off is a 'transfer' through the
          // permission check; the contact hears a fixed line that never says the booking changed.
          const summary = `Wants to ${change} their booking (${bookingLine ?? 'no upcoming booking on file'}): ${str(input.summary, 3500) || 'see the conversation'}`;
          const say = await toPerson(`${change} booking`, summary, change === 'reschedule' ? 'A person agrees a new time with the contact and moves the booking' : 'A person cancels the booking and confirms with the contact');
          forcedReply = say || (store && mode === 'enquiry_only' ? decide(mode, change).say : '') || BOOKING_CHANGE_SAY[change];
          return 'Passed to the team.';
        }
        const say = await toPerson(str(input.intent, 200), str(input.summary, 4000), 'A person replies to the contact');
        // A booked contact: the fixed line, never model wording after a hand-off.
        if (returning) { forcedReply = say || RETURNING_HANDOFF_SAY; return 'Passed to the team.'; }
        if (say) { forcedReply = say; return 'Passed to the team.'; }
        return 'A person has been asked to follow up. Tell the contact someone will be in touch soon. Do not promise anything else.';
      }
      default:
        return 'Unknown tool.';
    }
  }

  // Booked, but no upcoming booking on file: a person checks, in code. No model call, so no time can be guessed.
  if (returning && !bookingLine) {
    const say = await toPerson('check booking', 'Contact is booked but no upcoming booking is on file (it may have already happened). Please check and reply to them.', 'A person checks the booking and replies to the contact');
    const text = (say || NO_BOOKING_SAY).slice(0, replyLimit[channel]);
    if (d.logReply !== false) await d.rpc('fo_log_outbound', { ...a, contact: contactId, message: text, agent_name: 'setter', prompt: promptVersion });
    return result(text);
  }

  let reply = '';
  for (let round = 0; round < 6; round++) {
    let res: LlmResponse;
    try {
      res = await d.llm({ system, messages, tools });
      if (!res || !Array.isArray(res.content)) throw new MalformedModelResponse();
    } catch (e) {
      // Task A-55 (G2): the model call failed. Only the model call is caught here: tool errors are already passed back
      // to the model, and store errors still fail the turn (the route answers 503) rather than promise a follow-up
      // nobody recorded.
      modelFailure = modelFailureCode(e);
      break;
    }
    messages.push({ role: 'assistant', content: res.content });
    const calls = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    reply = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join(' ').trim();
    if (!calls.length || res.stopReason !== 'tool_use') break;
    const results: ToolResultBlock[] = [];
    for (const c of calls) {
      try { results.push({ type: 'tool_result', tool_use_id: c.id, content: await run(c) }); }
      catch (e) { results.push({ type: 'tool_result', tool_use_id: c.id, content: e instanceof Error ? e.message : 'Tool failed.', is_error: true }); }
    }
    messages.push({ role: 'user', content: results });
    if (booked || forcedReply) break;
  }
  // The loop stops right after a booking or a forced reply, so a model failure never follows one.
  if (modelFailure) return fallback(modelFailure);
  // A booked contact: a model reply that claims the booking changed is never sent. The fixed line goes instead and a person
  // is asked to follow up (unless this turn already handed the contact on).
  if (returning && !forcedReply && BOOKING_CHANGE_CLAIM.test(reply)) {
    const say = handedTo ? null : await toPerson('check booking reply', 'The AI reply claimed the booking was changed and was not sent. Nothing was changed. Please check what the contact wants and reply to them.', 'A person replies to the contact');
    forcedReply = say || RETURNING_HANDOFF_SAY;
  }
  // After a booking the logged confirmation is the reply; after a held or refused action, decide()'s words; otherwise the
  // model's text (capped to two SMS).
  const own = forcedReply ?? reply;
  let text = booked ? bookedReply : ((channel === 'email' ? own.trim() : own.replace(/\s+/g, ' ').trim()).slice(0, replyLimit[channel]) || null);
  if (text && !booked && d.logReply !== false) await d.rpc('fo_log_outbound', { ...a, contact: contactId, message: text, agent_name: 'setter', prompt: promptVersion });
  // The follow-up ladder: not after a booking, a hand-off, or a booking waiting for the owner.
  if (!store) {
    // Without the permission check: the start before A-8, unchanged (now + gapBefore(1), no new checks).
    if (text && !booked && !handedTo && (ctx.contact.phone || ctx.contact.email) && !['booked', 'disqualified', 'customer'].includes(state)) await startFollowUps(d.rpc, d.auth, contactId, d.now);
  } else if (text && !booked && !handedTo && !bookingHeld && !['booked', 'disqualified', 'customer'].includes(state)) await followUp();
  if (!text) text = null;
  return result(text);

  /** Model call failed: the fixed reply, a hand-off to a person (as escalate_human), no follow-up ladder, no booking.
   * Logs only the safe code, never the error message, provider body or key. */
  async function fallback(code: string): Promise<SetterTurn> {
    console.warn(`[front-office/setter] model call failed (${code}); fixed fallback reply used and the lead handed to a person.`);
    // Already handed on this turn (an earlier round's escalate_human or handoff_receptionist): not recorded twice.
    if (!handedTo) await toPerson('AI could not reply', `The AI model call failed (${code}). The contact got the fixed holding reply: "${SETTER_FALLBACK_REPLY}" Please reply to them.`, 'A person replies to the contact');
    const text = SETTER_FALLBACK_REPLY.slice(0, replyLimit[channel]);
    if (d.logReply !== false) await d.rpc('fo_log_outbound', { ...a, contact: contactId, message: text, agent_name: 'setter', prompt: SETTER_FALLBACK_PROMPT });
    return result(text);
  }

  async function followUp() {
    const chk = checkFollowUp({ ...ctx, contact: { ...ctx.contact, state } }, d.channel);
    if (!chk.ok) {
      actions.push({ action: 'follow_up', decision: 'skipped', reason: chk.why, pendingActionId: null, summary: `No follow-up for ${who}.`, payload: null, ok: null, note: null });
      return;
    }
    const body = fillTemplate(d.config.followUps[0] ?? 'Hi {name}, just checking in.', { name: ctx.contact.name }).slice(0, 1000);
    await act('follow_up', { kind: 'follow_up', channel: chk.channel, body, promptVersion: FOLLOW_UP_PROMPT, step: 1 },
      `Follow up with ${who} by ${chk.channel === 'sms' ? 'text' : 'email'} if they go quiet: "${body}"`,
      // Stable per contact: owner_approval keeps one follow-up item per contact instead of a new one every turn. Once
      // that item is decided, the same key returns it (act() reports 'decided') and no new follow-up is queued.
      `setter:follow_up:${contactId}:1`,
      () => performFollowUp(x, contactId, chk.channel));
  }
}
