// AI Receptionist caller identity check (A-20): the caller number alone never lets anyone move or cancel a booking.
// A second factor (the name on the booking, or its date and time) must match first. Scripted model, in-memory store
// and calendar: no network, nothing sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts'; // registers the extensionless import resolver used by lib/

const sim = await import('../lib/front-office/receptionist/simulate.ts');
const { receptionistSession, runReceptionistTurn, receptionistTools } = await import('../lib/front-office/receptionist/agent.ts');
const { nameMatches, timeMatches } = await import('../lib/front-office/receptionist/identity.ts');
const { streamOf } = await import('../lib/front-office/llm.ts');
type Block = import('../lib/front-office/llm.ts').Block;

const { SIM_AUTH, SIM_NOW, demoSettings, simulationStore, simulatedCalendar, recordingSenders } = sim;
const STARTS = '2026-11-11T02:00:00.000Z'; // Wednesday 10:00 am Perth
const CALLER = '+61411110077';
const PRIVATE = /Casey|Lane|Wednesday|Wed\b|10:00|10 am|11 Nov/i;

function setup(opts: { name?: string | null; mode?: 'automatic' | 'owner_approval' | 'enquiry_only' } = {}) {
  const settings = demoSettings();
  const name = opts.name === undefined ? 'Casey Lane' : opts.name ?? undefined;
  const db = simulationStore(settings, { caller: CALLER, contact: { state: 'booked', name, answers: {}, booking: { starts: STARTS, eventId: 'vbseedbooking0077' } } });
  const cal = simulatedCalendar([{ id: 'vbseedbooking0077', start: Date.parse(STARTS), end: Date.parse(STARTS) + settings.bookingMinutes * 60_000 }]);
  const senders = recordingSenders();
  const deps = { rpc: db.rpc, auth: SIM_AUTH, calendar: cal.provider, send: senders.send, email: senders.email, settings, now: SIM_NOW, call: { id: 'call_identity_0001', caller: CALLER, contact: 'contact-seed' }, ...(opts.mode ? { mode: opts.mode } : {}) };
  return { db, cal, senders, settings, deps, session: () => receptionistSession(deps), appt: () => db.tables.fo_appointments[0] };
}
async function firstOffer(session: Awaited<ReturnType<ReturnType<typeof setup>['session']>>) {
  const offers = JSON.parse(await session.run({ type: 'tool_use', id: 'a', name: 'check_availability', input: {} })) as { start: string }[];
  return offers[0].start;
}
const run = (session: Awaited<ReturnType<ReturnType<typeof setup>['session']>>, name: string, input: Record<string, unknown>) => session.run({ type: 'tool_use', id: name, name, input });
const unchanged = (t: ReturnType<typeof setup>) => {
  assert.equal(t.appt().status, 'booked'); assert.equal(t.appt().starts, STARTS);
  assert.deepEqual(t.cal.log, [], 'calendar untouched');
  assert.equal(t.db.tables.fo_contacts[0].state, 'booked');
};
const handedToStaff = (t: ReturnType<typeof setup>) => {
  assert.equal(t.db.tables.handoffs.length, 1);
  const h = t.db.tables.handoffs[0] as { owner: string; intent: string; summary: string };
  assert.equal(h.owner, 'human'); assert.equal(h.intent, 'booking change not verified');
  assert.match(h.summary, /could not confirm/); assert.match(h.summary, /Nothing was changed/);
  assert.ok(t.senders.out.some(w => w.channel === 'sms' && w.to === t.settings.staffPhone), 'staff texted (recorded, not sent)');
  assert.ok(!t.senders.out.some(w => w.to === CALLER), 'no confirmation to the caller');
};

test('tool definitions: reschedule and cancel take verify_name and verify_time', () => {
  for (const n of ['reschedule', 'cancel']) {
    const props = (receptionistTools.find(t => t.name === n)?.input_schema as { properties: Record<string, unknown> }).properties;
    assert.ok('verify_name' in props && 'verify_time' in props, n);
  }
});

