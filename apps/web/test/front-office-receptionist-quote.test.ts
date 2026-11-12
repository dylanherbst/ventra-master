// AI Receptionist quote requests (task A-19). A caller asking "how much would it cost to…" gets a structured quote
// request saved on their contact record, a handoff for the team, and a staff notification, the same way in every
// operating mode (capturing a request commits the business to nothing). No price is ever quoted: the business has no
// configured quote price, so the team sends the quote. Scripted model, in-memory store, recording senders: no network.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

// No network in this file: any fetch fails the run.
const realFetch = globalThis.fetch;
const fetchAttempts: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => { fetchAttempts.push(String(input instanceof Request ? input.url : input)); throw new Error('Network is not allowed in this test.'); }) as typeof fetch;
after(() => { globalThis.fetch = realFetch; assert.deepEqual(fetchAttempts, [], 'no network call was attempted'); });

const { runReceptionistTurn, receptionistTools, QUOTE_ANSWER_KEYS } = await import('../lib/front-office/receptionist/agent.ts');
const { simulationStore, simulatedCalendar, recordingSenders, scriptedModel, demoSettings, say, tool, SIM_AUTH, SIM_NOW } = await import('../lib/front-office/receptionist/simulate.ts');
const { streamOf } = await import('../lib/front-office/llm.ts');
const { decide } = await import('../lib/front-office/permissions.ts');
const { operatingModes } = await import('../lib/front-office/contracts.ts');
type OperatingMode = import('../lib/front-office/contracts.ts').OperatingMode;
type ScriptStep = import('../lib/front-office/receptionist/simulate.ts').ScriptStep;
type SimSeed = import('../lib/front-office/receptionist/simulate.ts').SimSeed;
type AgentSettings = import('../lib/front-office/settings.ts').AgentSettings;

const CALLER = '+61412000111';
const a = { channel: SIM_AUTH.channel, channel_key: SIM_AUTH.key };
/** Anything that looks like a price: a currency sign or code, or any digit at all. */
const PRICE = /[$€£]|\bAUD\b|\bdollars?\b|\d/i;

/** One caller turn against the simulated database: the call row (and contact, if the number is known) exists first,
 * as fo_voice_turn makes it on a real call. Every tool result passed back to the model is recorded. */
async function quoteCall(opts: { mode?: OperatingMode; caller?: string | null; settings?: AgentSettings; contact?: SimSeed['contact']; contactEmail?: string; steps: (results: string[]) => ScriptStep[] }) {
  const settings = opts.settings ?? demoSettings();
  const caller = opts.caller === undefined ? CALLER : opts.caller;
  const db = simulationStore(settings, { caller, contact: opts.contact });
  const callId = 'call_quote0001';
  const turn = await db.rpc('fo_voice_turn', { ...a, call_id: callId, caller, turn: 1, message: 'How much would it cost to run a team bootcamp?' }) as { contact: string | null };
  if (opts.contactEmail) { const row = db.tables.fo_contacts.find(x => x.id === turn.contact); if (row) row.email = opts.contactEmail; }
  const results: string[] = [];
  const cal = simulatedCalendar(), senders = recordingSenders();
  const steps = opts.steps(results).map((s): ScriptStep => typeof s === 'function' ? r => { results.push(...r.map(b => b.content)); return s(r); } : s);
  const gen = runReceptionistTurn({
    llm: streamOf(scriptedModel(steps)), rpc: db.rpc, auth: SIM_AUTH, calendar: cal.provider, send: senders.send, email: senders.email,
    settings, now: SIM_NOW, mode: opts.mode, call: { id: callId, caller, contact: turn.contact },
    conversation: [{ role: 'user', content: 'Hi, how much would it cost to run a bootcamp for my team of eight?' }],
  });
  let text = '', r = await gen.next();
  while (!r.done) { if (r.value.type === 'text') text += r.value.text; r = await gen.next(); }
  return { db, summary: r.value, text, results, cal, senders, contactId: turn.contact, call: db.tables.fo_calls.find(k => k.provider_call_id === callId) };
}

