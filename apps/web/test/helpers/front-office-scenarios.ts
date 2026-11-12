// A-28 / A-49 front-office QA scenarios: the per-scenario recorder (spec docs/agents/briefs/A-28_QA_SCENARIOS.md section 0)
// and the harness pieces the scenario files share. Copied, not moved, from the original test files (those stay
// untouched): the H-AGENT scripted model, fake calendar and permission setup (front-office-setter-actions.test.ts), and
// the H-DB PGlite + real chat route world (front-office-chat-e2e-db.test.ts), parameterised by the model script.
// Demo mode only: scripted models, in-memory or PGlite stores, no network, nothing sent, cost 0.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { call, configuredEnv, setEnv } from './route-harness.ts';
import { store } from './front-office-store.ts';
import type { Block, Llm } from '../../lib/front-office/llm.ts';
import type { OperatingMode } from '../../lib/front-office/contracts.ts';
import type { CalendarEventInput } from '../../lib/front-office/calendar/google.ts';

const { createMemoryPendingActionStore } = await import('../../lib/front-office/pending-actions.ts');
const { createSetterExecutor } = await import('../../lib/front-office/setter/actions.ts');
const { ventraSetterConfig } = await import('../../lib/front-office/setter/config.ts');
const { templateSettings, availabilityFor } = await import('../../lib/front-office/settings.ts');
const { offerTimes } = await import('../../lib/front-office/booking.ts');

// ---------------------------------------------------------------------------------------------------------------
// Recorder: one JSON record per scenario.

export type ScenarioToolCall = { name: string; input: unknown; result: string | null; isError: boolean };
export type ScenarioRecord = {
  id: string; mode: 'demo' | 'live'; operatingMode: OperatingMode | 'n/a';
  inputs: unknown[]; outputs: unknown[]; toolCalls: ScenarioToolCall[]; dbAfter: unknown;
  latencyMs: number; costAud: number; errors: string[]; expected: string; actual: string; pass: boolean;
};
export type Capture = {
  input: (...x: unknown[]) => void; output: (...x: unknown[]) => void; tools: (...t: ScenarioToolCall[]) => void;
  db: (x: unknown) => void; actual: (s: string) => void; error: (s: string) => void;
};

/** Runs a scenario body, timing it and recording what it saw. pass is true only when every assertion in the body held;
 * a failing body is still recorded (pass false) and then rethrown so the test fails. Records are plain JSON. When the
 * test-only env FRONT_OFFICE_QA_RECORD_DIR is set, each record is also written there as <id>-<operatingMode>-<case>.json.
 * `case` is optional (A-62): when omitted, it is the 1-based count of earlier runs of the same id and mode, so two cases
 * of one scenario never overwrite each other's file. A failure to write the file never hides the body's own error. */
export function createRecorder() {
  const records: ScenarioRecord[] = [];
  const runs = new Map<string, number>();
  async function scenario(meta: { id: string; operatingMode: OperatingMode | 'n/a'; expected: string; case?: string }, body: (c: Capture) => Promise<void>): Promise<ScenarioRecord> {
    const runKey = `${meta.id}-${meta.operatingMode}`, run = (runs.get(runKey) ?? 0) + 1;
    runs.set(runKey, run);
    const caseName = (meta.case ?? String(run)).replace(/[^A-Za-z0-9_.-]/g, '_');
    const r: ScenarioRecord = { id: meta.id, mode: 'demo', operatingMode: meta.operatingMode, inputs: [], outputs: [], toolCalls: [], dbAfter: null, latencyMs: 0, costAud: 0, errors: [], expected: meta.expected, actual: '', pass: false };
    const c: Capture = {
      input: (...x) => { r.inputs.push(...x); }, output: (...x) => { r.outputs.push(...x); }, tools: (...t) => { r.toolCalls.push(...t); },
      db: (x) => { r.dbAfter = x; }, actual: (s) => { r.actual = s; }, error: (s) => { r.errors.push(s); },
    };
    const t0 = performance.now();
    let bodyError: unknown, bodyFailed = false;
    try { await body(c); r.pass = true; }
    catch (e) { bodyFailed = true; bodyError = e; r.errors.push(e instanceof Error ? e.message : String(e)); }
    r.latencyMs = Math.round(performance.now() - t0);
    let writeError: unknown, writeFailed = false;
    try {
      const plain = JSON.parse(JSON.stringify(r)) as ScenarioRecord;
      records.push(plain);
      const dir = process.env.FRONT_OFFICE_QA_RECORD_DIR;
      if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, `${plain.id}-${plain.operatingMode}-${caseName}.json`), JSON.stringify(plain, null, 2)); }
    } catch (e) { writeFailed = true; writeError = e; }
    // A recording problem must not replace the scenario's own assertion error; it only fails a scenario that passed.
    if (bodyFailed) throw bodyError;
    if (writeFailed) throw writeError;
    return r;
  }
  return { records, scenario };
}

