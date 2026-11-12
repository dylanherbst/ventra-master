// Setter Test Lab (task A-3): customer messages through the real inbound router and Setter (handleInboundSms,
// runSetterTurn, bookSlot, jobs) with a scripted model and an in-memory store; booking goes through gate() / decide()
// and the owner approval queue. No network, nothing sent.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const { newLab, runLabTurn, decideLabAction, checkedLab, labStore, OBJECTION_NOTE, LAB_WITH_PERSON_NOTE, LAB_PHONE, LAB_AUTH, LAB_LIMITS } = await import('../lib/front-office/setter/lab.ts');
const { sendMessage, decideAction } = await import('../app/tools/setter-lab/actions.ts');
type LabState = import('../lib/front-office/setter/lab.ts').LabState;
type Mode = LabState['mode'];

const realFetch = globalThis.fetch;
const fetchAttempts: string[] = [];
before(() => { globalThis.fetch = (async (input: RequestInfo | URL) => { fetchAttempts.push(String(input)); throw new Error('network is off in this test'); }) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; assert.deepEqual(fetchAttempts, [], 'no network calls'); });

const QUALIFY = 'Hi, I\'m Sam. I run a gym in Fremantle. We get about 40 enquiries a week from Instagram. We are slow to reply and miss a lot of them. I want it fixed this week.';

async function toOffer(mode: Mode): Promise<LabState> {
  let s = newLab(mode);
  s = await runLabTurn(s, { message: QUALIFY });
  return s;
}

test('a turn produces the AI reply and CRM writes in the in-memory store', async () => {
  const s0 = newLab('automatic');
  const s = await runLabTurn(s0, { message: 'Hi, I run a gym in Perth.' });
  assert.equal(s0.turns.length, 0, 'input state is not changed');
  const t = s.turns[0];
  assert.equal(t.error, null);
  assert.ok(t.reply && t.reply.length > 0, 'AI reply');
  assert.match(t.route, /^setter:/);
  assert.ok(t.contactId);
  const c = s.tables.contacts.find(x => x.id === t.contactId);
  assert.equal(c?.phone, LAB_PHONE);
  assert.equal(c?.answers.business, 'Hi, I run a gym in Perth.');
  assert.equal(t.state, 'new');
  assert.deepEqual(t.missing, ['lead_flow', 'problem', 'timing']);
  assert.ok(t.writes.some(w => /fo_contacts insert/.test(w.detail)), 'contact created');
  assert.ok(t.writes.some(w => w.rpc === 'fo_save_details'), 'answers saved');
  assert.ok(t.writes.some(w => w.rpc === 'fo_log_outbound'), 'reply logged before sending');
  assert.deepEqual(t.tools.map(x => x.name), ['save_answers']);
  assert.equal(t.objection, OBJECTION_NOTE);
  assert.equal(s.wouldSend.length, 0, 'the reply is returned, not sent');
});

test('qualifying answers move the lead to qualified and offer real open times', async () => {
  const s = await toOffer('automatic');
  const t = s.turns[0];
  assert.equal(t.state, 'qualified');
  assert.deepEqual(t.tools.map(x => x.name), ['save_answers', 'set_stage', 'offer_times']);
  assert.match(t.reply ?? '', /Which suits you\?/);
  assert.equal(t.detected.timing, 'I want it fixed this week.');
  assert.match(t.detected.needs ?? '', /slow to reply/);
  assert.equal(t.booking, null);
});

