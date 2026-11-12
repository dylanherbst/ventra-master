// Front Office Lab page (task A-27): the cross-channel check (recognition only after the A-20 identity check) and the
// server overview (DEMO/LIVE, needs-local-Supabase, no fake data). No network, no database: every read is an injected fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const { crossChannelCheck, modeLabel, usageLine, isSetterQualified } = await import('../app/tools/front-office-lab/check.ts');
const o = await import('../app/tools/front-office-lab/overview.ts');
const { contactFromRow } = await import('../lib/front-office/crm.ts');
type Contact = NonNullable<ReturnType<typeof contactFromRow>>;

const WS = '11111111-1111-4111-8111-111111111111';
const row = (over: Record<string, unknown> = {}) => ({
  id: '22222222-2222-4222-8222-222222222222', workspace_id: WS, name: 'Priya Shah', phone: '+61412345678', email: 'priya@example.com',
  state: 'qualified', source: 'inbound', answers: {}, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z', ...over,
});
const contact = (over: Record<string, unknown> = {}): Contact => { const c = contactFromRow(row(over)); assert.ok(c); return c; };

test('a matching number alone does not recognise the caller: identity check required', () => {
  const r = crossChannelCheck({ phone: '0412 345 678' }, [contact()]);
  assert.equal(r.status, 'needs_identity');
  assert.equal(r.recognised, false);
  assert.equal(r.identityRequired, true);
  assert.equal(r.contact, null, 'nothing about the person is shown before the identity check');
  assert.match(r.message, /spoofed|ask for the name/i);
});

test('a wrong name is refused and reveals nothing', () => {
  const r = crossChannelCheck({ phone: '0412345678', verifyName: 'Someone Else' }, [contact()]);
  assert.equal(r.status, 'identity_failed');
  assert.equal(r.recognised, false);
  assert.equal(r.contact, null);
});

test('the right name after the number match recognises a Setter-qualified contact', () => {
  const r = crossChannelCheck({ phone: '+61 412 345 678', verifyName: 'priya shah' }, [contact()]);
  assert.equal(r.status, 'recognised');
  assert.equal(r.recognised, true);
  assert.deepEqual(r.contact, { name: 'Priya Shah', state: 'qualified', setterQualified: true });
});

test('first name alone passes (A-20 rule); a different surname does not', () => {
  assert.equal(crossChannelCheck({ phone: '0412345678', verifyName: 'Priya' }, [contact()]).status, 'recognised');
  assert.equal(crossChannelCheck({ phone: '0412345678', verifyName: 'Priya Jones' }, [contact()]).status, 'identity_failed');
});

test('recognised by email too; a contact not yet qualified is recognised but flagged', () => {
  const r = crossChannelCheck({ email: 'PRIYA@example.com', verifyName: 'Priya Shah' }, [contact({ state: 'new' })]);
  assert.equal(r.status, 'recognised');
  assert.equal(r.contact?.setterQualified, false);
});

test('unknown number, unreadable input and a record with no name are all handled without recognition', () => {
  assert.equal(crossChannelCheck({ phone: '0499 111 222', verifyName: 'Priya' }, [contact()]).status, 'not_found');
  assert.equal(crossChannelCheck({}, [contact()]).status, 'bad_input');
  assert.equal(crossChannelCheck({ phone: '1300 123 456' }, [contact()]).status, 'bad_input');
  assert.equal(crossChannelCheck({ phone: '0412345678', verifyName: 'Priya' }, [contact({ name: null })]).recognised, false);
});

test('records of another workspace are not blended: duplicates collapse to one person', () => {
  const dup = contact({ id: '33333333-3333-4333-8333-333333333333', created_at: '2026-11-02T00:00:00.000Z', email: null });
  const r = crossChannelCheck({ phone: '0412345678', verifyName: 'Priya Shah' }, [contact(), dup]);
  assert.equal(r.matches, 1);
  assert.equal(r.status, 'recognised');
});

