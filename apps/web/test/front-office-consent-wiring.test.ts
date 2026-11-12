// A-45: the app uses the per-channel consent records of A-38 (migration 202611110004). A follow-up on the customer's
// own SMS/email conversation is a reply (their inbound message is the evidence); moving them to another channel needs an
// explicit grant for it (fo_contact_context contact.consent); an opt-out always wins. STOP by SMS or email also closes
// the consent record, and a failure to do so never changes the opt-out. Scripted RPCs and PGlite with every real
// migration: no network, nothing sent, no live provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import './helpers/route-harness.ts';
import type { SetterContext } from '../lib/front-office/setter/actions.ts';

const { checkFollowUp, createSetterExecutor } = await import('../lib/front-office/setter/actions.ts');
const { handleInbound, handleInboundSms } = await import('../lib/front-office/orchestrator.ts');
const { metaRoute, runDueJobs } = await import('../lib/front-office/jobs.ts');
const { createMemoryPendingActionStore } = await import('../lib/front-office/pending-actions.ts');
const { approvalChannel } = await import('../app/api/front-office/pending-actions/shared.ts');
const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');

const CID = '33333333-3333-4333-8333-333333333333';
const base = (over: Partial<SetterContext['contact']> = {}, inbound = true): SetterContext => ({
  contact: { id: CID, name: 'Sam', phone: '+61411111111', email: null, state: 'qualifying', optedOut: false, answers: {}, ...over },
  messages: inbound ? [{ direction: 'inbound', body: 'Hi', agent: null, at: '2026-11-10T01:00:00Z' }] : [],
  appointment: null, handoffs: [],
});

test('follow-up consent: website chat to SMS needs a grant; a missing consent field (older database) is no consent', () => {
  const none = checkFollowUp(base(), 'web-chat');
  assert.equal(none.ok, false);
  assert.match(!none.ok ? none.why : '', /No recorded consent for texts/);
  assert.equal(checkFollowUp(base({ consent: { sms: false, email: false } }), 'web-chat').ok, false);
  assert.equal(checkFollowUp(base({ consent: { sms: false, email: true } }), 'web-chat').ok, false, 'email consent without an address does not help');
  assert.deepEqual(checkFollowUp(base({ consent: { sms: true, email: false } }), 'web-chat'), { ok: true, channel: 'sms', consent: 'The contact gave recorded consent to be contacted by text.' });
  assert.equal(checkFollowUp(base(), 'instagram').ok, false, 'Instagram to SMS needs a grant');
  assert.equal(checkFollowUp(base(), 'messenger').ok, false);
  // SMS conversation, email follow-up: another channel, so an email grant is needed.
  assert.equal(checkFollowUp(base({ phone: null, email: 'sam@example.com' }), 'sms').ok, false);
  assert.deepEqual(checkFollowUp(base({ phone: null, email: 'sam@example.com', consent: { sms: false, email: true } }), 'sms'), { ok: true, channel: 'email', consent: 'The contact gave recorded consent to be contacted by email.' });
});

test('follow-up consent: replying on the channel the customer used is still allowed without a grant', () => {
  assert.deepEqual(checkFollowUp(base(), 'sms'), { ok: true, channel: 'sms', consent: 'The contact messaged the business first (2026-11-10T01:00:00Z).' });
  assert.deepEqual(checkFollowUp(base({ phone: null, email: 'sam@example.com' }), 'email'), { ok: true, channel: 'email', consent: 'The contact messaged the business first (2026-11-10T01:00:00Z).' });
  // No channel given: unknown fails closed (A-47); see the dedicated test below.
  assert.equal(checkFollowUp(base()).ok, false);
  // No inbound message and no grant: no consent at all.
  assert.deepEqual(checkFollowUp(base({}, false), 'sms'), { ok: false, why: 'No recorded consent: the contact has not messaged the business.' });
  // An explicit grant is consent even before the contact has messaged.
  assert.equal(checkFollowUp(base({ consent: { sms: true, email: false } }, false), 'web-chat').ok, true);
});