const fullQuote = { need: 'A bootcamp session for a team of eight', where: 'Their office in Fremantle', when: 'Some time next month', budget: 'Around $500', name: 'Sam Lee', email: 'sam@example.com' };
const standardSteps = (): ScriptStep[] => [
  [say('Happy to get a quote started for you. '), tool('request_quote', fullQuote)],
  r => [say(/^Quote request saved on their record and the team has been told/.test(r[0]?.content ?? '') ? 'Thanks Sam. A team member will look at it and send you a quote.' : 'Sorry, something went wrong.')],
];

test('quote tool: offered to the model with the fields to capture; decide() allows it in every mode', () => {
  const spec = receptionistTools.find(t => t.name === 'request_quote');
  assert.ok(spec, 'request_quote is offered to the model');
  const props = Object.keys((spec.input_schema as { properties: Record<string, unknown> }).properties);
  for (const f of ['need', 'where', 'when', 'budget', 'name', 'phone', 'email']) assert.ok(props.includes(f), `captures ${f}`);
  assert.deepEqual((spec.input_schema as { required: string[] }).required, ['need']);
  assert.match(spec.description, /Never give a price/);
  for (const m of operatingModes) assert.equal(decide(m, 'take_message').decision, 'perform', `${m}: information gathering is always allowed`);
});

for (const mode of operatingModes) {
  test(`quote request in ${mode} mode: saved on the contact, handed to the team, staff notified, nothing booked or quoted`, async () => {
    const { db, summary, text, results, cal, senders, contactId, call } = await quoteCall({ mode, steps: standardSteps });
    assert.ok(contactId);
    const c = db.tables.fo_contacts.find(x => x.id === contactId);
    assert.ok(c);
    // Saved on the contact record (fo_save_details), with the caller's name and email.
    assert.deepEqual(
      { need: c.answers[QUOTE_ANSWER_KEYS.need], where: c.answers[QUOTE_ANSWER_KEYS.where], when: c.answers[QUOTE_ANSWER_KEYS.when], budget: c.answers[QUOTE_ANSWER_KEYS.budget] },
      { need: fullQuote.need, where: fullQuote.where, when: fullQuote.when, budget: fullQuote.budget },
    );
    assert.equal(c.name, 'Sam Lee'); assert.equal(c.email, 'sam@example.com'); assert.equal(c.phone, CALLER);
    // A handoff for a person (fo_record_handoff), so the team follows up.
    assert.equal(db.tables.handoffs.length, 1);
    const h = db.tables.handoffs[0] as { owner: string; intent: string; from: string; channel: string; summary: string; nextAction: string; answers: Record<string, string> };
    assert.equal(h.owner, 'human'); assert.equal(h.intent, 'quote request'); assert.equal(h.from, 'receptionist'); assert.equal(h.channel, 'voice');
    for (const v of [fullQuote.need, fullQuote.where, fullQuote.when, fullQuote.budget, 'Sam Lee', CALLER]) assert.ok(h.summary.includes(v), `handoff summary has ${v}`);
    assert.equal(h.answers[QUOTE_ANSWER_KEYS.need], fullQuote.need);
    assert.match(h.nextAction, /quote/i);
    // Staff notified through the fake notifier (the same path take_message uses); nothing really sent.
    const sms = senders.out.filter(o => o.channel === 'sms'), mail = senders.out.filter(o => o.channel === 'email');
    assert.equal(sms.length, 1); assert.equal(sms[0].to, '+61400000001'); assert.match(sms[0].body, /quote request from Sam Lee/);
    assert.ok(sms[0].body.includes(fullQuote.need));
    assert.equal(mail.length, 1); assert.equal(mail[0].to, 'team@harbour-fitness.example'); assert.match(mail[0].body, /^Quote request for Harbour Fitness/);
    assert.ok(senders.out.every(o => o.sent === false));
    // Outcome: 'quote' on the turn; stored as 'message' because the database list has no 'quote' yet.
    assert.deepEqual(summary.outcomes, ['quote']); assert.deepEqual(summary.tools, ['request_quote']);
    assert.deepEqual(call?.outcomes, ['message']);
    // No price quoted: not in the tool result, not in what the caller heard.
    assert.equal(results.length, 1);
    assert.doesNotMatch(results[0], PRICE, 'the tool result carries no price, not even the caller’s own budget');
    assert.match(results[0], /Do not give a price/);
    assert.doesNotMatch(text, PRICE);
    assert.match(text, /send you a quote/);
    // Information gathering only: no booking, no reminder, no calendar event, no state change beyond the new contact.
    assert.equal(db.tables.fo_appointments.length, 0); assert.equal(db.tables.fo_jobs.length, 0); assert.deepEqual(cal.log, []);
    assert.equal(c.state, 'new');
    assert.equal(summary.action, null);
  });
}