// ---------------------------------------------------------------------------------------------------------------
// Global assertions (section 0).

/** "Booked"/"confirmed" wording in a reply. Held lines ("You will hear back once it is confirmed") do not count. */
export const BOOKED_WORDING = /\byou'?re (all )?(booked|confirmed)\b|\b(booking|appointment|call) is (booked|confirmed)\b|\bbooked (you )?(in|for)\b/i;

export function assertNothingSent(wouldSend: { sent: boolean }[]) {
  for (const w of wouldSend) assert.equal(w.sent, false, 'nothing is actually sent in Demo');
}
export function assertOutboundTagged(outbound: { agent: string | null; prompt_version: string | null }[]) {
  for (const m of outbound) assert.ok(m.agent && m.prompt_version, 'every outbound has an agent and a prompt version');
}
/** No booked wording unless an appointment with a calendar event id exists. */
export function assertNoFalseBooking(replies: (string | null | undefined)[], appointments: { event_id?: string | null; provider_event_id?: string | null }[]) {
  const real = appointments.some(a => !!(a.event_id ?? a.provider_event_id));
  if (real) return;
  for (const r of replies) assert.doesNotMatch(r ?? '', BOOKED_WORDING, `no booked wording without an appointment: "${r}"`);
}

/** Global fetch trapped (front-office-lab-live.test.ts:16-19): any network attempt throws and is recorded. */
export function trapFetch() {
  const real = globalThis.fetch;
  const attempts: string[] = [];
  return {
    attempts,
    install: () => { globalThis.fetch = (async (input: RequestInfo | URL) => { attempts.push(String(input)); throw new Error('network is off in this test'); }) as typeof fetch; },
    restore: () => { globalThis.fetch = real; },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// H-AGENT: runSetterTurn with the in-memory store, a scripted model, a fake calendar and the permission check.

export const AGENT_NOW = Date.parse('2026-11-09T00:30:00Z'); // Monday 8:30 am Perth
export const CID = '11111111-1111-4111-8111-111111111111';
export const WS = '22222222-2222-4222-8222-222222222222';
export const OWNER = '33333333-3333-4333-8333-333333333333';
export const AUTH = { channel: '44444444-4444-4444-8444-444444444444', key: 'k'.repeat(40) };
export const ANSWERS = { business: 'Gym in Joondalup', lead_flow: '40 a week', problem: 'Slow replies', timing: 'This month' };

export const tool = (name: string, input: Record<string, unknown> = {}, id = name): Block => ({ type: 'tool_use', id, name, input });
export const say = (text: string): Block => ({ type: 'text', text });

/** Plays back a script (or a function of the request) and records every tool call and the result it was shown. */
export function scripted(steps: (Block[] | ((results: string[]) => Block[]))[]) {
  let i = 0;
  const results: string[] = [], systems: string[] = [], calls: ScenarioToolCall[] = [];
  const llm: Llm = async (req) => {
    systems.push(req.system);
    const last = req.messages.at(-1);
    if (last && Array.isArray(last.content)) for (const b of last.content) if (b.type === 'tool_result') {
      results.push(b.content);
      const c = calls.find(x => (x as ScenarioToolCall & { id?: string }).id === b.tool_use_id && x.result === null);
      if (c) { c.result = b.content; c.isError = b.is_error === true; }
    }
    const step = steps[Math.min(i++, steps.length - 1)];
    const content = typeof step === 'function' ? step(results) : step;
    for (const b of content) if (b.type === 'tool_use') calls.push({ id: b.id, name: b.name, input: b.input, result: null, isError: false } as ScenarioToolCall);
    return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
  };
  return { llm, results, systems, calls: () => calls.map(({ name, input, result, isError }) => ({ name, input, result, isError })), rounds: () => i };
}

export function fakeCalendar() {
  const events: CalendarEventInput[] = [];
  return {
    events,
    busy: async (from: number, to: number) => events.filter(e => e.end > from && e.start < to).map(e => ({ start: e.start, end: e.end })),
    createEvent: async (e: CalendarEventInput) => { const existed = events.some(x => x.id === e.id); if (!existed) events.push(e); return { id: e.id, htmlLink: null, existed }; },
    hasEvent: async (id: string) => events.some(e => e.id === id),
  };
}

/** The shared in-memory fo_* store with a real contact id, an inbound message on record and a mobile. */
export function lead(state = 'qualified', messages: { direction: 'inbound' | 'outbound'; body: string }[] = [{ direction: 'inbound', body: 'Hi, saw your ad' }], phone: string | null = '+61411111111') {
  const s = store(state, messages, phone);
  s.db.contact.id = CID;
  if (state === 'qualified') Object.assign(s.db.contact.answers, ANSWERS);
  return s;
}

export function agentSetup(mode: OperatingMode, s = lead(), now = AGENT_NOW) {
  const pending = createMemoryPendingActionStore({ workspaceId: WS, modes: () => ({ setter: mode, receptionist: 'enquiry_only' }), owners: [OWNER], now: () => now });
  const calendar = fakeCalendar();
  const sent: { to: string; body: string }[] = [];
  const send = async (to: string, body: string) => { sent.push({ to, body }); return { sent: false as const, sid: null }; };
  const deps = (llm: Llm, extra: Record<string, unknown> = {}) => ({ llm, rpc: s.rpc, auth: AUTH, calendar, send, config: ventraSetterConfig, now, permissions: { store: pending }, channel: 'sms' as const, ...extra });
  const executor = (at = now + 60_000) => createSetterExecutor({ rpc: s.rpc, auth: AUTH, calendar, config: ventraSetterConfig, now: at, send, via: 'sms' });
  return { ...s, pending, calendar, sent, deps, executor, now };
}

// ---------------------------------------------------------------------------------------------------------------
// H-DB: the real POST /api/front-office/chat against every migration in PGlite.

type Mode = OperatingMode;
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations');
const KEY = 'k'.repeat(40), CAL = 'primary';
export const VISITOR = 'v_scenarios_db_abcdefgh';
const DB_OWNER = '11111111-1111-4111-8111-111111111111', SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ALLOWED_HOSTS = new Set(['127.0.0.1:54321', 'api.anthropic.com', 'oauth2.googleapis.com', 'www.googleapis.com']);
const ENV_KEYS = [
  'FRONT_OFFICE_CHAT_CHANNEL_ID', 'FRONT_OFFICE_CHAT_CHANNEL_KEY', 'FRONT_OFFICE_CHAT_LIVE', 'FRONT_OFFICE_CHAT_ORIGINS', 'FRONT_OFFICE_DEMO_CHANNEL_ID', 'FRONT_OFFICE_DEMO_CHANNEL_KEY',
  'FRONT_OFFICE_DEMO_LIVE', 'FRONT_OFFICE_SEND_LIVE', 'ANTHROPIC_API_KEY', 'FRONT_OFFICE_MODEL', 'TWILIO_AUTH_TOKEN', 'TWILIO_ACCOUNT_SID', 'TWILIO_FROM_NUMBER',
  'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_CALENDAR_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID',
];

/** Clears every front-office switch, then points the route at the chat channel with the fake model and calendar.
 * live false leaves FRONT_OFFICE_CHAT_LIVE off (the honest "not switched on" path). */
export function dbEnv(channel: string, live: boolean, key: string = KEY) {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]])), supa = setEnv(configuredEnv);
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, {
    FRONT_OFFICE_CHAT_CHANNEL_ID: channel, FRONT_OFFICE_CHAT_CHANNEL_KEY: key,
    ANTHROPIC_API_KEY: 'test-key', FRONT_OFFICE_MODEL: 'test-model',
    GOOGLE_CALENDAR_CLIENT_ID: 'cid', GOOGLE_CALENDAR_CLIENT_SECRET: 'csecret', GOOGLE_CALENDAR_REFRESH_TOKEN: 'rtoken', GOOGLE_CALENDAR_ID: CAL,
  }, live ? { FRONT_OFFICE_CHAT_LIVE: '1' } : {});
  return () => { supa(); for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}

