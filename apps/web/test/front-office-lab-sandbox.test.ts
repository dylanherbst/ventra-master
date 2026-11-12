// Task A-34: the Setter Lab runs on the user's lab sandbox (real fo_* functions in PGlite with Supabase-like roles) when
// the lab key secret is set and the visitor is signed in, and falls back to memory with a plain reason when not.
// Proven here: a Setter Lab booking is a real row that GET /api/front-office/contacts returns for the sandbox workspace;
// reset and save / load scenario work from the lab's server functions; a real-looking email from the model is stored as a
// test address (not a failed turn); nothing is sent (no network, FRONT_OFFICE_SEND_LIVE ignored).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { USER, call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';

const { newLab, runLabTurn, decideLabAction, checkedLab } = await import('../lib/front-office/setter/lab.ts');
const session = await import('../lib/front-office/lab-session.ts');
const sandboxGlue = await import('../app/tools/setter-lab/sandbox.ts');
const actions = await import('../app/tools/setter-lab/actions.ts');
const contactsRoute = await import('../app/api/front-office/contacts/route.ts');
const { CONTACT_COLUMNS } = await import('../lib/front-office/crm.ts');
type LabRpc = import('../lib/supabase/lab-sandbox.ts').LabRpc;

const realFetch = globalThis.fetch;
const fetchAttempts: string[] = [];
const sendLiveBefore = process.env.FRONT_OFFICE_SEND_LIVE;
before(() => { process.env.FRONT_OFFICE_SEND_LIVE = '1'; globalThis.fetch = (async (input: RequestInfo | URL) => { fetchAttempts.push(String(input)); throw new Error('network is off in this test'); }) as typeof fetch; });
after(() => {
  globalThis.fetch = realFetch;
  if (sendLiveBefore === undefined) delete process.env.FRONT_OFFICE_SEND_LIVE; else process.env.FRONT_OFFICE_SEND_LIVE = sendLiveBefore;
  assert.deepEqual(fetchAttempts, [], 'no network calls, even with FRONT_OFFICE_SEND_LIVE set');
});

const SECRET = 's'.repeat(48);
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
const QUALIFY = 'Hi, I\'m Sam. I run a gym in Fremantle. We get about 40 enquiries a week from Instagram. We are slow to reply and miss a lot of them. I want it fixed this week.';

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;`);
  for (const f of (await readdir(MIGRATIONS_DIR)).filter(x => x.endsWith('.sql')).sort()) await db.exec(await readFile(path.join(MIGRATIONS_DIR, f), 'utf8'));
  const owner = '11111111-1111-4111-8111-111111111111', so = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await db.query('insert into auth.users values ($1)', [owner]);
  await db.query('insert into auth.sessions(id,user_id) values ($1,$2)', [so, owner]);
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: so })]);
  await db.exec('set role authenticated');
  // The signed-in user's client: named arguments, data back, the database's own error text thrown.
  const rpc: LabRpc = async (fn, args) => {
    const keys = Object.keys(args);
    const values = keys.map(k => { const v = args[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
    return (await db.query<{ r: unknown }>(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, values)).rows[0]?.r;
  };
  const rows = async <T = unknown>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows.map(x => x.r);
  const open = () => session.openLabSession({ env: { [session.LAB_KEY_ENV_NAME]: SECRET }, userId: owner, rpc });
  return { db, rpc, rows, owner, open };
}

test('a Setter Lab booking is a real sandbox row, returned by GET /api/front-office/contacts for the sandbox workspace', async () => {
  const { rows, open } = await setup();
  const s = await open();
  assert.equal(s.persistence.mode, 'database');
  const ws = s.persistence.mode === 'database' ? s.persistence.workspaceId : '';
  assert.ok(s.backend);

  let lab = newLab('automatic');
  lab = await runLabTurn(lab, { message: QUALIFY }, s.backend!);
  assert.equal(lab.turns[0].error, null);
  assert.equal(lab.turns[0].state, 'qualified');
  lab = await runLabTurn(lab, { message: 'The first one please.' }, s.backend!);
  const t = lab.turns[1];
  assert.equal(t.error, null);
  assert.equal(t.booking?.decision, 'perform');
  assert.equal(t.booking?.booked, true);
  assert.equal(t.state, 'booked');
  assert.equal(lab.tables.appointments.length, 1, 'the page mirror shows the booking');
  assert.equal(lab.wouldSend.length >= 0, true);
  assert.ok(lab.wouldSend.every(w => w.sent === false), 'nothing is sent');

  // Real rows in the sandbox workspace.
  const appts = await rows<string>('select status as r from public.fo_appointments where workspace_id = $1', [ws]);
  assert.deepEqual(appts, ['booked']);
  const stored = await rows<Record<string, unknown>>(`select to_jsonb(c) as r from (select ${CONTACT_COLUMNS} from public.fo_contacts where workspace_id = $1) c`, [ws]);
  assert.equal(stored.length, 1);

  // The route, fed exactly those rows under the sandbox workspace id.
  const restore = setEnv(configuredEnv);
  const fake = installFakeSupabase({ tables: { memberships: [{ user_id: USER }], fo_contacts: stored } });
  try {
    const r = await call(contactsRoute.GET, `/api/front-office/contacts?workspace=${ws}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 1);
    assert.equal(r.body.items[0].workspaceId, ws);
    assert.equal(r.body.items[0].state, 'booked');
    assert.equal(r.body.items[0].phone, lab.phone);
    assert.equal(r.body.items[0].id, t.contactId);
  } finally { fake.restore(); restore(); }
  fetchAttempts.length = 0; // the route test's own (faked) fetches are not network calls
});

