// Database rules for per-business agent settings, phone calls, reschedule and cancel (migration 202611080001).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import './helpers/route-harness.ts';

const { templateSettings } = await import('../lib/front-office/settings.ts');
const { RECEPTIONIST_PROMPT_VERSION } = await import('../lib/front-office/receptionist/prompt.ts');

const KEY = 'k'.repeat(40), VOICE = '+61800000001', CALLER = '+61411111111';
const migrations = ['202610160001_s01.sql', '202611060001_front_office.sql', '202611060002_front_office_appointments.sql', '202611060003_front_office_setter.sql', '202611060004_front_office_chat_email.sql', '202611060005_front_office_meta.sql', '202611080001_front_office_receptionist.sql'];

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
  for (const f of migrations) await db.exec(await readFile(`../../supabase/migrations/${f}`, 'utf8'));
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
  const w = await one<string>("select public.create_workspace('Iron Gym') as r");
  const voice = await one<string>("select public.fo_create_channel($1,'voice',$2,$3) as r", [w, VOICE, KEY]);
  const chat = await one<string>("select public.fo_create_channel($1,'web-chat','irongym.example',$2) as r", [w, KEY]);
  await db.exec('reset role');
  await db.query("insert into public.memberships(workspace_id,user_id,role,active) values ($1,$2,'staff',true)", [w, staff]);
  await as(owner, so);
  return { db, as, one, w, voice, chat, owner, so, staff, ss };
}

test('agent settings: owner saves and reads with a revision; others cannot; the channel key reads them', async () => {
  const { db, as, one, w, voice, chat, staff, ss, owner, so } = await setup();
  try {
    const s = { ...templateSettings('gym', 'Iron Gym'), faqs: [{ q: 'Where are you?', a: '12 Example St' }] };
    assert.equal(await one('select public.fo_get_agent_settings($1) as r', [w]), null);
    assert.equal(await one<number>('select public.fo_save_agent_settings($1,$2,0) as r', [w, s]), 1);
    await assert.rejects(db.query('select public.fo_save_agent_settings($1,$2,0)', [w, s]), /changed elsewhere/, 'second create conflicts');
    assert.equal(await one<number>('select public.fo_save_agent_settings($1,$2,1) as r', [w, { ...s, offer: 'Free trial' }]), 2);
    await assert.rejects(db.query('select public.fo_save_agent_settings($1,$2,1)', [w, s]), /changed elsewhere/, 'stale revision');
    const got = await one<{ data: { offer: string }; revision: number }>('select public.fo_get_agent_settings($1) as r', [w]);
    assert.equal(got.revision, 2); assert.equal(got.data.offer, 'Free trial');
    await assert.rejects(db.query('select public.fo_save_agent_settings($1,$2,2)', [w, { ...s, template: 'nope' }]), /check/);
    await as(staff, ss);
    await assert.rejects(db.query('select public.fo_get_agent_settings($1)', [w]), /Owner access/);
    await assert.rejects(db.query('select public.fo_save_agent_settings($1,$2,2)', [w, s]), /Owner access/);
    await as(null);
    await assert.rejects(db.query('select public.fo_get_agent_settings($1)', [w]), /permission denied/);
    const viaKey = await one<{ businessName: string }>('select public.fo_channel_settings($1,$2) as r', [voice, KEY]);
    assert.equal(viaKey.businessName, 'Iron Gym');
    assert.equal((await one<{ businessName: string }>('select public.fo_channel_settings($1,$2) as r', [chat, KEY])).businessName, 'Iron Gym');
    await assert.rejects(db.query('select public.fo_channel_settings($1,$2)', [voice, 'x'.repeat(40)]), /Channel not recognised/);
    await assert.rejects(db.query('select * from public.fo_agent_settings'), /permission denied/);
    await as(owner, so);
    assert.equal((await db.query('select * from public.fo_agent_settings')).rows.length, 1, 'owner reads under RLS');
  } finally { await db.close(); }
});