/** Every real migration in PGlite; one business with a web-chat channel, saved settings and the Setter mode under test;
 * one qualified website visitor seeded through the real fo_* functions. */
export async function dbSetup(mode: Mode) {
  const migrations = (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort();
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;`);
  for (const f of migrations) await db.exec(await readFile(path.join(MIGRATIONS_DIR, f), 'utf8'));
  await db.query('insert into auth.users values ($1)', [DB_OWNER]);
  await db.query('insert into auth.sessions(id,user_id) values ($1,$2)', [SESSION, DB_OWNER]);
  const as = async (id: string | null) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, session_id: SESSION }) : '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
  };
  const one = async <T = unknown>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  await as(DB_OWNER);
  const w = await one<string>("select public.create_workspace('Ventra') as r");
  const channel = await one<string>("select public.fo_create_channel($1,'web-chat','ventra.com.au',$2) as r", [w, KEY]);
  const settings = templateSettings('ventra', 'Ventra');
  await one('select public.fo_save_agent_settings($1,$2,0) as r', [w, settings]);
  await one('select public.fo_save_operating_modes($1,$2,$3,0) as r', [w, mode, 'enquiry_only']);
  await as(null);
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const names = Object.keys(args);
    return (await db.query<{ r: unknown }>(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`, names.map(n => args[n]))).rows[0]?.r;
  };
  const answers = Object.fromEntries(settings.questions.map(q => [q.id, 'Gym in Joondalup, 40 leads a week, slow replies, this month']));
  const { contact } = await rpc('fo_ingest', { channel, channel_key: KEY, sender: VISITOR, message: 'Hi, do you work with gyms?', msg_id: 'chat-seed-00000001', opt_out: false, opt_in: false }) as { contact: string };
  await rpc('fo_save_details', { channel, channel_key: KEY, contact, new_answers: answers, contact_name: 'Sam', contact_email: 'sam@example.com', contact_phone: '+61411111111' });
  await rpc('fo_set_state', { channel, channel_key: KEY, contact, new_state: 'qualifying', agent_name: 'setter', reason: 'Seed: answering questions' });
  await rpc('fo_set_state', { channel, channel_key: KEY, contact, new_state: 'qualified', agent_name: 'setter', reason: 'Seed: all questions answered' });
  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    await db.exec('reset role');
    try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('set role anon'); }
  };
  return { db, rpc, rows, w, channel, contact, answers };
}
export type DbSetup = Awaited<ReturnType<typeof dbSetup>>;