test('helpers: mode labels, Setter-qualified states, usage line', () => {
  assert.equal(modeLabel('automatic'), 'Automatic');
  assert.equal(modeLabel('owner_approval'), 'Owner approval');
  assert.equal(modeLabel('enquiry_only'), 'Enquiry only');
  assert.equal(modeLabel('nonsense'), 'Enquiry only');
  assert.equal(isSetterQualified({ state: 'qualified' }), true);
  assert.equal(isSetterQualified({ state: 'new' }), false);
  assert.match(usageLine({ spentAud: 1.234, capAud: 5, day: '2026-11-13', persistent: false }), /A\$1\.23 of A\$5\.00 .*memory/);
});

const usage = async () => ({ day: '2026-11-13', timeZone: 'Australia/Perth' as const, spentAud: 0, capAud: 5, remainingAud: 5, estimate: true as const, persistent: false, note: '' });
const q = { workspace: WS, phone: '0412345678', email: '', verifyName: '' };

test('overview without Supabase: DEMO badge, needs-local-Supabase state, no data, no reads', async () => {
  let reads = 0;
  const r = await o.loadLabOverview('tok', q, { configured: () => false, usage, modes: async () => { reads++; throw new Error('no'); }, contacts: async () => { reads++; return []; } });
  assert.equal(r.badge, 'DEMO');
  assert.equal(r.supabase, 'needs_local_supabase');
  assert.equal(r.blocked, o.NEEDS_LOCAL_SUPABASE);
  assert.equal(r.modes, null);
  assert.equal(r.check, null);
  assert.equal(reads, 0);
  assert.ok(r.usage, 'lab usage is still shown');
});

test('overview signed out, bad workspace, and non-member are blocked, not faked', async () => {
  const base = { configured: () => true, usage };
  const out = await o.loadLabOverview(undefined, q, { ...base, verify: async () => ({ error: 'Sign in' }) });
  assert.equal(out.session, 'signed_out'); assert.equal(out.badge, 'DEMO'); assert.equal(out.modes, null);
  const signed = { ...base, verify: async () => ({ error: null, userId: 'u1' }) };
  assert.equal((await o.loadLabOverview('tok', { ...q, workspace: 'nope' }, signed)).blocked, o.NEEDS_WORKSPACE);
  assert.equal((await o.loadLabOverview('tok', q, { ...signed, isMember: async () => false })).blocked, o.NO_ACCESS);
});

test('overview LIVE: real modes and the identity check run on the stored rows', async () => {
  const deps = {
    configured: () => true, usage, verify: async () => ({ error: null, userId: 'u1' }), isMember: async () => true,
    modes: async () => ({ setter: 'owner_approval' as const, receptionist: 'enquiry_only' as const }),
    contacts: async () => [row(), row({ workspace_id: '99999999-9999-4999-8999-999999999999', id: '44444444-4444-4444-8444-444444444444' })],
  };
  const without = await o.loadLabOverview('tok', q, deps);
  assert.equal(without.badge, 'LIVE');
  assert.deepEqual(without.modes, { setter: 'owner_approval', receptionist: 'enquiry_only' });
  assert.equal(without.check?.recognised, false, 'refused without the identity check');
  assert.equal(without.check?.status, 'needs_identity');
  const withName = await o.loadLabOverview('tok', { ...q, verifyName: 'Priya Shah' }, deps);
  assert.equal(withName.check?.recognised, true, 'allowed after the identity check');
});

test('overview: a database failure is a plain message, never a thrown error or invented data', async () => {
  const r = await o.loadLabOverview('tok', q, { configured: () => true, usage, verify: async () => ({ error: null, userId: 'u1' }), isMember: async () => { throw new Error('boom secret'); } });
  assert.equal(r.blocked, o.READ_FAILED);
  assert.equal(r.badge, 'DEMO');
  assert.equal(JSON.stringify(r).includes('boom'), false);
});