test('calls: caller becomes a contact once, turns are idempotent, replies logged with prompt version, end report recorded', async () => {
  const { db, as, one, voice, chat } = await setup();
  try {
    await as(null);
    const turn = 'select public.fo_voice_turn($1,$2,$3,$4,$5,$6) as r';
    const t1 = await one<Record<string, unknown>>(turn, [voice, KEY, 'call_0001abcd', CALLER, 1, 'Hi, what time do you open?']);
    assert.ok(t1.contact); assert.equal(t1.state, 'new'); assert.equal(t1.duplicate, false);
    const again = await one<Record<string, unknown>>(turn, [voice, KEY, 'call_0001abcd', CALLER, 1, 'Hi, what time do you open?']);
    assert.equal(again.duplicate, true, 'Vapi retries do not double-log'); assert.equal(again.contact, t1.contact);
    await one(turn, [voice, KEY, 'call_0001abcd', CALLER, 2, 'And parking?']);
    assert.ok(await one('select public.fo_voice_reply($1,$2,$3,$4,$5) as r', [voice, KEY, 'call_0001abcd', 'We open at 6.', RECEPTIONIST_PROMPT_VERSION]));
    await assert.rejects(db.query('select public.fo_voice_reply($1,$2,$3,$4,$5)', [voice, KEY, 'call_0001abcd', 'x', '']), /Prompt version/);
    await one('select public.fo_voice_outcome($1,$2,$3,$4) as r', [voice, KEY, 'call_0001abcd', 'faq']);
    await one('select public.fo_voice_outcome($1,$2,$3,$4) as r', [voice, KEY, 'call_0001abcd', 'faq']);
    await assert.rejects(db.query('select public.fo_voice_outcome($1,$2,$3,$4)', [voice, KEY, 'call_0001abcd', 'party']), /Unknown outcome/);
    const end = await one<{ outcomes: string[] }>('select public.fo_voice_end($1,$2,$3,$4,$5,$6,$7) as r', [voice, KEY, 'call_0001abcd', CALLER, 'customer-ended-call', 'Asked about hours.', 'User: hi AI: hello']);
    assert.deepEqual(end.outcomes, ['faq']);
    await db.exec('reset role');
    const msgs = (await db.query<{ direction: string; agent: string | null; prompt_version: string | null }>('select direction, agent, prompt_version from public.fo_messages order by created_at')).rows;
    assert.deepEqual(msgs.map(m => m.direction), ['inbound', 'inbound', 'outbound']);
    assert.equal(msgs[2].agent, 'receptionist'); assert.equal(msgs[2].prompt_version, RECEPTIONIST_PROMPT_VERSION);
    const call = (await db.query<{ ended_reason: string; summary: string; transcript: string }>('select * from public.fo_calls')).rows[0];
    assert.equal(call.ended_reason, 'customer-ended-call'); assert.equal(call.summary, 'Asked about hours.');
    const kinds = (await db.query<{ kind: string }>('select kind from public.fo_events order by id')).rows.map(r => r.kind);
    assert.deepEqual(kinds, ['created', 'inbound', 'inbound', 'call']);
    await as(null);
    await assert.rejects(db.query(turn, [chat, KEY, 'call_0002abcd', CALLER, 1, 'hi']), /Channel not recognised/, 'only voice channels');
    await assert.rejects(db.query(turn, [voice, KEY, 'bad id', CALLER, 1, 'hi']), /Call id required/);
  } finally { await db.close(); }
});

