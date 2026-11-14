// Shared front-office contracts (task A-1): validators accept the real shapes, reject bad input with a clear error, and
// the value lists stay identical to the database checks and the existing modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './helpers/route-harness.ts';
import {
  activityKinds, agents, bookingStatuses, callOutcomes, channelKinds, contactSources, contactStates, DEFAULT_OPERATING_MODE,
  handoffChannels, messageAuthors, operatingModes,
  parseActivityEvent, parseBooking, parseCallRecord, parseChannelConnectionState, parseChatReply, parseContact, parseConversation,
  parseList, parseMessage, parseOperatingMode, parseOperatingModes, parsePendingAction, parseReceptionistRunResult, parseSetterRunResult,
} from '../lib/front-office/contracts.ts';
import type { ParseResult } from '../lib/front-office/contracts.ts';
import { contactStates as stateModuleStates } from '../lib/front-office/state.ts';
// handoff.ts uses extensionless imports, resolved by the harness hook once it is registered.
const { agents: handoffAgents, channels: handoffModuleChannels } = await import('../lib/front-office/handoff.ts');

const W = '11111111-1111-4111-8111-111111111111', C = '33333333-3333-4333-8333-333333333333', ID = '44444444-4444-4444-8444-444444444444';
const T = '2026-11-10T02:00:00.000Z', T2 = '2026-11-10T02:30:00.000Z', T3 = '2026-11-11T02:00:00.000Z';

function ok<T>(r: ParseResult<T>): T { if (!r.ok) assert.fail(r.error); return r.value; }
function bad<T>(r: ParseResult<T>, pattern: RegExp) { assert.equal(r.ok, false); if (!r.ok) assert.match(r.error, pattern); }

// Value lists must match the database. Read the check constraints from the migrations.
const sql = (name: string) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
function sqlList(text: string, marker: string): string[] {
  const at = text.lastIndexOf(marker);
  assert.ok(at >= 0, `missing ${marker}`);
  const open = text.indexOf('(', at + marker.length), close = text.indexOf(')', open);
  return [...text.slice(open + 1, close).matchAll(/'([^']+)'/g)].map(m => m[1]);
}

test('value lists match the existing modules and the database checks', () => {
  assert.deepEqual([...contactStates], [...stateModuleStates]);
  assert.deepEqual([...agents], [...handoffAgents]);
  assert.deepEqual([...handoffChannels], [...handoffModuleChannels]);
  const base = sql('202611060001_front_office.sql'), appts = sql('202611060002_front_office_appointments.sql');
  const meta = sql('202611060005_front_office_meta.sql'), voice = sql('202611080001_front_office_receptionist.sql');
  assert.deepEqual(sqlList(base, 'state text not null default \'new\' check (state in'), [...contactStates]);
  assert.deepEqual(sqlList(base, 'source text not null default \'inbound\' check (source in'), [...contactSources]);
  assert.deepEqual(sqlList(base, 'agent text check (agent in'), [...messageAuthors]);
  assert.deepEqual(sqlList(meta, 'fo_channels_kind_check check (kind in').sort(), [...channelKinds].sort());
  assert.deepEqual(sqlList(meta, 'fo_handoffs_channel_check check (channel in').sort(), [...handoffChannels].sort());
  assert.deepEqual(sqlList(appts, 'status text not null default \'booked\' check (status in'), [...bookingStatuses]);
  assert.deepEqual(sqlList(voice, 'fo_events_kind_check check (kind in'), [...activityKinds]);
  assert.deepEqual(sqlList(voice, 'if outcome not in'), [...callOutcomes]);
});

test('operating modes: exactly three, enquiry only by default', () => {
  assert.deepEqual([...operatingModes], ['automatic', 'owner_approval', 'enquiry_only']);
  assert.equal(DEFAULT_OPERATING_MODE, 'enquiry_only');
  assert.equal(ok(parseOperatingMode('owner_approval')), 'owner_approval');
  bad(parseOperatingMode('auto'), /one of: automatic, owner_approval, enquiry_only/);
  assert.deepEqual(ok(parseOperatingModes({ setter: 'automatic', receptionist: 'enquiry_only' })), { setter: 'automatic', receptionist: 'enquiry_only' });
  bad(parseOperatingModes({ setter: 'automatic' }), /Receptionist mode/);
  bad(parseOperatingModes(null), /must be an object/);
  bad(parseOperatingModes([]), /must be an object/);
});

const contact = { id: C, workspaceId: W, name: 'Sam', phone: '+61412345678', email: 'sam@example.com', webVisitor: null, instagramId: null, messengerId: null, state: 'qualifying', source: 'inbound', optedOut: false, optedOutAt: null, answers: { goal: 'Lose 5kg' }, createdAt: T, updatedAt: T };