test('matchers: name is case/space/accent-insensitive with a first-name match; time needs date and time', () => {
  assert.ok(nameMatches('  casey  LANE ', 'Casey Lane'));
  assert.ok(nameMatches('Casey', 'Casey Lane'));
  assert.ok(nameMatches('Casey Lane', 'Casey'));
  assert.ok(nameMatches('Zoë', 'Zoe'));
  assert.ok(!nameMatches('Casey Smith', 'Casey Lane'), 'same first name, different surname');
  assert.ok(!nameMatches('Case', 'Casey Lane'));
  assert.ok(!nameMatches('Casey', null), 'no name on file never matches');
  assert.ok(!nameMatches('', 'Casey'));
  assert.ok(timeMatches('2026-11-11T10:00', STARTS, 'Australia/Perth'));
  assert.ok(timeMatches('2026-11-11T02:00:00Z', STARTS, 'Australia/Perth'));
  assert.ok(timeMatches('2026-11-11T10:00:00+08:00', STARTS, 'Australia/Perth'));
  assert.ok(!timeMatches('2026-11-11T11:00', STARTS, 'Australia/Perth'));
  assert.ok(!timeMatches('2026-11-12T10:00', STARTS, 'Australia/Perth'));
  assert.ok(!timeMatches('10:00', STARTS, 'Australia/Perth'), 'a bare time of day is too easy to guess');
});

test('wrong name on a cancel: refused, nothing changes, handed to staff, no booking details in the reply', async () => {
  const t = setup(); const s = await t.session();
  const r = await run(s, 'cancel', { reason: 'Changed plans', verify_name: 'Taylor' });
  assert.match(r, /^Not done, and nothing was changed/); assert.doesNotMatch(r, PRIVATE);
  unchanged(t); handedToStaff(t);
  assert.ok(!s.outcomes.includes('cancelled'));
});

test('wrong time on a reschedule: refused, nothing changes, handed to staff', async () => {
  const t = setup(); const s = await t.session();
  const start = await firstOffer(s);
  const r = await run(s, 'reschedule', { start, verify_time: '2026-11-12T15:00' });
  assert.match(r, /^Not done, and nothing was changed/); assert.doesNotMatch(r, PRIVATE);
  unchanged(t); handedToStaff(t);
  assert.ok(!s.outcomes.includes('rescheduled'));
});

test('a wrong detail locks the call: a second guess is refused too, with no second hand-off', async () => {
  const t = setup(); const s = await t.session();
  await run(s, 'cancel', { reason: 'x', verify_name: 'Taylor' });
  const again = await run(s, 'cancel', { reason: 'x', verify_name: 'Casey' });
  assert.match(again, /^Not done, and nothing was changed/);
  unchanged(t); assert.equal(t.db.tables.handoffs.length, 1);
});

test('missing detail: the AI is told to ask, nothing changes, no hand-off yet, nothing revealed', async () => {
  const t = setup(); const s = await t.session();
  const c = await run(s, 'cancel', { reason: 'Changed plans' });
  assert.match(c, /^Not done yet: before changing a booking/); assert.doesNotMatch(c, PRIVATE);
  const start = await firstOffer(s);
  const m = await run(s, 'reschedule', { start });
  assert.match(m, /^Not done yet/); assert.doesNotMatch(m, PRIVATE);
  unchanged(t); assert.equal(t.db.tables.handoffs.length, 0);
  // Whitespace-only is the same as nothing.
  assert.match(await run(s, 'cancel', { reason: 'x', verify_name: '   ', verify_time: ' ' }), /^Not done yet/);
});

test('a booking with no name on file cannot be verified by name, only by its time', async () => {
  const t = setup({ name: null }); const s = await t.session();
  assert.match(await run(s, 'cancel', { reason: 'x', verify_name: 'Casey' }), /^Not done, and nothing was changed/);
  unchanged(t);
  const t2 = setup({ name: null }); const s2 = await t2.session();
  assert.match(await run(s2, 'cancel', { reason: 'x', verify_time: '2026-11-11T10:00' }), /^Cancelled/);
});

test('correct name (any case, first name only) lets the cancel proceed exactly as before', async () => {
  const t = setup(); const s = await t.session();
  const r = await run(s, 'cancel', { reason: 'Away that week', verify_name: ' casey ' });
  assert.match(r, /^Cancelled/);
  assert.equal(t.appt().status, 'cancelled'); assert.deepEqual(t.cal.log, ['cancelled vbseedbooking0077']);
  assert.equal(t.db.tables.fo_contacts[0].state, 'qualified'); assert.equal(t.db.tables.handoffs.length, 0);
  assert.ok(s.outcomes.includes('cancelled'));
  assert.ok(t.senders.out.some(w => w.to === CALLER), 'confirmation recorded');
});