test('automatic: the booking is performed by the pipeline', async () => {
  const s = await runLabTurn(await toOffer('automatic'), { message: 'The first one please.' });
  const t = s.turns[1];
  assert.equal(t.booking?.decision, 'perform');
  assert.equal(t.booking?.booked, true);
  assert.equal(t.state, 'booked');
  assert.equal(s.tables.appointments.length, 1);
  assert.equal(s.calendar.length, 1, 'in-memory calendar only');
  assert.match(t.reply ?? '', /You're booked/);
  assert.equal(s.pending.length, 0);
});

test('owner_approval: the booking is held, then approve books it exactly once', async () => {
  let s = await runLabTurn(await toOffer('owner_approval'), { message: 'The last one please.' });
  const t = s.turns[1];
  assert.equal(t.booking?.decision, 'hold_for_approval');
  assert.equal(t.state, 'qualified');
  assert.equal(s.tables.appointments.length, 0, 'nothing booked yet');
  assert.match(t.reply ?? '', /passed your booking request to the team/);
  assert.equal(s.pending.length, 1);
  const id = s.pending[0].id;
  assert.equal(t.booking?.pendingId, id);
  assert.equal(s.pending[0].status, 'pending');

  s = await decideLabAction(s, id, 'approve');
  assert.equal(s.decisions[0].outcome, 'performed');
  assert.equal(s.pending[0].status, 'performed');
  assert.equal(s.tables.appointments.length, 1);
  assert.equal(s.tables.contacts[0].state, 'booked');
  assert.ok(s.tables.jobs.some(j => j.kind !== 'follow-up' && j.status === 'pending'), 'reminders scheduled');

  s = await decideLabAction(s, id, 'approve');
  assert.equal(s.decisions[1].outcome, 'already_decided');
  assert.equal(s.tables.appointments.length, 1, 'approve runs once');
  assert.equal(s.calendar.length, 1);
});

test('owner_approval: reject discards the booking', async () => {
  let s = await runLabTurn(await toOffer('owner_approval'), { message: 'The second one.' });
  s = await decideLabAction(s, s.pending[0].id, 'reject');
  assert.equal(s.decisions[0].outcome, 'rejected');
  assert.equal(s.pending[0].status, 'rejected');
  assert.equal(s.tables.appointments.length, 0);
});

test('enquiry_only: the booking is refused and handed to a person', async () => {
  const s = await runLabTurn(await toOffer('enquiry_only'), { message: 'The first one please.' });
  const t = s.turns[1];
  assert.equal(t.booking?.decision, 'refuse');
  assert.equal(t.booking?.pendingId, null);
  assert.equal(s.tables.appointments.length, 0);
  assert.equal(s.pending.length, 0);
  assert.equal(t.handedTo, 'human');
  assert.match(t.reply ?? '', /cannot book that myself/);
});

test('after a hand-off to a person the lab AI goes quiet, like the live routes (A-61)', async () => {
  // enquiry_only refused booking -> escalate_human; the next message is stored but gets no AI reply.
  const s1 = await runLabTurn(await toOffer('enquiry_only'), { message: 'The first one please.' });
  assert.equal(s1.turns[1].handedTo, 'human');
  const out = s1.tables.messages.filter(m => m.direction === 'outbound').length;
  const s2 = await runLabTurn(s1, { message: 'Hello? Is anyone there?' });
  const t = s2.turns[2];
  assert.equal(t.error, null);
  assert.equal(t.reply, null);
  assert.deepEqual(t.tools, [], 'no model tool calls');
  assert.match(t.route, /^setter:/);
  assert.ok(t.route.endsWith(LAB_WITH_PERSON_NOTE), 'the turn says why there is no reply');
  assert.equal(s2.tables.messages.filter(m => m.direction === 'outbound').length, out, 'no outbound');
  assert.equal(s2.tables.messages.at(-1)?.body, 'Hello? Is anyone there?');
  assert.ok(!t.writes.some(w => w.rpc === 'fo_log_outbound'));
  assert.equal(s2.wouldSend.length, 0);
});

test('G7 (A-59): the Setter prompts carry the talk-to-a-person rule and never claim to be human', async () => {
  const { setterSystemPrompt, setterReturningPrompt } = await import('../lib/front-office/setter/prompt.ts');
  const { LAB_CONFIG } = await import('../lib/front-office/setter/lab.ts');
  const prompts = [setterSystemPrompt(LAB_CONFIG, 'Mon 9 Nov', 'sms'), setterReturningPrompt(LAB_CONFIG, 'Mon 9 Nov', 'sms', null)];
  for (const p of prompts) {
    assert.match(p, /ask to talk to a person, a real person, a human or the owner/);
    assert.match(p, /a person will get back to them, and call escalate_human/);
    assert.match(p, /Never claim or imply you are a human/);
    assert.match(p, /say you are an AI assistant for the business/);
  }
});

test('G7 (A-59): a plain request for a person hands off to a person, then the AI goes quiet', async () => {
  const phrases = ['Can I talk to a person?', 'I want a real person please', 'Let me speak to a human', 'Can I talk to the owner?'];
  for (const message of phrases) {
    const s1 = await runLabTurn(newLab('automatic'), { message });
    const t = s1.turns[0];
    assert.equal(t.error, null, message);
    assert.deepEqual(t.tools.map(x => x.name), ['escalate_human'], message);
    assert.equal(t.handedTo, 'human', message);
    assert.ok(s1.tables.handoffs.some(h => h.owner === 'human'), message);
    assert.ok(t.reply && !/\bI am (a )?human\b/i.test(t.reply), message);
    const s2 = await runLabTurn(s1, { message: 'Hello? Anyone?' });
    assert.equal(s2.turns[1].reply, null, 'goes quiet after the hand-off');
    assert.deepEqual(s2.turns[1].tools, []);
    assert.equal(s2.wouldSend.length, 0);
  }
  // An ordinary message is not treated as a request for a person.
  const s = await runLabTurn(newLab('automatic'), { message: 'Hi, I run a gym in Perth.' });
  assert.deepEqual(s.turns[0].tools.map(x => x.name), ['save_answers']);
});

test('A-70: more ways to ask for a person hand off; ordinary "someone" messages do not', async () => {
  for (const message of ['Can I talk to someone?', 'can i talk to somebody', 'I would like to speak to a real person', 'chat with a human please']) {
    const s = await runLabTurn(newLab('automatic'), { message });
    assert.deepEqual(s.turns[0].tools.map(x => x.name), ['escalate_human'], message);
    assert.equal(s.turns[0].handedTo, 'human', message);
  }
  for (const message of ['Someone recommended you to me', 'Can someone fix my lashes?', 'I talked to people at the gym about you', 'Is anyone there at 5pm?']) {
    const s = await runLabTurn(newLab('automatic'), { message });
    assert.ok(!s.turns[0].tools.some(x => x.name === 'escalate_human'), `${message}: no hand-off`);
    assert.equal(s.turns[0].handedTo, null, message);
  }
});

test('A-75: production-style wording hands off; ordinary sentences about people, staff or the team do not', async () => {
  const yes = ['I want a human', 'I need a human please', 'I need a representative', 'Put me through', 'Please transfer me', 'Connect me to someone', 'connect me with a staff member', 'Can I speak to a team member?', 'can I speak to someone', 'I want to talk to a representative', 'I would like a staff member to call'];
  for (const message of yes) {
    const s = await runLabTurn(newLab('automatic'), { message });
    assert.deepEqual(s.turns[0].tools.map(x => x.name), ['escalate_human'], message);
    assert.equal(s.turns[0].handedTo, 'human', message);
  }
  const no = ["I'll talk to people at the gym", 'I will talk to the team at my gym about it', 'My staff member quit last week', 'I have a team member who trains clients', 'The representative from my old gym was rude', 'I spoke to your staff yesterday', 'Please transfer the lease on my gym to my partner', 'People at the gym love it'];
  for (const message of no) {
    const s = await runLabTurn(newLab('automatic'), { message });
    assert.ok(!s.turns[0].tools.some(x => x.name === 'escalate_human'), `${message}: no hand-off`);
    assert.equal(s.turns[0].handedTo, null, message);
  }
});

test('oversized or tampered state is refused before the pipeline runs', async () => {
  const base = await runLabTurn(newLab('automatic'), { message: 'Hi, I run a gym in Perth.' });
  const tamper = (f: (s: LabState) => void) => { const s = structuredClone(base); f(s); return s; };
  const cases: [string, unknown][] = [
    ['not an object', 'nope'],
    ['oversize text', tamper(s => { s.tables.messages[0].body = 'x'.repeat(LAB_LIMITS.string + 1); })],
    ['oversize total', tamper(s => { s.tables.messages = Array.from({ length: LAB_LIMITS.messages }, () => ({ ...s.tables.messages[0], body: 'y'.repeat(3000) })); })],
    ['too many held actions', tamper(s => { s.pending = Array.from({ length: LAB_LIMITS.pending + 1 }, () => s.turns[0] as never); })],
    ['too many contacts', tamper(s => { s.tables.contacts = Array.from({ length: LAB_LIMITS.contacts + 1 }, () => s.tables.contacts[0]); })],
    ['bad lab phone', tamper(s => { s.phone = 'call me'; })],
    ['bad contact phone', tamper(s => { s.tables.contacts[0].phone = '0411'; })],
    ['unknown answer key', tamper(s => { s.tables.contacts[0].answers.budget = '1m'; })],
    ['__proto__ key', tamper(s => { s.tables.contacts[0].answers = JSON.parse('{"__proto__":{"polluted":"yes"}}'); })],
    ['bad mode', tamper(s => { (s as { mode: string }).mode = 'yolo'; })],
    ['missing tables', tamper(s => { delete (s as Partial<LabState>).tables; })],
  ];
  for (const [name, s] of cases) {
    assert.throws(() => checkedLab(s), /The lab state is not valid/, name);
    const r = await sendMessage(s as LabState, 'hello', 'automatic');
    assert.equal(r.state, null, name); assert.match(r.error ?? '', /not valid/, name);
    const d = await decideAction(s as LabState, '00000000-0000-4000-8000-000000000001', 'approve');
    assert.equal(d.state, null, name); assert.match(d.error ?? '', /not valid/, name);
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined, 'no prototype pollution');
  const ok = checkedLab(base);
  assert.notEqual(ok, base, 'returns a copy');
});

test('a conversation stops at 40 turns', async () => {
  const one = await runLabTurn(newLab('automatic'), { message: 'Hello' });
  const full = structuredClone(one);
  full.turns = Array.from({ length: LAB_LIMITS.turns }, (_, i) => ({ ...one.turns[0], n: i + 1, writes: [], tools: [] }));
  await assert.rejects(runLabTurn(full, { message: 'One more' }), /reached 40 messages/);
  const r = await sendMessage(full, 'One more', 'automatic');
  assert.equal(r.state, null); assert.match(r.error ?? '', /reached 40/);
  full.turns.push(full.turns[0]);
  assert.throws(() => checkedLab(full), /too many turns/);
});

test('sendMessage is scripted only: a client request for the real model is ignored and nothing reaches the network', async () => {
  const before = fetchAttempts.length;
  const send = sendMessage as unknown as (...a: unknown[]) => ReturnType<typeof sendMessage>;
  const r = await send(newLab('automatic'), 'Hi, I run a gym in Perth.', 'automatic', 'real', { llm: 'anthropic' });
  assert.equal(r.error, null);
  assert.equal(r.state?.turns[0].model, 'scripted');
  assert.deepEqual(r.state?.turns[0].tools.map(t => t.name), ['save_answers']);
  assert.equal(fetchAttempts.length, before, 'no network call');
  const bad = await send(newLab('automatic'), { toString: () => 'x' }, 'not-a-mode');
  assert.match(bad.error ?? '', /Type a message first/);
});

test('fo_save_details keeps only the config question ids (__proto__ and unknown keys ignored)', async () => {
  const s = await runLabTurn(newLab('automatic'), { message: 'Hello' });
  const db = labStore(s);
  const contact = s.tables.contacts[0].id;
  const r = await db.rpc('fo_save_details', { channel: LAB_AUTH.channel, channel_key: LAB_AUTH.key, contact, new_answers: JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":"x","budget":"1m","business":"Gym in Perth"}'), contact_name: null, contact_email: null, contact_phone: null }) as { answers: Record<string, string> };
  assert.deepEqual(Object.keys(r.answers), ['business']);
  assert.equal(r.answers.business, 'Gym in Perth');
  assert.equal(Object.getPrototypeOf(s.tables.contacts[0].answers), Object.prototype);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