test('a real-looking email from the model is stored as a test address and the turn does not fail', async () => {
  const { rows, open } = await setup();
  const s = await open();
  const ws = s.persistence.mode === 'database' ? s.persistence.workspaceId : '';
  const lab = await runLabTurn(newLab('automatic'), { message: 'Hi, I\'m Sam. I run a gym in Fremantle. My email is Sam.Lee@gmail.com' }, s.backend!);
  const t = lab.turns[0];
  assert.equal(t.error, null);
  assert.ok(t.reply);
  const emails = await rows<string | null>('select email as r from public.fo_contacts where workspace_id = $1', [ws]);
  assert.deepEqual(emails, ['sam.lee@lab-sandbox.test']);
  assert.ok(t.writes.some(w => /looked real/.test(w.detail)), 'the turn says the address was swapped');
  assert.equal(session.sandboxEmail('x@example.com'), 'x@example.com');
  assert.equal(session.sandboxEmail('A B@corp.com.au'), 'ab@lab-sandbox.test');
  assert.ok(session.isTestEmail('a@b.invalid') && !session.isTestEmail('a@gmail.com'));
});

test('owner approval in the sandbox: the held booking is approved once and the row appears', async () => {
  const { rows, open } = await setup();
  const s = await open();
  const ws = s.persistence.mode === 'database' ? s.persistence.workspaceId : '';
  let lab = await runLabTurn(newLab('owner_approval'), { message: QUALIFY }, s.backend!);
  lab = await runLabTurn(lab, { message: 'The last one please.' }, s.backend!);
  assert.equal(lab.turns[1].booking?.decision, 'hold_for_approval');
  assert.equal((await rows('select 1 as r from public.fo_appointments where workspace_id = $1', [ws])).length, 0);
  lab = await decideLabAction(lab, lab.pending[0].id, 'approve', s.backend!);
  assert.equal(lab.decisions[0].outcome, 'performed');
  assert.equal((await rows('select 1 as r from public.fo_appointments where workspace_id = $1', [ws])).length, 1);
  assert.equal(lab.tables.contacts[0].state, 'booked');
});