test('correct time lets the reschedule proceed; the caller is not asked again for the next action', async () => {
  const t = setup(); const s = await t.session();
  const start = await firstOffer(s);
  const r = await run(s, 'reschedule', { start, verify_time: '2026-11-11T10:00' });
  assert.match(r, /^Moved to /);
  assert.equal(t.appt().starts, new Date(start).toISOString()); assert.equal(t.db.tables.handoffs.length, 0);
  assert.ok(s.outcomes.includes('rescheduled'));
  assert.match(await run(s, 'cancel', { reason: 'Changed my mind' }), /^Cancelled/, 'already verified on this call');
});

test('one correct detail is enough when the other is wrong', async () => {
  const t = setup(); const s = await t.session();
  assert.match(await run(s, 'cancel', { reason: 'x', verify_name: 'Casey', verify_time: '2026-01-01T09:00' }), /^Cancelled/);
});

test('operating mode behaviour is unchanged: the check runs the same in every mode', async () => {
  for (const mode of ['automatic', 'owner_approval', 'enquiry_only'] as const) {
    const bad = setup({ mode }); const sb = await bad.session();
    assert.match(await run(sb, 'cancel', { reason: 'x', verify_name: 'Taylor' }), /^Not done, and nothing was changed/, mode);
    unchanged(bad);
    const good = setup({ mode }); const sg = await good.session();
    assert.match(await run(sg, 'cancel', { reason: 'x', verify_name: 'Casey' }), /^Cancelled/, mode);
  }
});

test('book on a number that already has a booking does not reveal when it is', async () => {
  const t = setup(); const s = await t.session();
  const r = await run(s, 'book', { start: '2026-11-10T02:00:00.000Z' });
  assert.match(r, /already have a booking/); assert.doesNotMatch(r, PRIVATE);
});

test('whole turn: the prompt hides the name and time on file; a spoofer who guesses wrong gets a refusal and the team is told', async () => {
  const t = setup();
  const systems: string[] = [];
  const replies: Block[][] = [
    [{ type: 'tool_use', id: 't1', name: 'cancel', input: { reason: 'Cancel it', verify_name: 'Alex' } }],
    [{ type: 'text', text: 'I cannot change that booking on this call. I have passed it to the team.' }],
  ];
  let i = 0;
  const llm = streamOf(async (req) => { systems.push(req.system); const content = replies[i++] ?? []; return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }; });
  const gen = runReceptionistTurn({ ...t.deps, llm, conversation: [{ role: 'user', content: 'Cancel my booking please.' }] });
  let r = await gen.next(); let said = '';
  while (!r.done) { if (r.value.type === 'text') said += r.value.text; r = await gen.next(); }
  assert.ok(systems.length >= 2);
  for (const sys of systems) { assert.doesNotMatch(sys, PRIVATE, 'system prompt carries neither name nor time'); assert.match(sys, /verify_name or verify_time/); }
  assert.deepEqual(r.value.tools, ['cancel']); assert.doesNotMatch(said, PRIVATE);
  unchanged(t); handedToStaff(t);
});

test('Lab and production use the same check: the simulated cancel/reschedule fixtures verify and complete; a wrong name in the lab is refused', async () => {
  for (const id of ['cancel', 'reschedule']) {
    const r = await sim.simulateCall(sim.fixtureById(id)!);
    assert.ok(r.endOfCall.outcomes.includes(id === 'cancel' ? 'cancelled' : 'rescheduled'), id);
    assert.equal(r.tables.handoffs.length, 0, id);
  }
  const base = sim.fixtureById('cancel')!;
  const bad = { ...base, turns: [base.turns[0], { ...base.turns[1], script: [[sim.say('One moment. '), sim.tool('cancel', { reason: 'x', verify_name: 'Taylor' })], (r: { content: string }[]) => [sim.say(r[0]?.content ?? '')]] }] };
  const r = await sim.simulateCall(bad);
  assert.equal(r.tables.fo_appointments[0].status, 'booked');
  assert.deepEqual(r.calendar, []);
  assert.equal(r.tables.handoffs.length, 1);
  assert.ok(!r.endOfCall.outcomes.includes('cancelled'));
  assert.doesNotMatch(r.turns.map(x => x.said).join(' '), /Casey/);
});

