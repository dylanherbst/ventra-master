// A dropped call from a withheld number with no contact still leaves a staff-visible event (migration 202611130003).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const KEY = 'k'.repeat(40);
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
  const files = ['202610160001_s01.sql', '202611060001_front_office.sql', '202611060002_front_office_appointments.sql', '202611060003_front_office_setter.sql', '202611060004_front_office_chat_email.sql', '202611060005_front_office_meta.sql', '202611080001_front_office_receptionist.sql', '202611130002_front_office_voice_end_first.sql', '202611130003_front_office_voice_end_withheld.sql'];
  for (const f of files) await db.exec(await readFile(`../../supabase/migrations/${f}`, 'utf8'));
  const owner = '11111111-1111-4111-8111-111111111111', sess = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await db.query('insert into auth.users values ($1)', [owner]);
  await db.query('insert into auth.sessions(id,user_id) values ($1,$2)', [sess, owner]);
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: sess })]);
  await db.exec('set role authenticated');
  const one = async <T = unknown>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  const w = await one<string>("select public.create_workspace('Iron Gym') as r");
  const ch = await one<string>("select public.fo_create_channel($1,'voice',$2,$3) as r", [w, '+61800000001', KEY]);
  await db.exec('reset role');
  await db.exec('set role anon');
  return { db, one, ch, w };
}

type End = { call: string; contact: string | null; first: boolean };

test('withheld, contactless dropped call gets a placeholder contact and one staff-visible event; a duplicate adds nothing', async () => {
  const { db, one, ch, w } = await setup();
  try {
    const args = ['call_withheld1', null, 'customer-ended-call', '', 'User: hello'];
    const first = await one<End>(END, [ch, KEY, ...args]);
    assert.equal(first.first, true);
    assert.ok(first.contact, 'a contact exists for staff to see');
    const dup = await one<End>(END, [ch, KEY, ...args]);
    assert.equal(dup.first, false);
    assert.equal(dup.contact, first.contact, 'same contact, no second one');
    // Repeated duplicates with other reasons (one PGlite connection runs these serially: this is not a concurrency test).
    const [a, b] = await Promise.all([one<End>(END, [ch, KEY, 'call_withheld1', null, 'silence-timed-out', '', '']), one<End>(END, [ch, KEY, 'call_withheld1', null, 'customer-ended-call', '', ''])]);
    assert.equal(a.first || b.first, false);

    await db.exec('reset role');
    const contacts = (await db.query<{ id: string; name: string; phone: string | null }>('select id, name, phone from public.fo_contacts where workspace_id = $1', [w])).rows;
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].id, first.contact);
    assert.equal(contacts[0].name, 'Withheld caller');
    assert.equal(contacts[0].phone, null);
    const calls = (await db.query<{ n: string }>("select count(*)::text as n from public.fo_events where contact_id = $1 and kind = 'call'", [first.contact])).rows;
    assert.equal(calls[0].n, '1', 'exactly one call event despite duplicates');
    const created = (await db.query<{ n: string }>("select count(*)::text as n from public.fo_events where contact_id = $1 and kind = 'created'", [first.contact])).rows;
    assert.equal(created[0].n, '1');
  } finally { await db.close(); }
});

test('prefix and max-duration drops get a placeholder; a settled outcome or an existing contact gets none', async () => {
  const { db, one, ch, w } = await setup();
  try {
    for (const [id, reason] of [['call_prefix001', 'pipeline-error-x'], ['call_maxdur001', 'exceeded-max-duration']]) {
      const r = await one<End>(END, [ch, KEY, id, null, reason, '', '']);
      assert.equal(r.first, true);
      assert.ok(r.contact, `${reason} leaves a contact`);
    }
    for (const outcome of ['booked', 'rescheduled', 'cancelled', 'message', 'transfer', 'not-live']) {
      const id = `call_settled_${outcome.replace('-', '')}`;
      await one('select public.fo_voice_outcome($1,$2,$3,$4) as r', [ch, KEY, id, outcome]);
      const r = await one<End>(END, [ch, KEY, id, null, 'customer-ended-call', '', '']);
      assert.equal(r.first, true);
      assert.equal(r.contact, null, `${outcome} is settled: no placeholder`);
    }
    const known = await one<End>(END, [ch, KEY, 'call_knowncall1', '+61411111111', 'customer-ended-call', '', '']);
    await db.exec('reset role');
    const contacts = (await db.query<{ name: string | null; phone: string | null }>('select name, phone from public.fo_contacts where workspace_id = $1', [w])).rows;
    assert.equal(contacts.length, 3, 'two placeholders and one real caller, nothing else');
    assert.equal(contacts.filter(c => c.name === 'Withheld caller').length, 2);
    const stored = (await db.query<{ contact_id: string }>('select contact_id from public.fo_calls where id = $1', [known.call])).rows[0];
    assert.equal(stored.contact_id, known.contact, 'the existing contact is kept');
    assert.equal(contacts.find(c => c.phone === '+61411111111')?.name, null);
  } finally { await db.close(); }
});

test('a contactless call that was not dropped (assistant ended, never answered) creates no placeholder', async () => {
  const { db, one, ch, w } = await setup();
  try {
    for (const [id, reason] of [['call_ended0001', 'assistant-ended-call'], ['call_noanswer1', 'customer-did-not-answer'], ['call_voicemail', 'voicemail']]) {
      const r = await one<End>(END, [ch, KEY, id, null, reason, '', '']);
      assert.equal(r.first, true);
      assert.equal(r.contact, null);
    }
    await db.exec('reset role');
    assert.equal((await db.query('select 1 from public.fo_contacts where workspace_id = $1', [w])).rows.length, 0);
  } finally { await db.close(); }
});