test('contact: accepts a real record, rejects bad fields with a clear error', () => {
  assert.deepEqual(ok(parseContact(contact)), contact);
  // Missing answers is treated as none.
  assert.deepEqual(ok(parseContact({ ...contact, answers: undefined })).answers, {});
  // A web chat visitor is a contact before sharing a phone or email.
  ok(parseContact({ ...contact, phone: null, email: null, webVisitor: 'abcdefghijklmnop' }));
  bad(parseContact({ ...contact, id: 'nope' }), /Contact id/);
  bad(parseContact({ ...contact, state: 'hot' }), /State must be one of/);
  bad(parseContact({ ...contact, phone: '0412345678' }), /Phone must be a number like/);
  bad(parseContact({ ...contact, email: 'not-an-email' }), /Email is not valid/);
  bad(parseContact({ ...contact, phone: null, email: null }), /needs a phone, email/);
  bad(parseContact({ ...contact, optedOut: true }), /disagree/);
  bad(parseContact({ ...contact, answers: { goal: 5 } }), /Answer goal/);
  bad(parseContact({ ...contact, createdAt: 'yesterday' }), /Created at/);
});

test('message: outbound needs an author and automated sends need a prompt version (fo_messages checks)', () => {
  const m = { id: ID, contactId: C, channelId: null, channel: 'web-chat', direction: 'inbound', body: 'Hi', agent: null, promptVersion: null, createdAt: T };
  assert.deepEqual(ok(parseMessage(m)), m);
  ok(parseMessage({ ...m, direction: 'outbound', agent: 'setter', promptVersion: 'setter/qualify@3' }));
  ok(parseMessage({ ...m, direction: 'outbound', agent: 'human' }));
  bad(parseMessage({ ...m, direction: 'outbound' }), /needs an agent/);
  bad(parseMessage({ ...m, direction: 'outbound', agent: 'setter' }), /prompt version/);
  bad(parseMessage({ ...m, channel: 'fax' }), /Channel must be one of/);
  bad(parseMessage({ ...m, body: 'x'.repeat(4001) }), /Body/);
});

test('conversation, booking, activity and call records', () => {
  const conv = { contactId: C, channel: 'sms', contactName: null, state: 'new', optedOut: false, lastMessageAt: T, lastDirection: 'inbound', preview: 'Hi', messageCount: 1, pendingActions: 0, needsOwner: false };
  assert.deepEqual(ok(parseConversation(conv)), conv);
  bad(parseConversation({ ...conv, messageCount: -1 }), /Message count/);
  bad(parseConversation({ ...conv, preview: 'x'.repeat(161) }), /Preview/);

  const booking = { id: ID, contactId: C, startsAt: T, endsAt: T2, provider: 'google', status: 'booked', createdAt: T };
  assert.deepEqual(ok(parseBooking(booking)), booking);
  bad(parseBooking({ ...booking, endsAt: T }), /end after it starts/);
  bad(parseBooking({ ...booking, endsAt: T3 }), /at most 8 hours/);
  bad(parseBooking({ ...booking, status: 'maybe' }), /Status must be one of/);

  const ev = { id: 7, contactId: C, kind: 'state', fromState: 'qualifying', toState: 'qualified', agent: 'setter', detail: 'All answers in', createdAt: T };
  assert.deepEqual(ok(parseActivityEvent(ev)), ev);
  bad(parseActivityEvent({ ...ev, id: 0 }), /Activity id/);
  bad(parseActivityEvent({ ...ev, agent: 'system' }), /Agent must be one of/);

  const call = { id: ID, channelId: W, contactId: null, caller: null, outcomes: ['faq', 'message'], endedReason: 'customer-ended-call', summary: null, startedAt: T, endedAt: T2 };
  assert.deepEqual(ok(parseCallRecord(call)), call);
  bad(parseCallRecord({ ...call, outcomes: ['booked', 'sold'] }), /Outcome 2/);
  bad(parseCallRecord({ ...call, outcomes: 'faq' }), /Outcomes must be a list/);
});

const pending = { id: ID, workspaceId: W, product: 'receptionist', contactId: C, callId: null, mode: 'owner_approval', payload: { kind: 'book', start: T, end: T2, timeZone: 'Australia/Perth' }, summary: 'Book Sam for Tue 10:00', status: 'pending', createdAt: T, expiresAt: T3, decidedAt: null, decidedBy: null, note: null };

