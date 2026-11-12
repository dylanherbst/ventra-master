// A-77: the withheld-caller placeholder contact has an @call.invalid address. Nothing is ever sent, invited or counted as
// reachable through an address on the .invalid TLD. Scripted, in-memory, nothing leaves.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';
import type { SetterContext } from '../lib/front-office/setter/actions.ts';

const { isDeliverableEmail, deliverableEmail } = await import('../lib/front-office/contracts.ts');
const { checkFollowUp } = await import('../lib/front-office/setter/actions.ts');
const { metaRoute, runDueJobs } = await import('../lib/front-office/jobs.ts');
const { bookSlot, offerTimes } = await import('../lib/front-office/booking.ts');
const { createMemoryPendingActionStore } = await import('../lib/front-office/pending-actions.ts');
const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');

const CID = '33333333-3333-4333-8333-333333333333';
const INVALID = 'withheld-0123456789abcdef0123456789abcdef@call.invalid';
const NOW = Date.parse('2026-11-10T02:00:00Z');

const ctxOf = (over: Partial<SetterContext['contact']> = {}): SetterContext => ({
  contact: { id: CID, name: 'Withheld caller', phone: null, email: INVALID, state: 'qualifying', optedOut: false, answers: {}, consent: { sms: true, email: true }, ...over },
  messages: [{ direction: 'inbound', body: 'Hi', agent: null, at: '2026-11-10T01:00:00Z' }], appointment: null, handoffs: [],
});

test('isDeliverableEmail: the .invalid TLD is never deliverable; ordinary addresses are', () => {
  assert.equal(isDeliverableEmail(INVALID), false);
  assert.equal(isDeliverableEmail('X@Call.INVALID'), false);
  assert.equal(isDeliverableEmail('a@b.invalid'), false);
  assert.equal(isDeliverableEmail('sam@example.com'), true);
  assert.equal(isDeliverableEmail('sam@invalid.example.com'), true, 'only the TLD counts');
  for (const bad of [null, undefined, '', 'nope', 42]) assert.equal(isDeliverableEmail(bad), false);
  assert.equal(deliverableEmail(INVALID), null);
  assert.equal(deliverableEmail('sam@example.com'), 'sam@example.com');
});

test('booking: a placeholder address is never a calendar attendee or in the event text', async () => {
  const created: { attendeeEmail?: string | null; description?: string; summary?: string }[] = [];
  const perth = { timeZone: 'Australia/Perth', weekly: { 1: [['09:00', '12:00']], 2: [['09:00', '17:00']] }, slotMinutes: 30, bufferMinutes: 15, minNoticeMinutes: 120, horizonDays: 7 } as Parameters<typeof offerTimes>[1];
  const now = Date.parse('2026-11-09T00:30:00Z');
  const calendar = { busy: async () => [], createEvent: async (e: { id: string }) => { created.push(e as never); return { id: e.id, htmlLink: null, existed: false }; }, hasEvent: async () => false };
  const rpc = async (fn: string) => fn === 'fo_booking_for_event' ? null : fn === 'fo_book' ? { appointment: 'a1', state: 'booked', duplicate: false } : 'm';
  const sent: string[] = [];
  const offers = await offerTimes(calendar, perth, now);
  const r = await bookSlot({ auth: { channel: 'ch', key: 'k' }, availability: perth, contact: { id: 'c1', name: null, phone: null, email: INVALID }, now, businessName: 'Ventra', where: 'phone call', meetingTitle: 'Call', start: offers[0].start, calendar, rpc, send: async (to: string) => { sent.push(to); return { sent: false, sid: null }; } });
  assert.equal(r.duplicate, false);
  assert.equal(created.length, 1);
  assert.ok(!created[0].attendeeEmail, 'no invite to a placeholder');
  assert.doesNotMatch(JSON.stringify(created[0]), /call\.invalid/);
  assert.deepEqual(sent, []);
});

