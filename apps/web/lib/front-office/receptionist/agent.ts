// The AI Receptionist (phone). One caller turn: stream what to say, running the tools the model calls against the real
// store and calendar on the way. Transfers and hang-ups are returned as actions for the voice platform (Vapi) to carry
// out. Facts come only from the business's own FAQ (settings); anything else becomes a message or a transfer.
import { bookSlot, cancelBooking, offerTimes, rescheduleSlot, SlotTaken } from '../booking';
import type { Offer } from '../booking';
import type { CalendarProvider } from '../calendar/google';
import { formatSlot } from '../calendar/slots';
import type { EmailSender } from '../email';
import { checkedHandoff } from '../handoff';
import type { Agent } from '../handoff';
import { scheduleReminders } from '../jobs';
import type { LlmMessage, StreamLlm, ToolResultBlock, ToolSpec, ToolUseBlock } from '../llm';
import type { ChannelAuth, Rpc } from '../orchestrator';
import type { OperatingMode } from '../contracts';
import { decide } from '../permissions';
import { availabilityFor, knowledgeAnswer } from '../settings';
import type { AgentSettings } from '../settings';
import { canTransition, isContactState } from '../state';
import type { ContactState } from '../state';
import type { SmsSender } from '../sms-send';
import { plainText } from '../text';
import { ASK_TO_VERIFY, REFUSED_UNVERIFIED, VERIFY_ARGS, verifyBookingCaller } from './identity';
import { RECEPTIONIST_PROMPT_VERSION, receptionistSystemPrompt } from './prompt';

export type VoiceOut = { type: 'text'; text: string } | { type: 'transfer'; number: string } | { type: 'end' };
export type CallerTurn = { role: 'user' | 'assistant'; content: string };
export type ReceptionistDeps = {
  llm: StreamLlm; rpc: Rpc; auth: ChannelAuth; calendar: CalendarProvider | null; send: SmsSender; email: EmailSender;
  settings: AgentSettings; now: number;
  call: { id: string | null; caller: string | null; contact: string | null };
  conversation: CallerTurn[];
  /** The business's Receptionist operating mode. Optional: tools that only gather information work the same in every
   * mode (decide() answers 'perform' for take_message whatever the mode). */
  mode?: OperatingMode;
};
export type Outcome = 'faq' | 'faq-miss' | 'qualified' | 'booked' | 'rescheduled' | 'cancelled' | 'message' | 'transfer' | 'quote';
/** fo_voice_outcome's database check accepts only the original outcomes (migration 202611080001); a quote request is
 * stored there as 'message' until the database list gains 'quote'. The turn summary keeps 'quote'. */
const STORED_OUTCOME: Partial<Record<Outcome, string>> = { quote: 'message' };
/** Where a quote request is saved on the contact record (fo_contacts.answers), next to the qualifying answers. */
export const QUOTE_ANSWER_KEYS = { need: 'quote_need', where: 'quote_where', when: 'quote_when', budget: 'quote_budget' } as const;
export type TurnSummary = { said: string; tools: string[]; outcomes: Outcome[]; action: 'transfer' | 'end' | null };

type Ctx = {
  contact: { id: string; name: string | null; phone: string | null; email: string | null; state: ContactState; optedOut: boolean; answers: Record<string, string> };
  appointment: { id: string; starts: string; ends: string; status: string } | null;
  handoffs?: { intent?: string; summary?: string }[];
};
const UNVERIFIED_INTENT = 'booking change not verified';