test('reset and save / load scenario work on the sandbox rows and the lab state', async () => {
  const { rows, open } = await setup();
  const s = await open();
  const ws = s.persistence.mode === 'database' ? s.persistence.workspaceId : '';
  const count = async () => (await rows('select 1 as r from public.fo_contacts where workspace_id = $1', [ws])).length;

  let lab = await runLabTurn(newLab('automatic'), { message: QUALIFY }, s.backend!);
  lab = await runLabTurn(lab, { message: 'The first one please.' }, s.backend!);
  assert.equal(await count(), 1);

  const saved = await sandboxGlue.scenarioSave(s, 'setter', 'Booked lead', lab);
  assert.ok(saved.ok && saved.value.contacts === 1 && saved.value.appointments === 1);
  const again = await sandboxGlue.scenarioSave(s, 'setter', 'Booked lead', lab);
  assert.ok(again.ok && again.value.revision === 2, 'saving over the same name bumps the revision');
  assert.deepEqual((await sandboxGlue.scenarioList(s, 'setter')).map(x => x.name), ['Booked lead']);

  const reset = await sandboxGlue.resetSandbox(s);
  assert.ok(reset.ok && reset.value?.contacts === 1);
  assert.equal(await count(), 0);
  assert.equal((await rows('select 1 as r from public.fo_appointments where workspace_id = $1', [ws])).length, 0);

  const loaded = await sandboxGlue.scenarioLoad(s, 'setter', 'Booked lead');
  assert.ok(loaded.ok);
  assert.equal(await count(), 1, 'the saved rows are back');
  const restored = checkedLab(loaded.ok ? loaded.value : null);
  assert.equal(restored.turns.length, 2);
  // The lab keeps working on the loaded rows: the same contact answers (the phone matches).
  const next = await runLabTurn(restored, { message: 'Thanks!' }, s.backend!);
  assert.equal(next.turns[2].contactId, restored.turns[1].contactId);
  assert.equal(await count(), 1);

  const gone = await sandboxGlue.scenarioDelete(s, 'setter', 'Booked lead');
  assert.ok(gone.ok);
  assert.deepEqual(await sandboxGlue.scenarioList(s, 'setter'), []);
  const missing = await sandboxGlue.scenarioLoad(s, 'setter', 'Booked lead');
  assert.ok(!missing.ok && /Scenario not found/.test(missing.error));
});

type Req = { messages: { role: string; content: unknown }[] };
type Blk = Record<string, unknown>;
const toolB = (name: string, input: Record<string, unknown> = {}): Blk => ({ type: 'tool_use', id: `toolu_${name}`, name, input });
const textB = (text: string): Blk => ({ type: 'text', text });
const lastResults = (r: Req): string[] => { const m = r.messages.at(-1); return Array.isArray(m?.content) ? (m.content as Blk[]).filter(x => x.type === 'tool_result').map(x => String(x.content)) : []; };
/** A scripted Receptionist model: one step per model call, each step sees the request. */
function steps(list: ((r: Req) => Blk[])[]) {
  const queue = [...list];
  return (async (r: Req) => {
    const content = (queue.shift() ?? (() => [textB('Okay.')]))(r);
    return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
  }) as unknown as import('../lib/front-office/llm.ts').Llm;
}
const QUALIFIED = { goal: 'Get fitter', experience: 'New, no injuries', preferred_times: 'Weekday mornings', start_timeframe: 'This week' };
const lastOffer = (r: Req) => (JSON.parse(lastResults(r)[0] ?? '[]') as { start: string }[]).at(-1)?.start ?? 'none';

