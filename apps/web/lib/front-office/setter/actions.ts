// Setter actions through the shared permission check (task A-8).
//
// Every Setter action that commits the business (booking, the follow-up ladder, handing a lead to a person) is performed
// by one of the functions below. The Setter turn (agent.ts) calls them through pending-actions.ts gate(), which asks
// permissions.ts decide() for the business's Setter mode; the owner approval queue performs a held one later through
// createSetterExecutor(), which calls the very same functions. So a held action and a direct one do exactly the same
// thing, and each re-reads the contact first: a held action that went stale (the slot was taken, the contact opted out,
// a person took over) is not performed and the owner gets a plain-English note instead.
//
// Business rules that apply in every mode, before the permission check:
// - Follow-ups need consent (checkFollowUp, A-45). Explicit consent is fo_contact_context contact.consent (A-38 records
//   in fo_contact_consents): an open grant for SMS or email allows a follow-up on that channel. Without a grant, a
//   follow-up is only allowed on the same channel the customer messaged the business on (an SMS conversation followed up
//   by SMS, an email one by email): that continues their own conversation, it is not marketing, so their inbound message
//   is the evidence. Moving to a different channel (website chat, Instagram or Messenger to SMS/email, or SMS to email)
//   needs the explicit grant for that channel. An opt-out always wins over any grant. When the customer's channel is
//   not known, only a grant counts (A-47: fail closed).
// - Opt-out stops everything (the turn never runs; a held follow-up is not performed; jobs.ts cancels due ones).
// - Channel rules: follow-ups go by SMS (a mobile on record) or email, never into website chat, Instagram or Messenger
//   (a closed chat cannot be reached and Meta only allows replies within 24 hours of the customer's last message).
// - Quiet hours: the first follow-up is never due between 8 pm and 8 am in the business's time zone; it moves to 8 am.
// - Once the lead is handed to a person (the latest handoff's owner is 'human'), the AI stops replying until a person
//   hands it back (a handoff from 'human' to 'setter').
import { bookSlot, confirmationText, SlotTaken } from '../booking';
import type { CalendarProvider } from '../calendar/google';
import { formatSlot } from '../calendar/slots';
import { DEFAULT_OPERATING_MODE, hasConsent, isDeliverableEmail } from '../contracts';
import type { ContactConsent, PendingActionPayload, PermissionDecision } from '../contracts';
import { checkedHandoff } from '../handoff';
import type { Agent, Channel } from '../handoff';
import { FOLLOW_UP_PROMPT, gapBefore, scheduleReminders } from '../jobs';
import type { ChannelAuth, Rpc } from '../orchestrator';
import { createSupabasePendingActionStore } from '../pending-actions';
import type { ActionExecutor, ExecutionResult, PendingActionStore } from '../pending-actions';
import type { SmsSender } from '../sms-send';
import { canTransition } from '../state';
import type { ContactState } from '../state';
import type { SetterConfig } from './config';

/** fo_contact_context: everything about a contact before the Setter acts. */
export type SetterContext = {
  /** consent: explicit per-channel consent (A-38). Missing (older database): no consent on either channel. */
  contact: { id: string; name: string | null; phone: string | null; email: string | null; state: ContactState; optedOut: boolean; answers: Record<string, string>; consent?: ContactConsent };
  messages: { direction: 'inbound' | 'outbound'; body: string; agent: string | null; at: string }[];
  appointment: { id: string; starts: string; ends: string; status: string } | null;
  handoffs: { from: string; owner: string; intent: string; summary: string }[];
};

/** One lead status change made by the Setter. fo_set_state writes the same change to fo_contacts and fo_events. */
export type StatusTransition = { from: ContactState; to: ContactState; at: string; reason: string };

/** One action the Setter tried this turn and what happened. 'skipped': a business rule stopped it before the permission
 * check (no consent, opted out, no reachable channel). payload and summary are what the owner sees in the queue. */
export type SetterActionRecord = {
  action: 'book' | 'follow_up' | 'transfer' | 'take_message';
  decision: PermissionDecision | 'skipped';
  reason: string;
  pendingActionId: string | null;
  summary: string;
  payload: PendingActionPayload | null;
  /** perform only: whether it worked. */
  ok: boolean | null;
  note: string | null;
};

/** Local hours; start > end wraps midnight. */
export type QuietHours = { start: number; end: number };
export const DEFAULT_QUIET_HOURS: QuietHours = { start: 20, end: 8 };

export type SetterPermissions = {
  /** The approval queue and the mode in force. Live routes: channelPermissions(). Tests and labs: the memory store. */
  store: PendingActionStore;
  quietHours?: QuietHours;
  /** How long a held action waits for the owner (5 minutes to 30 days). Default 24 hours. */
  ttlMinutes?: number;
};