const phoneProp = { type: 'string', description: 'Caller mobile in E.164, e.g. +61412345678. Only if their number is withheld or they gave another one.' };
export const receptionistTools: ToolSpec[] = [
  { name: 'answer_faq', description: 'Look up the business’s own answer to a factual question (prices, hours, classes, location, policies). Say only what it returns.', input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
  { name: 'qualify', description: 'Save the caller’s answers to the qualifying questions by question id, and their name, mobile or email if given.', input_schema: { type: 'object', properties: { answers: { type: 'object', additionalProperties: { type: 'string' } }, name: { type: 'string' }, phone: phoneProp, email: { type: 'string' } }, required: ['answers'] } },
  { name: 'check_availability', description: 'Get two or three open times from the live calendar.', input_schema: { type: 'object', properties: {} } },
  { name: 'book', description: 'Book one of the times from check_availability, using its start value.', input_schema: { type: 'object', properties: { start: { type: 'string' }, phone: phoneProp }, required: ['start'] } },
  { name: 'reschedule', description: 'Move the caller’s existing booking to one of the times from check_availability. The caller must first confirm who they are: pass the name the booking is under as verify_name, or its day and time as verify_time. The phone number alone is not enough.', input_schema: { type: 'object', properties: { start: { type: 'string' }, ...VERIFY_ARGS }, required: ['start'] } },
  { name: 'cancel', description: 'Cancel the caller’s existing booking, after they confirm. The caller must first confirm who they are: pass the name the booking is under as verify_name, or its day and time as verify_time. The phone number alone is not enough.', input_schema: { type: 'object', properties: { reason: { type: 'string' }, ...VERIFY_ARGS }, required: ['reason'] } },
  { name: 'take_message', description: 'Take a message for the team, who will call back.', input_schema: { type: 'object', properties: { message: { type: 'string' }, name: { type: 'string' }, phone: phoneProp, urgent: { type: 'boolean' } }, required: ['message'] } },
  { name: 'request_quote', description: 'When the caller asks what a job or service would cost for them ("how much would it cost to…"), capture a quote request for the team: what they need, where, when or their timeframe, their budget if they offer one, and their name, mobile or email. Never give a price, range or estimate yourself: the team sends the quote.', input_schema: { type: 'object', properties: { need: { type: 'string', description: 'What they want done or quoted, in their words.' }, where: { type: 'string', description: 'Where (suburb, address or site), if relevant.' }, when: { type: 'string', description: 'When, or their timeframe.' }, budget: { type: 'string', description: 'Their budget, only if they offered one.' }, name: { type: 'string' }, phone: phoneProp, email: { type: 'string' } }, required: ['need'] } },
  { name: 'transfer', description: 'Put the caller through to a person at the business (urgent, complaint, billing, or they ask for a person).', input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
  { name: 'end_call', description: 'Hang up, after saying goodbye.', input_schema: { type: 'object', properties: {} } },
];

const STOP = new Set('the and for are you your our with what how much does can have when where which this that from about there their them they is it to of in on at a an do i we be or if my me any'.split(' '));
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
/** The business's FAQ entries that best match a question (word overlap), best first. Empty: nothing on file. */
export function matchFaqs(question: string, faqs: AgentSettings['faqs'], max = 2) {
  const q = words(question);
  return faqs.map(f => { const fw = words(f.q + ' ' + f.a); let n = 0; for (const w of q) if (fw.has(w)) n++; return { f, n: n + (words(f.q).size && [...words(f.q)].every(w => q.has(w)) ? 2 : 0) }; })
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, max).map(x => x.f);
}

const hasKnowledge = (s: AgentSettings) => { const k = s.knowledge; return !!k && (k.services.length + k.offers.length + k.policies.length + k.objections.length) > 0; };
export const NO_ANSWER = 'No answer on file. Say you do not have that in front of you and offer to take a message or put them through.';
/** What answer_faq hands back to the model: the business's own words (knowledge base, then FAQs), an objection rule's
 * reply, or an honest "not on file". hit false: nothing to state (logged as faq-miss). Never a generated fact. */
export function faqLookup(question: string, s: AgentSettings, now: number): { hit: boolean; result: string } {
  const k = knowledgeAnswer(question, s, now);
  if (k.objection) return { hit: true, result: JSON.stringify([{ question: 'objection', answer: k.objection.response, ...(k.objection.escalate ? { note: 'Then offer to take a message so a person from the team follows up.' } : {}) }]) };
  const noPrice = (names: string[]) => names.filter(x => x !== 'that');
  if (!k.answers.length && k.missingPrice.length) {
    const named = noPrice(k.missingPrice);
    return { hit: false, result: `No price on file${named.length ? ` for ${named.join(', ')}` : ''}. Do not give a price, range or estimate. Say you do not have that price in front of you, that the team will check and get back to them, and offer to take a message.` };
  }
  // FAQs the knowledge base did not already cover, by the original matcher (kept so existing FAQ answers behave as before).
  const seen = new Set(k.answers.map(a => a.answer));
  const faqs = matchFaqs(question, s.faqs).filter(f => !seen.has(f.a)).map(f => ({ question: f.q, answer: f.a }));
  const answers = [...k.answers.map(a => ({ question: a.topic, answer: a.answer })), ...faqs].slice(0, 3);
  if (!answers.length) return { hit: false, result: NO_ANSWER };
  const missing = noPrice(k.missingPrice);
  return { hit: true, result: JSON.stringify(missing.length ? [...answers, { question: 'not on file', answer: `No price on file for ${missing.join(', ')}: do not give one, say the team will confirm it.` }] : answers) };
}

/** Vapi's conversation as Messages API turns: user first and last, same-role turns merged. */
export function callTranscript(turns: CallerTurn[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const t of turns) {
    const text = t.content.trim();
    if (!text) continue;
    const last = out.at(-1);
    if (last && last.role === t.role) last.content = `${last.content as string}\n${text}`;
    else out.push({ role: t.role, content: text });
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '(The call connected.)' });
  if (out.at(-1)?.role !== 'user') out.push({ role: 'user', content: '(The caller is silent.)' });
  return out;
}

