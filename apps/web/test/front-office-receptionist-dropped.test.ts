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
  assert.equal(s.log.dispatches.length, 0, 'a duplicate is not an error: no staff event');
  assert.equal(s.log.sent, 0);
});

test('A-73: sequential duplicate end-of-call report (second returns first=false) creates no second call-back and no event', async () => {
  const s = voiceStore();
  const firsts: unknown[] = [];
  const rpc = async (fn: string, a: Record<string, unknown>) => { const r = await s.rpc(fn, a); if (fn === 'fo_voice_end') firsts.push((r as { first: unknown }).first); return r; };
  await report({ ...s, rpc }, 'customer-ended-call');
  assert.equal(s.db.handoffs.length, 1);
  await report({ ...s, rpc }, 'customer-ended-call');
  assert.deepEqual(firsts, [true, false]);
  assert.equal(s.db.handoffs.length, 1);
  assert.equal(s.log.dispatches.length, 0);
  assert.equal(s.log.sent, 0);
});

test('A-73: fo_contact_context throws -> a staff-visible dispatch event, no call-back, webhook still 200', async () => {
  const s = voiceStore();
  const rpc = async (fn: string, a: Record<string, unknown>) => { if (fn === 'fo_contact_context') throw new Error('context down'); return s.rpc(fn, a); };
  const orig = console.error; const seen: string[] = []; console.error = (...m: unknown[]) => { seen.push(m.join(' ')); };
  try { await report({ ...s, rpc }, 'customer-ended-call'); } finally { console.error = orig; }
  assert.equal(s.db.handoffs.length, 0);
  assert.equal(s.log.dispatches.length, 1);
  assert.equal(s.log.dispatches[0], 'receptionist: Dropped call customer-ended-call: the call-back could not be saved. Please check the call log and call this person back.');
  assert.ok(seen.some(m => /dropped-call handoff failed: context down/.test(m)));
  assert.equal(s.log.sent, 0);
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

test('A-73: missing / null `first` flag -> no call-back, but a staff-visible dispatch event (one per report)', async () => {
  for (const mode of ['undefined', 'null', 'missing'] as const) {
    const s = voiceStore();
    const rpc = async (fn: string, a: Record<string, unknown>) => {
      const r = await s.rpc(fn, a);
      if (fn !== 'fo_voice_end') return r;
      const body = { ...(r as Record<string, unknown>) };
      if (mode === 'missing') delete body.first; else body.first = mode === 'null' ? null : undefined;
      return body;
    };
    const orig = console.error; console.error = () => undefined;
    try { await report({ ...s, rpc }, 'customer-ended-call'); } finally { console.error = orig; }
    assert.equal(s.db.handoffs.length, 0, mode);
    assert.equal(s.log.dispatches.length, 1, mode);
    assert.match(s.log.dispatches[0], /^receptionist: Dropped call customer-ended-call: the system could not tell if a call-back was already made, so none was created/, mode);
    assert.equal(s.log.sent, 0, mode);
  }
});

test('A-73: missing `first` flag but the call was settled (booked) -> no event and no call-back', async () => {
  const s = voiceStore(['booked']);
  const rpc = async (fn: string, a: Record<string, unknown>) => { const r = await s.rpc(fn, a); return fn === 'fo_voice_end' ? { ...(r as object), first: undefined } : r; };
  const orig = console.error; console.error = () => undefined;
  try { await report({ ...s, rpc }, 'customer-ended-call'); } finally { console.error = orig; }
  assert.equal(s.db.handoffs.length, 0); assert.equal(s.log.dispatches.length, 0); assert.equal(s.log.sent, 0);
});

test('A-73: a non-drop reason with a missing `first` flag logs no event (nothing was lost)', async () => {
  const s = voiceStore();
  const rpc = async (fn: string, a: Record<string, unknown>) => { const r = await s.rpc(fn, a); return fn === 'fo_voice_end' ? { ...(r as object), first: null } : r; };
  await report({ ...s, rpc }, 'assistant-ended-call');
  assert.equal(s.db.handoffs.length, 0); assert.equal(s.log.dispatches.length, 0);
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
  assert.equal(s.log.dispatches[0], 'receptionist: Dropped call customer-ended-call: the call-back could not be saved. Please check the call log and call this person back.');
  assert.equal(s.log.sent, 0);
});

test('A-77: dropped call from a withheld number (placeholder contact) -> hand-off says the number was withheld, no placeholder name or email shown, nothing sent', async () => {
  const s = voiceStore([], { caller: null });
  s.db.contact.name = 'Withheld caller'; s.db.contact.answers = {}; s.db.contact.email = 'withheld-0123456789abcdef@call.invalid';
  await report(s, 'customer-ended-call', null);
  assert.equal(s.db.handoffs.length, 1);
  const h = s.db.handoffs[0] as { summary: string; contact: { name: string | null } };
  assert.match(h.summary, /^Dropped call from a withheld number \(no number to call back on\)\. Captured: nothing captured\./);
  assert.doesNotMatch(JSON.stringify(h.summary), /Withheld caller|call\.invalid/);
  assert.equal(h.contact.name, null);
  assert.equal(s.log.sent, 0);
});

test('A-77: a real caller who is merely named "Withheld caller" but has a phone is still shown as captured', async () => {
  const s = voiceStore();
  s.db.contact.name = 'Withheld caller';
  await report(s, 'customer-ended-call');
  assert.match((s.db.handoffs[0] as { summary: string }).summary, /name Withheld caller/);
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
  // Exactly one fixture is an unsettled hang-up ("book-too-early"); every other fixture leaves no call-back.
  const expectedCallbacks: Record<string, number> = { faq: 0, 'dont-know': 0, 'new-caller': 0, book: 0, 'book-too-early': 1, reschedule: 0, cancel: 0, transfer: 0, urgent: 0 };
  assert.deepEqual(fixtures.map(f => f.id).sort(), Object.keys(expectedCallbacks).sort(), 'fixture list changed: update the expected counts');
  for (const f of fixtures) {
    const r = await simulateCall(f);
    const callbacks = r.tables.handoffs.filter(h => /call back \(dropped call\)/.test(String((h as { intent?: string }).intent)));
    assert.equal(callbacks.length, expectedCallbacks[f.id], f.id);
    if (callbacks.length) {
      found++;
      const h = callbacks[0] as { owner: string; channel: string; nextAction: string; summary: string };
      assert.equal(h.owner, 'human'); assert.equal(h.channel, 'voice'); assert.equal(h.nextAction, 'Call the caller back');
      assert.match(h.summary, /^Dropped call from /); assert.match(h.summary, /Stopped: customer-ended-call/);
      assert.equal(r.tables.handoffs.length, 1, f.id);
      assert.ok(r.endOfCall.outcomes.includes('message'), f.id);
    }
  }
  assert.equal(found, 1, 'exactly one fixture is a dropped call');
});

test('G5 dropped call: an error ending reason -> one call-back handoff', async () => {
  const s = voiceStore();
  await report(s, 'pipeline-error-custom-llm-failed');
  assert.equal(s.db.handoffs.length, 1);
  assert.match((s.db.handoffs[0] as { summary: string }).summary, /Stopped: pipeline-error-custom-llm-failed/);
});
