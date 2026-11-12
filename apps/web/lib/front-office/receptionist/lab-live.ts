// Receptionist Lab "Live AI Test" engine (task A-26). Server only. The owner speaks (the page turns speech into text)
// and the SAME Receptionist as the phone answers: runReceptionistTurn from agent.ts with its real tools (answer_faq on
// the business's own knowledge, qualify, check_availability, book, reschedule, cancel, take_message, request_quote,
// transfer, end_call) and the real booking pipeline (booking.ts, jobs.ts), driven by the real Anthropic model.
//
// Sandboxed: only the model is real. The store, calendar and SMS/email senders are the Receptionist Test Lab's in-memory
// ones from simulate.ts (they only record what would have gone out), and no env switch (FRONT_OFFICE_SEND_LIVE,
// FRONT_OFFICE_VOICE_LIVE, Vapi keys, ...) is read on this path. The model's fetch is wrapped by anthropicOnlyFetch, so it
// can reach https://api.anthropic.com and nothing else. No call is placed or answered.
//
// Paid, so guarded exactly like the Setter's Live AI Test (setter/lab-live.ts), and against the SAME daily cap
// (lab-usage.ts): a verified caller, a configured model, today's cap not spent, all before any call; each model call
// then reserves its worst case first (meteredLlm) and is refused, unmade, if that would cross the cap.
//
// Operating modes: the phone Receptionist does not yet consult decide() for book / reschedule / cancel (only
// request_quote does), so neither does the lab: it is the same pipeline. Each tool call carries simulate.ts's
// ModeDecision ('automatic', enforced: false) so the page can say so plainly.
import { randomBytes } from 'node:crypto';
import { sandboxRpc } from '../lab-session';
import type { LabBackend } from '../lab-session';
import type { ChannelAuth, Rpc } from '../orchestrator';
import { isMetered, labDailyCapAud, labDay, liveCapReached, meteredLlm, priceFor, defaultLabUsageStore } from '../lab-usage';
import type { LabUsageStore } from '../lab-usage';
import { anthropicConfigFromEnv, anthropicLlm } from '../llm';
import type { Llm } from '../llm';
import type { AgentSettings } from '../settings';
import { anthropicOnlyFetch, isLabCaller, LIVE_NEEDS_USER, LIVE_NOT_CONFIGURED } from '../setter/lab-live';
import type { LabCaller } from '../setter/lab-live';
import type { LabTurnUsage } from '../setter/lab';
import { runReceptionistTurn } from './agent';
import type { CallerTurn, Outcome } from './agent';
import { recordDroppedCall } from './dropped';
import { greeting, RECEPTIONIST_GREETING_VERSION, RECEPTIONIST_PROMPT_VERSION } from './prompt';
import { demoSettings, recordingModel, recordingSenders, SIM_AUTH, SIM_NOW, simulatedCalendar, simulationStore } from './simulate';
import type { SimCalendarEvent, SimTables, SimToolCall, WouldSend } from './simulate';

export type { LabCaller };
export { LIVE_NEEDS_USER, LIVE_NOT_CONFIGURED };

/** The lab's made-up caller number (never a real customer). */
export const RECEPTIONIST_LAB_CALLER = '+61411113333';
export const RECEPTIONIST_LAB_CALL_ID = 'call_lab_live_receptionist';
/** turns: caller lines per call; said: one caller line; line: one conversation line (replies are clipped to it). */
export const RECEPTIONIST_LAB_LIMITS = { turns: 30, said: 600, line: 2000, stateBytes: 512 * 1024 } as const;
export const LAB_TROUBLE = 'Sorry, I am having trouble right now. Please call back shortly, or leave a message after the call ends.';