test('follow-up consent: an opt-out overrides any grant', () => {
  const both = { sms: true, email: true };
  for (const via of ['sms', 'email', 'web-chat', 'instagram'] as const) {
    assert.deepEqual(checkFollowUp(base({ optedOut: true, email: 'sam@example.com', consent: both }), via), { ok: false, why: 'The contact opted out.' });
  }
  assert.deepEqual(metaRoute({ recipient: 'ig-1', optedOut: false, lastInbound: null }, { name: null, phone: '+61411111111', email: null, state: 'new', optedOut: true, consent: both }, Date.now(), true), { via: 'owner', reason: 'The contact opted out.' });
});

test('performFollowUp from website chat: no grant schedules nothing; a grant schedules follow-up 1 by text', async () => {
  for (const consent of [undefined, { sms: true, email: false }]) {
    const calls: string[] = [];
    const rpc = async (fn: string) => { calls.push(fn); if (fn === 'fo_contact_context') return base(consent ? { consent } : {}); return null; };
    const exec = createSetterExecutor({ rpc, auth: { channel: 'ch', key: 'k' }, calendar: null, config: ventraSetterConfig, now: Date.parse('2026-11-10T02:00:00Z'), send: async () => ({ sent: false, sid: null }), channel: 'web-chat' });
    const r = await exec({ product: 'setter', contactId: CID, pendingActionId: 'p1', payload: { kind: 'follow_up', channel: 'sms', body: 'Hi Sam', promptVersion: 'setter/follow-up@1', step: 1 } } as Parameters<typeof exec>[0]);
    if (consent) { assert.equal(r.ok, true); assert.ok(calls.includes('fo_schedule_job')); }
    else { assert.equal(r.ok, false); assert.match(r.note ?? '', /No follow-up: No recorded consent for texts/); assert.ok(!calls.includes('fo_schedule_job')); }
  }
});

test('A-47: an unknown customer channel fails closed in checkFollowUp and performFollowUp; only a grant allows the follow-up', async () => {
  // Before A-47 both of these were ok (the conversation was assumed to be on the follow-up channel).
  const unknown = checkFollowUp(base());
  assert.equal(unknown.ok, false);
  assert.match(!unknown.ok ? unknown.why : '', /No recorded consent for texts: the contact messaged on a channel that is not known/);
  assert.equal(checkFollowUp(base(), undefined).ok, false);
  assert.equal(checkFollowUp(base({ phone: null, email: 'sam@example.com' })).ok, false);
  assert.deepEqual(checkFollowUp(base({ consent: { sms: true, email: false } })), { ok: true, channel: 'sms', consent: 'The contact gave recorded consent to be contacted by text.' });
  const payload = { kind: 'follow_up', channel: 'sms', body: 'Hi Sam', promptVersion: 'setter/follow-up@1', step: 1 };
  for (const deps of [{}, { via: null }, { channel: 'sms' as const }, { channel: 'sms' as const, via: null }]) {
    const calls: string[] = [];
    const rpc = async (fn: string) => { calls.push(fn); return fn === 'fo_contact_context' ? base() : null; };
    const exec = createSetterExecutor({ rpc, auth: { channel: 'ch', key: 'k' }, calendar: null, config: ventraSetterConfig, now: Date.parse('2026-11-10T02:00:00Z'), send: async () => ({ sent: false, sid: null }), ...deps });
    const r = await exec({ product: 'setter', contactId: CID, pendingActionId: 'p1', payload } as Parameters<typeof exec>[0]);
    assert.equal(r.ok, false, `deps ${JSON.stringify(deps)}: the record's channel is never taken as the customer's own`);
    assert.ok(!calls.includes('fo_schedule_job'));
  }
  // Known SMS conversation: a same-channel reply is still allowed without a grant.
  const calls: string[] = [];
  const rpc = async (fn: string) => { calls.push(fn); return fn === 'fo_contact_context' ? base() : null; };
  const exec = createSetterExecutor({ rpc, auth: { channel: 'ch', key: 'k' }, calendar: null, config: ventraSetterConfig, now: Date.parse('2026-11-10T02:00:00Z'), send: async () => ({ sent: false, sid: null }), via: 'sms' });
  assert.equal((await exec({ product: 'setter', contactId: CID, pendingActionId: 'p1', payload } as Parameters<typeof exec>[0])).ok, true);
  assert.ok(calls.includes('fo_schedule_job'));
});