test('Receptionist Lab on the sandbox: a call books a real row, email is a test address, end-of-call summary and scenarios work', async () => {
  const rl = await import('../lib/front-office/receptionist/lab-live.ts');
  const { rows, open } = await setup();
  const s = await open();
  const ws = s.persistence.mode === 'database' ? s.persistence.workspaceId : '';
  assert.ok(s.voice);
  let st = await rl.startReceptionistLab({ backend: s.voice! });
  assert.notEqual(st.callId, rl.RECEPTIONIST_LAB_CALL_ID, 'a sandbox call has its own provider call id');
  assert.equal(st.tables.fo_calls.length, 1);
  assert.equal(st.tables.fo_contacts[0].phone, rl.RECEPTIONIST_LAB_CALLER);
  assert.equal((await rows('select 1 as r from public.fo_calls where workspace_id = $1', [ws])).length, 1);

  st = await rl.runReceptionistLabTurnWith(st, { says: 'Hi, I am Alex. I want a free trial. Weekday mornings, this week.' }, { model: 'scripted', backend: s.voice!, base: steps([
    () => [toolB('qualify', { answers: QUALIFIED, name: 'Alex', email: 'alex@gmail.com' })],
    () => [toolB('check_availability')],
    () => [textB('I have a few times. Which suits?')],
  ]) });
  assert.equal(st.turns.at(-1)!.error, null);
  st = await rl.runReceptionistLabTurnWith(JSON.parse(JSON.stringify(st)), { says: 'The last one please.' }, { model: 'scripted', backend: s.voice!, base: steps([
    () => [toolB('check_availability')],
    r => [toolB('book', { start: lastOffer(r) })],
    () => [textB('You are booked in.')],
  ]) });
  const t = st.turns.at(-1)!;
  assert.equal(t.error, null);
  assert.deepEqual(t.outcomes, ['booked']);
  assert.equal(st.tables.fo_appointments.length, 1, 'the page mirror shows the booking');
  assert.equal(st.tables.fo_contacts[0].state, 'booked');
  assert.ok(st.wouldSend.every(w => w.sent === false), 'nothing is sent');
  assert.deepEqual(await rows('select email as r from public.fo_contacts where workspace_id = $1', [ws]), ['alex@lab-sandbox.test']);
  assert.deepEqual(await rows('select status as r from public.fo_appointments where workspace_id = $1', [ws]), ['booked']);

  const ended = await rl.endReceptionistLabCall(st, { backend: s.voice! });
  assert.ok(ended.ended);
  assert.match(ended.ended!.summary.outcome.text, /booked/i);
  assert.equal((await rows<boolean>('select ended_at is not null as r from public.fo_calls where workspace_id = $1', [ws]))[0], true);

  const saved = await sandboxGlue.scenarioSave(s, 'receptionist', 'Booked call', ended);
  assert.ok(saved.ok && saved.value.appointments === 1);
  assert.ok((await sandboxGlue.resetSandbox(s)).ok);
  assert.equal((await rows('select 1 as r from public.fo_appointments where workspace_id = $1', [ws])).length, 0);
  const loaded = await sandboxGlue.scenarioLoad(s, 'receptionist', 'Booked call');
  assert.ok(loaded.ok);
  assert.equal(rl.checkedReceptionistLab(loaded.ok ? loaded.value : null).callId, st.callId);
  assert.equal((await rows('select 1 as r from public.fo_appointments where workspace_id = $1', [ws])).length, 1);
  // Receptionist scenarios do not show in the Setter list.
  assert.deepEqual(await sandboxGlue.scenarioList(s, 'setter'), []);
});

test('without the lab key secret the labs fall back to memory with a plain reason, and still work', async () => {
  const { rpc, owner } = await setup();
  const none = await session.openLabSession({ env: {}, userId: owner, rpc });
  assert.equal(none.persistence.mode, 'memory');
  assert.equal(none.persistence.mode === 'memory' && none.persistence.reason, session.MEMORY_NO_SECRET);
  assert.match(session.MEMORY_NO_SECRET, /FRONT_OFFICE_LAB_KEY_SECRET/);
  assert.match(session.MEMORY_NO_SECRET, /memory on this page only/);
  assert.equal(none.backend, null);
  const short = await session.openLabSession({ env: { [session.LAB_KEY_ENV_NAME]: 'short' }, userId: owner, rpc });
  assert.equal(short.persistence.mode === 'memory' && short.persistence.reason, session.MEMORY_SHORT_SECRET);
  const out = await session.openLabSession({ env: { [session.LAB_KEY_ENV_NAME]: SECRET }, userId: null, rpc: null });
  assert.equal(out.persistence.mode === 'memory' && out.persistence.reason, session.MEMORY_SIGNED_OUT);
  const broken = await session.openLabSession({ env: { [session.LAB_KEY_ENV_NAME]: SECRET }, userId: owner, rpc: async () => { throw new Error('connection refused'); } });
  assert.equal(broken.persistence.mode === 'memory' && broken.persistence.reason, session.MEMORY_UNAVAILABLE);

  // The server functions: no cookie, no env secret -> memory, the demo conversation still runs, and says why.
  const started = await actions.startLab('automatic');
  assert.equal(started.error, null);
  assert.equal(started.persistence?.mode, 'memory');
  const r = await actions.sendMessage(started.state!, 'Hi, I run a gym in Perth.', 'automatic');
  assert.equal(r.error, null);
  assert.equal(r.persistence?.mode, 'memory');
  assert.ok(r.state!.tables.contacts.length === 1 && r.state!.turns[0].reply);
  const saveMem = await actions.saveScenario(r.state!, 'x');
  assert.match(saveMem.error ?? '', /memory on this page only/);
  const resetMem = await actions.resetLab('automatic');
  assert.equal(resetMem.state?.turns.length, 0);
  assert.match(resetMem.notice ?? '', /memory only/);
});