/** What performing a Setter action needs. now: the time it is performed (the turn, or the owner's approval). */
export type SetterActionDeps = {
  rpc: Rpc; auth: ChannelAuth; calendar: CalendarProvider | null; config: SetterConfig; now: number; send: SmsSender;
  /** The conversation's channel, for handoff records. Default: sms when there is a mobile, else email, else web-chat. */
  channel?: Channel;
  /** The channel the customer messaged on, for the follow-up consent rule (checkFollowUp). Not set or null: not known,
   * which fails closed (A-47): only an explicit consent grant allows a follow-up. Every live caller sets it (setter/agent.ts
   * from the conversation, the approval queue from the channel the held item came from). */
  via?: Channel | null;
  quietHours?: QuietHours;
};

/** The permission store for a live channel: modes and held actions through the channel key (migration 202611100001). */
export function channelPermissions(rpc: Rpc, auth: ChannelAuth, options: { quietHours?: QuietHours; ttlMinutes?: number } = {}): SetterPermissions {
  return { store: createSupabasePendingActionStore({ rpc, channel: { id: auth.channel, key: auth.key } }), ...options };
}

/** The same store, except that a mode that cannot be read is the safe default (enquiry_only): nothing is committed. */
export function failSafeStore(s: PendingActionStore): PendingActionStore {
  return {
    async mode(product) { try { return await s.mode(product); } catch { return DEFAULT_OPERATING_MODE; } },
    request: input => s.request(input),
    list: filter => s.list(filter),
    decide: (id, decision, by, note) => s.decide(id, decision, by, note),
    finish: (id, ok, note) => s.finish(id, ok, note),
    expire: () => s.expire(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------------------------

/** True while a person owns the conversation: the latest handoff went to 'human' and nobody has handed it back. */
export function withPerson(handoffs: SetterContext['handoffs']): boolean {
  return handoffs.at(-1)?.owner === 'human';
}

const NO_FOLLOW_UP: readonly ContactState[] = ['booked', 'disqualified', 'customer'];
export type FollowUpCheck = { ok: true; channel: 'sms' | 'email'; consent: string } | { ok: false; why: string };

/** Whether this contact may get the follow-up ladder at all, and on which channel. Pure.
 * via: the channel the customer is talking on. Not given (unknown): fails closed (A-47), so only an explicit consent grant
 * allows a follow-up; the conversation is never assumed to be on the follow-up's channel.
 * Rule (see the note at the top): opt-out wins; then a reply on the customer's own SMS/email channel after they
 * messaged; otherwise only an explicit consent grant for SMS (mobile on record) or email (address on record). */
export function checkFollowUp(ctx: SetterContext, via?: Channel): FollowUpCheck {
  const c = ctx.contact;
  if (c.optedOut) return { ok: false, why: 'The contact opted out.' };
  if (NO_FOLLOW_UP.includes(c.state)) return { ok: false, why: `The contact is ${c.state}.` };
  if (withPerson(ctx.handoffs)) return { ok: false, why: 'A person is looking after this contact.' };
  const reach = (ch: 'sms' | 'email') => ch === 'sms' ? !!c.phone : isDeliverableEmail(c.email);
  const own = via === 'sms' || via === 'email' ? via : null;
  // NOTE: fo_contact_context returns only the latest 40 messages, so a long thread of only outbound messages could hide
  // the contact's inbound message; that fails safe (no same-channel follow-up). Explicit consent is not affected.
  const first = ctx.messages.find(m => m.direction === 'inbound');
  if (first && (own === 'sms' || own === 'email') && reach(own)) {
    return { ok: true, channel: own, consent: `The contact messaged the business first${first.at ? ` (${first.at})` : ''}.` };
  }
  for (const ch of ['sms', 'email'] as const) {
    if (reach(ch) && hasConsent(c.consent, ch)) return { ok: true, channel: ch, consent: `The contact gave recorded consent to be contacted by ${ch === 'sms' ? 'text' : 'email'}.` };
  }
  if (!first) return { ok: false, why: 'No recorded consent: the contact has not messaged the business.' };
  if (!c.phone && !isDeliverableEmail(c.email)) return { ok: false, why: 'No mobile or email on record. Follow-ups never go into website chat, Instagram or Messenger.' };
  return { ok: false, why: `No recorded consent for ${c.phone ? 'texts' : 'email'}: the contact messaged on ${via ?? 'a channel that is not known'} and has not agreed to be contacted another way.` };
}

function localMinutes(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  const n = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return n('hour') * 60 + n('minute');
}
export function inQuietHours(t: number, timeZone: string, q: QuietHours = DEFAULT_QUIET_HOURS): boolean {
  const m = localMinutes(t, timeZone), s = q.start * 60, e = q.end * 60;
  if (s === e) return false;
  return s > e ? m >= s || m < e : m >= s && m < e;
}
/** t, or the end of the quiet hours it falls in (on the hour, in the business's time zone). */
export function outsideQuietHours(t: number, timeZone: string, q: QuietHours = DEFAULT_QUIET_HOURS): number {
  if (!inQuietHours(t, timeZone, q)) return t;
  const wait = (q.end * 60 - localMinutes(t, timeZone) + 1440) % 1440;
  return t - (t % 60_000) + wait * 60_000;
}

// ---------------------------------------------------------------------------------------------------------------------
// Performing
// ---------------------------------------------------------------------------------------------------------------------

const iso = (t: number) => new Date(t).toISOString();
const auth = (x: SetterActionDeps) => ({ channel: x.auth.channel, channel_key: x.auth.key });
const readContext = async (x: SetterActionDeps, contact: string) => await x.rpc('fo_contact_context', { ...auth(x), contact }) as SetterContext;
const channelOf = (x: SetterActionDeps, ctx: SetterContext): Channel => x.channel ?? (ctx.contact.phone ? 'sms' : isDeliverableEmail(ctx.contact.email) ? 'email' : 'web-chat');
const noSend: SmsSender = async () => ({ sent: false, sid: null });

/** Moves the lead and records the change. Passes through qualifying when needed (new -> qualifying -> qualified). */
async function setState(x: SetterActionDeps, contact: string, from: ContactState, to: ContactState, reason: string, out: StatusTransition[]): Promise<ContactState> {
  let state = from;
  if (!canTransition(state, to) && canTransition(state, 'qualifying') && canTransition('qualifying', to)) state = await setState(x, contact, state, 'qualifying', reason, out);
  if (!canTransition(state, to)) throw new Error(`Cannot move from ${state} to ${to}.`);
  const next = await x.rpc('fo_set_state', { ...auth(x), contact, new_state: to, agent_name: 'setter', reason: reason.slice(0, 500) }) as ContactState;
  out.push({ from: state, to: next, at: iso(x.now), reason: reason.slice(0, 500) });
  return next;
}

/** Records one handoff in fo_handoffs (and fo_events) through the handoff contract. */
export async function recordHandoff(x: SetterActionDeps, ctx: SetterContext, owner: Agent, intent: string, summary: string, nextAction: string): Promise<void> {
  const h = checkedHandoff({
    contact: { id: ctx.contact.id, name: ctx.contact.name, phone: ctx.contact.phone, email: ctx.contact.email, state: ctx.contact.state },
    channel: channelOf(x, ctx), intent: intent || 'follow up', answers: ctx.contact.answers, summary: summary || 'See the conversation.', nextAction, from: 'setter', owner,
  });
  await x.rpc('fo_record_handoff', { ...auth(x), contact: ctx.contact.id, handoff: h });
}

export type BookOutcome = { ok: boolean; note: string; slotTaken: boolean; confirmation: string | null; transitions: StatusTransition[] };

/** Books one time: re-reads the contact, checks it is still bookable, books (booking.ts re-checks the calendar), hands
 * the lead to Sales and schedules reminders. confirm: send the confirmation by SMS (an approved action, after the
 * conversation); in a turn the confirmation is the reply itself. Unexpected errors are thrown. */
export async function performBook(x: SetterActionDeps, contactId: string, start: number, opts: { confirm: boolean }): Promise<BookOutcome> {
  const transitions: StatusTransition[] = [];
  const no = (note: string, slotTaken = false): BookOutcome => ({ ok: false, note, slotTaken, confirmation: null, transitions });
  if (!x.calendar) return no('The calendar is not connected, so nothing was booked.');
  const ctx = await readContext(x, contactId);
  const c = ctx.contact;
  if (c.optedOut) return no('The contact has opted out, so nothing was booked.');
  // A person took over since: they stay in charge. Booking now would also record a 'sales' handoff that ends theirs.
  if (withPerson(ctx.handoffs)) return no('A person is looking after this contact now, so nothing was booked.');
  if (c.state === 'booked' || ctx.appointment) return no('The contact already has a booking, so nothing else was booked.');
  if (!c.phone && !isDeliverableEmail(c.email)) return no('There is no mobile or email to confirm the booking to, so nothing was booked.');
  if (!Number.isFinite(start) || start <= x.now) return no('That time has already passed, so nothing was booked.');
  let state: ContactState = c.state;
  try {
    if (state !== 'qualified') state = await setState(x, contactId, state, 'qualified', 'Picked a time', transitions);
  } catch {
    return no(`The contact is ${state} and cannot be booked, so nothing was booked.`);
  }
  const tz = x.config.availability.timeZone, label = formatSlot(start, tz);
  let r: Awaited<ReturnType<typeof bookSlot>>;
  try {
    r = await bookSlot({ calendar: x.calendar, rpc: x.rpc, auth: x.auth, send: opts.confirm ? x.send : noSend, availability: x.config.availability, contact: c, start, now: x.now, businessName: x.config.businessName, where: x.config.where, meetingTitle: x.config.meetingTitle });
  } catch (e) {
    if (e instanceof SlotTaken) return no(`${label} is no longer free, so nothing was booked.`, true);
    throw e;
  }
  if (r.duplicate) return { ok: true, note: `Already booked for ${label}.`, slotTaken: false, confirmation: confirmationText(x.config.businessName, start, tz, x.config.where), transitions };
  transitions.push({ from: state, to: 'booked', at: iso(x.now), reason: `Booked ${label}` });
  await recordHandoff(x, { ...ctx, contact: { ...c, state: 'booked' } }, 'sales', 'run the booked call', `Booked ${label}. ` + (Object.entries(c.answers).map(([k, v]) => `${k}: ${v}`).join('; ') || 'No answers saved.'), `Run the ${x.config.meetingTitle} at ${iso(start)}`);
  await scheduleReminders(x.rpc, x.auth, contactId, r.appointment, start, x.now);
  const sent = opts.confirm ? (r.sent ? ' Confirmation sent.' : ' Confirmation logged, not sent (live sending off or no mobile).') : '';
  return { ok: true, note: `Booked ${label}.${sent}`, slotTaken: false, confirmation: r.confirmation || null, transitions };
}

/** Schedules follow-up 1 of the ladder after re-checking consent, opt-out, a person taking over and the channel.
 * jobs.ts sends it (and the later steps) when due. */
export async function performFollowUp(x: SetterActionDeps, contactId: string, channel: 'sms' | 'email' | null): Promise<ExecutionResult> {
  const ctx = await readContext(x, contactId);
  // Unknown via fails closed (A-47): x.channel (the record's channel) is never taken as the customer's own channel.
  const chk = checkFollowUp(ctx, x.via ?? undefined);
  if (!chk.ok) return { ok: false, note: `No follow-up: ${chk.why}` };
  if (channel && channel !== chk.channel) return { ok: false, note: `No follow-up: the contact can no longer be reached by ${channel === 'sms' ? 'text' : 'email'}.` };
  const tz = x.config.availability.timeZone;
  const due = outsideQuietHours(x.now + gapBefore(1), tz, x.quietHours);
  await x.rpc('fo_schedule_job', { ...auth(x), contact: contactId, job_kind: 'follow-up', job_step: 1, due: iso(due), appointment: null });
  return { ok: true, note: `Follow-up 1 by ${chk.channel === 'sms' ? 'text' : 'email'} scheduled for ${formatSlot(due, tz)}.` };
}

/** Hands the lead to a person: one fo_handoffs record; from then on the AI does not reply (withPerson). */
export async function performTransfer(x: SetterActionDeps, contactId: string, intent: string, summary: string, nextAction = 'A person replies to the contact'): Promise<ExecutionResult> {
  const ctx = await readContext(x, contactId);
  await recordHandoff(x, ctx, 'human', intent, summary, nextAction);
  return { ok: true, note: 'Handed to a person. The AI stops replying to this contact.' };
}

/** The executor the owner approval queue uses for Setter actions (approvePendingAction). It re-validates each held
 * action against the contact as it is now and performs it with the same functions as a direct action. */
export function createSetterExecutor(x: SetterActionDeps): ActionExecutor {
  return async ({ product, payload, contactId, pendingActionId }) => {
    if (product !== 'setter' || !contactId || !payload) return { ok: false, note: 'Not a Setter action, so nothing was done.' };
    switch (payload.kind) {
      case 'book': {
        const r = await performBook(x, contactId, Date.parse(payload.start), { confirm: pendingActionId !== null });
        return { ok: r.ok, note: r.note };
      }
      case 'follow_up':
        if (payload.step !== 1) return { ok: false, note: 'Only the first follow-up is held; later ones follow the ladder.' };
        return performFollowUp(x, contactId, payload.channel === 'sms' || payload.channel === 'email' ? payload.channel : null);
      case 'transfer': {
        const [intent, ...rest] = payload.reason.split(': ');
        return performTransfer(x, contactId, (intent || 'follow up').slice(0, 200), rest.join(': ') || payload.reason || 'See the conversation.');
      }
      default:
        return { ok: false, note: 'The Setter does not perform this kind of action.' };
    }
  };
}
