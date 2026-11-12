// Receptionist Test Lab (task A-4): simulated inbound calls through the real Receptionist pipeline (parseVapiChat,
// the vapiChat flow, runReceptionistTurn and its tools, parseVapiEvent and fo_voice_end), with a scripted model, an
// in-memory store and calendar, and senders that only record. Where the pipeline lacks something (per-business
// operating modes, emergency-services guidance) the test pins today's behaviour and says so.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const { simulateCall, fixtureById, fixtures, demoSettings, simulationStore, SIM_AUTH } = await import('../lib/front-office/receptionist/simulate.ts');
const { checkedAgentSettings } = await import('../lib/front-office/settings.ts');
const { RECEPTIONIST_PROMPT_VERSION } = await import('../lib/front-office/receptionist/prompt.ts');
type SimResult = import('../lib/front-office/receptionist/simulate.ts').SimResult;

// No network in this file: any fetch fails the run.
const realFetch = globalThis.fetch;
const fetchAttempts: string[] = [];
const liveBefore = process.env.FRONT_OFFICE_VOICE_LIVE;
before(() => { globalThis.fetch = (async (input: RequestInfo | URL) => { fetchAttempts.push(String(input)); throw new Error('network is off in this test'); }) as typeof fetch; });
after(() => {
  globalThis.fetch = realFetch;
  assert.deepEqual(fetchAttempts, [], 'no network calls');
  assert.equal(process.env.FRONT_OFFICE_VOICE_LIVE, liveBefore, 'the real voice switch is never changed');
});

const run = (id: string, opts: Parameters<typeof simulateCall>[1] = {}) => {
  const f = fixtureById(id);
  assert.ok(f, `fixture ${id}`);
  return simulateCall(f, opts);
};
const call = (r: SimResult) => { assert.equal(r.tables.fo_calls.length, 1, 'one fo_calls row per call'); return r.tables.fo_calls[0]; };
const tools = (r: SimResult, name: string) => r.toolCalls.filter(t => t.name === name);
const actions = (r: SimResult) => r.turns.flatMap(t => t.vapiActions);
const nothingSent = (r: SimResult) => assert.ok(r.wouldSend.every(s => s.sent === false), 'nothing is ever sent');

test('lab: every fixture runs end to end; greeting first; fo_calls and fo_contacts written; end-of-call report recorded', async () => {
  assert.ok(fixtures.length >= 9);
  for (const f of fixtures) {
    const r = await simulateCall(f);
    assert.equal(r.demo, true);
    assert.equal(r.turns[0].route, 'greeting', f.id);
    assert.match(r.transcript[0].text, /Harbour Fitness \(demo\) AI assistant\. This call is recorded for training\. How can I help today\?/);
    const k = call(r);
    assert.ok(k.ended, f.id); assert.ok(k.summary?.startsWith('Simulated summary'), f.id); assert.match(k.transcript ?? '', /^AI: Thanks for calling/);
    assert.ok(r.tables.fo_contacts.some(c => c.phone === f.caller), 'caller is a contact');
    assert.ok(r.writes.some(w => w.rpc === 'fo_voice_end' && w.table === 'fo_calls'));
    assert.ok(r.turns.every(t => t.chunks.at(-1) === 'data: [DONE]\n\n'), 'Vapi stream always closes');
    assert.deepEqual(r.endOfCall.outcomes, k.outcomes);
    nothingSent(r);
  }
});

test('FAQ: answered only from the business’s own FAQ; spoken reply logged with the prompt version', async () => {
  const r = await run('faq');
  const [faq] = tools(r, 'answer_faq');
  assert.match(String(faq.result), /5 am to 9 pm on weekdays/);
  assert.equal(r.turns[1].said, 'We are open 5 am to 9 pm on weekdays and 7 am to 1 pm on weekends.');
  assert.deepEqual(call(r).outcomes, ['faq']);
  assert.ok(r.tables.fo_messages.some(m => m.direction === 'outbound' && m.prompt_version === RECEPTIONIST_PROMPT_VERSION && /5 am/.test(m.body)));
  assert.ok(r.tables.fo_messages.some(m => m.direction === 'inbound' && m.provider_id === 'vapi:call_sim_faq:1'));
  assert.deepEqual(actions(r), [{ name: 'endCall', args: {} }]);
  assert.equal(r.endOfCall.endedReason, 'assistant-ended-call');
});

