// G11 (task A-68): fo_save_details stores only the business's question ids, with sizes capped, against the real migrations
// in PGlite with Supabase-like roles (migration 202611130001). No network, nothing sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import './helpers/route-harness.ts';

const { templateSettings } = await import('../lib/front-office/settings.ts');

const KEY = 'k'.repeat(40), OTHER_KEY = 'o'.repeat(40);
const GUARD = '202611130001_front_office_save_details_guard.sql';
const migrations = ['202610160001_s01.sql', '202611060001_front_office.sql', '202611060002_front_office_appointments.sql', '202611060003_front_office_setter.sql',
  '202611060004_front_office_chat_email.sql', '202611060005_front_office_meta.sql', '202611080001_front_office_receptionist.sql', GUARD];
const details = 'select public.fo_save_details($1,$2,$3,$4::jsonb,$5,$6,$7) as r';

async function setup(withSettings: boolean) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
  for (const f of migrations) await db.exec(await readFile(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8'));
  const owner = '11111111-1111-4111-8111-111111111111', session = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await db.query('insert into auth.users values ($1)', [owner]);
  await db.query('insert into auth.sessions(id,user_id) values ($1,$2)', [session, owner]);
  const as = async (id: string | null) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, session_id: session }) : '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
  };
  const one = async <T = unknown>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  await as(owner);
  const ids = templateSettings('ventra', 'Ventra').questions.map(q => q.id);
  const make = async (name: string, number: string, key: string) => {
    const w = await one<string>('select public.create_workspace($1) as r', [name]);
    const channel = await one<string>("select public.fo_create_channel($1,'web-chat',$2,$3) as r", [w, number, key]);
    if (withSettings) await one('select public.fo_save_agent_settings($1,$2,0) as r', [w, templateSettings('ventra', name)]);
    return { w, channel };
  };
  const a = await make('Alpha Gym', 'alpha.example', KEY);
  const b = await make('Beta Gym', 'beta.example', OTHER_KEY);
  await as(null);
  const ing = 'select public.fo_ingest($1,$2,$3,$4,$5,$6,$7) as r';
  const contact = (await one<Record<string, string>>(ing, [a.channel, KEY, 'v_abcdefghijklmnop', 'Hi', 'chat-0001', false, false])).contact;
  const otherContact = (await one<Record<string, string>>(ing, [b.channel, OTHER_KEY, 'v_qrstuvwxyzabcdef', 'Hi', 'chat-0002', false, false])).contact;
  const save = (answers: unknown, c = contact) => one<{ answers: Record<string, unknown> }>(details, [a.channel, KEY, c, JSON.stringify(answers), null, null, null]);
  const stored = async (id: string) => { await db.exec('reset role'); try { return (await db.query<{ answers: Record<string, unknown> }>('select answers from public.fo_contacts where id=$1', [id])).rows[0]!.answers; } finally { await db.exec('set role anon'); } };
  return { db, as, one, a, b, ids, contact, otherContact, save, stored, owner };
}

test('G11: a question id is stored; admin, __proto__, constructor and other unknown keys are dropped', async () => {
  const { db, ids, save, stored, contact } = await setup(true);
  try {
    const raw = `{"${ids[0]}":"Gym in Perth","admin":"true","role":"owner","constructor":"x","Bad Key":"y","__proto__":{"polluted":"yes"}}`;
    const r = await save(JSON.parse(raw));
    assert.deepEqual(r.answers, { [ids[0]!]: 'Gym in Perth' });
    assert.deepEqual(await stored(contact), { [ids[0]!]: 'Gym in Perth' });
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    // Known keys keep merging as before: a later answer for another id adds, the same id replaces.
    const again = await save({ [ids[1]!]: 'Slow replies', [ids[0]!]: 'Gym in Joondalup' });
    assert.deepEqual(again.answers, { [ids[0]!]: 'Gym in Joondalup', [ids[1]!]: 'Slow replies' });
    // Keys that are valid ids for another business are not valid here.
    const none = await save({ unrelated_question: 'x' });
    assert.deepEqual(none.answers, again.answers);
  } finally { await db.close(); }
});

