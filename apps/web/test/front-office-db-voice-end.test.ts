// fo_voice_end reports `first` atomically (migration 202611130002).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const KEY = 'k'.repeat(40), KEY2 = 'm'.repeat(40), CALLER = '+61411111111';
const END = 'select public.fo_voice_end($1,$2,$3,$4,$5,$6,$7) as r';

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
  const files = ['202610160001_s01.sql', '202611060001_front_office.sql', '202611060002_front_office_appointments.sql', '202611060003_front_office_setter.sql', '202611060004_front_office_chat_email.sql', '202611060005_front_office_meta.sql', '202611080001_front_office_receptionist.sql', '202611130002_front_office_voice_end_first.sql'];
  for (const f of files) await db.exec(await readFile(`../../supabase/migrations/${f}`, 'utf8'));
  const owner = '11111111-1111-4111-8111-111111111111', sess = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await db.query('insert into auth.users values ($1)', [owner]);
  await db.query('insert into auth.sessions(id,user_id) values ($1,$2)', [sess, owner]);
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: sess })]);
  await db.exec('set role authenticated');
  const one = async <T = unknown>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  const w1 = await one<string>("select public.create_workspace('Iron Gym') as r");
  const w2 = await one<string>("select public.create_workspace('Other Gym') as r");
  const ch1 = await one<string>("select public.fo_create_channel($1,'voice',$2,$3) as r", [w1, '+61800000001', KEY]);
  const ch2 = await one<string>("select public.fo_create_channel($1,'voice',$2,$3) as r", [w2, '+61800000002', KEY2]);
  await db.exec('reset role');
  await db.exec('set role anon');
  return { db, one, ch1, ch2 };
}

type End = { call: string; first: boolean };

test('fo_voice_end: concurrent identical reports give exactly one first=true; other calls are independent; wrong workspace refused', async () => {
  const { db, one, ch1, ch2 } = await setup();
  try {
    const args = (ch: string, key: string, id: string, reason = 'customer-ended-call') => [ch, key, id, CALLER, reason, 'Summary', 'User: hi'];
    const both = await Promise.all([one<End>(END, args(ch1, KEY, 'call_0001abcd')), one<End>(END, args(ch1, KEY, 'call_0001abcd'))]);
    assert.equal(both.filter((r) => r.first === true).length, 1, 'exactly one winner');
    assert.equal(both.filter((r) => r.first === false).length, 1);
    assert.equal(both[0].call, both[1].call);

    const later = await one<End>(END, args(ch1, KEY, 'call_0001abcd', 'overwritten'));
    assert.equal(later.first, false, 'a late duplicate is not first');

    const other = await one<End>(END, args(ch1, KEY, 'call_0002abcd'));
    assert.equal(other.first, true, 'another call is independent');
    assert.notEqual(other.call, both[0].call);

    await assert.rejects(db.query(END, args(ch1, KEY2, 'call_0003abcd')), /Channel not recognised/, 'other workspace key refused');
    await assert.rejects(db.query(END, args(ch2, KEY, 'call_0003abcd')), /Channel not recognised/);
    const sameIdOtherWorkspace = await one<End>(END, args(ch2, KEY2, 'call_0001abcd'));
    assert.equal(sameIdOtherWorkspace.first, true, 'same provider id in another workspace is its own call');

    await db.exec('reset role');
    const rows = (await db.query<{ ended_reason: string; events: string }>(
      "select ended_reason, (select count(*) from public.fo_events e where e.contact_id = k.contact_id and e.kind = 'call')::text as events from public.fo_calls k where provider_call_id = 'call_0001abcd' and channel_id = $1", [ch1])).rows;
    assert.equal(rows[0].ended_reason, 'customer-ended-call', 'duplicates do not overwrite');
    assert.equal(rows[0].events, '2', 'one call event per ended call (this caller ended two calls), none for duplicates');
  } finally { await db.close(); }
});