test('quote request is identical across the three modes and with no mode given', async () => {
  const shape = async (mode?: OperatingMode) => {
    const r = await quoteCall({ mode, steps: standardSteps });
    return { answers: r.db.tables.fo_contacts[0].answers, handoffs: r.db.tables.handoffs, out: r.senders.out, results: r.results, text: r.text, outcomes: r.summary.outcomes };
  };
  const base = await shape(undefined);
  for (const m of operatingModes) assert.deepEqual(await shape(m), base, `${m} behaves the same`);
});

test('quote request with only the need, from a withheld number: asks for a mobile, then saves it on the contact the number gives', async () => {
  const r = await quoteCall({
    mode: 'enquiry_only', caller: null,
    steps: () => [
      [tool('request_quote', { need: 'Personal training for two people' })],
      res => [say(/^Not saved on file/.test(res[0]?.content ?? '') ? 'I can get a quote to you. What is the best mobile for you? ' : 'Unexpected.')],
    ],
  });
  assert.equal(r.contactId, null);
  assert.match(r.results[0], /^Not saved on file/); assert.match(r.results[0], /Ask for their mobile/); assert.doesNotMatch(r.results[0], PRICE);
  assert.equal(r.db.tables.fo_contacts.length, 0, 'no contact without a number');
  assert.equal(r.db.tables.handoffs.length, 0, 'no contact to hang a handoff on');
  assert.equal(r.senders.out.length, 2, 'staff still hear about it'); assert.match(r.senders.out[0].body, /number withheld/);
  assert.doesNotMatch(r.text, PRICE);

  const r2 = await quoteCall({
    mode: 'enquiry_only', caller: null,
    steps: () => [
      [tool('request_quote', { need: 'Personal training for two people', when: 'Next week', name: 'Alex', phone: '0412 345 678' })],
      res => [say(/^Quote request saved on their record and the team has been told/.test(res[0]?.content ?? '') ? 'Thanks Alex, the team will send you a quote.' : 'Unexpected.')],
    ],
  });
  const c = r2.db.tables.fo_contacts.find(x => x.phone === '+61412345678');
  assert.ok(c, 'the mobile they gave becomes the contact');
  assert.equal(c.name, 'Alex'); assert.equal(c.answers[QUOTE_ANSWER_KEYS.need], 'Personal training for two people'); assert.equal(c.answers[QUOTE_ANSWER_KEYS.when], 'Next week');
  assert.equal(c.answers[QUOTE_ANSWER_KEYS.where], undefined); assert.equal(c.answers[QUOTE_ANSWER_KEYS.budget], undefined, 'no budget invented');
  assert.equal(r2.db.tables.handoffs.length, 1);
  assert.doesNotMatch(r2.results[0], PRICE); assert.doesNotMatch(r2.text, PRICE);
});

test('quote request without what they need: nothing saved or sent, the model is told to ask', async () => {
  const r = await quoteCall({ mode: 'automatic', steps: () => [[tool('request_quote', { need: '   ', budget: '$900' })], res => [say(/Ask what they would like a quote for/.test(res[0]?.content ?? '') ? 'What would you like the quote for? ' : 'Unexpected.')]] });
  assert.match(r.results[0], /Ask what they would like a quote for/); assert.doesNotMatch(r.results[0], PRICE);
  assert.equal(r.db.tables.handoffs.length, 0); assert.equal(r.senders.out.length, 0);
  assert.deepEqual(r.db.tables.fo_contacts[0].answers, {});
  assert.deepEqual(r.summary.outcomes, []);
});