const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const cleanPhone = (v: unknown) => str(v, 24).replace(/[\s()-]/g, '').replace(/^0(?=[2-478]\d{8}$)/, '+61');
const E164 = /^\+[1-9][0-9]{6,14}$/;

/** Everything the Receptionist can do on one call, against the real store and calendar. Used by the streamed turn and by
 * Vapi tool-call webhooks (when tools are configured on the Vapi side instead). */
export async function receptionistSession(d: Omit<ReceptionistDeps, 'llm' | 'conversation'>) {
  const s = d.settings, tz = s.timeZone, availability = availabilityFor(s);
  const a = { channel: d.auth.channel, channel_key: d.auth.key };
  const used: string[] = [], outcomes: Outcome[] = [];
  let contactId = d.call.contact, ctx: Ctx | null = null, offers: Offer[] = [], action: TurnSummary['action'] = null, transferTo = '';
  /** The quote request already captured in this session: whether it was handed off and staff told, and the contact
   * details they were told about. Keeps a second request_quote from duplicating the handoff or the notice. */
  let quoteState: { handedOff: boolean; notified: boolean; phone: string | null; email: string | null; updateSent: boolean } | null = null;
  /** What was stored for each contact when it was first loaded in this session, before any tool ran. */
  const snapshots = new Map<string, { name: string | null; appt: { id: string; starts: string } | null }>();
  const load = async () => {
    ctx = contactId ? await d.rpc('fo_contact_context', { ...a, contact: contactId }) as Ctx : null;
    const c = ctx as Ctx | null;
    if (c && !snapshots.has(c.contact.id)) snapshots.set(c.contact.id, { name: c.contact.name, appt: c.appointment ? { id: c.appointment.id, starts: c.appointment.starts } : null });
  };
  await load();
  const outcome = async (o: Outcome) => {
    if (!outcomes.includes(o)) outcomes.push(o);
    if (d.call.id) await d.rpc('fo_voice_outcome', { ...a, call_id: d.call.id, outcome: STORED_OUTCOME[o] ?? o }).catch(() => undefined);
  };
  /** The caller as a contact: from the call, or from a number they gave. */
  async function ensureContact(phoneArg: unknown, name?: string): Promise<string | null> {
    const phone = cleanPhone(phoneArg);
    if (phone && E164.test(phone) && d.call.id && (!ctx || ctx.contact.phone !== phone)) {
      // The name is saved only after we know whether this contact has a booking (nameToSave): fo_voice_contact would
      // otherwise name a contact that has no name on file yet, even one holding someone else's booking.
      contactId = await d.rpc('fo_voice_contact', { ...a, call_id: d.call.id, phone_number: phone, contact_name: null }) as string;
      await load();
      const c = ctx as Ctx | null, nm = nameToSave(name ?? '');
      if (c && nm && !c.contact.name) { await d.rpc('fo_save_details', { ...a, contact: c.contact.id, new_answers: {}, contact_name: nm, contact_email: null, contact_phone: null }); c.contact.name = nm; }
    }
    return contactId;
  }
  async function moveTo(target: ContactState, reason: string) {
    const c = ctx as Ctx | null;
    if (!c || c.contact.state === target) return;
    if (!canTransition(c.contact.state, target) && canTransition(c.contact.state, 'qualifying') && canTransition('qualifying', target)) await moveTo('qualifying', reason);
    if (!canTransition(c.contact.state, target)) throw new Error(`Cannot move from ${c.contact.state} to ${target}.`);
    const next = await d.rpc('fo_set_state', { ...a, contact: c.contact.id, new_state: target, agent_name: 'receptionist', reason: reason.slice(0, 500) });
    c.contact.state = isContactState(next) ? next : target;
  }
  async function handoff(owner: Agent, intent: string, summary: string, nextAction: string) {
    const c = ctx as Ctx | null;
    if (!c) return;
    const h = checkedHandoff({ contact: { id: c.contact.id, name: plainText(c.contact.name, 160) || null, phone: c.contact.phone, email: c.contact.email, state: c.contact.state }, channel: 'voice', intent: intent || 'call back', answers: c.contact.answers, summary: summary || 'See the call.', nextAction, from: 'receptionist', owner });
    await d.rpc('fo_record_handoff', { ...a, contact: c.contact.id, handoff: h });
  }
  /** Second factor before a booking is moved or cancelled (identity.ts): the caller number alone is never enough.
   * Returns null when the caller is verified, else the words to hand back to the model with nothing changed. A wrong
   * detail locks the call for the rest of it (no guessing), hands the request to staff once and reveals nothing. */
  let verifiedFor: string | null = null, locked = false, lockHandedOff = false;
  /** A wrong detail on THIS call, from an earlier utterance or webhook (each builds a fresh session): the hand-off we
   * wrote carries a "[call <id>]" marker, read back through fo_contact_context's handoffs. */
  const callMarker = d.call.id ? `[call ${d.call.id}]` : null;
  const failedEarlier = () => !!callMarker && ((ctx as Ctx | null)?.handoffs ?? []).some(h => h.intent === UNVERIFIED_INTENT && typeof h.summary === 'string' && h.summary.includes(callMarker));
  /** The stored name may be replaced only when nothing is at stake: a contact with a booking keeps the name on file
   * until the caller has been verified, or a spoofer could rename the victim and then "confirm" the new name. */
  const nameToSave = (name: string): string | null => {
    const c = ctx as Ctx | null;
    if (!name) return null;
    const snap = c && snapshots.get(c.contact.id);
    return snap?.appt && verifiedFor !== snap.appt.id ? null : name;
  };
  async function identityGate(c: Ctx, input: Record<string, unknown>, action: 'move' | 'cancel'): Promise<string | null> {
    const appt = c.appointment as NonNullable<Ctx['appointment']>;
    // The details to match are the ones stored when this contact was first loaded, before any tool could change them.
    const snap = snapshots.get(c.contact.id);
    // A booking made on this very call by this caller needs no second factor.
    if (!snap?.appt || snap.appt.id !== appt.id) return null;
    if (verifiedFor === appt.id) return null;
    const report = async () => {
      if (lockHandedOff || failedEarlier()) return;
      const from = c.contact.phone ?? d.call.caller ?? 'number withheld';
      await handoff('human', UNVERIFIED_INTENT, `${callMarker ? callMarker + ' ' : ''}Caller on ${from} asked to ${action} a booking but could not confirm the name or the time on it. Nothing was changed. Please check who is calling before changing anything.`, 'Verify the caller, then call back');
      lockHandedOff = true;
      const note = `${s.businessName} AI receptionist: caller on ${from} asked to ${action} a booking but could not confirm who they are. Nothing was changed. Please call back and check.`.slice(0, 320);
      if (s.staffPhone) await d.send(s.staffPhone, note).catch(() => undefined);
      if (s.staffEmail) await d.email(s.staffEmail, `Booking change not verified for ${s.businessName}`, note).catch(() => undefined);
      await outcome('message');
    };
    if (locked || failedEarlier()) { if (locked) await report(); return REFUSED_UNVERIFIED; } // a failed hand-off is retried
    const check = verifyBookingCaller(input, snap.name, snap.appt, tz);
    if (check === 'ok') { verifiedFor = appt.id; return null; }
    if (check === 'missing') return ASK_TO_VERIFY;
    locked = true;
    await report();
    return REFUSED_UNVERIFIED;
  }
  const missingAnswers = () => s.questions.filter(q => q.required && !(ctx as Ctx | null)?.contact.answers[q.id]).map(q => q.id);

  async function run(t: ToolUseBlock): Promise<string> {
    used.push(t.name);
    const input = t.input ?? {};
    switch (t.name) {
      case 'answer_faq': {
        const r = faqLookup(str(input.question, 300), s, d.now);
        await outcome(r.hit ? 'faq' : 'faq-miss');
        return r.result;
      }
      case 'qualify': {
        await ensureContact(input.phone, plainText(input.name, 160) || undefined);
        if (!ctx) return 'I need their mobile number first, so the team can reach them. Ask for it and pass it as phone.';
        const c = ctx as Ctx;
        const ids = new Set(s.questions.map(q => q.id)), answers: Record<string, string> = {};
        for (const [k, v] of Object.entries((input.answers ?? {}) as Record<string, unknown>)) if (ids.has(k) && typeof v === 'string' && v.trim()) answers[k] = v.trim().slice(0, 1000);
        const email = str(input.email, 254), okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        const saveName = nameToSave(plainText(input.name, 160));
        const r = await d.rpc('fo_save_details', { ...a, contact: c.contact.id, new_answers: answers, contact_name: saveName, contact_email: okEmail ? email : null, contact_phone: null }) as { answers?: Record<string, string> } | null;
        c.contact.answers = r?.answers ?? { ...c.contact.answers, ...answers };
        if (saveName) c.contact.name = saveName;
        const missing = missingAnswers();
        if (!missing.length && ['new', 'contacted', 'qualifying', 'nurture', 'disqualified'].includes(c.contact.state)) { await moveTo('qualified', 'Answered the qualifying questions on a call'); await outcome('qualified'); }
        else if (missing.length && ['new', 'contacted', 'nurture'].includes(c.contact.state)) await moveTo('qualifying', 'Qualifying on a call');
        return missing.length ? `Saved. Still to ask: ${missing.join(', ')}.` : 'Saved. All required answers are in.';
      }
      case 'check_availability': {
        if (!d.calendar) return 'The calendar is not connected. Offer to take a message so the team can book them.';
        if (!Object.keys(s.hours).length) return 'Booking hours are not set up yet. Offer to take a message so the team can book them.';
        offers = await offerTimes(d.calendar, availability, d.now);
        return offers.length ? JSON.stringify(offers.map(o => ({ label: o.label, start: new Date(o.start).toISOString() }))) : 'No open times in the next two weeks. Offer to take a message.';
      }
      case 'book': {
        await ensureContact(input.phone);
        if (!ctx) return 'Ask for their mobile number first and pass it as phone.';
        const c = ctx as Ctx;
        if (!d.calendar) return 'The calendar is not connected. Offer to take a message.';
        // Never state the time: the caller is not verified, and the number alone proves nothing.
        if (c.appointment) return 'They already have a booking. Do not say when. Offer to move it instead, which needs them to confirm the name it is under or its day and time.';
        const missing = missingAnswers();
        if (missing.length) return `Ask these first and save them with qualify: ${missing.join(', ')}.`;
        const start = Date.parse(str(input.start, 40));
        if (!offers.length) offers = await offerTimes(d.calendar, availability, d.now, 12);
        if (!offers.some(o => o.start === start)) return 'That is not one of the open times. Call check_availability and use a start value from it.';
        if (c.contact.state !== 'qualified') await moveTo('qualified', 'Booking on a call');
        try {
          const r = await bookSlot({ calendar: d.calendar, rpc: d.rpc, auth: d.auth, send: d.send, availability, contact: c.contact, start, now: d.now, businessName: s.businessName, where: s.bookingWhere, meetingTitle: s.bookingType });
          c.contact.state = 'booked';
          await scheduleReminders(d.rpc, d.auth, c.contact.id, r.appointment, start, d.now);
          await outcome('booked');
          return `Booked for ${formatSlot(start, tz)}. A confirmation text is on its way. Tell them, then ask if there is anything else.`;
        } catch (e) {
          if (e instanceof SlotTaken) { offers = []; return 'That time was just taken. Call check_availability again.'; }
          throw e;
        }
      }
      case 'reschedule': {
        const c = ctx as Ctx | null;
        if (!c?.appointment) return 'I cannot find a booking for this caller. Offer to book a new time or take a message.';
        const gate = await identityGate(c, input, 'move');
        if (gate) return gate;
        if (!d.calendar) return 'The calendar is not connected. Offer to take a message.';
        const start = Date.parse(str(input.start, 40));
        if (!offers.length) offers = await offerTimes(d.calendar, availability, d.now, 12);
        if (!offers.some(o => o.start === start)) return 'That is not one of the open times. Call check_availability and use a start value from it.';
        try {
          await rescheduleSlot({ calendar: d.calendar, rpc: d.rpc, auth: d.auth, send: d.send, availability, contact: c.contact, appointment: c.appointment, start, now: d.now, businessName: s.businessName, where: s.bookingWhere });
          await scheduleReminders(d.rpc, d.auth, c.contact.id, c.appointment.id, start, d.now);
          c.appointment = { ...c.appointment, starts: new Date(start).toISOString() };
          await outcome('rescheduled');
          return `Moved to ${formatSlot(start, tz)}. A text confirming it is on its way.`;
        } catch (e) {
          if (e instanceof SlotTaken) { offers = []; return 'That time was just taken. Call check_availability again.'; }
          throw e;
        }
      }
      case 'cancel': {
        const c = ctx as Ctx | null;
        if (!c?.appointment) return 'I cannot find a booking for this caller.';
        const gate = await identityGate(c, input, 'cancel');
        if (gate) return gate;
        await cancelBooking({ calendar: d.calendar, rpc: d.rpc, auth: d.auth, send: d.send, contact: c.contact, appointment: c.appointment, reason: plainText(input.reason, 400) || 'Cancelled on a call', businessName: s.businessName, timeZone: tz });
        c.appointment = null; c.contact.state = 'qualified';
        await outcome('cancelled');
        return 'Cancelled. A text confirming it is on its way. Offer to book another time.';
      }
      case 'take_message': {
        const name = plainText(input.name, 160);
        await ensureContact(input.phone, name || undefined);
        const c = ctx as Ctx | null;
        const msg = plainText(input.message, 1500) || 'Please call back.';
        const from = c?.contact.phone ?? d.call.caller ?? 'number withheld';
        const urgent = input.urgent === true;
        await handoff('human', urgent ? 'urgent call back' : 'call back', `Phone message${urgent ? ' (urgent)' : ''} from ${name || c?.contact.name || 'a caller'} on ${from}: ${msg}`, 'Call the caller back');
        const note = `${s.businessName} AI receptionist: ${urgent ? 'URGENT ' : ''}message from ${name || c?.contact.name || 'a caller'} (${from}): ${msg}`.slice(0, 600);
        // Staff notifications go out only when live sending is on (the senders enforce FRONT_OFFICE_SEND_LIVE).
        if (s.staffPhone) await d.send(s.staffPhone, note.slice(0, 320)).catch(() => undefined);
        if (s.staffEmail) await d.email(s.staffEmail, `${urgent ? 'Urgent: ' : ''}phone message for ${s.businessName}`, note).catch(() => undefined);
        await outcome('message');
        return from === 'number withheld' ? 'Message taken, but there is no number to call back on. Ask for their mobile if they want a call back.' : 'Message taken. Tell them the team will call them back.';
      }
      case 'request_quote': {
        // Capturing a quote request gathers information and commits the business to nothing, so the shared permission
        // check treats it as take_message: performed in automatic, owner_approval and enquiry_only alike.
        const permission = decide(d.mode, 'take_message');
        if (permission.decision !== 'perform') return 'I cannot save that right now. Offer to take a message instead.';
        // Caller words go into staff texts, emails and the handoff: one line each, no control characters.
        const need = plainText(input.need, 1000);
        if (!need) return 'Ask what they would like a quote for, then call request_quote again with it as need.';
        const where = plainText(input.where, 300), when = plainText(input.when, 300), budget = plainText(input.budget, 200), name = plainText(input.name, 160);
        const email = str(input.email, 254), okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        await ensureContact(input.phone, name || undefined);
        const c = ctx as Ctx | null;
        // A repeat: a second request_quote on this call, or the contact already has this same request on file.
        const onFile = c?.contact.answers[QUOTE_ANSWER_KEYS.need];
        if (!quoteState && onFile && onFile.toLowerCase() === need.toLowerCase()) {
          quoteState = { handedOff: true, notified: !!(s.staffPhone || s.staffEmail), phone: c?.contact.phone ?? null, email: c?.contact.email ?? null, updateSent: false };
        }
        const repeat = quoteState !== null;
        const fields: Record<string, string> = { [QUOTE_ANSWER_KEYS.need]: need };
        if (where) fields[QUOTE_ANSWER_KEYS.where] = where;
        if (when) fields[QUOTE_ANSWER_KEYS.when] = when;
        if (budget) fields[QUOTE_ANSWER_KEYS.budget] = budget;
        if (c) {
          const r = await d.rpc('fo_save_details', { ...a, contact: c.contact.id, new_answers: fields, contact_name: nameToSave(name), contact_email: okEmail ? email : null, contact_phone: null }) as { answers?: Record<string, string> } | null;
          c.contact.answers = r?.answers ?? { ...c.contact.answers, ...fields };
          if (nameToSave(name)) c.contact.name = name;
          if (okEmail && !c.contact.email) c.contact.email = email;
        }
        const who = name || c?.contact.name || 'a caller';
        const phoneNow = c?.contact.phone ?? d.call.caller ?? null, emailNow = okEmail ? email : c?.contact.email ?? null;
        const from = phoneNow ?? 'number withheld';
        const details = [`needs ${need}`, where && `where: ${where}`, when && `when: ${when}`, budget && `budget: ${budget}`, emailNow && `email: ${emailNow}`].filter(Boolean).join('; ');
        const writeHandoff = async () => { if (c) { await handoff('human', 'quote request', `Quote request from ${who} on ${from}: ${details}.`, 'Prepare a quote and send it to the caller'); return true; } return false; };
        // Same staff notification path as take_message; the senders enforce FRONT_OFFICE_SEND_LIVE.
        if (!quoteState) {
          const handedOff = await writeHandoff();
          const note = `${s.businessName} AI receptionist: quote request from ${who} (${from}): ${details}`.slice(0, 600);
          if (s.staffPhone) await d.send(s.staffPhone, note.slice(0, 320)).catch(() => undefined);
          if (s.staffEmail) await d.email(s.staffEmail, `Quote request for ${s.businessName}`, note).catch(() => undefined);
          quoteState = { handedOff, notified: !!(s.staffPhone || s.staffEmail), phone: phoneNow, email: emailNow, updateSent: false };
        } else {
          // Never a second handoff or a second full notice. The first handoff is written now only if there was no
          // contact to hang it on before; staff get at most one short update when new contact details arrive.
          const q = quoteState;
          if (!q.handedOff) q.handedOff = await writeHandoff();
          const newDetails = (phoneNow && phoneNow !== q.phone) || (emailNow && emailNow !== q.email);
          if (newDetails && q.notified && !q.updateSent) {
            const update = `${s.businessName} AI receptionist: update to the quote request from ${who}: contact now ${[phoneNow, emailNow].filter(Boolean).join(', ')}`.slice(0, 320);
            if (s.staffPhone) await d.send(s.staffPhone, update).catch(() => undefined);
            else if (s.staffEmail) await d.email(s.staffEmail, `Quote request update for ${s.businessName}`, update).catch(() => undefined);
            q.updateSent = true;
          }
          q.phone = phoneNow; q.email = emailNow;
        }
        await outcome('quote');
        // No price here, ever: the business has no configured quote price, so the team sends the quote.
        const noPrice = 'Do not give a price, range or estimate, even if asked again: say a team member will look at it and send them a quote.';
        const askMobile = 'Ask for their mobile and call request_quote again with it as phone.';
        if (!c) {
          // Nothing is on file: there is no contact to save it on. Say only what really happened.
          return quoteState.notified
            ? `Not saved on file, because there is no mobile number to link it to. The team has been sent the request by message${emailNow ? ', with their email,' : ''} and can follow up${emailNow ? ' by email' : ' only if the caller leaves a number'}. ${askMobile} ${noPrice}`
            : `Not saved and not passed on: there is no mobile number to link it to and no team contact is set up. ${askMobile} ${noPrice}`;
        }
        return repeat
          ? `Quote request updated on their record. The team already has it. ${noPrice}`
          : `Quote request saved on their record and the team has been told. ${noPrice}`;
      }
      case 'transfer': {
        if (!s.transferNumber) return 'No one is available to take calls right now. Offer to take a message instead.';
        await handoff('human', 'call transferred', `Transferred to the team: ${plainText(input.reason, 400) || 'caller asked for a person'}.`, 'Take the transferred call');
        await outcome('transfer');
        transferTo = s.transferNumber; action = 'transfer';
        return 'Transferring now. Say one short sentence, like "Putting you through now."';
      }
      case 'end_call':
        if (!action) action = 'end';
        return 'Ending the call after your goodbye.';
      default:
        return 'Unknown tool.';
    }
  }

  return {
    run, outcomes, used,
    get ctx() { return ctx as Ctx | null; },
    get action() { return action; },
    get transferTo() { return transferTo; },
  };
}