test('A-47: the approval queue performs a held follow-up with the channel the item came from', async () => {
  const env = {
    FRONT_OFFICE_CHANNEL_ID: '44444444-4444-4444-8444-444444444441', FRONT_OFFICE_CHANNEL_KEY: 's'.repeat(40),
    FRONT_OFFICE_CHAT_CHANNEL_ID: '44444444-4444-4444-8444-444444444442', FRONT_OFFICE_CHAT_CHANNEL_KEY: 'c'.repeat(40),
    FRONT_OFFICE_INSTAGRAM_CHANNEL_ID: '44444444-4444-4444-8444-444444444443', FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY: 'i'.repeat(40),
  };
  assert.equal(approvalChannel(env, env.FRONT_OFFICE_CHANNEL_ID)?.kind, 'sms');
  assert.equal(approvalChannel(env, env.FRONT_OFFICE_CHAT_CHANNEL_ID)?.kind, 'web-chat');
  assert.equal(approvalChannel(env, env.FRONT_OFFICE_INSTAGRAM_CHANNEL_ID)?.kind, 'instagram');
  assert.equal(approvalChannel(env, '44444444-4444-4444-8444-444444444449'), null, 'an unknown channel is not performed at all');
});

const JOB_NOW = Date.parse('2026-11-10T02:00:00Z');
const runFollowUp = async (ctx: SetterContext, via?: 'sms' | 'web-chat') => {
  const calls: string[] = []; const sent: string[] = [];
  const rpc = async (fn: string) => {
    calls.push(fn);
    if (fn === 'fo_claim_jobs') return [{ id: 'j1', contact: CID, kind: 'follow-up', step: 2, appointment: null }];
    if (fn === 'fo_contact_context') return ctx;
    return null;
  };
  const store = createMemoryPendingActionStore({ workspaceId: '55555555-5555-4555-8555-555555555555', modes: () => ({ setter: 'automatic', receptionist: 'enquiry_only' }), owners: [], now: () => JOB_NOW });
  const out = await runDueJobs({ rpc, auth: { channel: 'ch', key: 'k' }, send: async (to: string) => { sent.push(to); return { sent: false, sid: null }; }, config: ventraSetterConfig, now: JOB_NOW, permissions: { store, quietHours: { start: 0, end: 0 } }, ...(via ? { via } : {}) });
  return { out: out[0], calls, sent };
};

test('A-47 jobs: grant -> follow-up scheduled from website chat -> grant withdrawn -> the due job is blocked (inbound only on web chat)', async () => {
  // 1. The grant lets the Setter schedule follow-up 1 by text from a website chat.
  let ctx = base({ consent: { sms: true, email: false } });
  const calls: string[] = [];
  const rpc = async (fn: string) => { calls.push(fn); return fn === 'fo_contact_context' ? ctx : null; };
  const exec = createSetterExecutor({ rpc, auth: { channel: 'ch', key: 'k' }, calendar: null, config: ventraSetterConfig, now: JOB_NOW, send: async () => ({ sent: false, sid: null }), via: 'web-chat' });
  assert.equal((await exec({ product: 'setter', contactId: CID, pendingActionId: 'p1', payload: { kind: 'follow_up', channel: 'sms', body: 'Hi', promptVersion: 'setter/follow-up@1', step: 1 } } as Parameters<typeof exec>[0])).ok, true);
  assert.ok(calls.includes('fo_schedule_job'));
  // While the grant is open the web-chat runner sends it.
  const open = await runFollowUp(ctx, 'web-chat');
  assert.equal(open.out.outcome, 'done'); assert.equal(open.sent.length, 1);
  // 2. The grant is withdrawn; the only inbound message is the website chat. Before A-47 any inbound let it through.
  ctx = base({ consent: { sms: false, email: false } });
  const r = await runFollowUp(ctx, 'web-chat');
  assert.equal(r.out.outcome, 'cancelled');
  assert.match(r.out.note, /No follow-up: No recorded consent for texts: the contact messaged on web-chat/);
  assert.equal(r.sent.length, 0); assert.ok(!r.calls.includes('fo_log_outbound'));
  // The runner without a known channel fails closed too.
  const u = await runFollowUp(ctx);
  assert.equal(u.out.outcome, 'cancelled'); assert.equal(u.sent.length, 0);
  // An SMS conversation (inbound on the SMS channel) is still followed up by SMS without a grant.
  const s = await runFollowUp(ctx, 'sms');
  assert.equal(s.out.outcome, 'done'); assert.equal(s.sent.length, 1);
  // No inbound at all and no grant: the original wording.
  const none = await runFollowUp(base({}, false), 'sms');
  assert.match(none.out.note, /No recorded consent: the contact has not messaged the business/);
});