test('the sandbox cannot be reset or loaded without a sandbox session (memory mode refuses scenario writes)', async () => {
  const mem = await session.openLabSession({ env: {}, userId: null, rpc: null });
  assert.deepEqual(await sandboxGlue.scenarioList(mem, 'setter'), []);
  const save = await sandboxGlue.scenarioSave(mem, 'setter', 'x', {});
  assert.ok(!save.ok);
  const load = await sandboxGlue.scenarioLoad(mem, 'setter', 'x');
  assert.ok(!load.ok);
  const reset = await sandboxGlue.resetSandbox(mem);
  assert.ok(reset.ok && reset.value === null);
});

// A-66: error text in action results is filtered, persistence is kept, the shared-sandbox warning is plain, and the
// signed-in check runs once for a live message.
test('A-66: a database error message never reaches an action result; the labs own validation text and persistence do', async () => {
  const raw = 'PostgREST 42P01: relation "public.fo_secret_table" does not exist (details: key=abc)';
  assert.equal(await session.safeLabError(new Error(raw)), 'The lab sandbox is unavailable. Please retry.');
  assert.equal(await session.safeLabError('not an error'), 'The lab sandbox is unavailable. Please retry.');
  assert.equal(await session.safeLabError(new Error('Scenario not found.')), 'Scenario not found.');
  assert.match(await session.safeLabError(new Error('The lab state is not valid (not an object). Start a new conversation.')), /^The lab state is not valid/);

  // Through the server functions: a bad state fails, keeps persistence, and shows the lab's own message only.
  for (const r of [await actions.sendMessage(null as never, 'hi', 'automatic'), await actions.decideAction(null as never, 'x', 'approve'), await actions.saveScenario(null as never, 'n')]) {
    assert.equal(r.state, null);
    assert.match(r.error ?? '', /^The lab state is not valid/);
    assert.equal(r.persistence?.mode, 'memory', 'persistence is kept on the failure path');
  }
  const bad = await actions.decideAction(newLab('automatic'), 'x', 'maybe' as never);
  assert.equal(bad.error, 'Decision must be approve or reject.');
  assert.equal(bad.persistence?.mode, 'memory');

  const src = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/tools/setter-lab/actions.ts'), 'utf8');
  assert.doesNotMatch(src, /e\.message\.slice/, 'no raw error text in the setter actions');
  const rsrc = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/tools/receptionist-lab/actions.ts'), 'utf8');
  assert.doesNotMatch(rsrc, /e\.message\.slice/, 'no raw error text in the receptionist actions');
});

test('A-66: the reset notices and buttons say the whole shared lab sandbox is cleared', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const setterSrc = await readFile(path.resolve(here, '../app/tools/setter-lab/actions.ts'), 'utf8');
  const recSrc = await readFile(path.resolve(here, '../app/tools/receptionist-lab/actions.ts'), 'utf8');
  assert.match(setterSrc, /clears the whole lab sandbox, including the Receptionist Lab data/);
  assert.match(recSrc, /clears the whole lab sandbox, including the Setter Lab data/);
  assert.match(await readFile(path.resolve(here, '../app/tools/setter-lab/lab.tsx'), 'utf8'), /New conversation \(clears the whole lab sandbox, including the Receptionist Lab\)/);
  assert.match(await readFile(path.resolve(here, '../app/tools/receptionist-lab/live-call.tsx'), 'utf8'), /including the Setter Lab\)<\/button>/);
});

test('A-66: labSessionFromToken reuses an already verified caller and does not verify twice', async () => {
  let getUserCalls = 0;
  const verify = { configured: () => true, authClient: () => ({ auth: { getUser: async () => { getUserCalls++; return { data: { user: { id: USER } }, error: null }; } } }), sessionClient: () => ({ rpc: async () => ({ data: true, error: null }) }) };
  const env = { [session.LAB_KEY_ENV_NAME]: SECRET };
  const client = () => ({ rpc: async () => ({ data: null, error: { message: 'boom' } }) });
  await sandboxGlue.labSessionFromToken('tok', { env, verify, client });
  assert.equal(getUserCalls, 1, 'without a verified caller it verifies once');
  getUserCalls = 0;
  await sandboxGlue.labSessionFromToken('tok', { env, verify, client, verified: { caller: { userId: USER }, error: null } });
  assert.equal(getUserCalls, 0, 'with the verified caller handed on it does not verify again');
});
