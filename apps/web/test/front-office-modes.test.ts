// Operating modes and the approval queue (task A-2): the shared permission check for every mode and action, the gate,
// and approve/reject/expire against the in-memory store (the database store is covered in front-office-modes-db.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const { decide, permissionActions, commitmentKinds } = await import('../lib/front-office/permissions.ts');
const { operatingModes, pendingActionKinds, permissionDecisions, parsePendingAction } = await import('../lib/front-office/contracts.ts');
const {
  approvePendingAction, rejectPendingAction, listPendingActions, expirePendingActions, gate, checkRequest,
  createMemoryPendingActionStore, createSupabasePendingActionStore, rowToPendingAction, PendingActionError,
} = await import('../lib/front-office/pending-actions.ts');
type Payload = import('../lib/front-office/contracts.ts').PendingActionPayload;
type Executor = import('../lib/front-office/pending-actions.ts').ActionExecutor;

const W = '11111111-1111-4111-8111-111111111111', OWNER = '22222222-2222-4222-8222-222222222222', STAFF = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444', B = '55555555-5555-4555-8555-555555555555';

const payloads: Record<string, Payload> = {
  book: { kind: 'book', start: '2030-01-07T01:00:00.000Z', end: '2030-01-07T01:45:00.000Z', timeZone: 'Australia/Sydney' },
  reschedule: { kind: 'reschedule', bookingId: B, start: '2030-01-08T01:00:00.000Z', end: '2030-01-08T01:45:00.000Z', timeZone: 'Australia/Sydney' },
  cancel: { kind: 'cancel', bookingId: B, reason: 'Away that week' },
  send: { kind: 'send', channel: 'sms', body: 'See you Tuesday at 10.', promptVersion: 'setter/confirm@1' },
  follow_up: { kind: 'follow_up', channel: 'email', body: 'Still keen on a trial?', promptVersion: 'setter/follow-up@1', step: 1 },
  transfer: { kind: 'transfer', reason: 'Caller asked for a person' },
};

// The rules from the task, written out once so the table below is checked against them and not against itself.
const expected: Record<string, Record<string, string>> = {
  automatic: { book: 'perform', reschedule: 'perform', cancel: 'perform', send: 'perform', follow_up: 'perform', transfer: 'perform', take_message: 'perform' },
  owner_approval: { book: 'hold_for_approval', reschedule: 'hold_for_approval', cancel: 'hold_for_approval', send: 'hold_for_approval', follow_up: 'hold_for_approval', transfer: 'perform', take_message: 'perform' },
  enquiry_only: { book: 'refuse', reschedule: 'refuse', cancel: 'refuse', send: 'refuse', follow_up: 'refuse', transfer: 'perform', take_message: 'perform' },
};

test('permissions: the action list is every pending kind plus take_message; commitments are the kinds minus transfer', () => {
  assert.deepEqual([...permissionActions], [...pendingActionKinds, 'take_message']);
  assert.deepEqual([...commitmentKinds], pendingActionKinds.filter(k => k !== 'transfer'));
  assert.deepEqual(Object.keys(expected), [...operatingModes]);
});