/** A model script for the H-DB world: given the Anthropic request body, the assistant content for that round. */
export type DbScript = (body: { system: string; messages: { role: string; content: unknown }[] }) => Block[];

/** The original e2e script: offer times, book the first offered time, then a plain reply. */
export const offerThenBook: DbScript = (body) => {
  const last = body.messages.at(-1)?.content;
  const result = Array.isArray(last) ? (last as { type: string; content?: string }[]).find(b => b.type === 'tool_result') : undefined;
  if (!result) return [{ type: 'tool_use', id: 't1', name: 'offer_times', input: {} }];
  if (Array.isArray(body.messages.at(-2)?.content) && (body.messages.at(-2)!.content as Block[]).some(b => b.type === 'tool_use' && b.name === 'book_time')) return [{ type: 'text', text: 'All set.' }];
  let start: string | null = null;
  try { start = (JSON.parse(result.content ?? '') as { start: string }[])[0]?.start ?? null; } catch { /* times not offered */ }
  return [{ type: 'tool_use', id: 't2', name: 'book_time', input: { start: start ?? '__open_slot__' } }];
};

/** Fake global fetch: Supabase RPCs go to the real functions in PGlite; the model is scripted; Google Calendar is fake. */
export function dbWorld(rpc: DbSetup['rpc'], script: DbScript = offerThenBook) {
  const availability = availabilityFor(templateSettings('ventra', 'Ventra'));
  const rpcCalls: string[] = [], rpcErrors: string[] = [], hosts: string[] = [], errors: string[] = [], systems: string[] = [], events: { id: string; start: number; end: number }[] = [];
  let llmCalls = 0;
  const real = globalThis.fetch;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const handle = async (url: URL, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : {};
    if (url.host === 'api.anthropic.com') {
      llmCalls++; systems.push(String(body.system ?? ''));
      let content = script(body);
      const b = content[0];
      if (b?.type === 'tool_use' && (b.input as { start?: string }).start === '__open_slot__') {
        const open = await offerTimes({ busy: async () => [], createEvent: async () => { throw new Error('no'); }, hasEvent: async () => false } as never, availability, Date.now(), 12);
        content = [{ ...b, input: { start: new Date(open[0].start).toISOString() } } as Block];
      }
      return json(200, { content, stop_reason: content.some(x => x.type === 'tool_use') ? 'tool_use' : 'end_turn' });
    }
    if (url.host === 'oauth2.googleapis.com') return json(200, { access_token: 'fake-access', expires_in: 3600 });
    if (url.host === 'www.googleapis.com') {
      if (url.pathname.endsWith('/freeBusy')) return json(200, { calendars: { [CAL]: { busy: events.map(e => ({ start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString() })) } } });
      const m = url.pathname.match(/\/events(?:\/([^/]+))?$/);
      if (m && (init?.method ?? 'GET') === 'POST') {
        if (events.some(e => e.id === body.id)) return json(409, {});
        events.push({ id: body.id, start: Date.parse(body.start.dateTime), end: Date.parse(body.end.dateTime) });
        return json(200, { id: body.id, htmlLink: null });
      }
      if (m?.[1]) return events.some(e => e.id === m[1]) ? json(200, { id: m[1], status: 'confirmed' }) : json(404, {});
      return json(404, {});
    }
    if (url.host === '127.0.0.1:54321' && url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.slice('/rest/v1/rpc/'.length); rpcCalls.push(fn);
      try { return json(200, (await rpc(fn, body)) ?? null); } catch (e) { rpcErrors.push(`${fn}: ${(e as Error).message}`); return json(400, { message: (e as Error).message }); }
    }
    return json(404, {});
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    hosts.push(url.host);
    return handle(url, init);
  }) as typeof fetch;
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
  return { rpcCalls, rpcErrors, hosts, errors, systems, events, llmCalls: () => llmCalls, restore: () => { globalThis.fetch = real; console.error = realError; } };
}

