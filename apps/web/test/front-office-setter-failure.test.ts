// A-55 (gap G2): the Setter recovers from a model/API failure. When the model call throws (provider error, timeout) or
// returns a malformed response, the contact gets the fixed fallback reply (never AI text), the lead is handed to a person
// the same way escalate_human does, nothing is booked, no follow-up starts, and only a safe code is logged or returned.
// Scripted models and the in-memory store only; global fetch trapped; nothing sent.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const h = await import('./helpers/front-office-scenarios.ts');
const { tool, say, lead, agentSetup, CID } = h;
const { runSetterTurn, modelFailureCode, SETTER_FALLBACK_REPLY, SETTER_FALLBACK_PROMPT } = await import('../lib/front-office/setter/agent.ts');
const { anthropicLlm } = await import('../lib/front-office/llm.ts');
type Llm = import('../lib/front-office/llm.ts').Llm;
type Mode = import('../lib/front-office/contracts.ts').OperatingMode;

const trap = h.trapFetch();
before(() => trap.install());
after(() => { trap.restore(); assert.deepEqual(trap.attempts, [], 'no network calls'); });

const MODES: Mode[] = ['automatic', 'owner_approval', 'enquiry_only'];
const SECRET = 'sk-ant-fake-A55-SECRET-do-not-leak';

/** Captures console output for the duration of fn. */
async function quiet<T>(fn: () => Promise<T>): Promise<{ value: T; logged: string[] }> {
  const logged: string[] = [];
  const keep = { warn: console.warn, error: console.error, log: console.log, info: console.info };
  const grab = (...x: unknown[]) => { logged.push(x.map(v => v instanceof Error ? `${v.name}: ${v.message} ${v.stack ?? ''}` : typeof v === 'string' ? v : JSON.stringify(v)).join(' ')); };
  console.warn = grab; console.error = grab; console.log = grab; console.info = grab;
  try { return { value: await fn(), logged }; } finally { Object.assign(console, keep); }
}
const throwing = (e: unknown): Llm => async () => { throw e; };

test('model throws, every mode: fixed fallback reply, one human handoff via transfer, no booking, no state change, no follow-up', async () => {
  for (const mode of MODES) {
    const a = agentSetup(mode);
    const { value: turn, logged } = await quiet(() => runSetterTurn(CID, a.deps(throwing(new Error('AI provider error (500).')))));
    assert.equal(turn.reply, SETTER_FALLBACK_REPLY, mode);
    assert.equal(turn.modelFailure, 'provider_500');
    assert.equal(turn.handedTo, 'human');
    assert.deepEqual(turn.actions.map(x => [x.action, x.decision]), [['transfer', 'perform']], 'the escalate_human path: one transfer through the permission check');
    assert.equal(a.db.handoffs.length, 1);
    const ho = a.db.handoffs[0] as { owner: string; from: string; contact: { id: string } };
    assert.equal(ho.owner, 'human'); assert.equal(ho.from, 'setter'); assert.equal(ho.contact.id, CID);
    assert.deepEqual(a.db.outbound, [{ message: SETTER_FALLBACK_REPLY, prompt: SETTER_FALLBACK_PROMPT }]);
    assert.equal(turn.booked, false); assert.equal(a.db.appointment, null); assert.equal(a.calendar.events.length, 0);
    assert.equal(a.db.contact.state, 'qualified'); assert.equal(turn.state, 'qualified'); assert.deepEqual(turn.transitions, []);
    assert.equal(a.db.jobs.length, 0, 'no follow-up ladder'); assert.equal(a.pending.items.length, 0); assert.deepEqual(turn.pendingActionIds, []);
    assert.equal(a.sent.length, 0, 'the route sends the reply; the turn sends nothing itself');
    assert.deepEqual(logged.filter(l => l.includes('provider_500')).length, 1, 'logged once, by code');
  }
});

test('a later message after the fallback: the person owns the lead, so the AI stays silent and the model is not called', async () => {
  const a = agentSetup('automatic');
  await quiet(() => runSetterTurn(CID, a.deps(throwing(new Error('AI provider error (503).')))));
  a.db.messages.push({ direction: 'inbound', body: 'Hello?' } as never);
  let calls = 0;
  const turn = await runSetterTurn(CID, a.deps(async () => { calls++; return { content: [say('Hi')], stopReason: 'end_turn' }; }));
  assert.equal(turn.reply, null); assert.equal(calls, 0); assert.equal(a.db.outbound.length, 1);
});