export type ReceptionistLabModel = 'scripted' | 'live';
export type ReceptionistLabTurn = {
  n: number; caller: string | null; said: string; route: 'greeting' | 'agent' | 'error';
  model: ReceptionistLabModel | null; prompt: string | null;
  tools: SimToolCall[]; outcomes: Outcome[]; action: 'transfer' | 'end' | null; transferTo: string | null;
  /** Live turns only. All costs are estimates (lab-usage.ts). */
  usage?: LabTurnUsage;
  /** Wall time of the whole turn, tools included. */
  latencyMs: number;
  error: string | null;
};
export type ReceptionistLabState = {
  v: 1; callId: string; caller: string | null; seq: number; now: number;
  /** The spoken conversation, as Vapi would send it. */
  conversation: CallerTurn[];
  tables: SimTables; calendar: Required<SimCalendarEvent>[]; calendarLog: string[]; wouldSend: WouldSend[];
  turns: ReceptionistLabTurn[];
  ended: { reason: string; summary: ReceptionistCallSummary } | null;
};

export type ReceptionistLabDeps = {
  /** The business's settings (knowledge, FAQs, hours, transfer number). Server side only; default the demo business. */
  settings?: AgentSettings;
  /** The network for the model only (default global fetch), wrapped by anthropicOnlyFetch. */
  fetch?: typeof fetch;
  /** Server env (default process.env): ANTHROPIC_API_KEY, FRONT_OFFICE_MODEL, FRONT_OFFICE_LAB_DAILY_CAP_AUD. */
  env?: Record<string, string | undefined>;
  /** Wall clock for latency and the cap's day (default Date.now). The call's own time stays state.now. */
  clock?: () => number;
  usage?: LabUsageStore;
  timeoutMs?: number;
  /** The user's lab sandbox over its voice channel (lab-session.ts voice). Absent = the in-memory store. */
  backend?: LabBackend;
};

const E164 = /^\+[1-9][0-9]{6,14}$/, CALL_ID = /^[A-Za-z0-9_-]{8,100}$/;

// ---------------------------------------------------------------------------------------------------------------
// The lab's database: the in-memory simulation store (default) or the user's lab sandbox (task A-34, lab-session.ts) over
// the real fo_* functions of its voice channel. In sandbox mode the lab state's tables are a read-back mirror so the page,
// the validators and the post-call summary work unchanged. The calendar and the recording senders stay in the lab state.
type LabDb = { rpc: Rpc; auth: ChannelAuth; sim: ReturnType<typeof simulationStore> | null; backend: LabBackend | null };
function openDb(settings: AgentSettings, s: { caller: string | null; tables?: SimTables; seq?: number }, backend?: LabBackend): LabDb {
  if (backend) return { rpc: sandboxRpc(backend.rpc, []), auth: backend.auth, sim: null, backend };
  const sim = simulationStore(settings, { caller: s.caller }, settings.bookingMinutes, s.tables ? { tables: s.tables, seq: s.seq ?? 0 } : undefined);
  return { rpc: sim.rpc, auth: SIM_AUTH, sim, backend: null };
}
const dbAuth = (db: LabDb) => ({ channel: db.auth.channel, channel_key: db.auth.key });

/** Copies the call, the contact, its messages, next booking and hand-offs from the sandbox into the lab state (read only). */
async function mirrorSandbox(s: ReceptionistLabState, db: LabDb, contactId: string | null, outcomes: string[], ended: { reason: string; summary: string; transcript: string } | null): Promise<void> {
  const backend = db.backend;
  if (!backend) return;
  const t = s.tables;
  const prev = t.fo_calls.find(k => k.provider_call_id === s.callId);
  const call = { id: prev?.id ?? s.callId, provider_call_id: s.callId, contact_id: contactId ?? prev?.contact_id ?? null, caller: s.caller, outcomes: [...new Set([...(prev?.outcomes ?? []), ...outcomes])], ended_reason: ended?.reason ?? prev?.ended_reason ?? null, summary: ended?.summary ?? prev?.summary ?? null, transcript: ended?.transcript ?? prev?.transcript ?? null, ended: ended !== null || prev?.ended === true };
  t.fo_calls = [call];
  if (!call.contact_id) return;
  const ctx = await backend.rpc('fo_contact_context', { ...dbAuth(db), contact: call.contact_id }) as {
    contact: SimTables['fo_contacts'][number];
    messages: { direction: 'inbound' | 'outbound'; body: string; agent: string | null }[];
    appointment: { id: string; starts: string; ends: string } | null;
    handoffs: Record<string, unknown>[];
  };
  const c = ctx.contact;
  t.fo_contacts = [{ id: c.id, phone: c.phone, name: c.name, email: c.email, state: c.state, optedOut: c.optedOut === true, answers: { ...c.answers } }];
  t.fo_messages = ctx.messages.map(m => ({ contact_id: c.id, direction: m.direction, body: m.body, agent: m.agent, prompt_version: null, provider_id: null }));
  const appts: SimTables['fo_appointments'] = ctx.appointment ? [{ id: ctx.appointment.id, contact_id: c.id, starts: String(ctx.appointment.starts), ends: String(ctx.appointment.ends), status: 'booked', provider_event_id: '' }] : [];
  if (!appts.length) {
    // fo_contact_context hides bookings that ended before the database's real now(); the lab's clock is fixed in the past.
    for (const e of s.calendar) {
      if (e.cancelled) continue;
      const id = await backend.rpc('fo_booking_for_event', { ...dbAuth(db), calendar_provider: 'google', event_id: e.id });
      if (typeof id === 'string') appts.push({ id, contact_id: c.id, starts: new Date(e.start).toISOString(), ends: new Date(e.end).toISOString(), status: 'booked', provider_event_id: e.id });
    }
  }
  t.fo_appointments = appts;
  t.handoffs = ctx.handoffs.map(h => ({ ...h }));
}