for (const mode of operatingModes) {
  for (const action of permissionActions) {
    test(`permissions: ${mode} x ${action} -> ${expected[mode][action]}`, () => {
      const p = decide(mode, action);
      assert.equal(p.decision, expected[mode][action]);
      assert.ok(permissionDecisions.includes(p.decision));
      assert.equal(p.mode, mode);
      assert.ok(p.reason.length > 10, 'a plain-English reason for the owner');
      if (p.decision === 'perform') assert.equal(p.say, '', 'nothing extra to tell the customer');
      else {
        assert.ok(p.say.length > 10, 'a line the AI can say to the customer');
        assert.doesNotMatch(p.say, /\b(I|we) (have |'ve )?(booked|cancelled|sent|moved|rescheduled)\b|\bis (booked|cancelled|moved)\b/i, 'never claims the action happened');
      }
      if (p.decision === 'hold_for_approval') assert.match(p.reason, /owner approval/);
      if (p.decision === 'refuse') assert.match(p.reason, /enquiry only/);
      assert.deepEqual(decide(mode, action), p, 'pure: same answer every time');
    });
  }
}

// Owner decision 2026-11-14 (A-14): the AI always transfers when someone asks for a person, in every mode.
for (const mode of operatingModes) {
  test(`permissions: transfer is performed in ${mode} (a request for a person is never blocked or held)`, () => {
    const p = decide(mode, 'transfer');
    assert.equal(p.decision, 'perform');
    assert.equal(p.say, '');
  });
}

test('permissions: unknown mode falls back to enquiry_only; unknown action is refused; never throws', () => {
  assert.equal(decide('yolo', 'book').decision, 'refuse');
  assert.equal(decide('yolo', 'book').mode, 'enquiry_only');
  assert.equal(decide(undefined, 'take_message').decision, 'perform');
  for (const a of ['delete', '', null, 42, { kind: 'book' }, 'take-message', 'BOOK']) assert.equal(decide('automatic', a).decision, 'refuse', String(a));
});

function store(mode: 'automatic' | 'owner_approval' | 'enquiry_only', extra: { owners?: string[]; now?: () => number } = {}) {
  let n = 0;
  const modes = { setter: mode, receptionist: mode };
  const s = createMemoryPendingActionStore({ workspaceId: W, modes: () => modes, newId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, '0')}`, ...extra });
  return { s, modes };
}
function recorder(result: { ok: boolean; note?: string } | Error = { ok: true, note: 'Booked in the calendar.' }) {
  const calls: Parameters<Executor>[0][] = [];
  const execute: Executor = async a => { calls.push(a); if (result instanceof Error) throw result; return result; };
  return { calls, execute };
}

for (const mode of operatingModes) {
  for (const action of permissionActions) {
    test(`gate: ${mode} x ${action} performs, holds or refuses, and only performs through the executor`, async () => {
      const { s } = store(mode);
      const { calls, execute } = recorder();
      const request = action === 'take_message' ? undefined : { payload: payloads[action], summary: `Test ${action}`, idempotencyKey: `test:${mode}:${action}`, contactId: C };
      const r = await gate({ store: s, product: 'receptionist', action, request, execute });
      assert.equal(r.decision, expected[mode][action]);
      if (r.decision === 'perform') {
        assert.equal(calls.length, 1); assert.equal(r.result.ok, true);
        assert.deepEqual(calls[0].payload, action === 'take_message' ? null : payloads[action]);
        assert.equal(s.items.length, 0);
      } else if (r.decision === 'hold_for_approval') {
        assert.equal(calls.length, 0, 'held, not performed');
        assert.equal(r.item.status, 'pending'); assert.equal(r.item.mode, 'owner_approval'); assert.equal(r.item.product, 'receptionist');
        assert.deepEqual(r.item.payload, payloads[action]);
        assert.ok(parsePendingAction(r.item).ok, 'item matches the contract');
      } else {
        assert.equal(calls.length, 0, 'refused, not performed'); assert.equal(s.items.length, 0);
      }
    });
  }
}

test('gate: the request must match the action; bad payloads are refused before anything happens', async () => {
  const { s } = store('owner_approval');
  const { calls, execute } = recorder();
  await assert.rejects(gate({ store: s, product: 'setter', action: 'book', request: { payload: payloads.cancel, summary: 'x', idempotencyKey: 'mismatch01' }, execute }), (e: unknown) => e instanceof PendingActionError && e.code === 'invalid');
  await assert.rejects(gate({ store: s, product: 'setter', action: 'book', execute }), /must match/);
  await assert.rejects(gate({ store: s, product: 'setter', action: 'book', request: { payload: { ...payloads.book, end: '2030-01-07T01:00:00.000Z' } as Payload, summary: 'x', idempotencyKey: 'badtimes01' }, execute }), /End must be after start/);
  const auto = store('automatic');
  await assert.rejects(gate({ store: auto.s, product: 'setter', action: 'send', request: { payload: { ...payloads.send, body: '' } as Payload, summary: 'x', idempotencyKey: 'emptybody1' }, execute }), /Body/);
  assert.equal(calls.length, 0); assert.equal(s.items.length, 0);
});

test('gate: an executor that throws is reported as failed with a safe note', async () => {
  const { s } = store('automatic');
  const r = await gate({ store: s, product: 'setter', action: 'book', request: { payload: payloads.book, summary: 'Book Sam', idempotencyKey: 'throws0001' }, execute: recorder(new Error('Google 500: token abc123')).execute });
  assert.equal(r.decision, 'perform');
  if (r.decision === 'perform') { assert.equal(r.result.ok, false); assert.doesNotMatch(String(r.result.note), /abc123|Google/); }
});

test('checkRequest: validates key, expiry, product, ids and summary with plain-English errors', () => {
  const ok = { product: 'setter', payload: payloads.book, summary: '  Book Sam for Tue 10:00  ', idempotencyKey: 'chat:msg-0001' };
  const r = checkRequest(ok);
  assert.equal(r.summary, 'Book Sam for Tue 10:00'); assert.equal(r.ttlMinutes, 1440); assert.equal(r.contactId, null);
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ ...ok, idempotencyKey: 'short' }, /Idempotency key/],
    [{ ...ok, idempotencyKey: 'has space 123' }, /Idempotency key/],
    [{ ...ok, ttlMinutes: 1 }, /Expiry/],
    [{ ...ok, ttlMinutes: 60 * 24 * 31 }, /Expiry/],
    [{ ...ok, product: 'sales' }, /Product/],
    [{ ...ok, contactId: 'nope' }, /Contact id/],
    [{ ...ok, summary: '' }, /Summary/],
    [{ ...ok, summary: 'x'.repeat(301) }, /Summary/],
    [{ ...ok, payload: { kind: 'delete' } }, /Action/],
  ];
  for (const [input, re] of bad) assert.throws(() => checkRequest(input), (e: unknown) => e instanceof PendingActionError && e.code === 'invalid' && re.test(e.message), JSON.stringify(input));
});

test('checkRequest: every kind\'s payload is fully checked by the contract parser before anything is stored', async () => {
  const bad: Record<string, Record<string, unknown>[]> = {
    book: [{ ...payloads.book, start: 'soon' }, { ...payloads.book, end: payloads.book.kind }, { ...payloads.book, timeZone: '' }],
    reschedule: [{ ...payloads.reschedule, bookingId: 'b1' }, { ...payloads.reschedule, end: '2030-01-08T00:00:00.000Z' }],
    cancel: [{ ...payloads.cancel, bookingId: null }, { ...payloads.cancel, reason: 'x'.repeat(401) }],
    send: [{ ...payloads.send, channel: 'whatsapp' }, { ...payloads.send, body: 'x'.repeat(1001) }, { ...payloads.send, promptVersion: '' }],
    follow_up: [{ ...payloads.follow_up, step: 0 }, { ...payloads.follow_up, step: 1.5 }, { ...payloads.follow_up, body: '' }],
    transfer: [{ ...payloads.transfer, reason: 7 }, { kind: 'transfer' }],
  };
  assert.deepEqual(Object.keys(bad), [...pendingActionKinds]);
  const { s } = store('owner_approval');
  let n = 0;
  for (const [kind, list] of Object.entries(bad)) for (const payload of list) {
    const req = { product: 'setter', payload, summary: `Bad ${kind}`, idempotencyKey: `bad:${kind}:${++n}xx` };
    assert.throws(() => checkRequest(req), (e: unknown) => e instanceof PendingActionError && e.code === 'invalid', JSON.stringify(payload));
    await assert.rejects(s.request(req as never), (e: unknown) => e instanceof PendingActionError && e.code === 'invalid');
  }
  assert.equal(s.items.length, 0, 'nothing stored');
  // Unknown extra fields are dropped: what is stored is exactly the parsed payload.
  const held = await s.request({ product: 'setter', payload: { ...payloads.cancel, extra: 'x' } as never, summary: 'Cancel', idempotencyKey: 'clean:cancel:1' });
  assert.deepEqual(held.item.payload, payloads.cancel);
});

test('gate: a mode change between reading the mode and holding is followed, never thrown', async () => {
  const raced = (after: 'automatic' | 'enquiry_only' | 'owner_approval') => {
    const { s } = store('owner_approval');
    let reads = 0;
    const wrapped = { ...s, mode: async () => (reads++ === 0 ? 'owner_approval' : after) as never, request: async () => { throw new PendingActionError('not_allowed', 'Not in owner approval mode.'); } };
    return wrapped;
  };
  const req = { payload: payloads.book, summary: 'Book Sam', idempotencyKey: 'race:mode:0001' };
  const toAuto = recorder();
  const a = await gate({ store: raced('automatic'), product: 'setter', action: 'book', request: req, execute: toAuto.execute });
  assert.equal(a.decision, 'perform'); assert.equal(toAuto.calls.length, 1, 'now automatic: performed once');
  assert.equal(a.permission.mode, 'automatic');
  const toEnquiry = recorder();
  const b = await gate({ store: raced('enquiry_only'), product: 'setter', action: 'book', request: req, execute: toEnquiry.execute });
  assert.equal(b.decision, 'refuse'); assert.equal(toEnquiry.calls.length, 0);
  const stuck = recorder();
  const c = await gate({ store: raced('owner_approval'), product: 'setter', action: 'book', request: req, execute: stuck.execute });
  assert.equal(c.decision, 'refuse'); assert.match(c.permission.reason, /mode changed/); assert.ok(c.permission.say.length > 10);
  assert.equal(stuck.calls.length, 0);
  // Other errors are not swallowed.
  const { s } = store('owner_approval');
  const broken = { ...s, request: async () => { throw new PendingActionError('unavailable', 'The approval queue is not available right now.'); } };
  await assert.rejects(gate({ store: broken, product: 'setter', action: 'book', request: req, execute: stuck.execute }), (e: unknown) => e instanceof PendingActionError && e.code === 'unavailable');
});

test('queue: an approved item whose stored payload is not valid is closed as failed and never performed', async () => {
  const { s } = store('owner_approval');
  const { item } = await s.request({ product: 'setter', payload: payloads.book, summary: 'Book Sam', idempotencyKey: 'tamper:book:01' });
  s.items[0].payload = { kind: 'book', start: 'whenever' } as never; // as if written around checkRequest
  const { calls, execute } = recorder();
  const r = await approvePendingAction(s, item.id, OWNER, execute);
  assert.equal(r.outcome, 'failed'); assert.equal(r.item.status, 'failed'); assert.match(String(r.item.note), /not valid/);
  assert.equal(calls.length, 0);
  assert.equal((await approvePendingAction(s, item.id, OWNER, execute)).outcome, 'already_decided');
});

test('queue: held only in owner_approval; a retried request returns the same item', async () => {
  const { s, modes } = store('owner_approval');
  const req = { product: 'setter' as const, payload: payloads.send, summary: 'Confirm Tuesday by SMS', idempotencyKey: 'sms:SM0001:confirm', contactId: C };
  const a = await s.request(req);
  const b = await s.request(req);
  assert.equal(a.created, true); assert.equal(b.created, false); assert.equal(a.item.id, b.item.id); assert.equal(s.items.length, 1);
  modes.setter = 'automatic';
  await assert.rejects(s.request({ ...req, idempotencyKey: 'sms:SM0002:confirm' }), (e: unknown) => e instanceof PendingActionError && e.code === 'not_allowed');
  modes.setter = 'enquiry_only';
  await assert.rejects(s.request({ ...req, idempotencyKey: 'sms:SM0003:confirm' }), /owner approval/);
  assert.equal((await listPendingActions(s, { status: 'pending' })).length, 1, 'switching mode changes nothing already held');
});

test('queue: approving performs the original action exactly once; a second approve is a no-op with the same result', async () => {
  const { s } = store('owner_approval', { owners: [OWNER] });
  const { item } = await s.request({ product: 'receptionist', payload: payloads.reschedule, summary: 'Move Sam to Wed 10:00', idempotencyKey: 'vapi:call1:resched', contactId: C });
  const { calls, execute } = recorder({ ok: true, note: 'Moved in the calendar.' });
  const first = await approvePendingAction(s, item.id, OWNER, execute, 'Fine by me');
  assert.equal(first.outcome, 'performed'); assert.equal(first.item.status, 'performed');
  assert.equal(first.item.decidedBy, OWNER); assert.ok(first.item.decidedAt); assert.ok(first.item.committedAt);
  assert.equal(first.item.note, 'Moved in the calendar.');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { product: 'receptionist', payload: payloads.reschedule, contactId: C, callId: null, channelId: null, pendingActionId: item.id });
  const second = await approvePendingAction(s, item.id, OWNER, execute);
  assert.equal(second.outcome, 'already_decided'); assert.deepEqual(second.item, first.item, 'same result');
  assert.equal(calls.length, 1, 'not performed again');
  assert.equal((await rejectPendingAction(s, item.id, OWNER)).outcome, 'already_decided', 'cannot reject after approval');
  assert.ok(parsePendingAction(second.item).ok);
});

test('queue: concurrent approvals perform once', async () => {
  const { s } = store('owner_approval');
  const { item } = await s.request({ product: 'setter', payload: payloads.book, summary: 'Book Sam', idempotencyKey: 'race:book:0001' });
  const { calls, execute } = recorder();
  const results = await Promise.all([1, 2, 3, 4].map(() => approvePendingAction(s, item.id, OWNER, execute)));
  assert.equal(calls.length, 1);
  assert.deepEqual(results.map(r => r.outcome).sort(), ['already_decided', 'already_decided', 'already_decided', 'performed']);
});

test('queue: a failing executor marks the item failed (once, safe note); it is not retried by a second approve', async () => {
  const { s } = store('owner_approval');
  const { item } = await s.request({ product: 'setter', payload: payloads.follow_up, summary: 'Follow up Sam', idempotencyKey: 'job:fu:0001' });
  const { calls, execute } = recorder(new Error('Postmark 422 secret-token'));
  const r = await approvePendingAction(s, item.id, OWNER, execute);
  assert.equal(r.outcome, 'failed'); assert.equal(r.item.status, 'failed'); assert.equal(r.item.committedAt, null);
  assert.doesNotMatch(String(r.item.note), /secret|Postmark/);
  assert.equal((await approvePendingAction(s, item.id, OWNER, execute)).outcome, 'already_decided');
  assert.equal(calls.length, 1);
  const soft = await s.request({ product: 'setter', payload: payloads.send, summary: 'Send', idempotencyKey: 'job:send:0002' });
  const r2 = await approvePendingAction(s, soft.item.id, OWNER, recorder({ ok: false, note: 'Contact opted out.' }).execute);
  assert.equal(r2.outcome, 'failed'); assert.equal(r2.item.note, 'Contact opted out.');
});

test('queue: rejected and expired items never reach the executor', async () => {
  let t = Date.parse('2030-01-01T00:00:00Z');
  const { s } = store('owner_approval', { now: () => t });
  const { calls, execute } = recorder();
  const a = await s.request({ product: 'setter', payload: payloads.cancel, summary: 'Cancel Sam', idempotencyKey: 'rej:cancel:01' });
  const rej = await rejectPendingAction(s, a.item.id, OWNER, 'Keep the booking');
  assert.equal(rej.outcome, 'rejected'); assert.equal(rej.item.note, 'Keep the booking');
  assert.equal((await approvePendingAction(s, a.item.id, OWNER, execute)).outcome, 'already_decided');
  assert.equal((await rejectPendingAction(s, a.item.id, OWNER)).outcome, 'already_decided');

  const b = await s.request({ product: 'setter', payload: payloads.book, summary: 'Book Sam', idempotencyKey: 'exp:book:0001', ttlMinutes: 30 });
  const c = await s.request({ product: 'setter', payload: payloads.book, summary: 'Book Jo', idempotencyKey: 'exp:book:0002', ttlMinutes: 30 });
  t += 31 * 60_000;
  const late = await approvePendingAction(s, b.item.id, OWNER, execute);
  assert.equal(late.outcome, 'expired'); assert.equal(late.item.status, 'expired'); assert.ok(late.item.decidedAt);
  assert.equal(await expirePendingActions(s), 1, 'the sweep expires the other one');
  assert.equal((await rejectPendingAction(s, c.item.id, OWNER)).outcome, 'expired');
  assert.equal((await approvePendingAction(s, c.item.id, OWNER, execute)).outcome, 'expired');
  assert.equal(calls.length, 0);
  assert.deepEqual((await listPendingActions(s)).map(x => x.status), ['expired', 'expired', 'rejected'], 'newest first');
});

test('queue: only listed owners decide; unknown ids and bad ids are safe errors', async () => {
  const { s } = store('owner_approval', { owners: [OWNER] });
  const { item } = await s.request({ product: 'setter', payload: payloads.book, summary: 'Book Sam', idempotencyKey: 'own:book:0001' });
  const { calls, execute } = recorder();
  await assert.rejects(approvePendingAction(s, item.id, STAFF, execute), (e: unknown) => e instanceof PendingActionError && e.code === 'forbidden');
  await assert.rejects(rejectPendingAction(s, item.id, STAFF), /Owner access/);
  await assert.rejects(approvePendingAction(s, B, OWNER, execute), (e: unknown) => e instanceof PendingActionError && e.code === 'not_found');
  await assert.rejects(approvePendingAction(s, 'not-an-id', OWNER, execute), (e: unknown) => e instanceof PendingActionError && e.code === 'invalid');
  assert.equal(calls.length, 0);
  assert.equal((await s.finish(item.id, true, null).catch((e: InstanceType<typeof PendingActionError>) => e.code)), 'conflict', 'cannot finish an item nobody approved');
});

test('supabase store: maps rows to the contract, calls the right RPCs and hides database errors', async () => {
  const row = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', workspace_id: W, product: 'setter', kind: 'book', contact_id: C, call_id: null, channel_id: B,
    mode: 'owner_approval', payload: payloads.book, summary: 'Book Sam', status: 'pending', idempotency_key: 'chat:1234567',
    created_at: '2030-01-01T00:00:00.123456+00:00', expires_at: '2030-01-02T00:00:00+00:00', decided_at: null, decided_by: null, committed_at: null, note: null,
  };
  const mapped = rowToPendingAction(row);
  assert.equal(mapped.workspaceId, W); assert.equal(mapped.channelId, B); assert.equal(mapped.createdAt, '2030-01-01T00:00:00.123Z');
  assert.throws(() => rowToPendingAction({ ...row, status: 'weird' }), (e: unknown) => e instanceof PendingActionError && e.code === 'unavailable');

  const seen: [string, Record<string, unknown>][] = [];
  let fail: string | null = null;
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    seen.push([fn, args]);
    if (fail) throw new Error(fail);
    if (fn === 'fo_channel_modes') return { setter: 'owner_approval', receptionist: 'bogus' };
    if (fn === 'fo_request_action') return { item: row, created: true };
    if (fn === 'fo_decide_action') return { item: { ...row, status: 'approved', decided_at: '2030-01-01T01:00:00Z', decided_by: OWNER }, changed: true };
    if (fn === 'fo_finish_action') return { item: { ...row, status: 'performed', decided_at: '2030-01-01T01:00:00Z', decided_by: OWNER, committed_at: '2030-01-01T01:00:01Z', note: 'Done.' }, changed: true };
    if (fn === 'fo_expire_actions') return 0;
    if (fn === 'fo_list_actions') return [row];
    return null;
  };
  const hook = createSupabasePendingActionStore({ rpc, channel: { id: B, key: 'k'.repeat(40) } });
  assert.equal(await hook.mode('setter'), 'owner_approval');
  assert.equal(await hook.mode('receptionist'), 'enquiry_only', 'unknown value read as the safe default');
  const held = await hook.request({ product: 'setter', payload: payloads.book, summary: 'Book Sam', idempotencyKey: 'chat:1234567', contactId: C });
  assert.equal(held.created, true); assert.equal(held.item.id, row.id);
  assert.deepEqual(seen.at(-1), ['fo_request_action', { channel: B, channel_key: 'k'.repeat(40), product_name: 'setter', contact: C, call: null, action_payload: payloads.book, action_summary: 'Book Sam', idem_key: 'chat:1234567', ttl_minutes: 1440 }]);
  await assert.rejects(hook.list(), (e: unknown) => e instanceof PendingActionError && e.code === 'forbidden', 'a webhook store has no workspace session');

  const owner = createSupabasePendingActionStore({ rpc, workspaceId: W });
  assert.equal((await owner.list({ status: 'pending' })).length, 1);
  const { calls, execute } = recorder();
  const r = await approvePendingAction(owner, row.id, OWNER, execute);
  assert.equal(r.outcome, 'performed'); assert.equal(calls.length, 1); assert.equal(calls[0].channelId, B);
  assert.deepEqual(seen.slice(-2).map(x => x[0]), ['fo_decide_action', 'fo_finish_action']);

  for (const [message, code] of [['Not in owner approval mode.', 'not_allowed'], ['Owner access required.', 'forbidden'], ['Action not found.', 'not_found'],
    ['new row violates check constraint "x"', 'invalid'], ['connection refused at 10.0.0.1 password=hunter2', 'unavailable']] as const) {
    fail = message;
    await assert.rejects(owner.decide(row.id, 'approve', OWNER, null), (e: unknown) => e instanceof PendingActionError && e.code === code && !/10\.0\.0\.1|hunter2|constraint "x"/.test(e.message), message);
  }
});

test('supabase store: an approved row that cannot be read is closed as failed, never left approved or performed', async () => {
  const base = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009', workspace_id: W, product: 'setter', kind: 'book', contact_id: null, call_id: null, channel_id: null,
    mode: 'owner_approval', summary: 'Book Sam', idempotency_key: 'chat:9999999', created_at: '2030-01-01T00:00:00Z', expires_at: '2030-01-02T00:00:00Z',
    decided_by: OWNER, note: null,
  };
  const approved = { ...base, status: 'approved', decided_at: '2030-01-01T01:00:00Z', committed_at: null };
  const make = (decided: Record<string, unknown>) => {
    const seen: [string, Record<string, unknown>][] = [];
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      seen.push([fn, args]);
      if (fn === 'fo_decide_action') return { item: decided, changed: true };
      if (fn === 'fo_finish_action') return { item: { ...decided, status: 'failed', note: args.result_note }, changed: true };
      return null;
    };
    return { seen, store: createSupabasePendingActionStore({ rpc, workspaceId: W }) };
  };
  // Payload is the only problem: mapped as invalid, closed as failed through the normal path.
  const badPayload = { ...approved, payload: { kind: 'book', start: 'whenever' } };
  assert.equal(rowToPendingAction(badPayload).invalid, true);
  assert.equal(rowToPendingAction({ ...badPayload, payload: payloads.book }).invalid, false);
  const one = make(badPayload);
  const { calls, execute } = recorder();
  const r = await approvePendingAction(one.store, base.id, OWNER, execute);
  assert.equal(r.outcome, 'failed'); assert.equal(r.item.status, 'failed'); assert.equal(calls.length, 0);
  assert.deepEqual(one.seen.at(-1), ['fo_finish_action', { action: base.id, succeeded: false, result_note: 'The held action was not valid, so it was not performed.' }]);
  // Something else is unreadable: still closed as failed, and the caller gets a safe error.
  const two = make({ ...approved, payload: payloads.book, summary: '' });
  await assert.rejects(approvePendingAction(two.store, base.id, OWNER, execute), (e: unknown) => e instanceof PendingActionError && e.code === 'unavailable');
  assert.deepEqual(two.seen.map(x => x[0]), ['fo_decide_action', 'fo_finish_action']);
  assert.equal(two.seen[1][1].succeeded, false);
  assert.equal(calls.length, 0);
});