test('no staff contact set: the quote is still saved and handed off; nothing is sent', async () => {
  const r = await quoteCall({ mode: 'owner_approval', settings: demoSettings({ staffPhone: '', staffEmail: '' }), steps: standardSteps });
  assert.equal(r.senders.out.length, 0);
  assert.equal(r.db.tables.handoffs.length, 1);
  assert.equal(r.db.tables.fo_contacts[0].answers[QUOTE_ANSWER_KEYS.need], fullQuote.need);
  assert.doesNotMatch(r.results[0], PRICE);
});

// Review fix round (A-19 PASS WITH NOTES).

test('two request_quote calls in one session (withheld number, then a mobile): one handoff, one full notice, one short update', async () => {
  const r = await quoteCall({
    mode: 'automatic', caller: null,
    steps: () => [
      [tool('request_quote', { need: 'Bootcamp for a team of eight', where: 'Fremantle' })],
      res => /^Not saved on file/.test(res[0]?.content ?? '') ? [tool('request_quote', { need: 'Bootcamp for a team of eight', where: 'Fremantle', name: 'Jo', phone: '0412 345 678' })] : [say('Unexpected.')],
      res => [say(/^Quote request updated on their record/.test(res[0]?.content ?? '') ? 'Thanks Jo, the team will send you a quote.' : 'Unexpected.')],
    ],
  });
  assert.equal(r.results.length, 2);
  assert.match(r.results[0], /^Not saved on file/); assert.match(r.results[1], /^Quote request updated on their record/);
  const c = r.db.tables.fo_contacts.find(x => x.phone === '+61412345678');
  assert.ok(c); assert.equal(c.answers[QUOTE_ANSWER_KEYS.need], 'Bootcamp for a team of eight'); assert.equal(c.answers[QUOTE_ANSWER_KEYS.where], 'Fremantle');
  assert.equal(r.db.tables.handoffs.length, 1, 'exactly one handoff');
  assert.equal(r.senders.out.length, 3, 'full notice by text and email, then one short update');
  assert.deepEqual(r.senders.out.map(o => o.channel), ['sms', 'email', 'sms']);
  assert.match(r.senders.out[2].body, /update to the quote request from Jo: contact now \+61412345678$/);
  assert.deepEqual(r.summary.outcomes, ['quote']); assert.deepEqual(r.call?.outcomes, ['message']);
  for (const x of r.results) assert.doesNotMatch(x, PRICE);
  assert.doesNotMatch(r.text, PRICE);
});

test('two request_quote calls in one session from a known caller with nothing new: one handoff, one notice, no update', async () => {
  const r = await quoteCall({
    mode: 'owner_approval',
    steps: () => [
      [tool('request_quote', { need: 'Bootcamp for a team of eight' })],
      () => [tool('request_quote', { need: 'Bootcamp for a team of eight', when: 'Next month' })],
      () => [say('The team will send you a quote.')],
    ],
  });
  assert.match(r.results[1], /^Quote request updated on their record/);
  assert.equal(r.db.tables.fo_contacts[0].answers[QUOTE_ANSWER_KEYS.when], 'Next month', 'the later detail is saved');
  assert.equal(r.db.tables.handoffs.length, 1);
  assert.equal(r.senders.out.length, 2, 'one full notice (text and email), nothing more');
});

test('same request already on the contact from an earlier call: answers updated, no second handoff or notice', async () => {
  const r = await quoteCall({
    mode: 'enquiry_only',
    contact: { state: 'new', name: 'Sam Lee', answers: { [QUOTE_ANSWER_KEYS.need]: 'Bootcamp for a team of eight' } },
    steps: () => [[tool('request_quote', { need: 'bootcamp for a team of eight', where: 'Fremantle' })], () => [say('The team will send you a quote.')]],
  });
  assert.match(r.results[0], /^Quote request updated on their record/);
  assert.equal(r.db.tables.fo_contacts[0].answers[QUOTE_ANSWER_KEYS.where], 'Fremantle');
  assert.equal(r.db.tables.handoffs.length, 0); assert.equal(r.senders.out.length, 0);
});