/** A new lab call: the call row and contact are created and the fixed greeting is said (no model, no cost). */
export async function startReceptionistLab(opts: { caller?: string | null; settings?: AgentSettings; now?: number; backend?: LabBackend } = {}): Promise<ReceptionistLabState> {
  const caller = opts.caller === undefined ? RECEPTIONIST_LAB_CALLER : opts.caller;
  if (caller !== null && !E164.test(caller)) throw new Error('The test caller number must be in +61 format.');
  const settings = opts.settings ?? demoSettings();
  const db = openDb(settings, { caller }, opts.backend);
  const a = dbAuth(db);
  // In the sandbox every call needs its own provider call id (the database keeps calls from earlier lab sessions).
  const callId = opts.backend ? `call_lab_${randomBytes(6).toString('hex')}` : RECEPTIONIST_LAB_CALL_ID;
  const first = await db.rpc('fo_voice_turn', { ...a, call_id: callId, caller, turn: 0, message: null }) as { contact?: string | null } | null;
  const text = greeting(settings);
  await db.rpc('fo_voice_reply', { ...a, call_id: callId, message: text, prompt: RECEPTIONIST_GREETING_VERSION });
  const state: ReceptionistLabState = {
    v: 1, callId, caller, seq: db.sim?.seq() ?? 0, now: opts.now ?? SIM_NOW,
    conversation: [{ role: 'assistant', content: text }],
    tables: db.sim ? structuredClone(db.sim.tables) : { fo_calls: [], fo_contacts: [], fo_messages: [], fo_appointments: [], fo_jobs: [], fo_events: [], handoffs: [] },
    calendar: [], calendarLog: [], wouldSend: [],
    turns: [{ n: 0, caller: null, said: text, route: 'greeting', model: null, prompt: RECEPTIONIST_GREETING_VERSION, tools: [], outcomes: [], action: null, transferTo: null, latencyMs: 0, error: null }],
    ended: null,
  };
  await mirrorSandbox(state, db, first?.contact ?? null, [], null);
  return state;
}