test('"I don’t know" safety: no answer on file means no guess, a message for the team and a person owns the call back', async () => {
  const r = await run('dont-know');
  assert.match(String(tools(r, 'answer_faq')[0].result), /^No answer on file/);
  assert.match(r.turns[1].said, /I don’t have that in front of me/);
  assert.deepEqual(call(r).outcomes, ['faq-miss', 'message']);
  assert.equal(r.tables.handoffs.length, 1); assert.equal(r.tables.handoffs[0].owner, 'human'); assert.match(String(r.tables.handoffs[0].summary), /sauna/);
  assert.deepEqual(r.wouldSend.map(s => [s.channel, s.to]), [['sms', '+61400000001'], ['email', 'team@harbour-fitness.example']]);
  assert.equal(tools(r, 'take_message')[0].mode?.action, 'send');
});

test('new caller qualification: answers saved over two turns, new -> qualifying -> qualified, name kept', async () => {
  const r = await run('new-caller');
  const q = tools(r, 'qualify');
  assert.equal(q.length, 2);
  assert.match(String(q[0].result), /Still to ask: preferred_times, start_timeframe/);
  assert.equal(q[1].result, 'Saved. All required answers are in.');
  const c = r.tables.fo_contacts[0];
  assert.equal(c.state, 'qualified'); assert.equal(c.name, 'Sam Lee'); assert.equal(c.answers.preferred_times, 'Weekday mornings');
  assert.deepEqual(r.tables.fo_events.filter(e => e.kind === 'state').map(e => e.detail.split(':')[0]), ['new -> qualifying', 'qualifying -> qualified']);
  assert.deepEqual(call(r).outcomes, ['qualified']);
  assert.equal(r.tables.fo_appointments.length, 0, 'nothing booked');
});

test('booking (automatic, the only mode today): real open time booked, calendar event, reminders, confirmation logged then recorded not sent', async () => {
  const r = await run('book');
  const [, second] = tools(r, 'check_availability');
  const offered = JSON.parse(String(second.result)) as { start: string }[];
  const [book] = tools(r, 'book');
  const picked = offered.at(-1)?.start;
  assert.equal(book.input.start, picked);
  assert.match(String(book.result), /^Booked for /);
  assert.deepEqual(book.mode, { action: 'book', mode: 'automatic', enforced: false, note: r.modes.note });
  const appt = r.tables.fo_appointments[0];
  assert.equal(appt.status, 'booked'); assert.equal(appt.starts, picked);
  assert.equal(r.tables.fo_contacts[0].state, 'booked');
  assert.deepEqual(call(r).outcomes, ['qualified', 'booked']);
  assert.equal(r.calendar.length, 1); assert.match(r.calendar[0], /^created vb/);
  assert.ok(r.tables.fo_jobs.some(j => j.kind === 'reminder-24h' || j.kind === 'reminder-2h'), 'reminder scheduled');
  assert.ok(r.tables.fo_messages.some(m => m.prompt_version === 'setter/booking-confirmation@1'), 'logged before sending');
  assert.equal(r.wouldSend.filter(s => s.channel === 'sms' && s.to === '+61411110004').length, 1);
  nothingSent(r);
});

test('Receptionist Lab: an operatingMode inside the settings data is dropped (modes are saved separately), and the lab reports and runs automatic only (perBusiness false, modes not enforced), so it books directly', async () => {
  const s = checkedAgentSettings({ ...demoSettings(), operatingMode: 'enquiry_only' });
  assert.equal('operatingMode' in s, false, 'settings have no operating mode today');
  const r = await run('book');
  assert.deepEqual(r.modes, { available: ['automatic'], perBusiness: false, note: r.modes.note });
  assert.match(r.modes.note, /A-2/);
  for (const t of r.toolCalls.filter(x => x.mode)) assert.equal(t.mode?.enforced, false);
  assert.equal(r.tables.fo_appointments.length, 1, 'booked with no owner approval step');
});

test('booking is refused before the required questions and when the calendar is not connected', async () => {
  let r = await run('book-too-early');
  assert.match(String(tools(r, 'book')[0].result), /^Ask these first and save them with qualify: goal, experience, preferred_times, start_timeframe\./);
  assert.equal(r.tables.fo_appointments.length, 0); assert.equal(r.tables.fo_contacts[0].state, 'new');
  r = await run('book', { calendar: false });
  assert.match(String(tools(r, 'check_availability')[0].result), /calendar is not connected/);
  assert.equal(r.tables.fo_appointments.length, 0); assert.equal(r.calendar.length, 0);
});

test('reschedule: record and calendar event move to the chosen open time; old reminders stop, new ones scheduled', async () => {
  const r = await run('reschedule');
  const [, check] = tools(r, 'check_availability');
  const target = (JSON.parse(String(check.result)) as { start: string }[])[1].start;
  const [mv] = tools(r, 'reschedule');
  assert.equal(mv.input.start, target); assert.match(String(mv.result), /^Moved to /);
  assert.equal(mv.mode?.action, 'reschedule');
  assert.equal(r.tables.fo_appointments[0].starts, target);
  assert.deepEqual(r.calendar, [`moved vbseedbooking0001 to ${target}`]);
  assert.deepEqual(call(r).outcomes, ['rescheduled']);
  assert.ok(r.tables.fo_messages.some(m => m.prompt_version === 'receptionist/booking-moved@1'));
  assert.ok(r.tables.fo_jobs.some(j => j.appointment_id === 'appt-seed' && j.status === 'pending'));
});