// A-48: the email runner. Sends are recorded per channel; the SMS and email senders are fakes (nothing leaves).
const runOn = async (ctx: SetterContext, via: 'sms' | 'web-chat' | 'email', withEmailSender = true) => {
  const calls: string[] = []; const texts: string[] = []; const emails: string[] = [];
  const rpc = async (fn: string) => {
    calls.push(fn);
    if (fn === 'fo_claim_jobs') return [{ id: 'j1', contact: CID, kind: 'follow-up', step: 2, appointment: null }];
    if (fn === 'fo_contact_context') return ctx;
    return null;
  };
  const store = createMemoryPendingActionStore({ workspaceId: '55555555-5555-4555-8555-555555555555', modes: () => ({ setter: 'automatic', receptionist: 'enquiry_only' }), owners: [], now: () => JOB_NOW });
  const out = await runDueJobs({ rpc, auth: { channel: 'ch', key: 'k' }, send: async (to: string) => { texts.push(to); return { sent: false, sid: null }; }, email: withEmailSender ? async (to: string) => { emails.push(to); return { sent: false, id: null }; } : undefined, config: ventraSetterConfig, now: JOB_NOW, permissions: { store, quietHours: { start: 0, end: 0 } }, via });
  return { out: out[0], calls, texts, emails };
};

test('A-48 jobs: an email lead who also left a phone number gets a same-channel email follow-up without a grant', async () => {
  const lead = base({ email: 'sam@example.com', consent: { sms: false, email: false } });
  // Before A-48 the email runner picked SMS for this contact (phone present) and blocked it for want of an SMS grant.
  const r = await runOn(lead, 'email');
  assert.equal(r.out.outcome, 'done', r.out.note);
  assert.deepEqual(r.emails, ['sam@example.com']);
  assert.deepEqual(r.texts, [], 'no text to an email lead');
  assert.ok(r.calls.includes('fo_log_outbound'));
  // Older database (no consent field): still the same-channel reply.
  assert.equal((await runOn(base({ email: 'sam@example.com' }), 'email')).out.outcome, 'done');
});