test('withheld number with only an email: not claimed as saved; the team is told with the email; nothing on file', async () => {
  const r = await quoteCall({
    mode: 'enquiry_only', caller: null,
    steps: () => [[tool('request_quote', { need: 'Personal training for two people', name: 'Kim', email: 'kim@example.com' })], () => [say('Thanks Kim. Could I also grab your mobile? ')]],
  });
  assert.equal(r.contactId, null);
  assert.doesNotMatch(r.results[0], /^Quote request saved|updated on their record/);
  assert.match(r.results[0], /^Not saved on file, because there is no mobile number to link it to\. The team has been sent the request by message, with their email,/);
  assert.match(r.results[0], /Ask for their mobile/); assert.doesNotMatch(r.results[0], PRICE);
  assert.equal(r.db.tables.fo_contacts.length, 0); assert.equal(r.db.tables.handoffs.length, 0);
  assert.equal(r.senders.out.length, 2);
  for (const o of r.senders.out) { assert.match(o.body, /kim@example\.com/); assert.match(o.body, /number withheld/); }

  const none = await quoteCall({ caller: null, settings: demoSettings({ staffPhone: '', staffEmail: '' }), steps: () => [[tool('request_quote', { need: 'Personal training', email: 'kim@example.com' })], () => [say('Could I grab your mobile? ')]] });
  assert.match(none.results[0], /^Not saved and not passed on/); assert.equal(none.senders.out.length, 0);
});

test('caller text is one clean line in staff texts, emails, the handoff and the record (newlines and control characters collapsed)', async () => {
  const r = await quoteCall({
    mode: 'automatic',
    steps: () => [[tool('request_quote', { need: 'Bootcamp\nfor eight\r\n\tpeople\u0007 please', where: 'Fremantle\n\nofficeEND\u0000', when: ' next\vmonth ', budget: 'not\nsure', name: 'Sam\nLee' })], () => [say('The team will send you a quote.')]],
  });
  const c = r.db.tables.fo_contacts[0];
  assert.equal(c.answers[QUOTE_ANSWER_KEYS.need], 'Bootcamp for eight people please');
  assert.equal(c.answers[QUOTE_ANSWER_KEYS.where], 'Fremantle officeEND');
  assert.equal(c.answers[QUOTE_ANSWER_KEYS.when], 'next month'); assert.equal(c.answers[QUOTE_ANSWER_KEYS.budget], 'not sure');
  assert.equal(c.name, 'Sam Lee');
  const h = r.db.tables.handoffs[0] as { summary: string };
  // eslint-disable-next-line no-control-regex
  const CONTROL = /[\u0000-\u001f\u007f]/;
  assert.doesNotMatch(h.summary, CONTROL); assert.ok(h.summary.includes('needs Bootcamp for eight people please'));
  assert.equal(r.senders.out.length, 2);
  for (const o of r.senders.out) { assert.doesNotMatch(o.body, CONTROL); assert.ok(o.body.includes('quote request from Sam Lee')); }
});

// A-77 rework: a contact holding the withheld-caller placeholder address takes the real address the caller gives.
test('quote request: a real email replaces the withheld-caller placeholder on the record and in the staff text', async () => {
  const PLACEHOLDER = 'withheld-0123456789abcdef0123456789abcdef@call.invalid';
  const { db, senders, contactId } = await quoteCall({ contactEmail: PLACEHOLDER, steps: standardSteps });
  const c = db.tables.fo_contacts.find(x => x.id === contactId);
  assert.equal(c?.email, 'sam@example.com', 'saved over the placeholder');
  const all = JSON.stringify([senders.out, db.tables.handoffs]);
  assert.match(all, /sam@example\.com/);
  assert.doesNotMatch(all, /call\.invalid/);
});

test('quote request: with no real email given, the placeholder never reaches staff text or the handoff', async () => {
  const PLACEHOLDER = 'withheld-0123456789abcdef0123456789abcdef@call.invalid';
  const { senders, db } = await quoteCall({ contactEmail: PLACEHOLDER, steps: () => [
    [tool('request_quote', { need: 'Bootcamp for eight', name: 'Sam Lee' })],
    () => [say('Thanks, the team will be in touch.')],
  ] });
  assert.doesNotMatch(JSON.stringify([senders.out, db.tables.handoffs]), /call\.invalid/);
});