export async function dbSend(id: string, message: string, visitor: string = VISITOR) {
  const { POST } = await import('../../app/api/front-office/chat/route.ts');
  return call(POST, '/api/front-office/chat', {
    method: 'POST', cookie: null, headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify({ visitor, message, id }),
  });
}

/** GET /api/front-office/chat: the history of one visitor on the configured channel. */
export async function dbHistory(visitor: string = VISITOR) {
  const { GET } = await import('../../app/api/front-office/chat/route.ts');
  return call(GET, `/api/front-office/chat?visitor=${encodeURIComponent(visitor)}`, { method: 'GET', cookie: null, headers: { origin: 'http://localhost:3000' } });
}

/** A second, unrelated business in the SAME database (A-52, X4): its own workspace, web-chat channel (with its own key),
 * saved settings and Setter mode, and one website visitor with private, recognisable details seeded through the real
 * fo_* functions. Same owner login as the first business (it only needs a second workspace; isolation is by workspace). */
export async function dbAddWorkspace(s: DbSetup, o: { name: string; key: string; visitor?: string; message: string; contactName: string; contactEmail: string; answers: Record<string, string>; mode?: Mode }) {
  const as = async (id: string | null) => {
    await s.db.exec('reset role');
    await s.db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, session_id: SESSION }) : '']);
    await s.db.exec(id ? 'set role authenticated' : 'set role anon');
  };
  const one = async <T = unknown>(sql: string, params: unknown[] = []) => (await s.db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  const visitor = o.visitor ?? VISITOR;
  await as(DB_OWNER);
  const w = await one<string>('select public.create_workspace($1) as r', [o.name]);
  const channel = await one<string>("select public.fo_create_channel($1,'web-chat','other.example',$2) as r", [w, o.key]);
  await one('select public.fo_save_agent_settings($1,$2,0) as r', [w, templateSettings('ventra', o.name)]);
  await one('select public.fo_save_operating_modes($1,$2,$3,0) as r', [w, o.mode ?? 'automatic', 'enquiry_only']);
  await as(null);
  const { contact } = await s.rpc('fo_ingest', { channel, channel_key: o.key, sender: visitor, message: o.message, msg_id: 'other-seed-00000001', opt_out: false, opt_in: false }) as { contact: string };
  await s.rpc('fo_save_details', { channel, channel_key: o.key, contact, new_answers: o.answers, contact_name: o.contactName, contact_email: o.contactEmail, contact_phone: null });
  return { w, channel, key: o.key, contact, visitor };
}

