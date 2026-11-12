// Task A-18: the Meta reply queue (fo_outbox) lives in fo_pending_actions (migration 202611130004). PGlite with Supabase-like
// roles and every migration in order. The outbox assertions of front-office-db.test.ts are repeated here against the merged
// queue, plus: an approved reply is a row in fo_pending_actions, and a repeated approve or send cannot send twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const KEY = 'k'.repeat(40);
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
const MERGE = '202611130004_front_office_outbox_merge.sql';
const all = (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort();

async function setup(files: string[] = all) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;`);
  for (const f of files) await db.exec(await readFile(path.join(MIGRATIONS_DIR, f), 'utf8'));
  const owner = '11111111-1111-4111-8111-111111111111', staff = '22222222-2222-4222-8222-222222222222';
  const so = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ss = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await db.query('insert into auth.users values ($1),($2)', [owner, staff]);
  await db.query('insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)', [so, owner, ss, staff]);
  const as = async (id: string | null, session?: string) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, session_id: session }) : '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
  };
  const one = async <T = unknown>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  await as(owner, so);
  const w = await one<string>("select public.create_workspace('Ventra') as r");
  const ig = await one<string>("select public.fo_create_channel($1,'instagram','17841400000000001',$2) as r", [w, KEY]);
  await as(null);
  const ing = 'select public.fo_ingest($1,$2,$3,$4,$5,$6,$7) as r';
  const contact = (await one<Record<string, string>>(ing, [ig, KEY, '1234567890123', 'Intro classes?', 'aWdfZAG1faX1', false, false])).contact;
  return { db, as, one, w, ig, ing, contact, owner, so, staff, ss };
}
const queue = (one: Awaited<ReturnType<typeof setup>>['one'], ig: string, c: string, body: string) =>
  one<string>('select public.fo_queue_outbound($1,$2,$3,$4,$5) as r', [ig, KEY, c, body, 'setter/qualify@1']);

test('outbox queue (merged): approve logs once, edited text sent, opt-out cancels, permissions as before', async () => {
  const { db, as, one, w, ig, ing, contact: c, owner, so, staff, ss } = await setup();
  try {
    const q1 = await queue(one, ig, c, 'Intro week is $29. Mornings or evenings?');
    const q2 = await queue(one, ig, c, 'Second draft');
    await assert.rejects(db.query("select public.fo_decide_outbox($1,$2,'approved',null)", [w, q1]), /permission denied/, 'anon cannot approve');
    await as(staff, ss);
    await assert.rejects(db.query("select public.fo_decide_outbox($1,$2,'approved',null)", [w, q1]), /Workspace access/, 'non-member cannot approve');
    assert.equal((await db.query('select * from public.fo_outbox')).rows.length, 0, 'non-member sees no replies');
    await as(owner, so);
    assert.equal(await one('select count(*)::int as r from public.fo_outbox where status = $1', ['queued']), 2);
    const d = await one<Record<string, string>>("select public.fo_decide_outbox($1,$2,'approved',$3) as r", [w, q1, 'Intro week is $29! Mornings or evenings?']);
    assert.equal(d.status, 'approved'); assert.equal(d.kind, 'instagram'); assert.equal(d.recipient, '1234567890123'); assert.equal(d.body, 'Intro week is $29! Mornings or evenings?');
    await one('select public.fo_outbox_sent($1,$2,true,$3) as r', [w, q1, 'Sent']);
    await assert.rejects(db.query("select public.fo_decide_outbox($1,$2,'approved',null)", [w, q1]), /Nothing to decide/, 'decided once');
    assert.equal(await one("select count(*)::int as r from public.fo_messages where contact_id=$1 and direction='outbound' and prompt_version='setter/qualify@1+approved'", [c]), 1);
    await as(null);
    await one(ing, [ig, KEY, '1234567890123', 'stop', 'aWdfZAG1faX3', true, false]);
    await as(owner, so);
    assert.equal(await one('select status as r from public.fo_outbox where id=$1', [q2]), 'cancelled', 'opt-out cancels queued replies');
    assert.equal(await one('select status as r from public.fo_pending_actions where id=$1', [q2]), 'cancelled', '... in the one queue');
  } finally { await db.close(); }
});

test('an approved reply is a row in fo_pending_actions, and a repeated approve or send cannot send twice', async () => {
  const { db, as, one, w, ig, contact: c, owner, so } = await setup();
  try {
    const q = await queue(one, ig, c, 'See you Friday');
    await as(owner, so);
    const held = await one<Record<string, unknown>>('select to_jsonb(a) as r from public.fo_pending_actions a where id=$1', [q]);
    assert.equal(held.kind, 'outbox_reply'); assert.equal(held.status, 'pending'); assert.equal(held.product, 'setter'); assert.equal(held.contact_id, c);
    assert.deepEqual((await one<Record<string, string>>('select a.payload as r from public.fo_pending_actions a where id=$1', [q])), { kind: 'outbox_reply', body: 'See you Friday', prompt_version: 'setter/qualify@1' });
    assert.equal(await one("select count(*)::int as r from public.fo_list_actions($1,null,50) where kind = 'outbox_reply'", [w]), 0, 'the generic action list leaves replies to the reply queue');
    assert.equal(await one('select count(*)::int as r from public.fo_outbox where workspace_id = $1 and status = $2', [w, 'queued']), 1, 'the reply queue lists it');

    const first = await one<Record<string, string>>("select public.fo_decide_outbox($1,$2,'approved',null) as r", [w, q]);
    assert.equal(first.status, 'approved');
    assert.equal(await one('select status as r from public.fo_pending_actions where id=$1', [q]), 'approved');
    assert.equal(await one('select status as r from public.fo_outbox where id=$1', [q]), 'approved');
    // A second approve (double click, retry) is refused by the database, so the app never reaches its send step again.
    await assert.rejects(db.query("select public.fo_decide_outbox($1,$2,'approved',null)", [w, q]), /Nothing to decide/);
    await assert.rejects(db.query("select public.fo_decide_outbox($1,$2,'rejected',null)", [w, q]), /Nothing to decide/);
    // The generic owner calls cannot approve or finish it without sending.
    await assert.rejects(db.query("select public.fo_decide_action($1,'approve',null)", [q]), /reply queue/);
    await assert.rejects(db.query('select public.fo_finish_action($1,true,null)', [q]), /reply queue/);
    await one('select public.fo_outbox_sent($1,$2,true,$3) as r', [w, q, 'Sent']);
    await assert.rejects(db.query('select public.fo_outbox_sent($1,$2,true,$3)', [w, q, 'Sent again']), /Not approved/);
    const done = await one<Record<string, unknown>>('select to_jsonb(a) as r from public.fo_pending_actions a where id=$1', [q]);
    assert.equal(done.status, 'performed'); assert.ok(done.committed_at); assert.ok(done.decided_at);
    assert.equal(await one('select status as r from public.fo_outbox where id=$1', [q]), 'sent');
    assert.equal(await one("select count(*)::int as r from public.fo_messages where contact_id=$1 and direction='outbound'", [c]), 1, 'logged as sent exactly once');
    // A failed send is recorded, not retried silently.
    const q2 = await queue(one, ig, c, 'Another');
    await as(owner, so);
    await one("select public.fo_decide_outbox($1,$2,'approved',null) as r", [w, q2]);
    await one('select public.fo_outbox_sent($1,$2,false,$3) as r', [w, q2, 'Window closed']);
    assert.equal(await one('select status as r from public.fo_outbox where id=$1', [q2]), 'failed');
    assert.equal(await one("select count(*)::int as r from public.fo_messages where contact_id=$1 and direction='outbound'", [c]), 1);
    // Rejecting through the generic call is allowed (it never sends).
    const q3 = await queue(one, ig, c, 'Third');
    await as(owner, so);
    const rej = await one<{ changed: boolean; item: { status: string } }>("select public.fo_decide_action($1,'reject','no') as r", [q3]);
    assert.equal(rej.changed, true); assert.equal(rej.item.status, 'rejected');
    assert.equal(await one('select status as r from public.fo_outbox where id=$1', [q3]), 'rejected');
  } finally { await db.close(); }
});

test('expired reply is not sent; replies for another workspace stay out of reach; bad input is refused', async () => {
  const { db, as, one, w, ig, contact: c, owner, so, staff, ss } = await setup();
  try {
    const q = await queue(one, ig, c, 'Late one');
    await db.exec('reset role');
    await db.query("update public.fo_pending_actions set expires_at = now() - interval '1 minute', created_at = now() - interval '2 days' where id=$1", [q]);
    await as(owner, so);
    // F3: a pending reply past its expiry already reads as cancelled, before anything expires it.
    assert.equal(await one('select status as r from public.fo_outbox where id=$1', [q]), 'cancelled');
    assert.equal(await one('select count(*)::int as r from public.fo_outbox where workspace_id=$1 and status=$2', [w, 'queued']), 0, 'not counted as waiting');
    const r = await one<Record<string, string>>("select public.fo_decide_outbox($1,$2,'approved',null) as r", [w, q]);
    assert.equal(r.status, 'cancelled'); assert.equal(r.recipient, undefined);
    assert.equal(await one('select status as r from public.fo_pending_actions where id=$1', [q]), 'expired');
    await assert.rejects(db.query('select public.fo_outbox_sent($1,$2,true,$3)', [w, q, 'x']), /Not approved/);
    await as(staff, ss);
    const other = await one<string>("select public.create_workspace('Other') as r");
    await assert.rejects(db.query("select public.fo_decide_outbox($1,$2,'approved',null)", [other, q]), /Nothing to decide/, 'wrong workspace cannot decide');
    await as(null);
    await assert.rejects(db.query('select public.fo_queue_outbound($1,$2,$3,$4,$5)', [ig, KEY, c, '', 'p']), /1 to 1000/);
    await assert.rejects(db.query('select public.fo_queue_outbound($1,$2,$3,$4,$5)', [ig, KEY, c, 'x'.repeat(1001), 'p']), /1 to 1000/);
    await assert.rejects(db.query('select public.fo_queue_outbound($1,$2,$3,$4,$5)', [ig, 'wrong'.padEnd(40, 'x'), c, 'hi', 'p']), /Channel not recognised/);
    await assert.rejects(db.query('select * from public.fo_outbox'), /permission denied/, 'anon cannot read the view');
  } finally { await db.close(); }
});

test('migration moves existing fo_outbox rows into fo_pending_actions with their ids, statuses and text', async () => {
  const before = all.filter(f => f < MERGE);
  const { db, one, w, ig, contact: c } = await setup(before);
  try {
    await db.exec('reset role');
    const ins = (status: string, body: string, decided: boolean) => db.query<{ id: string }>(
      `insert into public.fo_outbox(workspace_id, contact_id, channel_id, body, prompt_version, status, decided_at, note) values ($1,$2,$3,$4,'setter/qualify@1',$5,${decided ? 'now()' : 'null'},'n') returning id`, [w, c, ig, body, status]);
    const ids: Record<string, string> = {};
    for (const [s, d] of [['queued', false], ['approved', true], ['sent', true], ['rejected', true], ['failed', true], ['cancelled', true]] as const) ids[s] = (await ins(s, `body ${s}`, d)).rows[0].id;
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, MERGE), 'utf8'));
    const want: Record<string, string> = { queued: 'pending', approved: 'approved', sent: 'performed', rejected: 'rejected', failed: 'failed', cancelled: 'cancelled' };
    for (const s of Object.keys(ids)) {
      assert.equal(await one('select status as r from public.fo_pending_actions where id=$1 and kind=$2', [ids[s], 'outbox_reply']), want[s], s);
      assert.equal(await one('select status as r from public.fo_outbox where id=$1', [ids[s]]), s, `${s} reads back unchanged through the view`);
      assert.equal(await one('select body as r from public.fo_outbox where id=$1', [ids[s]]), `body ${s}`);
    }
    assert.equal(await one("select count(*)::int as r from information_schema.tables where table_name='fo_outbox' and table_type='BASE TABLE'"), 0, 'the old table is gone');
    assert.equal(await one("select committed_at is not null as r from public.fo_pending_actions where id=$1", [ids.sent]), true);
  } finally { await db.close(); }
});

test('deleting a channel or a workspace that holds a queued reply is allowed, and an orphaned reply cannot be approved', async () => {
  const { db, as, one, w, ig, contact: c, owner, so } = await setup();
  try {
    const q = await queue(one, ig, c, 'Held while the channel goes');
    await db.exec('reset role');
    await db.query('delete from public.fo_channels where id = $1', [ig]);
    assert.equal(await one('select channel_id is null as r from public.fo_pending_actions where id=$1', [q]), true, 'the reply is kept, without a channel');
    await as(owner, so);
    await assert.rejects(db.query("select public.fo_decide_outbox($1,$2,'approved',null)", [w, q]), /Channel not found/);
    assert.equal(await one('select status as r from public.fo_pending_actions where id=$1', [q]), 'pending', 'not stranded as approved');
    assert.equal(await one("select (public.fo_decide_action($1,'reject','gone') -> 'item' ->> 'status') as r", [q]), 'rejected', 'it can still be rejected');
  } finally { await db.close(); }
  const e = await setup();
  try {
    await queue(e.one, e.ig, e.contact, 'Held while the workspace goes');
    await e.db.exec('reset role');
    await e.db.query('delete from public.workspaces where id = $1', [e.w]);
    assert.equal(await e.one('select count(*)::int as r from public.fo_pending_actions where workspace_id = $1', [e.w]), 0);
    assert.equal(await e.one('select count(*)::int as r from public.fo_pending_actions'), 0);
  } finally { await e.db.close(); }
});
