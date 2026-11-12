// G5: a dropped call (caller hung up, or an error) before anything was settled leaves exactly one call-back handoff for
// staff via the Vapi end-of-call report. In-memory store, no network, nothing sent, live flags off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRequest } from './helpers/route-harness.ts';

const { store } = await import('./helpers/front-office-store.ts');
const { checkedAgentSettings, templateSettings } = await import('../lib/front-office/settings.ts');
const { vapiWebhook } = await import('../lib/front-office/vapi-route.ts');

const auth = { channel: '55555555-5555-4555-8555-555555555555', key: 'k'.repeat(40) };
const CALLER = '+61411111111';

function voiceStore(outcomes: string[] = [], opts: { failHandoff?: boolean; caller?: string | null } = {}) {
  const base = store('qualifying', [], opts.caller === null ? '+61400000000' : CALLER);
  base.db.contact.name = 'Pat'; base.db.contact.answers = { goal: 'Strength' };
  if (opts.caller === null) base.db.contact.phone = null;
  const log = { outcomes: [...outcomes], ends: 0, sent: 0, dispatches: [] as string[], seen: new Set<string>() };
  const rpc = async (fn: string, a: Record<string, unknown>): Promise<unknown> => {
    switch (fn) {
      case 'fo_channel_settings': return checkedAgentSettings(templateSettings('gym', 'Iron Gym'));
      case 'fo_voice_outcome': if (!log.outcomes.includes(a.outcome as string)) log.outcomes.push(a.outcome as string); return null;
      // Like the database: `first` is true once per call id, atomically (no await between check and set).
      case 'fo_voice_end': { log.ends++; const first = !log.seen.has(a.call_id as string); log.seen.add(a.call_id as string); return { call: 'k1', contact: 'c1', outcomes: [...log.outcomes], first }; }
      case 'fo_record_handoff': if (opts.failHandoff) throw new Error('database down'); return base.rpc(fn, a);
      case 'fo_log_dispatch': log.dispatches.push(`${a.agent_name}: ${a.reason}`); return null;
      case 'fo_log_outbound': log.sent++; return 'm';
      default: return base.rpc(fn, a);
    }
  };
  return { ...base, rpc, log };
}