test('pending action: every payload kind, and only owner approval mode holds actions', () => {
  assert.deepEqual(ok(parsePendingAction(pending)), pending);
  const payloads = [
    { kind: 'reschedule', bookingId: ID, start: T, end: T2, timeZone: 'Australia/Perth' },
    { kind: 'cancel', bookingId: ID, reason: 'Sick' },
    { kind: 'send', channel: 'sms', body: 'See you then', promptVersion: 'setter/qualify@3' },
    { kind: 'follow_up', channel: 'email', body: 'Still keen?', promptVersion: 'setter/follow-up@1', step: 2 },
    { kind: 'transfer', reason: 'Urgent' },
  ];
  for (const p of payloads) assert.deepEqual(ok(parsePendingAction({ ...pending, payload: p })).payload, p);
  bad(parsePendingAction({ ...pending, mode: 'automatic' }), /Only owner approval/);
  bad(parsePendingAction({ ...pending, payload: { kind: 'refund' } }), /Action must be one of/);
  bad(parsePendingAction({ ...pending, payload: { kind: 'book', start: T2, end: T, timeZone: 'UTC' } }), /End must be after start/);
  bad(parsePendingAction({ ...pending, payload: { kind: 'send', channel: 'sms', body: '', promptVersion: 'x' } }), /Body/);
  bad(parsePendingAction({ ...pending, payload: { kind: 'follow_up', channel: 'sms', body: 'x', promptVersion: 'x', step: 0 } }), /Step/);
  bad(parsePendingAction({ ...pending, decidedAt: T2 }), /no decision yet/);
  bad(parsePendingAction({ ...pending, expiresAt: T }), /Expires at/);
  bad(parsePendingAction({ ...pending, payload: undefined }), /Payload must be an object/);
});

test('connection state: LIVE only when verified', () => {
  const c = { target: 'voice', status: 'verified', mode: 'LIVE', address: '+61812345678', checkedAt: T, detail: 'Test call answered.' };
  assert.deepEqual(ok(parseChannelConnectionState(c)), c);
  ok(parseChannelConnectionState({ ...c, target: 'google-calendar', status: 'not-configured', mode: 'DEMO', address: null, checkedAt: null }));
  bad(parseChannelConnectionState({ ...c, status: 'configured' }), /Only a verified connection can be LIVE/);
  bad(parseChannelConnectionState({ ...c, target: 'tiktok' }), /Connection must be one of/);
});

test('Setter and Receptionist run results respect the operating mode', () => {
  const s = { reply: 'What is your goal?', state: 'qualifying', booked: false, handedTo: null, tools: ['save_answers'], mode: 'enquiry_only', pendingActionIds: [] };
  assert.deepEqual(ok(parseSetterRunResult(s)), s);
  ok(parseSetterRunResult({ ...s, booked: true, state: 'booked', handedTo: 'sales', mode: 'automatic' }));
  ok(parseSetterRunResult({ ...s, mode: 'owner_approval', pendingActionIds: [ID] }));
  bad(parseSetterRunResult({ ...s, booked: true }), /Only automatic mode books/);
  bad(parseSetterRunResult({ ...s, pendingActionIds: [ID] }), /Only owner approval mode holds/);
  bad(parseSetterRunResult({ ...s, handedTo: 'robot' }), /Handed to/);

  const r = { said: 'We open at 6am.', tools: ['answer_faq'], outcomes: ['faq'], action: null, callId: ID, contactId: C, mode: 'enquiry_only', pendingActionIds: [] };
  assert.deepEqual(ok(parseReceptionistRunResult(r)), r);
  ok(parseReceptionistRunResult({ ...r, outcomes: ['booked'], mode: 'automatic' }));
  ok(parseReceptionistRunResult({ ...r, outcomes: ['message'], action: 'end' }));
  bad(parseReceptionistRunResult({ ...r, outcomes: ['booked'] }), /Only automatic mode/);
  // Owner decision 2026-11-14 (A-14): a transfer to a person is accepted in every mode.
  for (const mode of ['automatic', 'owner_approval', 'enquiry_only']) {
    ok(parseReceptionistRunResult({ ...r, action: 'transfer', outcomes: ['transfer'], mode }));
  }
  bad(parseReceptionistRunResult({ ...r, action: 'hold' }), /Action must be one of/);
});

test('chat reply: accepts what the chat route returns today', () => {
  assert.deepEqual(ok(parseChatReply({ reply: null, live: false, note: 'Thanks, your message is with the team. We will reply soon.' })),
    { reply: null, live: false, demo: false, booked: false, state: null, note: 'Thanks, your message is with the team. We will reply soon.' });
  assert.deepEqual(ok(parseChatReply({ reply: 'Hi!', live: true, demo: true, state: 'qualifying' })), { reply: 'Hi!', live: true, demo: true, booked: false, state: 'qualifying', note: null });
  bad(parseChatReply({ reply: 'Hi' }), /Live must be true or false/);
  bad(parseChatReply({ error: 'Chat is not connected yet.', configured: false }), /Live/);
});

test('lists: every item checked, the first bad one named', () => {
  assert.equal(ok(parseList([contact, contact], parseContact)).length, 2);
  bad(parseList([contact, { ...contact, state: 'x' }], parseContact), /^Item 2: State/);
  bad(parseList({}, parseContact), /Expected a list/);
  bad(parseList([1, 2, 3], parseContact, 2), /more than 2/);
});