test('calls: withheld number has no contact until the caller gives a mobile; missed calls with a number become contacts', async () => {
  const { db, as, one, voice } = await setup();
  try {
    await as(null);
    const t = await one<Record<string, unknown>>('select public.fo_voice_turn($1,$2,$3,$4,$5,$6) as r', [voice, KEY, 'call_withheld1', null, 1, 'Hi']);
    assert.equal(t.contact, null);
    assert.equal(await one('select public.fo_voice_reply($1,$2,$3,$4,$5) as r', [voice, KEY, 'call_withheld1', 'Hello', RECEPTIONIST_PROMPT_VERSION]), null, 'nothing to log against');
    await assert.rejects(db.query('select public.fo_voice_contact($1,$2,$3,$4,$5)', [voice, KEY, 'call_withheld1', '0412', 'Sam']), /not valid/);
    const c = await one<string>('select public.fo_voice_contact($1,$2,$3,$4,$5) as r', [voice, KEY, 'call_withheld1', CALLER, 'Sam']);
    const again = await one<Record<string, unknown>>('select public.fo_voice_turn($1,$2,$3,$4,$5,$6) as r', [voice, KEY, 'call_withheld1', null, 2, 'Thanks']);
    assert.equal(again.contact, c);
    const missed = await one<{ contact: string | null }>('select public.fo_voice_end($1,$2,$3,$4,$5,$6,$7) as r', [voice, KEY, 'call_missed01', '+61422222222', 'customer-did-not-answer', '', '']);
    assert.ok(missed.contact, 'a missed caller is not lost');
    await db.exec('reset role');
    assert.equal((await db.query<{ name: string }>('select name from public.fo_contacts where id = $1', [c])).rows[0].name, 'Sam');
  } finally { await db.close(); }
});

test('reschedule and cancel: only booked appointments of this contact; reminders stop; cancel returns the contact to qualified', async () => {
  const { db, as, one, voice } = await setup();
  try {
    await as(null);
    const { contact } = await one<{ contact: string }>('select public.fo_voice_turn($1,$2,$3,$4,$5,$6) as r', [voice, KEY, 'call_book0001', CALLER, 1, 'Book me in']);
    for (const s of ['qualifying', 'qualified']) await one('select public.fo_set_state($1,$2,$3,$4,$5,$6) as r', [voice, KEY, contact, s, 'receptionist', 'test']);
    const b = await one<{ appointment: string }>('select public.fo_book($1,$2,$3,$4,$5,$6,$7) as r', [voice, KEY, contact, '2030-01-07T01:00:00Z', '2030-01-07T01:45:00Z', 'google', 'vbabcdef0123']);
    await one('select public.fo_schedule_job($1,$2,$3,$4,$5,$6,$7) as r', [voice, KEY, contact, 'reminder-24h', 1, '2030-01-06T01:00:00Z', b.appointment]);
    const moved = await one<{ eventId: string }>('select public.fo_reschedule($1,$2,$3,$4,$5,$6) as r', [voice, KEY, contact, b.appointment, '2030-01-08T02:00:00Z', '2030-01-08T02:45:00Z']);
    assert.equal(moved.eventId, 'vbabcdef0123');
    await assert.rejects(db.query('select public.fo_reschedule($1,$2,$3,$4,$5,$6)', [voice, KEY, contact, b.appointment, '2030-01-08T02:00:00Z', '2030-01-08T01:00:00Z']), /Invalid time/);
    await assert.rejects(db.query('select public.fo_reschedule($1,$2,$3,$4,$5,$6)', [voice, KEY, '99999999-9999-4999-8999-999999999999', b.appointment, '2030-01-08T02:00:00Z', '2030-01-08T02:45:00Z']), /No booking/);
    await one('select public.fo_cancel_booking($1,$2,$3,$4,$5) as r', [voice, KEY, contact, b.appointment, 'Away that week']);
    await assert.rejects(db.query('select public.fo_cancel_booking($1,$2,$3,$4,$5)', [voice, KEY, contact, b.appointment, 'again']), /No booking/);
    await db.exec('reset role');
    assert.equal((await db.query<{ status: string; starts_at: Date }>('select status, starts_at from public.fo_appointments')).rows[0].status, 'cancelled');
    assert.equal((await db.query<{ status: string }>('select status from public.fo_jobs')).rows[0].status, 'cancelled');
    assert.equal((await db.query<{ state: string }>('select state from public.fo_contacts')).rows[0].state, 'qualified');
  } finally { await db.close(); }
});