const arr =(v: unknown) => Array.isArray(v);
/** Lab state as sent back by the page: shape and size checked, then deep-copied. Anything else is refused. */
export function checkedReceptionistLab(v: unknown): ReceptionistLabState {
  const bad = () => new Error('This lab call could not be read. Start a new call.');
  if (!v || typeof v !== 'object') throw bad();
  if (JSON.stringify(v).length > RECEPTIONIST_LAB_LIMITS.stateBytes) throw new Error('This lab call is too long. Start a new call.');
  const s = v as ReceptionistLabState;
  if (s.v !== 1 || typeof s.callId !== 'string' || !CALL_ID.test(s.callId)) throw bad();
  if (!(s.caller === null || (typeof s.caller === 'string' && E164.test(s.caller)))) throw bad();
  if (!Number.isSafeInteger(s.seq) || s.seq < 0 || !Number.isFinite(s.now)) throw bad();
  // The conversation is what goes to the model, so its size is bounded here (not by the client's own turns list):
  // the greeting, then at most `turns` caller lines and replies, each line short.
  if (!arr(s.conversation) || s.conversation.length > RECEPTIONIST_LAB_LIMITS.turns * 2 + 2) throw new Error(TOO_LONG);
  if (!s.conversation.every(t => isObj(t) && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')) throw bad();
  if (s.conversation.some(t => t.content.length > RECEPTIONIST_LAB_LIMITS.line)) throw new Error(TOO_LONG);
  if (!arr(s.turns) || s.turns.length > RECEPTIONIST_LAB_LIMITS.turns + 1 || !arr(s.calendar) || !arr(s.calendarLog) || !arr(s.wouldSend)) throw bad();
  if (!s.turns.every(isTurn)) throw bad();
  if (!s.calendarLog.every(x => typeof x === 'string') || !s.wouldSend.every(w => isObj(w) && typeof w.to === 'string' && typeof w.body === 'string')) throw bad();
  if (!(s.ended === null || (isObj(s.ended) && typeof s.ended.reason === 'string' && isObj(s.ended.summary)))) throw bad();
  const t = s.tables as SimTables | undefined;
  if (!isObj(t) || !(Object.keys(ROW) as (keyof SimTables)[]).every(k => arr(t[k]) && (t[k] as unknown[]).every(ROW[k]))) throw bad();
  if (!s.calendar.every(e => isObj(e) && typeof e.id === 'string' && Number.isFinite(e.start) && Number.isFinite(e.end))) throw bad();
  return structuredClone(s);
}
const TOO_LONG = 'This lab call is too long. Start a new call.';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown) => typeof v === 'string';
const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';
const isStrMap = (v: unknown) => isObj(v) && Object.values(v).every(isStr);
const strs = (v: unknown) => Array.isArray(v) && v.every(isStr);
/** Per-row shape of each lab table: the fields the pipeline and the summary read. */
const ROW: Record<keyof SimTables, (r: unknown) => boolean> = {
  fo_calls: r => isObj(r) && isStr(r.id) && isStr(r.provider_call_id) && isStrOrNull(r.contact_id) && isStrOrNull(r.caller) && strs(r.outcomes) && typeof r.ended === 'boolean',
  fo_contacts: r => isObj(r) && isStr(r.id) && isStrOrNull(r.phone) && isStrOrNull(r.name) && isStrOrNull(r.email) && isStr(r.state) && typeof r.optedOut === 'boolean' && isStrMap(r.answers),
  fo_messages: r => isObj(r) && isStr(r.contact_id) && isStr(r.body) && (r.direction === 'inbound' || r.direction === 'outbound') && isStrOrNull(r.provider_id),
  fo_appointments: r => isObj(r) && isStr(r.id) && isStr(r.contact_id) && isStr(r.starts) && isStr(r.ends) && isStr(r.status) && isStr(r.provider_event_id),
  fo_jobs: r => isObj(r) && isStr(r.id) && isStr(r.contact_id) && isStr(r.kind) && isStr(r.status) && isStrOrNull(r.appointment_id),
  fo_events: r => isObj(r) && isStr(r.contact_id) && isStr(r.kind) && isStr(r.detail),
  handoffs: r => isObj(r),
};
const isTurn = (t: unknown) => isObj(t) && Number.isSafeInteger(t.n) && isStrOrNull(t.caller) && isStr(t.said) && strs(t.outcomes)
  && (t.action === null || t.action === 'transfer' || t.action === 'end') && isStrOrNull(t.transferTo) && isStrOrNull(t.error)
  && Array.isArray(t.tools) && t.tools.every(c => isObj(c) && isStr(c.name) && isObj(c.input) && isStrOrNull(c.result) && typeof c.isError === 'boolean')
  && (t.usage === undefined || (isObj(t.usage) && ['calls', 'inputTokens', 'outputTokens', 'latencyMs', 'costAud'].every(k => Number.isFinite((t.usage as Record<string, unknown>)[k]))));

/** One caller turn through the real Receptionist with any model (the scripted one in tests). A 'live' model must be
 * metered against the daily cap (meteredLlm), or it is refused before anything runs. */
export async function runReceptionistLabTurnWith(state: ReceptionistLabState, input: { says: string }, m: { base: Llm; model: ReceptionistLabModel; settings?: AgentSettings; clock?: () => number; backend?: LabBackend }): Promise<ReceptionistLabState> {
  if (m.model === 'live' && !isMetered(m.base)) throw new Error('Live AI Test refused: the model is not metered against the daily cap.');
  const s = checkedReceptionistLab(state);
  // A transfer or hang-up ends the call, as on the phone.
  if (s.ended || s.turns.at(-1)?.action) throw new Error('This lab call has ended. Start a new call.');
  // Counted from the conversation (what the model is sent), never from the client's turns list.
  if (s.conversation.filter(c => c.role === 'user').length >= RECEPTIONIST_LAB_LIMITS.turns) throw new Error(TOO_LONG);
  const says = input.says.replace(/\s+/g, ' ').trim().slice(0, RECEPTIONIST_LAB_LIMITS.said);
  if (!says) throw new Error('Say something first.');
  const clock = m.clock ?? Date.now, t0 = clock();
  const settings = m.settings ?? demoSettings();
  const db = openDb(settings, { caller: s.caller, tables: s.tables, seq: s.seq }, m.backend);
  const cal = simulatedCalendar(s.calendar);
  const senders = recordingSenders();
  const a = dbAuth(db);
  let contactId: string | null = null;

  s.conversation.push({ role: 'user', content: says });
  const n = s.conversation.filter(c => c.role === 'user').length;
  const tools: SimToolCall[] = [];
  const turn: ReceptionistLabTurn = { n, caller: says, said: '', route: 'agent', model: m.model, prompt: RECEPTIONIST_PROMPT_VERSION, tools, outcomes: [], action: null, transferTo: null, latencyMs: 0, error: null };
  try {
    // As vapi-route.ts vapiChat: record the caller's words on the call, then the Receptionist turn.
    const r = await db.rpc('fo_voice_turn', { ...a, call_id: s.callId, caller: s.caller, turn: n, message: says }) as { contact: string | null };
    contactId = r?.contact ?? null;
    const llm = recordingModel(m.base, n, tools, () => undefined);
    const gen = runReceptionistTurn({ llm, rpc: db.rpc, auth: db.auth, calendar: cal.provider, send: senders.send, email: senders.email, settings, now: s.now, call: { id: s.callId, caller: s.caller, contact: r?.contact ?? null }, conversation: [...s.conversation] });
    let step = await gen.next();
    while (!step.done) {
      const out = step.value;
      if (out.type === 'text') turn.said += out.text;
      else if (out.type === 'transfer') { turn.action = 'transfer'; turn.transferTo = out.number; }
      else turn.action = 'end';
      step = await gen.next();
    }
    turn.outcomes = step.value.outcomes;
  } catch (e) {
    turn.route = 'error';
    turn.error = e instanceof Error ? e.message.slice(0, 300) : 'unknown';
    turn.said = `${turn.said.trim()} ${LAB_TROUBLE}`;
  }
  for (const c of tools) if (c.result === null) c.result = '(Not passed back to the model: the turn ended straight after this tool.)';
  turn.said = turn.said.trim();
  turn.latencyMs = Math.max(0, clock() - t0);
  if (turn.said) s.conversation.push({ role: 'assistant', content: turn.said.slice(0, RECEPTIONIST_LAB_LIMITS.line) });
  s.turns.push(turn);
  if (db.sim) { s.tables = structuredClone(db.sim.tables); s.seq = db.sim.seq(); }
  s.calendar = cal.snapshot(); s.calendarLog.push(...cal.log); s.wouldSend.push(...senders.out);
  try { await mirrorSandbox(s, db, contactId, turn.outcomes, null); } catch { turn.error = turn.error ?? 'The sandbox database could not be read back after this turn.'; }
  return s;
}

/**
 * One caller turn through the real Receptionist with the real model, sandboxed. Throws (and makes no call) when the
 * caller is missing, the model is not configured, or today's shared lab cap is spent. A failure during the turn (the
 * model, a tool, the cap) lands in the turn as route 'error' with the plain apology the phone uses.
 *
 * The server action must pass a caller built from a verified Supabase user (supabase.auth.getUser() on the server).
 */
export async function runLiveReceptionistTurn(state: ReceptionistLabState, input: { says: string }, caller: LabCaller | null | undefined, deps: ReceptionistLabDeps = {}): Promise<ReceptionistLabState> {
  if (!isLabCaller(caller)) throw new Error(LIVE_NEEDS_USER);
  const env = deps.env ?? process.env;
  const config = anthropicConfigFromEnv(env);
  if (!config) throw new Error(LIVE_NOT_CONFIGURED);
  const store = deps.usage ?? defaultLabUsageStore, clock = deps.clock ?? Date.now;
  const capAud = labDailyCapAud(env), day = labDay(clock());
  if ((await store.spent(day)) >= capAud) throw new Error(liveCapReached(capAud));
  const { known } = priceFor(config.model);
  const u: LabTurnUsage = {
    estimate: true, model: config.model, priceKnown: known, calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, costAud: 0, usageReported: true,
    note: known ? 'Estimated cost from reported tokens and a fixed price table.' : 'Estimated cost: this model is not in the price table, so it is priced at the highest rate.',
  };
  const fetchImpl = anthropicOnlyFetch(deps.fetch ?? ((...x: Parameters<typeof fetch>) => globalThis.fetch(...x)));
  const base = meteredLlm(anthropicLlm(config, fetchImpl, deps.timeoutMs ?? 30_000), { model: config.model, day, capAud, store, clock, u });
  const next = await runReceptionistLabTurnWith(state, input, { base, model: 'live', settings: deps.settings, clock, backend: deps.backend });
  const turn = next.turns.at(-1);
  if (turn) turn.usage = u;
  return next;
}

// ---------------------------------------------------------------------------------------------------------------
// Post-call summary. Built from what the pipeline actually recorded (no model, no cost), so it never claims more.

export type ReceptionistCallSummary = {
  caller: { phone: string | null; name: string | null; email: string | null; stage: string | null; answers: Record<string, string> };
  /** Why they called: the first thing they said, and what the Receptionist did about it. */
  reason: string;
  topics: string[];
  actions: { turn: number; tool: string; input: Record<string, unknown>; result: string | null; isError: boolean }[];
  outcome: { outcomes: Outcome[]; booking: { starts: string; status: string } | null; endedBy: 'transfer' | 'end' | 'caller'; transferTo: string | null; text: string };
  wouldSend: WouldSend[];
  usage: { estimate: true; calls: number; inputTokens: number; outputTokens: number; latencyMs: number; costAud: number; liveTurns: number };
  errors: string[];
};

const PHRASE: Record<Outcome, string> = { faq: 'answered a question from the business’s own information', 'faq-miss': 'was asked something not on file', qualified: 'took the qualifying answers', booked: 'booked an appointment', rescheduled: 'moved the booking', cancelled: 'cancelled the booking', message: 'took a message for the team', transfer: 'put the caller through to the team', quote: 'took a quote request for the team' };
const TOPIC: Record<string, string> = { answer_faq: 'question', qualify: 'qualifying', check_availability: 'availability', book: 'booking', reschedule: 'reschedule', cancel: 'cancellation', take_message: 'message', request_quote: 'quote', transfer: 'wants a person' };

export function summariseReceptionistLabCall(state: ReceptionistLabState): ReceptionistCallSummary {
  const s = checkedReceptionistLab(state);
  // Shape is checked above; anything still unreadable is the same plain error, never a raw TypeError.
  try { return summaryOf(s); } catch { throw new Error('This lab call could not be read. Start a new call.'); }
}
function summaryOf(s: ReceptionistLabState): ReceptionistCallSummary {
  const call = s.tables.fo_calls.find(k => k.provider_call_id === s.callId);
  const contact = call?.contact_id ? s.tables.fo_contacts.find(c => c.id === call.contact_id) ?? null : null;
  const appt = contact ? [...s.tables.fo_appointments].reverse().find(x => x.contact_id === contact.id) ?? null : null;
  const outcomes: Outcome[] = [];
  for (const t of s.turns) for (const o of t.outcomes) if (!outcomes.includes(o)) outcomes.push(o);
  const actions = s.turns.flatMap(t => t.tools.map(c => ({ turn: t.n, tool: c.name, input: c.input, result: c.result, isError: c.isError })));
  const topics = [...new Set(actions.map(x => TOPIC[x.tool]).filter(Boolean))];
  const last = [...s.turns].reverse().find(t => t.action);
  const endedBy = last?.action ?? 'caller';
  const first = s.turns.find(t => t.caller)?.caller ?? '';
  const who = contact?.name ?? 'The caller';
  const did = outcomes.length ? outcomes.map(o => PHRASE[o]).join(', ') : 'did not complete anything';
  const text = first
    ? `${who}${contact?.phone ? ` (${contact.phone})` : ''} called: "${first.slice(0, 160)}". The receptionist ${did}.${appt?.status === 'booked' ? ` Booked for ${appt.starts}.` : ''}${endedBy === 'transfer' ? ' The call was put through to the team.' : ''}`
    : 'The call connected but the caller said nothing.';
  const live = s.turns.filter(t => t.usage);
  const sum = (k: 'calls' | 'inputTokens' | 'outputTokens' | 'latencyMs' | 'costAud') => Math.round(live.reduce((n, t) => n + (t.usage?.[k] ?? 0), 0) * 1e9) / 1e9;
  return {
    caller: { phone: contact?.phone ?? s.caller, name: contact?.name ?? null, email: contact?.email ?? null, stage: contact?.state ?? null, answers: { ...contact?.answers } },
    reason: first ? `${first.slice(0, 200)}${topics.length ? ` (${topics.join(', ')})` : ''}` : 'Nothing said.',
    topics, actions,
    outcome: { outcomes, booking: appt ? { starts: appt.starts, status: appt.status } : null, endedBy, transferTo: last?.transferTo ?? null, text },
    wouldSend: [...s.wouldSend],
    usage: { estimate: true, calls: sum('calls'), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), latencyMs: sum('latencyMs'), costAud: sum('costAud'), liveTurns: live.length },
    errors: s.turns.flatMap(t => t.error ? [t.error] : []),
  };
}