test('timeout, malformed response and an unknown error are each caught with a safe code', async () => {
  const cases: [Llm, string][] = [
    [throwing(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), 'timeout'],
    [async () => ({ content: undefined, stopReason: 'end_turn' }) as never, 'malformed_response'],
    [async () => null as never, 'malformed_response'],
    [throwing(new TypeError(`fetch failed: connect ECONNREFUSED key=${SECRET}`)), 'model_error'],
    [throwing('a string, not an Error'), 'model_error'],
  ];
  for (const [llm, code] of cases) {
    const a = agentSetup('owner_approval');
    const { value: turn, logged } = await quiet(() => runSetterTurn(CID, a.deps(llm)));
    assert.equal(turn.modelFailure, code); assert.equal(turn.reply, SETTER_FALLBACK_REPLY);
    assert.deepEqual(a.db.handoffs.map(x => (x as { owner: string }).owner), ['human']);
    assert.equal(a.db.appointment, null); assert.equal(a.db.jobs.length, 0);
    assert.ok(!JSON.stringify({ turn, logged, db: a.db }).includes(SECRET), `no secret for ${code}`);
    assert.ok(!logged.join('\n').includes('ECONNREFUSED'), 'the error message itself is not logged');
  }
  assert.equal(modelFailureCode(new Error('AI provider error (stream).')), 'provider_stream');
  assert.equal(modelFailureCode(new Error('AI provider error (429).')), 'provider_429');
  assert.equal(modelFailureCode(new Error(`AI provider error (500). ${SECRET}`)), 'model_error', 'only the exact adapter message maps to a status');
});

test('malformed content blocks inside the content array lead to the fallback reply, not a failed turn', async () => {
  const bad: unknown[][] = [
    [null], [undefined], ['just a string'], [42], [{}], [{ type: 7 }], [{ type: 'text' }], [{ type: 'text', text: 5 }],
    [{ type: 'tool_use', name: 'save_answers', input: {} }], [{ type: 'tool_use', id: 't1', input: {} }],
    [say('Fine so far'), null],
  ];
  for (const content of bad) {
    for (const mode of MODES) {
      const a = agentSetup(mode);
      const { value: turn } = await quiet(() => runSetterTurn(CID, a.deps((async () => ({ content, stopReason: 'end_turn' })) as never)));
      assert.equal(turn.reply, SETTER_FALLBACK_REPLY, `${mode} ${JSON.stringify(content)}`);
      assert.equal(turn.modelFailure, 'malformed_response');
      assert.deepEqual(a.db.handoffs.map(x => (x as { owner: string }).owner), ['human']);
      assert.deepEqual(a.db.outbound, [{ message: SETTER_FALLBACK_REPLY, prompt: SETTER_FALLBACK_PROMPT }]);
      assert.equal(a.db.appointment, null); assert.equal(a.pending.items.length, 0);
    }
  }
});

test('the fallback hand-off is never held or refused in any mode (A-14): the transfer is performed, so ignoring toPerson is safe', async () => {
  for (const mode of MODES) {
    const a = agentSetup(mode);
    const { value: turn } = await quiet(() => runSetterTurn(CID, a.deps(throwing(new Error('AI provider error (500).')))));
    const transfers = turn.actions.filter(x => x.action === 'transfer');
    assert.deepEqual(transfers.map(x => x.decision), ['perform'], mode);
    assert.equal(a.pending.items.length, 0, `${mode}: nothing held for approval`);
    assert.equal(turn.handedTo, 'human'); assert.equal(turn.reply, SETTER_FALLBACK_REPLY);
  }
});