test('G11: values are capped at 500 characters, scalars become text, objects, arrays and null are dropped, key count is bounded', async () => {
  const { db, ids, save, one, a, contact } = await setup(true);
  try {
    const r = await save({ [ids[0]!]: 'x'.repeat(5000), [ids[1]!]: 42, [ids[2]!]: { nested: 'object' } });
    assert.equal((r.answers[ids[0]!] as string).length, 500);
    assert.equal(r.answers[ids[1]!], '42');
    assert.equal(ids[2]! in r.answers, false, 'objects are not stored');
    const r2 = await save({ [ids[2]!]: ['a'], [ids[3] ?? ids[0]!]: null });
    assert.equal(ids[2]! in r2.answers, false);
    // Hundreds of junk keys are refused, not silently trimmed.
    const junk = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`junk_${i}`, 'x']));
    await assert.rejects(save(junk), /Too many answers/);
    await assert.rejects(one(details, [a.channel, KEY, contact, '"a string"', null, null, null]), /Answers must be an object/);
  } finally { await db.close(); }
});

test('G11: another workspace\'s contact or channel key is still refused, and its data is untouched', async () => {
  const { db, ids, a, b, otherContact, stored, one } = await setup(true);
  try {
    await assert.rejects(one(details, [a.channel, KEY, otherContact, JSON.stringify({ [ids[0]!]: 'HACKED' }), 'HACKED', null, null]), /Contact not found/);
    await assert.rejects(one(details, [b.channel, KEY, otherContact, '{}', null, null, null]), /Channel not recognised/);
    assert.deepEqual(await stored(otherContact), {});
  } finally { await db.close(); }
});

test('G11: non-storable values do not use up the 20-answer limit', async () => {
  const { db, save } = await setup(false);
  try {
    const answers: Record<string, unknown> = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`a_obj_${String(i).padStart(2, '0')}`, i % 2 ? { x: 1 } : null]));
    answers.zz_real = 'kept';
    const r = await save(answers);
    assert.deepEqual(r.answers, { zz_real: 'kept' });
  } finally { await db.close(); }
});

test('G11: a contact holds at most 50 answer keys in total; the refused call saves nothing', async () => {
  const { db, save, stored, contact } = await setup(false);
  try {
    const batch = (from: number, n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`key_${String(from + i).padStart(2, '0')}`, 'v']));
    await save(batch(0, 20)); await save(batch(20, 20)); await save(batch(40, 10));
    assert.equal(Object.keys(await stored(contact)).length, 50);
    await save({ key_00: 'changed' });
    assert.equal((await stored(contact)).key_00, 'changed');
    await assert.rejects(save({ key_99: 'one too many' }), /Too many saved answers/);
    const after = await stored(contact);
    assert.equal(Object.keys(after).length, 50);
    assert.equal('key_99' in after, false);
  } finally { await db.close(); }
});

test('G11: settings with no questions store nothing; no saved settings yet falls back to the question-id format', async () => {
  const empty = await setup(true);
  try {
    await empty.db.exec('reset role');
    await empty.db.query("update public.fo_agent_settings set data = jsonb_set(data, '{questions}', '[]') where workspace_id = $1", [empty.a.w]);
    await empty.db.exec('set role anon');
    assert.deepEqual((await empty.save({ [empty.ids[0]!]: 'x', business: 'y' })).answers, {});
  } finally { await empty.db.close(); }
  const none = await setup(false);
  try {
    const r = await none.save({ business: 'Gym in Perth', admin_note: 'ok-format', 'Not-An-Id': 'x', __proto__x: 'y', _hidden: 'z' });
    assert.deepEqual(r.answers, { business: 'Gym in Perth', admin_note: 'ok-format' });
  } finally { await none.db.close(); }
});