/** Hang up: the summary and transcript are saved on the call record (fo_voice_end, as the phone's end-of-call report
 * does) and the state is closed. No model, no cost. */
export async function endReceptionistLabCall(state: ReceptionistLabState, opts: { settings?: AgentSettings; backend?: LabBackend } = {}): Promise<ReceptionistLabState> {
  const s = checkedReceptionistLab(state);
  if (s.ended) return s;
  const summary = summariseReceptionistLabCall(s);
  const settings = opts.settings ?? demoSettings();
  const db = openDb(settings, { caller: s.caller, tables: s.tables, seq: s.seq }, opts.backend);
  const reason = summary.outcome.endedBy === 'transfer' ? 'assistant-forwarded-call' : summary.outcome.endedBy === 'end' ? 'assistant-ended-call' : 'customer-ended-call';
  const transcript = s.conversation.map(c => `${c.role === 'assistant' ? 'AI' : 'User'}: ${c.content}`).join('\n');
  const end = await db.rpc('fo_voice_end', { ...dbAuth(db), call_id: s.callId, caller: s.caller, reason, call_summary: summary.outcome.text.slice(0, 4000), call_transcript: transcript.slice(0, 20000) }) as { contact: string | null; outcomes: string[] | null; first?: boolean } | null;
  if (end) await recordDroppedCall(db.rpc, db.auth, end, { id: s.callId, caller: s.caller, reason, transcript });
  if (db.sim) { s.tables = structuredClone(db.sim.tables); s.seq = db.sim.seq(); }
  else await mirrorSandbox(s, db, end?.contact ?? s.tables.fo_calls[0]?.contact_id ?? null, end?.outcomes ?? [], { reason, summary: summary.outcome.text.slice(0, 4000), transcript: transcript.slice(0, 20000) });
  s.ended = { reason, summary };
  return s;
}