test('A-48 jobs: nothing looser; another channel still needs an open grant and an opt-out still wins', async () => {
  // Email runner, phone only: the follow-up would be a text, another channel, so it needs an SMS grant.
  const phoneOnly = await runOn(base({ consent: { sms: false, email: false } }), 'email');
  assert.equal(phoneOnly.out.outcome, 'cancelled');
  assert.match(phoneOnly.out.note, /No recorded consent for texts: the contact messaged on email/);
  assert.equal(phoneOnly.texts.length + phoneOnly.emails.length, 0);
  const granted = await runOn(base({ consent: { sms: true, email: false } }), 'email');
  assert.equal(granted.out.outcome, 'done'); assert.equal(granted.texts.length, 1);
  // Website chat runner, phone and email, no grant: still a text by default and still blocked (unchanged).
  const chat = await runOn(base({ email: 'sam@example.com', consent: { sms: false, email: false } }), 'web-chat');
  assert.equal(chat.out.outcome, 'cancelled'); assert.equal(chat.texts.length + chat.emails.length, 0);
  // An email grant alone does not let the web-chat runner text them.
  assert.equal((await runOn(base({ email: 'sam@example.com', consent: { sms: false, email: true } }), 'web-chat')).out.outcome, 'cancelled');
  // SMS runner with phone and email: the text is the same channel, unchanged.
  const sms = await runOn(base({ email: 'sam@example.com', consent: { sms: false, email: false } }), 'sms');
  assert.equal(sms.out.outcome, 'done'); assert.equal(sms.texts.length, 1); assert.equal(sms.emails.length, 0);
  // Opt-out wins on the email runner, even with both grants: nothing logged or sent.
  for (const via of ['email', 'sms', 'web-chat'] as const) {
    const out = await runOn(base({ email: 'sam@example.com', optedOut: true, consent: { sms: true, email: true } }), via);
    assert.equal(out.out.outcome, 'cancelled');
    assert.equal(out.texts.length + out.emails.length, 0);
    assert.ok(!out.calls.includes('fo_log_outbound'));
  }
  // No inbound and no grant on the email runner: no consent at all.
  assert.match((await runOn(base({ email: 'sam@example.com' }, false), 'email')).out.note, /No recorded consent: the contact has not messaged the business/);
});

test('A-50 jobs: the email runner with no email sender falls back to SMS, so a contact with a phone needs an SMS grant', async () => {
  const lead = (sms: boolean) => base({ email: 'sam@example.com', consent: { sms, email: true } });
  // No grant: blocked, nothing sent by text or email, nothing logged.
  const blocked = await runOn(lead(false), 'email', false);
  assert.equal(blocked.out.outcome, 'cancelled');
  assert.match(blocked.out.note, /No recorded consent for texts: the contact messaged on email/);
  assert.equal(blocked.texts.length + blocked.emails.length, 0);
  assert.ok(!blocked.calls.includes('fo_log_outbound'));
  // With an SMS grant the code does fall back to a text.
  const granted = await runOn(lead(true), 'email', false);
  assert.equal(granted.out.outcome, 'done', granted.out.note);
  assert.equal(granted.texts.length, 1); assert.equal(granted.emails.length, 0);
});

test('Meta out-of-window reroute reads contact.consent: SMS with a grant, owner task without one or with an older database', () => {
  const w = { recipient: 'ig-1', optedOut: false, lastInbound: '2026-11-01T00:00:00Z' };
  const c = { name: null, phone: '+61411111111', email: 'sam@example.com', state: 'qualifying', optedOut: false };
  const now = Date.parse('2026-11-10T00:00:00Z');
  assert.deepEqual(metaRoute(w, { ...c, consent: { sms: true, email: false } }, now, true), { via: 'sms' });
  assert.deepEqual(metaRoute(w, { ...c, consent: { sms: false, email: true } }, now, true), { via: 'email' });
  assert.equal(metaRoute(w, c, now, true).via, 'owner');
  assert.equal(metaRoute(w, { ...c, consent: { sms: false, email: false } }, now, true).via, 'owner');
});

// --- STOP closes the consent record ------------------------------------------------------------------------------------

const MSG = { from: '+61411111111', to: '+61400000101', body: 'STOP', messageSid: 'SM00000000000000000000000000000001' };
const scripted = (opts: { optedOut: boolean; withdrawFails?: boolean }) => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === 'fo_ingest_sms' || fn === 'fo_ingest') return { contact: 'c1', state: 'qualifying', created: false, duplicate: false, optedOut: opts.optedOut };
    if (fn === 'fo_withdraw_consent' && opts.withdrawFails) throw new Error('function public.fo_withdraw_consent does not exist');
    return null;
  };
  return { calls, rpc };
};