test('the real Anthropic adapter against a 401 whose body echoes the key: no key or body in the turn or the logs', async () => {
  const a = agentSetup('automatic');
  const fake401 = (async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${SECRET}` } }), { status: 401 })) as unknown as typeof fetch;
  const { value: turn, logged } = await quiet(() => runSetterTurn(CID, a.deps(anthropicLlm({ apiKey: SECRET, model: 'test-model' }, fake401))));
  assert.equal(turn.reply, SETTER_FALLBACK_REPLY); assert.equal(turn.modelFailure, 'provider_401');
  const everything = JSON.stringify({ turn, logged, db: a.db });
  assert.ok(!everything.includes(SECRET), 'no key'); assert.ok(!everything.includes('x-api-key'), 'no provider body');
  assert.ok(!everything.includes('authentication_error'), 'no provider error type');
});

test('failure after tools ran: earlier escalate_human is not recorded twice; offer_times never becomes a booking', async () => {
  // Round 1 escalates (automatic: transfer performs, no forced reply, so the loop asks the model again); round 2 fails.
  const a = agentSetup('automatic');
  let n = 0;
  const escalateThenFail: Llm = async () => { if (n++ === 0) return { content: [tool('escalate_human', { intent: 'refund', summary: 'Wants a refund' })], stopReason: 'tool_use' }; throw new Error('AI provider error (529).'); };
  const { value: t1 } = await quiet(() => runSetterTurn(CID, a.deps(escalateThenFail)));
  assert.equal(t1.reply, SETTER_FALLBACK_REPLY); assert.equal(t1.modelFailure, 'provider_529');
  assert.equal(a.db.handoffs.length, 1, 'one hand-off, not two');
  assert.equal((a.db.handoffs[0] as { intent: string }).intent, 'refund');

  // Round 1 offers times; round 2 (which would book) fails: nothing booked, no calendar event, no booked wording.
  const b = agentSetup('automatic');
  let m = 0;
  const offerThenFail: Llm = async () => { if (m++ === 0) return { content: [tool('offer_times')], stopReason: 'tool_use' }; throw new Error('AI provider error (500).'); };
  const { value: t2 } = await quiet(() => runSetterTurn(CID, b.deps(offerThenFail)));
  assert.deepEqual(t2.tools, ['offer_times']);
  assert.equal(t2.booked, false); assert.equal(b.db.appointment, null); assert.equal(b.calendar.events.length, 0);
  assert.notEqual(b.db.contact.state, 'booked'); assert.equal(t2.reply, SETTER_FALLBACK_REPLY);
  h.assertNoFalseBooking([t2.reply], []);
  assert.deepEqual(b.db.handoffs.map(x => (x as { owner: string }).owner), ['human']);
});

test('without the permission check (lab, demo): fallback and handoff still happen, and no follow-up is started', async () => {
  const a = agentSetup('automatic', lead('qualifying'));
  const { value: turn } = await quiet(() => runSetterTurn(CID, a.deps(throwing(new Error('AI provider error (500).')), { permissions: undefined })));
  assert.equal(turn.reply, SETTER_FALLBACK_REPLY); assert.equal(turn.handedTo, 'human');
  assert.deepEqual(a.db.handoffs.map(x => (x as { owner: string }).owner), ['human']);
  assert.equal(a.db.jobs.length, 0, 'the pre-A-8 path would start follow-ups after a reply; the fallback does not');
  assert.equal(a.db.contact.state, 'qualifying');
});

test('logReply false (social DMs): the fallback is returned for the approval queue and not logged by the turn', async () => {
  const a = agentSetup('automatic');
  const { value: turn } = await quiet(() => runSetterTurn(CID, a.deps(throwing(new Error('AI provider error (500).')), { channel: 'instagram', logReply: false })));
  assert.equal(turn.reply, SETTER_FALLBACK_REPLY); assert.equal(a.db.outbound.length, 0);
  assert.deepEqual(a.db.handoffs.map(x => (x as { owner: string }).owner), ['human']);
});

test('a working model is unchanged: no modelFailure field, the model text is the reply', async () => {
  const a = agentSetup('automatic');
  const turn = await runSetterTurn(CID, a.deps(async () => ({ content: [say('Would Tuesday suit you?')], stopReason: 'end_turn' })));
  assert.equal(turn.reply, 'Would Tuesday suit you?'); assert.equal('modelFailure' in turn, false);
  assert.equal(a.db.handoffs.length, 0); assert.notEqual(a.db.outbound[0]?.prompt, SETTER_FALLBACK_PROMPT);
});