// ---------------------------------------------------------------------------------------------------------------
// Receptionist (A-51). H-RTURN: one runReceptionistTurn against the simulated store, with any calendar (fault
// injection) and operating mode; as quoteCall in front-office-receptionist-quote.test.ts. H-LABCALL: a multi-turn lab
// call through runReceptionistLabTurnWith with a scripted model per caller line. No network, nothing sent.

const rsim = await import('../../lib/front-office/receptionist/simulate.ts');
const rlab = await import('../../lib/front-office/receptionist/lab-live.ts');
const { runReceptionistTurn } = await import('../../lib/front-office/receptionist/agent.ts');
type ScriptStep = import('../../lib/front-office/receptionist/simulate.ts').ScriptStep;
type SimSeed = import('../../lib/front-office/receptionist/simulate.ts').SimSeed;
type SimToolCall = import('../../lib/front-office/receptionist/simulate.ts').SimToolCall;
type CallerTurn = import('../../lib/front-office/receptionist/agent.ts').CallerTurn;
type AgentSettings = import('../../lib/front-office/settings.ts').AgentSettings;
type CalendarProvider = import('../../lib/front-office/calendar/google.ts').CalendarProvider;
type ReceptionistLabState = import('../../lib/front-office/receptionist/lab-live.ts').ReceptionistLabState;

export const R_CALLER = '+61412000222';
export const R_CALL_ID = 'call_scenario0001';
/** The demo gym's required qualifying answers (same ids as the simulate.ts fixtures). */
export const R_QUALIFIED = { goal: 'Get fitter', experience: 'New to training, no injuries', preferred_times: 'Weekday mornings', start_timeframe: 'This week' };

/** Offers from a check_availability result ([] when it was not a list of times). */
export const offersFrom = (content: string | null | undefined): { label: string; start: string }[] => {
  try { const v = JSON.parse(content ?? ''); return Array.isArray(v) && v[0]?.start ? v : []; } catch { return []; }
};
export const toScenarioTools = (calls: SimToolCall[]): ScenarioToolCall[] => calls.map(({ name, input, result, isError }) => ({ name, input, result, isError }));