test('STOP by SMS: opts out, confirms and withdraws SMS consent with an inbound STOP source', async () => {
  const s = scripted({ optedOut: true });
  const r = await handleInboundSms(s.rpc, { channel: 'ch', key: 'k' }, MSG);
  assert.equal(r.optedOut, true); assert.match(r.reply ?? '', /unsubscribed/);
  assert.deepEqual(s.calls.map(c => c.fn), ['fo_ingest_sms', 'fo_log_outbound', 'fo_withdraw_consent']);
  assert.equal(s.calls[0].args.opt_out, true);
  assert.deepEqual(s.calls[2].args, { channel: 'ch', channel_key: 'k', contact: 'c1', consent_channel: 'sms', source: 'inbound STOP (sms)', withdrawn: null });
});

test('STOP by email withdraws email consent; web chat or a normal message never calls withdraw', async () => {
  const e = scripted({ optedOut: true });
  await handleInbound(e.rpc, { channel: 'ch', key: 'k' }, { via: 'email', sender: 'sam@example.com', body: 'Subject: Re\n\nunsubscribe', checkText: 'STOP', messageId: 'm1' });
  const w = e.calls.find(c => c.fn === 'fo_withdraw_consent');
  assert.equal(w?.args.consent_channel, 'email'); assert.equal(w?.args.source, 'inbound STOP (email)');
  const chat = scripted({ optedOut: true });
  await handleInbound(chat.rpc, { channel: 'ch', key: 'k' }, { via: 'web-chat', sender: 'v1', body: 'STOP', messageId: 'w1' });
  assert.ok(!chat.calls.some(c => c.fn === 'fo_withdraw_consent'), 'website chat has no SMS/email consent to withdraw');
  const hi = scripted({ optedOut: false });
  await handleInboundSms(hi.rpc, { channel: 'ch', key: 'k' }, { ...MSG, body: 'Hi' });
  assert.ok(!hi.calls.some(c => c.fn === 'fo_withdraw_consent'));
  // A STOP the database did not record as an opt-out does not withdraw either.
  const notOut = scripted({ optedOut: false });
  await handleInboundSms(notOut.rpc, { channel: 'ch', key: 'k' }, MSG);
  assert.ok(!notOut.calls.some(c => c.fn === 'fo_withdraw_consent'));
});

test('A-47: STOP withdraw is on by default (no option): plain handleInboundSms and handleInbound withdraw', async () => {
  // Before A-47 a caller without { withdrawConsent: true } never withdrew.
  const s = scripted({ optedOut: true });
  await handleInboundSms(s.rpc, { channel: 'ch', key: 'k' }, MSG);
  assert.deepEqual(s.calls.map(c => c.fn), ['fo_ingest_sms', 'fo_log_outbound', 'fo_withdraw_consent']);
  const e = scripted({ optedOut: true });
  await handleInbound(e.rpc, { channel: 'ch', key: 'k' }, { via: 'email', sender: 'sam@example.com', body: 'STOP', messageId: 'm2' }, {});
  assert.equal(e.calls.at(-1)?.fn, 'fo_withdraw_consent');
});

test('a failing withdraw never breaks or changes the opt-out', async () => {
  const ok = scripted({ optedOut: true });
  const expected = await handleInboundSms(ok.rpc, { channel: 'ch', key: 'k' }, MSG);
  const bad = scripted({ optedOut: true, withdrawFails: true });
  const warn = console.warn; const warned: unknown[][] = []; console.warn = (...a: unknown[]) => { warned.push(a); };
  try {
    const r = await handleInboundSms(bad.rpc, { channel: 'ch', key: 'k' }, MSG);
    assert.deepEqual(r, expected, 'same result, same opt-out confirmation');
    assert.deepEqual(bad.calls.map(c => c.fn), ['fo_ingest_sms', 'fo_log_outbound', 'fo_withdraw_consent']);
  } finally { console.warn = warn; }
  assert.equal(warned.length, 1, 'the failure is logged once');
});