test('rule model (Lab free-text): asks for the name, then cancels once the caller gives it; refuses a wrong one', async () => {
  const fx = sim.fixtureById('cancel')!;
  const ask = await sim.simulateCall(fx, { callerLines: ['I want to cancel my booking'] });
  assert.equal(ask.tables.fo_appointments[0].status, 'booked');
  assert.match(ask.turns.map(x => x.said).join(' '), /name the booking is under/);
  const ok = await sim.simulateCall(fx, { callerLines: ['Hi it\'s Casey, I want to cancel my booking'] });
  assert.equal(ok.tables.fo_appointments[0].status, 'cancelled');
  const bad = await sim.simulateCall(fx, { callerLines: ['Hi it\'s Morgan, I want to cancel my booking'] });
  assert.equal(bad.tables.fo_appointments[0].status, 'booked');
  assert.equal(bad.tables.handoffs.length, 1);
});

test('qualify cannot be used to change the name on file and then verify with it: refused, handed to staff, stored name unchanged', async () => {
  const t = setup(); const s = await t.session();
  await run(s, 'qualify', { answers: {}, name: 'Mallory' });
  assert.equal(t.db.tables.fo_contacts[0].name, 'Casey Lane', 'stored name not overwritten');
  const r = await run(s, 'cancel', { reason: 'x', verify_name: 'Mallory' });
  assert.match(r, /^Not done, and nothing was changed/);
  unchanged(t); handedToStaff(t);
  assert.equal(t.db.tables.fo_contacts[0].name, 'Casey Lane');
  // The other name-saving tool, and a fresh session on the same call.
  await run(s, 'request_quote', { need: 'a quote', name: 'Mallory' });
  const s2 = await t.session();
  await run(s2, 'qualify', { answers: {}, name: 'Mallory' });
  assert.equal(t.db.tables.fo_contacts[0].name, 'Casey Lane');
  assert.match(await run(s2, 'cancel', { reason: 'x', verify_name: 'Mallory' }), /^Not done, and nothing was changed/);
  unchanged(t);
});

test('a booking with no name on file cannot be given one by an unverified caller', async () => {
  const t = setup({ name: null }); const s = await t.session();
  await run(s, 'qualify', { answers: {}, name: 'Mallory' });
  assert.equal(t.db.tables.fo_contacts[0].name, null);
  const s2 = await t.session();
  assert.match(await run(s2, 'cancel', { reason: 'x', verify_name: 'Mallory' }), /^Not done, and nothing was changed/);
  unchanged(t);
});

test('a verified caller may still update their name; a contact with no booking can be named', async () => {
  const t = setup(); const s = await t.session();
  assert.match(await run(s, 'cancel', { reason: 'x', verify_name: 'Casey' }), /^Cancelled/);
  await run(s, 'qualify', { answers: {}, name: 'Casey L' });
  assert.equal(t.db.tables.fo_contacts[0].name, 'Casey L');
  const n = setup(); n.db.tables.fo_appointments.length = 0; const sn = await n.session();
  await run(sn, 'qualify', { answers: {}, name: 'Pat Lee' });
  assert.equal(n.db.tables.fo_contacts[0].name, 'Pat Lee');
});