/** H-RTURN. `calendar`: null for "not connected", or a function wrapping the simulated calendar (fault injection). */
export async function receptionistTurn(o: {
  steps: ScriptStep[]; settings?: AgentSettings; caller?: string | null; contact?: SimSeed['contact'];
  calendar?: null | ((base: CalendarProvider) => CalendarProvider); mode?: OperatingMode; conversation?: CallerTurn[];
}) {
  const settings = o.settings ?? rsim.demoSettings();
  const caller = o.caller === undefined ? R_CALLER : o.caller;
  const db = rsim.simulationStore(settings, { caller, contact: o.contact });
  const b = o.contact?.booking;
  const cal = rsim.simulatedCalendar(b ? [{ id: b.eventId, start: Date.parse(b.starts), end: Date.parse(b.starts) + settings.bookingMinutes * 60_000 }] : []);
  const calendar = o.calendar === null ? null : o.calendar ? o.calendar(cal.provider) : cal.provider;
  const conversation = o.conversation ?? [{ role: 'user' as const, content: 'Hi' }];
  const a = { channel: rsim.SIM_AUTH.channel, channel_key: rsim.SIM_AUTH.key };
  const turn = await db.rpc('fo_voice_turn', { ...a, call_id: R_CALL_ID, caller, turn: 1, message: conversation.at(-1)?.content ?? null }) as { contact: string | null };
  const senders = rsim.recordingSenders();
  const tools: SimToolCall[] = [];
  const llm = rsim.recordingModel(rsim.scriptedModel(o.steps), 1, tools, () => undefined);
  const gen = runReceptionistTurn({ llm, rpc: db.rpc, auth: rsim.SIM_AUTH, calendar, send: senders.send, email: senders.email, settings, now: rsim.SIM_NOW, mode: o.mode, call: { id: R_CALL_ID, caller, contact: turn.contact }, conversation });
  let text = '', transferTo: string | null = null, r = await gen.next();
  while (!r.done) { if (r.value.type === 'text') text += r.value.text; else if (r.value.type === 'transfer') transferTo = r.value.number; r = await gen.next(); }
  return { db, tables: db.tables, text: text.trim(), summary: r.value, tools, transferTo, cal, senders, wouldSend: senders.out, contactId: turn.contact, settings };
}

/** H-LABCALL: a lab call (greeting first), one scripted model per caller line, the same settings throughout. */
export async function labCall(lines: { says: string; steps: ScriptStep[] }[], opts: { settings?: AgentSettings; from?: ReceptionistLabState } = {}) {
  let s = opts.from ?? await rlab.startReceptionistLab({ settings: opts.settings });
  for (const l of lines) s = await rlab.runReceptionistLabTurnWith(s, { says: l.says }, { base: rsim.scriptedModel(l.steps), model: 'scripted', settings: opts.settings });
  return s;
}
export const labCallTools = (s: ReceptionistLabState) => s.turns.flatMap(t => t.tools);

/** Receptionist globals: nothing sent, every outbound tagged with the receptionist and a prompt version, no booked
 * wording without an appointment that has a calendar event. */
export function assertReceptionistGlobals(x: { wouldSend: { sent: boolean }[]; tables: { fo_messages: { direction: string; agent: string | null; prompt_version: string | null }[]; fo_appointments: { provider_event_id: string }[] }; replies: string[] }) {
  assertNothingSent(x.wouldSend);
  assertOutboundTagged(x.tables.fo_messages.filter(m => m.direction === 'outbound'));
  assertNoFalseBooking(x.replies, x.tables.fo_appointments);
}

export async function dbSnapshot(s: DbSetup) {
  type Row = Record<string, unknown>;
  const contact = await s.rows<Row>('select id, state, name, email, phone from public.fo_contacts where workspace_id = $1', [s.w]);
  const messages = await s.rows<{ direction: string; body: string; agent: string | null; prompt_version: string | null }>('select direction, body, agent, prompt_version from public.fo_messages where contact_id = $1 order by created_at, id', [s.contact]);
  const pending = await s.rows<{ product: string; kind: string; status: string; idempotency_key: string; mode: string }>('select product, kind, status, idempotency_key, mode from public.fo_pending_actions where workspace_id = $1', [s.w]);
  const appointments = await s.rows<{ contact_id: string; status: string; provider_event_id: string }>('select contact_id, status, provider_event_id from public.fo_appointments where workspace_id = $1', [s.w]);
  const handoffs = await s.rows<{ from_agent: string; owner: string; channel: string }>('select from_agent, owner, channel from public.fo_handoffs where contact_id = $1 order by created_at', [s.contact]);
  const dispatches = await s.rows<{ agent: string; detail: string }>("select agent, detail from public.fo_events where contact_id = $1 and kind = 'dispatch' order by created_at", [s.contact]);
  return { contact, messages, pending, appointments, handoffs, dispatches };
}