export async function* runReceptionistTurn(d: ReceptionistDeps): AsyncGenerator<VoiceOut, TurnSummary> {
  const s = d.settings, tz = s.timeZone;
  const a = { channel: d.auth.channel, channel_key: d.auth.key };
  const session = await receptionistSession(d);
  const c0 = session.ctx;
  const contactLine = [
    // The name and time on file are kept out of the prompt: the caller number could be spoofed, so nothing on the booking
    // may be said until they confirm it themselves (identity.ts).
    c0 ? `Caller number is on record, stage ${c0.contact.state}. The name on file is not shown: do not guess or greet by name.` : (d.call.caller ? 'New caller.' : 'Caller’s number is withheld.'),
    c0 && Object.keys(c0.contact.answers).length ? `Answers on file: ${JSON.stringify(c0.contact.answers)}.` : '',
    c0?.appointment ? 'They have a booking on file. Do not say its time or the name on it. To move or cancel it, first ask for the name it is under or its day and time, and pass what they say as verify_name or verify_time.' : '',
    s.faqs.length || hasKnowledge(s) ? '' : 'The business has not added any FAQ answers yet.',
    s.transferNumber ? '' : 'Transfers are not set up: take a message instead.',
  ].filter(Boolean).join('\n');
  const system = receptionistSystemPrompt(s, formatSlot(d.now, tz), contactLine);
  const messages = callTranscript(d.conversation);
  let said = '';

  for (let round = 0; round < 5 && !session.action; round++) {
    const calls: ToolUseBlock[] = [];
    let text = '', stop = 'end_turn';
    for await (const ev of d.llm({ system, messages, tools: receptionistTools, maxTokens: 300 })) {
      if (ev.type === 'text') { text += ev.text; said += ev.text; yield { type: 'text', text: ev.text }; }
      else if (ev.type === 'tool') calls.push(ev.block);
      else stop = ev.reason;
    }
    messages.push({ role: 'assistant', content: [...(text ? [{ type: 'text' as const, text }] : []), ...calls] });
    if (!calls.length || stop !== 'tool_use') break;
    const results: ToolResultBlock[] = [];
    for (const c of calls) {
      try { results.push({ type: 'tool_result', tool_use_id: c.id, content: await session.run(c) }); }
      catch (e) { results.push({ type: 'tool_result', tool_use_id: c.id, content: (e instanceof Error ? e.message : 'That did not work.') + ' Apologise and offer to take a message.', is_error: true }); }
    }
    messages.push({ role: 'user', content: results });
    if (session.action) {
      // One last short line before the transfer or hang-up, if the model has not said goodbye yet.
      if (!text.trim()) {
        for await (const ev of d.llm({ system, messages, tools: receptionistTools, maxTokens: 80 })) if (ev.type === 'text') { said += ev.text; yield { type: 'text', text: ev.text }; }
      }
    }
  }
  if (said.trim() && d.call.id) await d.rpc('fo_voice_reply', { ...a, call_id: d.call.id, message: said.trim(), prompt: RECEPTIONIST_PROMPT_VERSION }).catch(() => undefined);
  if (session.action === 'transfer') yield { type: 'transfer', number: session.transferTo };
  if (session.action === 'end') yield { type: 'end' };
  return { said: said.trim(), tools: session.used, outcomes: session.outcomes, action: session.action };
}