async function report(s: ReturnType<typeof voiceStore>, endedReason: string, number: string | null = CALLER) {
  const keys = ['FRONT_OFFICE_VOICE_CHANNEL_ID', 'FRONT_OFFICE_VOICE_CHANNEL_KEY', 'FRONT_OFFICE_VOICE_LIVE'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.FRONT_OFFICE_VOICE_CHANNEL_ID = auth.channel;
  try {
    const body = JSON.stringify({ message: { type: 'end-of-call-report', endedReason, call: { id: 'call_dropped01', customer: number ? { number } : {} }, artifact: { transcript: 'AI: Thanks for calling Iron Gym.\nUser: I want to book a trial\nAI: Which day suits you?', messages: [] }, analysis: { summary: 'Booking a trial.' } } });
    const res = await vapiWebhook(makeRequest('/x', { method: 'POST', cookie: null, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.key }, body }), null, { rpc: s.rpc, now: () => Date.parse('2026-11-09T00:30:00Z') });
    assert.equal(res.status, 200);
  } finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

test('G5 dropped call: customer hang-up mid-booking -> one call-back handoff with number, what was captured, where it stopped', async () => {
  const s = voiceStore(['qualified']);
  await report(s, 'customer-ended-call');
  assert.equal(s.db.handoffs.length, 1);
  const h = s.db.handoffs[0] as { owner: string; channel: string; intent: string; summary: string; nextAction: string };
  assert.equal(h.owner, 'human'); assert.equal(h.channel, 'voice'); assert.match(h.intent, /call back/);
  assert.match(h.summary, /\+61411111111/); assert.match(h.summary, /name Pat/); assert.match(h.summary, /goal: Strength/);
  assert.match(h.summary, /customer-ended-call after qualified/); assert.match(h.summary, /Which day suits you\?/);
  assert.equal(h.nextAction, 'Call the caller back');
  assert.equal(s.log.sent, 0, 'nothing sent');
});

test('G5 dropped call: a repeated end-of-call report creates no second handoff', async () => {
  const s = voiceStore();
  await report(s, 'customer-ended-call');
  await report(s, 'customer-ended-call');
  assert.equal(s.log.ends, 2); assert.equal(s.db.handoffs.length, 1);
});

test('G5 dropped call: completed calls (booked, message, transfer, normal ending) create none', async () => {
  for (const outcomes of [['booked'], ['message'], ['transfer'], ['rescheduled'], ['cancelled']]) {
    const s = voiceStore(outcomes);
    await report(s, 'customer-ended-call');
    assert.equal(s.db.handoffs.length, 0, outcomes.join());
  }
  for (const reason of ['assistant-ended-call', 'assistant-said-end-call-phrase', 'assistant-forwarded-call', 'customer-did-not-answer', 'voicemail']) {
    const s = voiceStore();
    await report(s, reason);
    assert.equal(s.db.handoffs.length, 0, reason);
  }
});

test('A-58 follow-up: two identical reports at the same time -> exactly one handoff', async () => {
  const s = voiceStore();
  await Promise.all([report(s, 'customer-ended-call'), report(s, 'customer-ended-call')]);
  assert.equal(s.log.ends, 2); assert.equal(s.db.handoffs.length, 1);
});

test('A-58 follow-up: no `first` flag from the database -> no call-back (and it is logged, not silent)', async () => {
  const s = voiceStore();
  const rpc = async (fn: string, a: Record<string, unknown>) => { const r = await s.rpc(fn, a); return fn === 'fo_voice_end' ? { ...(r as object), first: undefined } : r; };
  const orig = console.error; const seen: string[] = []; console.error = (...m: unknown[]) => { seen.push(m.join(' ')); };
  try { await report({ ...s, rpc }, 'customer-ended-call'); } finally { console.error = orig; }
  assert.equal(s.db.handoffs.length, 0);
  assert.ok(seen.some(m => /no `first` flag/.test(m)));
});

test('A-58 follow-up: failed handoff -> a staff-visible event is recorded and the webhook still answers 200', async () => {
  const s = voiceStore([], { failHandoff: true });
  const orig = console.error; console.error = () => undefined;
  try { await report(s, 'customer-ended-call'); } finally { console.error = orig; } // report() asserts 200
  assert.equal(s.db.handoffs.length, 0);
  assert.equal(s.log.dispatches.length, 1);
  assert.match(s.log.dispatches[0], /^receptionist: Dropped call customer-ended-call: the call-back could not be saved/);
  assert.equal(s.log.sent, 0);
});

test('A-58 follow-up: withheld caller number -> handoff says number withheld; nothing is sent', async () => {
  const s = voiceStore([], { caller: null });
  s.db.contact.email = 'pat@example.com'; // a contact who left an email earlier: the only way staff can reach them
  await report(s, 'customer-ended-call', null);
  assert.equal(s.db.handoffs.length, 1);
  const h = s.db.handoffs[0] as { summary: string };
  assert.match(h.summary, /Dropped call from number withheld/);
  assert.equal(s.log.sent, 0, 'no SMS call-back');
});

test('A-58 follow-up: withheld number and no email on file -> no handoff can be saved, so a staff-visible event says so (200)', async () => {
  const s = voiceStore([], { caller: null });
  const orig = console.error; console.error = () => undefined;
  try { await report(s, 'customer-ended-call', null); } finally { console.error = orig; }
  assert.equal(s.db.handoffs.length, 0);
  assert.equal(s.log.dispatches.length, 1);
  assert.equal(s.log.sent, 0);
});

test('A-58 follow-up: only the explicit drop reasons count (exceeded-max-duration yes; unknown no)', async () => {
  const { isDroppedReason, DROPPED_ENDED_REASONS } = await import('../lib/front-office/receptionist/dropped.ts');
  assert.ok(DROPPED_ENDED_REASONS.includes('exceeded-max-duration'));
  for (const r of ['customer-ended-call', 'silence-timed-out', 'exceeded-max-duration', 'pipeline-error-custom-llm-failed']) assert.equal(isDroppedReason(r), true, r);
  for (const r of ['assistant-ended-call', 'voicemail', 'customer-did-not-answer', 'something-new', 'ended', 'error']) assert.equal(isDroppedReason(r), false, r);
  const s = voiceStore();
  await report(s, 'exceeded-max-duration');
  assert.equal(s.db.handoffs.length, 1);
});

test('A-58 follow-up: the Receptionist Lab simulator produces the same call-back, once', async () => {
  const { simulateCall, fixtures } = await import('../lib/front-office/receptionist/simulate.ts');
  let found = 0;
  for (const f of fixtures) {
    const r = await simulateCall(f);
    const callbacks = r.tables.handoffs.filter(h => /call back \(dropped call\)/.test(String((h as { intent?: string }).intent)));
    // Normal endings never leave one; a hang-up leaves at most one (the call is then marked 'message', so a repeat adds none).
    if (r.endOfCall.endedReason !== 'customer-ended-call') assert.equal(callbacks.length, 0, f.id);
    else assert.ok(callbacks.length <= 1, f.id);
    if (callbacks.length) { found++; assert.equal((callbacks[0] as { owner: string }).owner, 'human'); assert.ok(r.endOfCall.outcomes.includes('message'), f.id); }
  }
  assert.ok(found >= 1, 'at least one fixture is a dropped call');
});

test('G5 dropped call: an error ending reason -> one call-back handoff', async () => {
  const s = voiceStore();
  await report(s, 'pipeline-error-custom-llm-failed');
  assert.equal(s.db.handoffs.length, 1);
  assert.match((s.db.handoffs[0] as { summary: string }).summary, /Stopped: pipeline-error-custom-llm-failed/);
});