test('the lock survives a new session on the same call: a second guess is refused with no second hand-off, text or email', async () => {
  const t = setup();
  const first = await t.session();
  assert.match(await run(first, 'cancel', { reason: 'x', verify_name: 'Taylor' }), /^Not done, and nothing was changed/);
  const sent = t.senders.out.length;
  // Next utterance or webhook: a brand-new session (no shared memory) on the same call id.
  const second = await t.session();
  assert.match(await run(second, 'cancel', { reason: 'x', verify_name: 'Morgan' }), /^Not done, and nothing was changed/);
  assert.match(await run(second, 'cancel', { reason: 'x', verify_name: 'Casey' }), /^Not done, and nothing was changed/, 'even the right name is refused on a locked call');
  unchanged(t); assert.equal(t.db.tables.handoffs.length, 1); assert.equal(t.senders.out.length, sent);
  // Three real turns on the same call id.
  const t2 = setup();
  const turn = async (name: string) => {
    const replies: Block[][] = [[{ type: 'tool_use', id: 'c', name: 'cancel', input: { reason: 'x', verify_name: name } }], [{ type: 'text', text: 'I cannot change that on this call.' }]];
    let i = 0;
    const llm = streamOf(async () => { const content = replies[i++] ?? []; return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }; });
    const gen = runReceptionistTurn({ ...t2.deps, llm, conversation: [{ role: 'user', content: 'Cancel it.' }] });
    let r = await gen.next(); while (!r.done) r = await gen.next();
  };
  await turn('Taylor'); await turn('Morgan'); await turn('Casey');
  unchanged(t2); assert.equal(t2.db.tables.handoffs.length, 1);
  assert.equal(t2.senders.out.filter(w => w.channel === 'sms').length, 1); assert.equal(t2.senders.out.filter(w => w.channel === 'email').length, 1);
  // A different call from the same number starts fresh: the real customer can still verify.
  const other = await receptionistSession({ ...t2.deps, call: { ...t2.deps.call, id: 'call_identity_0002' } });
  assert.match(await run(other, 'cancel', { reason: 'x', verify_name: 'Casey' }), /^Cancelled/);
});

test('a failed check locks the whole call: switching to another contact by phone is refused, with no second hand-off', async () => {
  const t = setup();
  const first = await t.session();
  assert.match(await run(first, 'cancel', { reason: 'x', verify_name: 'Taylor' }), /^Not done, and nothing was changed/);
  const sent = t.senders.out.length;
  // Same session, then a fresh session on the same call id: both try another contact.
  for (const s of [first, await t.session()]) {
    await run(s, 'qualify', { phone: '+61422220088', answers: {}, name: 'Casey Lane' });
    const r = await run(s, 'cancel', { reason: 'x', verify_name: 'Casey' });
    assert.match(r, /^Not done, and nothing was changed/);
    assert.doesNotMatch(r, PRIVATE);
    await run(s, 'reschedule', { start: STARTS, verify_time: '2026-11-11T10:00' });
  }
  unchanged(t); handedToStaff(t);
  assert.equal(t.senders.out.length, sent, 'no extra text or email');
  assert.equal(t.db.tables.fo_contacts.length, 1, 'no second contact was created on the locked call');
  const original = t.db.tables.fo_contacts[0].id;
  assert.ok(t.db.tables.fo_calls.every(k => !k.contact_id || k.contact_id === original), 'the call stays linked to the original contact');
  assert.ok(t.db.tables.handoffs.every(h => (h as { contact: { id: string } }).contact.id === original), 'the hand-off is on the original contact');
});

test('A-77: with no failed check, naming a different number mid-call still switches the call to that contact', async () => {
  const t = setup();
  const s = await t.session();
  await run(s, 'qualify', { phone: '+61422220088', answers: {}, name: 'Pat Other' });
  assert.equal(t.db.tables.fo_contacts.length, 2, 'a second contact was created for the other number');
  const other = t.db.tables.fo_contacts.find(c => c.phone === '+61422220088');
  assert.ok(other, 'the new contact has the number the caller gave');
  assert.equal(t.db.tables.fo_calls.find(k => k.provider_call_id === 'call_identity_0001')?.contact_id, other.id, 'the call is now linked to the new contact');
  assert.equal(t.db.tables.handoffs.length, 0, 'no failed check, so no hand-off');
});

test('the hand-off is marked done only once it was written: a failing hand-off is retried on the next wrong guess', async () => {
  const t = setup(); let fail = true;
  const rpc = async (fn: string, a: Record<string, unknown>) => { if (fn === 'fo_record_handoff' && fail) throw new Error('db down'); return t.db.rpc(fn, a); };
  const s = await receptionistSession({ ...t.deps, rpc });
  await assert.rejects(run(s, 'cancel', { reason: 'x', verify_name: 'Taylor' }), /db down/);
  fail = false;
  assert.match(await run(s, 'cancel', { reason: 'x', verify_name: 'Taylor' }), /^Not done, and nothing was changed/);
  assert.equal(t.db.tables.handoffs.length, 1);
  unchanged(t);
});