test('cancel: confirmed first, then the booking and calendar event go, contact back to qualified', async () => {
  const r = await run('cancel');
  assert.equal(r.turns[1].summary?.tools.length, 0, 'asks to confirm before cancelling');
  const [c] = tools(r, 'cancel');
  assert.equal(c.result, 'Cancelled. A text confirming it is on its way. Offer to book another time.');
  assert.equal(r.tables.fo_appointments[0].status, 'cancelled');
  assert.equal(r.tables.fo_contacts[0].state, 'qualified');
  assert.deepEqual(r.calendar, ['cancelled vbseedbooking0002']);
  assert.deepEqual(call(r).outcomes, ['cancelled']);
  assert.ok(r.tables.fo_messages.some(m => m.prompt_version === 'receptionist/booking-cancelled@1'));
});

test('transfer: Vapi gets a transferCall to the business number; with no number set it becomes a message', async () => {
  let r = await run('transfer');
  assert.deepEqual(actions(r), [{ name: 'transferCall', args: { destination: '+61890000001' } }]);
  assert.equal(r.turns[1].said, 'Putting you through now.');
  assert.equal(r.endOfCall.endedReason, 'assistant-forwarded-call');
  assert.deepEqual(call(r).outcomes, ['transfer']); assert.equal(r.tables.handoffs[0].owner, 'human');
  r = await run('transfer', { transfer: false });
  assert.match(String(tools(r, 'transfer')[0].result), /^No one is available/);
  assert.equal(actions(r).length, 0); assert.deepEqual(call(r).outcomes, ['message']);
  assert.equal(r.endOfCall.endedReason, 'customer-ended-call');
});

test('urgent situation: put through first, else an urgent message; the prompt tells a caller in danger to call 000 (A-57)', async () => {
  let r = await run('urgent');
  assert.match(String(tools(r, 'transfer')[0].input.reason), /^Urgent/);
  assert.deepEqual(actions(r), [{ name: 'transferCall', args: { destination: '+61890000001' } }]);
  // Injuries that are not life-threatening go to transfer or take_message; a caller in danger is told to call 000 (A-57).
  assert.match(String(r.turns[1].system), /hang up and call 000 now/);
  r = await run('urgent', { transfer: false });
  assert.equal(tools(r, 'take_message')[0].input.urgent, true);
  assert.equal(r.tables.handoffs[0].intent, 'urgent call back');
  assert.match(r.wouldSend.find(s => s.channel === 'sms')?.body ?? '', /URGENT message/);
  assert.deepEqual(call(r).outcomes, ['message']);
});

test('not switched on: honest message, call-back message for the team, hang up; the model never runs', async () => {
  for (const opts of [{ liveSwitch: false }, { receptionistOn: false }]) {
    const r = await run('book', opts);
    assert.equal(r.gate.live, false);
    assert.equal(r.turns.length, 1); assert.equal(r.turns[0].route, 'not-live');
    assert.match(r.turns[0].said, /isn't switched on yet/);
    assert.deepEqual(actions(r), [{ name: 'endCall', args: {} }]);
    assert.deepEqual(call(r).outcomes, ['not-live', 'message']);
    assert.equal(r.tables.fo_appointments.length, 0); assert.equal(r.turns[0].system, null, 'no model request');
    assert.ok(r.tables.fo_messages.some(m => m.prompt_version === 'receptionist/not-live@1'));
  }
});

test('your own caller lines: keyword rules drive the same tools (FAQ, then a person)', async () => {
  const r = await run('faq', { callerLines: ['Is there parking?', 'Can I speak to a manager please?'] });
  assert.equal(r.fixture.id, 'custom'); assert.equal(r.gate.model, 'rules');
  assert.equal(r.turns[1].said, 'Yes, there is free parking behind the building.');
  assert.deepEqual(actions(r), [{ name: 'transferCall', args: { destination: '+61890000001' } }]);
  assert.deepEqual(call(r).outcomes, ['faq', 'transfer']);
});

test('simulation store refuses any other channel key, like fo_channel_workspace', async () => {
  const { rpc } = simulationStore(demoSettings(), { caller: null });
  await assert.rejects(rpc('fo_voice_turn', { channel: SIM_AUTH.channel, channel_key: 'x'.repeat(40), call_id: 'call_x0000001', caller: null, turn: 0, message: null }), /Channel not recognised/);
});