test('follow-up check: a placeholder address is not a way to reach the contact, even with an email consent flag', () => {
  for (const via of [undefined, 'email', 'sms', 'web-chat'] as const) {
    const r = checkFollowUp(ctxOf(), via);
    assert.equal(r.ok, false, String(via));
    assert.match(!r.ok ? r.why : '', /No mobile or email on record|No recorded consent/);
  }
  assert.equal(checkFollowUp(ctxOf({ email: 'sam@example.com' }), 'email').ok, true, 'a real address still works');
});

test('Meta route: outside the reply window a placeholder address is never the email fallback', () => {
  const w = { recipient: 'ig-1', optedOut: false, lastInbound: '2026-11-01T00:00:00Z' };
  const r = metaRoute(w, ctxOf().contact, NOW, true);
  assert.equal(r.via, 'owner');
  assert.equal(metaRoute(w, ctxOf({ email: 'sam@example.com' }).contact, NOW, true).via, 'email');
});

async function runOn(ctx: SetterContext, via: 'sms' | 'email') {
  const calls: string[] = [], texts: string[] = [], emails: string[] = [];
  const rpc = async (fn: string) => {
    calls.push(fn);
    if (fn === 'fo_claim_jobs') return [{ id: 'j1', contact: CID, kind: 'follow-up', step: 2, appointment: null }];
    if (fn === 'fo_contact_context') return ctx;
    return null;
  };
  const store = createMemoryPendingActionStore({ workspaceId: '55555555-5555-4555-8555-555555555555', modes: () => ({ setter: 'automatic', receptionist: 'enquiry_only' }), owners: [], now: () => NOW });
  const out = await runDueJobs({ rpc, auth: { channel: 'ch', key: 'k' }, send: async (to: string) => { texts.push(to); return { sent: false, sid: null }; }, email: async (to: string) => { emails.push(to); return { sent: false, id: null }; }, config: ventraSetterConfig, now: NOW, permissions: { store, quietHours: { start: 0, end: 0 } }, via });
  return { out: out[0], calls, texts, emails };
}

test('job runner: a contact whose only address is a placeholder is never emailed (cancelled, nothing logged or sent)', async () => {
  for (const via of ['email', 'sms'] as const) {
    const r = await runOn(ctxOf(), via);
    assert.equal(r.out.outcome, 'cancelled', via);
    assert.match(r.out.note, /no way to reach them/i);
    assert.deepEqual(r.emails, [], via); assert.deepEqual(r.texts, [], via);
    assert.ok(!r.calls.includes('fo_log_outbound'), via);
  }
});

test('held-action text: a placeholder contact never shows call.invalid in the owner-approval summary', async () => {
  const sent: string[] = [];
  const store = createMemoryPendingActionStore({ workspaceId: '55555555-5555-4555-8555-555555555555', modes: () => ({ setter: 'owner_approval', receptionist: 'enquiry_only' }), owners: [], now: () => NOW });
  const rpc = async (fn: string) => fn === 'fo_claim_jobs' ? [{ id: 'j1', contact: CID, kind: 'follow-up', step: 2, appointment: null }] : fn === 'fo_contact_context' ? ctxOf({ name: null, phone: '+61411111111' }) : null;
  const out = await runDueJobs({ rpc, auth: { channel: 'ch', key: 'k' }, send: async (to: string) => { sent.push(to); return { sent: false, sid: null }; }, email: async (to: string) => { sent.push(to); return { sent: false, id: null }; }, config: ventraSetterConfig, now: NOW, permissions: { store, quietHours: { start: 0, end: 0 } }, via: 'email' });
  assert.deepEqual(sent, [], 'held, nothing sent');
  assert.doesNotMatch(JSON.stringify([out, await store.list()]), /call\.invalid/);
  assert.ok((await store.list()).length >= 1, 'a held action was recorded');
});

test('job runner: with a mobile as well, the placeholder is ignored and the text goes to the mobile, never the placeholder', async () => {
  const r = await runOn(ctxOf({ phone: '+61411111111' }), 'email');
  assert.equal(r.out.outcome, 'done', r.out.note);
  assert.deepEqual(r.emails, []);
  assert.deepEqual(r.texts, ['+61411111111']);
});