test('A-47: a failed withdraw logs a fixed text plus the error name/code only, never the error message', async () => {
  const leaky = Object.assign(new Error('relation fo_contact_consents: contact +61411111111 secret-detail'), { code: '42883' });
  const calls: string[] = [];
  const rpc = async (fn: string) => {
    calls.push(fn);
    if (fn === 'fo_ingest_sms') return { contact: 'c1', state: 'qualifying', created: false, duplicate: false, optedOut: true };
    if (fn === 'fo_withdraw_consent') throw leaky;
    return null;
  };
  const warn = console.warn; const warned: unknown[][] = []; console.warn = (...a: unknown[]) => { warned.push(a); };
  try { await handleInboundSms(rpc, { channel: 'ch', key: 'k' }, MSG); } finally { console.warn = warn; }
  assert.deepEqual(warned, [['fo_withdraw_consent failed after an opt-out; the opt-out stands.', { channel: 'sms', error: 'Error', code: '42883' }]]);
  const text = JSON.stringify(warned);
  assert.ok(!text.includes('secret-detail') && !text.includes('+61411111111'), 'no error message or phone number in the log');
});

// --- Real SQL: grant, STOP through the orchestrator, context and history ------------------------------------------------

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

test('PGlite: a granted SMS consent is closed by an inbound STOP; the contact is opted out and the history keeps the source', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;`);
    for (const f of (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(path.join(MIGRATIONS_DIR, f), 'utf8'));
    const owner = '11111111-1111-4111-8111-111111111111', sess = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await db.query('insert into auth.users values ($1)', [owner]);
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2)', [sess, owner]);
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: sess })]);
    await db.exec('set role authenticated');
    const one = async <T>(sql: string, p: unknown[] = []) => (await db.query<{ r: T }>(sql, p)).rows[0]?.r as T;
    const w = await one<string>("select public.create_workspace('Iron Gym') as r");
    const KEY = 'a'.repeat(40);
    const ch = await one<string>("select public.fo_create_channel($1,'sms',$2,$3) as r", [w, MSG.to, KEY]);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims','',false)");
    await db.exec('set role anon'); // webhooks use the channel key, no user session
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const keys = Object.keys(args);
      return one<unknown>(`select public.${fn}(${keys.map((k, n) => `${k} => $${n + 1}`).join(', ')}) as r`, keys.map(k => args[k]));
    };
    const auth = { channel: ch, key: KEY };
    const first = await handleInboundSms(rpc, auth, { ...MSG, body: 'Hi', messageSid: 'SM00000000000000000000000000000010' });
    await rpc('fo_grant_consent', { channel: ch, channel_key: KEY, contact: first.contact, consent_channel: 'sms', source: 'Website form, SMS box', given_at: null });
    const before = await rpc('fo_contact_context', { channel: ch, channel_key: KEY, contact: first.contact }) as SetterContext;
    assert.deepEqual(before.contact.consent, { sms: true, email: false });
    assert.equal(checkFollowUp(before, 'web-chat').ok, true, 'the recorded grant allows a text follow-up from another channel');
    const stop = await handleInboundSms(rpc, auth, { ...MSG, messageSid: 'SM00000000000000000000000000000011' });
    assert.equal(stop.optedOut, true); assert.match(stop.reply ?? '', /unsubscribed/);
    const after = await rpc('fo_contact_context', { channel: ch, channel_key: KEY, contact: first.contact }) as SetterContext;
    assert.equal(after.contact.optedOut, true);
    assert.deepEqual(after.contact.consent, { sms: false, email: false });
    assert.deepEqual(checkFollowUp(after, 'web-chat'), { ok: false, why: 'The contact opted out.' });
    await db.exec('reset role');
    const rows = (await db.query<{ withdrawn_source: string | null; granted_source: string }>('select granted_source, withdrawn_source from public.fo_contact_consents where contact_id = $1', [first.contact])).rows;
    assert.deepEqual(rows, [{ granted_source: 'Website form, SMS box', withdrawn_source: 'inbound STOP (sms)' }]);
  } finally { await db.close(); }
});
