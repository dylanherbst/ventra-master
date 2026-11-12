// A-54 (gap G1): a booked contact who writes again on web chat or in the Setter Lab is answered about their booking
// (time, where) and offered a change. The Setter has no tool that moves or cancels a booking, so a change request is
// handed to a person (escalate_human with booking_change, a 'transfer' through the permission check) in every mode, and
// the contact hears a fixed line that never says the booking changed. A person who owns the conversation still silences
// the AI. Other channels pass no sales hook, so booked contacts there still get no AI reply. Scripted models, in-memory or
// PGlite stores, global fetch trapped outside the route world, nothing sent.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const h = await import('./helpers/front-office-scenarios.ts');
const { tool, say, scripted, lead, agentSetup, CID, assertNothingSent, assertOutboundTagged } = h;
const { runSetterTurn, setterHooks, returningTools, BOOKING_CHANGE_SAY, RETURNING_HANDOFF_SAY, NO_BOOKING_SAY, SETTER_FALLBACK_REPLY, SETTER_FALLBACK_PROMPT } = await import('../lib/front-office/setter/agent.ts');
const { SETTER_RETURNING_PROMPT_VERSION } = await import('../lib/front-office/setter/prompt.ts');
const { newLab, runLabTurn, LAB_CONFIG } = await import('../lib/front-office/setter/lab.ts');
const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');
const { formatSlot } = await import('../lib/front-office/calendar/slots.ts');
const { decide } = await import('../lib/front-office/permissions.ts');
const { handleInbound, handleInboundSms } = await import('../lib/front-office/orchestrator.ts');
type Mode = import('../lib/front-office/contracts.ts').OperatingMode;
type LabState = import('../lib/front-office/setter/lab.ts').LabState;
type Llm = import('../lib/front-office/llm.ts').Llm;

const trap = h.trapFetch();
before(() => trap.install());
after(() => { trap.restore(); assert.deepEqual(trap.attempts, [], 'no network calls'); });

const MODES: Mode[] = ['automatic', 'owner_approval', 'enquiry_only'];
const TZ = ventraSetterConfig.availability.timeZone;
const STARTS = '2026-11-10T02:00:00.000Z'; // Tue 10 Nov, 10:00 am Perth
const LINE = `${ventraSetterConfig.meetingTitle} on ${formatSlot(Date.parse(STARTS), TZ)} (${TZ}), ${ventraSetterConfig.where}`;
// owner_approval creates no approval item for a change (a person does it), so it uses the same honest line as automatic.
const changeSay = (mode: Mode, change: 'reschedule' | 'cancel') => mode === 'enquiry_only' ? decide(mode, change).say : BOOKING_CHANGE_SAY[change];

/** A booked contact (as after the Setter booked it): appointment on file, handed to Sales, one new inbound message. */
function bookedSetup(mode: Mode, message: string, appointment = true) {
  const a = agentSetup(mode, lead('booked', [{ direction: 'inbound', body: 'Can I book a call?' }, { direction: 'outbound', body: 'You are booked.' }, { direction: 'inbound', body: message }]));
  Object.assign(a.db.contact, { name: 'Sam', email: 'sam@example.com' });
  if (appointment) a.db.appointment = { id: 'appt-1', starts: STARTS, ends: '2026-11-10T02:30:00.000Z', status: 'booked' };
  a.db.handoffs.push({ from: 'setter', owner: 'sales', intent: 'run the booked call', summary: 'Booked.' });
  return a;
}

// ---------------------------------------------------------------------------------------------------------------
test('booked contact writes again (H-AGENT, all three modes): told their booking (time, where), offered a change, no booking tools, tagged returning prompt', async () => {
  for (const mode of MODES) {
    const a = bookedSetup(mode, 'Hi, quick question about my call');
    // The stand-in repeats only the prompt's booking line, so the time and place come from the stored appointment.
    let booking = '';
    const m = scripted([() => [say(`Welcome back, Sam. You're booked for your ${booking}. Would you like to keep it, or should I ask the team to move or cancel it?`)]]);
    const seenTools: string[][] = [];
    const llm: Llm = async (req) => { seenTools.push((req.tools ?? []).map(t => t.name)); booking = /^Their booking: (.+?)\.?$/m.exec(req.system)?.[1] ?? ''; return m.llm(req); };
    const turn = await runSetterTurn(CID, a.deps(llm));
    assert.ok(m.systems[0].includes(`Their booking: ${LINE}.`), `${mode}: the prompt carries the stored booking`);
    assert.match(m.systems[0], /Contact stage: booked\./);
    assert.match(m.systems[0], /do not offer or book new times/);
    assert.deepEqual(seenTools, [returningTools.map(t => t.name)]);
    assert.deepEqual(seenTools[0], ['handoff_receptionist', 'escalate_human']);
    assert.ok(turn.reply?.includes(formatSlot(Date.parse(STARTS), TZ)) && turn.reply.includes(ventraSetterConfig.where), `${mode}: ${turn.reply}`);
    assert.equal(turn.state, 'booked'); assert.equal(turn.booked, false); assert.equal(turn.handedTo, null);
    assert.deepEqual(a.db.outbound, [{ message: turn.reply, prompt: SETTER_RETURNING_PROMPT_VERSION }]);
    assert.equal(a.db.jobs.length, 0, 'no follow-up ladder for a booked contact');
    assert.equal(a.pending.items.length, 0); assert.equal(a.db.appointment?.starts, STARTS); assert.equal(a.db.handoffs.length, 1);
    assert.deepEqual(turn.actions, []);
  }
});

test('booked contact asks to move or cancel (H-AGENT, all three modes): handed to a person through the permission check, fixed honest reply, booking unchanged, then the AI is silent', async () => {
  for (const mode of MODES) for (const change of ['reschedule', 'cancel'] as const) {
    const message = change === 'reschedule' ? 'Can I move it to Thursday afternoon?' : 'I need to cancel, sorry.';
    const a = bookedSetup(mode, message);
    const m = scripted([[tool('escalate_human', { intent: `${change} booking`, summary: message, booking_change: change })], [say('Your booking has been moved.')]]);
    const turn = await runSetterTurn(CID, a.deps(m.llm));
    assert.equal(m.rounds(), 1, 'the fixed line ends the turn; the model never words it');
    assert.equal(turn.reply, changeSay(mode, change), `${mode}/${change}`);
    assert.doesNotMatch(turn.reply ?? '', /\b(has been|was|is now) (moved|rescheduled|cancell?ed)\b/i, 'never says it changed');
    const t = turn.actions.find(x => x.action === 'transfer');
    assert.equal(t?.decision, 'perform', 'a transfer is always allowed'); assert.equal(t?.ok, true);
    assert.equal(turn.handedTo, 'human');
    const h2 = a.db.handoffs.at(-1) as { owner: string; intent: string; summary: string; nextAction: string };
    assert.equal(h2.owner, 'human'); assert.equal(h2.intent, `${change} booking`);
    assert.ok(h2.summary.includes(LINE) && h2.summary.includes(message), 'the person sees the booking and the request');
    assert.equal(a.pending.items.length, 0, 'nothing held: no AI change is attempted');
    assert.equal(a.db.appointment?.starts, STARTS); assert.equal(a.db.contact.state, 'booked'); assert.equal(a.calendar.events.length, 0);
    assert.deepEqual(a.db.outbound, [{ message: turn.reply, prompt: SETTER_RETURNING_PROMPT_VERSION }]);
    assert.equal(a.db.jobs.length, 0); assertNothingSent(a.sent.map(() => ({ sent: false })));
    // A person now owns it: the next message gets no AI reply (withPerson) and the model is not called.
    a.db.messages.push({ direction: 'inbound', body: 'Any update?', agent: null, at: '' });
    const next = scripted([[say('Hi again!')]]);
    const t2 = await runSetterTurn(CID, a.deps(next.llm));
    assert.equal(t2.reply, null); assert.equal(next.rounds(), 0); assert.equal(a.db.outbound.length, 1);
  }
});

test('booked contact: a model asking for booking tools is refused (nothing re-qualified or re-booked)', async () => {
  const a = bookedSetup('automatic', 'Book me the first one again');
  const m = scripted([[tool('offer_times')], [tool('book_time', { start: '2026-11-11T02:00:00.000Z' }, 'b1')], [tool('set_stage', { stage: 'qualified', reason: 'x' }, 's1')], [say('Your booking stays as it is.')]]);
  const turn = await runSetterTurn(CID, a.deps(m.llm));
  for (const r of m.results) assert.match(r, /^Not available: this contact is already booked/);
  assert.equal(turn.booked, false); assert.equal(a.db.appointment?.starts, STARTS); assert.equal(a.calendar.events.length, 0);
  assert.deepEqual(a.db.states, ['booked']); assert.equal(a.pending.items.length, 0);

});

test('booked contact with no upcoming booking on file (all three modes): handed to a person in code, fixed line, no model call, no guessed time', async () => {
  for (const mode of MODES) {
    const b = bookedSetup(mode, 'When is my call?', false);
    const n = scripted([[say('Your call is on Friday at 3 pm.')]]);
    const t = await runSetterTurn(CID, b.deps(n.llm));
    assert.equal(n.rounds(), 0, 'model never called');
    assert.equal(t.reply, NO_BOOKING_SAY); assert.doesNotMatch(t.reply ?? '', /\d/, 'no time invented');
    assert.equal(t.handedTo, 'human'); assert.equal(t.actions.find(x => x.action === 'transfer')?.decision, 'perform');
    assert.deepEqual(b.db.handoffs.map(x => [x.owner, x.intent]), [['sales', 'run the booked call'], ['human', 'check booking']]);
    assert.deepEqual(b.db.outbound, [{ message: NO_BOOKING_SAY, prompt: SETTER_RETURNING_PROMPT_VERSION }]);
    assert.equal(b.pending.items.length, 0); assert.equal(b.db.jobs.length, 0); assert.equal(b.db.contact.state, 'booked');
  }
});

test('booked contact (all three modes): a model reply claiming the booking changed is never sent; fixed line + human handoff instead', async () => {
  const claims = ['Done! Your booking has been moved to Thursday at 2 pm.', 'No worries, I have cancelled it for you.', "All sorted, I've rescheduled your call.", 'Your booking is changed.'];
  for (const mode of MODES) for (const claim of claims) {
    const a = bookedSetup(mode, 'Can you push my call to Thursday?');
    const m = scripted([[say(claim)]]);
    const turn = await runSetterTurn(CID, a.deps(m.llm));
    assert.equal(turn.reply, RETURNING_HANDOFF_SAY, `${mode}: "${claim}" replaced`);
    assert.ok(!a.db.outbound.some(o => o.message === claim), 'the claim is never logged or sent');
    assert.deepEqual(a.db.outbound, [{ message: RETURNING_HANDOFF_SAY, prompt: SETTER_RETURNING_PROMPT_VERSION }]);
    assert.equal(turn.handedTo, 'human'); assert.equal(a.db.handoffs.at(-1)?.owner, 'human'); assert.equal(a.db.handoffs.length, 2);
    assert.equal(a.db.appointment?.starts, STARTS); assert.equal(a.pending.items.length, 0);
  }
  // After a handoff_receptionist this turn: still replaced, but no second hand-off is recorded.
  const r = bookedSetup('automatic', 'I have a billing question, and move my call');
  const m = scripted([[tool('handoff_receptionist', { intent: 'billing', summary: 'Billing question' })], [say('Sure, I moved your call.')]]);
  const turn = await runSetterTurn(CID, r.deps(m.llm));
  assert.equal(turn.reply, RETURNING_HANDOFF_SAY); assert.equal(turn.handedTo, 'receptionist');
  assert.deepEqual(r.db.handoffs.map(x => x.owner), ['sales', 'receptionist']);
  // A plain answer that only offers a change is sent as written.
  const ok = bookedSetup('automatic', 'Hi');
  const okm = scripted([[say(`You're booked for your ${LINE}. Would you like to keep it, or should I ask the team to move or cancel it?`)]]);
  const okTurn = await runSetterTurn(CID, ok.deps(okm.llm));
  assert.ok(okTurn.reply?.startsWith("You're booked for your")); assert.equal(okTurn.handedTo, null);
});

test('booked contact (all three modes): escalate_human without booking_change ends with the fixed line, never the model wording', async () => {
  for (const mode of MODES) {
    const a = bookedSetup(mode, 'Do you offer a discount on the next call?');
    const m = scripted([[tool('escalate_human', { intent: 'discount', summary: 'Asked for a discount' })], [say('Your booking has been moved and you get 50% off.')]]);
    const turn = await runSetterTurn(CID, a.deps(m.llm));
    assert.equal(m.rounds(), 1, 'the model is not asked to word it');
    assert.equal(turn.reply, RETURNING_HANDOFF_SAY); assert.equal(turn.handedTo, 'human');
    assert.equal(turn.actions.find(x => x.action === 'transfer')?.decision, 'perform');
    assert.deepEqual(a.db.outbound, [{ message: RETURNING_HANDOFF_SAY, prompt: SETTER_RETURNING_PROMPT_VERSION }]);
  }
});

test('booked contact + model failure (A-55 on a returning turn): fixed fallback reply, human handoff, fallback prompt version', async () => {
  const a = bookedSetup('automatic', 'Hi, quick question about my call');
  const turn = await runSetterTurn(CID, a.deps(async () => { throw new Error('AI provider error (500).'); }));
  assert.equal(turn.reply, SETTER_FALLBACK_REPLY); assert.equal(turn.modelFailure, 'provider_500');
  assert.equal(turn.handedTo, 'human'); assert.equal(a.db.handoffs.at(-1)?.owner, 'human');
  assert.deepEqual(a.db.outbound, [{ message: SETTER_FALLBACK_REPLY, prompt: SETTER_FALLBACK_PROMPT }]);
  assert.equal(a.db.contact.state, 'booked'); assert.equal(a.db.appointment?.starts, STARTS); assert.equal(a.db.jobs.length, 0);
});

test('the main Setter prompt is unchanged for unbooked contacts (no returning rules, all six tools)', async () => {
  const a = agentSetup('automatic', lead('qualified', [{ direction: 'inbound', body: 'Hi' }]));
  const seen: string[][] = [];
  const m = scripted([[say('What is the main problem?')]]);
  await runSetterTurn(CID, a.deps(async (req) => { seen.push((req.tools ?? []).map(t => t.name)); return m.llm(req); }));
  assert.equal(seen[0].length, 6); assert.ok(seen[0].includes('book_time'));
  assert.doesNotMatch(m.systems[0], /Their booking:/);
  assert.equal(a.db.outbound[0].prompt, 'setter/qualify@3');
});

// ---------------------------------------------------------------------------------------------------------------
async function labBooked(mode: Mode): Promise<LabState> {
  let s = await runLabTurn(newLab(mode), { message: "Hi, I'm Sam. I run a gym in Fremantle. We get about 40 enquiries a week from Instagram. We are slow to reply and miss a lot of them. I want it fixed this week." });
  s = await runLabTurn(s, { message: 'The last one please.' });
  assert.equal(s.tables.contacts[0].state, 'booked');
  return s;
}
test('Setter Lab: a booked contact writing again is told the booking; asking to move or cancel hands it to a person with the fixed line (same code path as web chat)', async () => {
  let s = await labBooked('automatic');
  const label = formatSlot(Date.parse(s.tables.appointments[0].starts), LAB_CONFIG.availability.timeZone);
  s = await runLabTurn(s, { message: 'Hi, what time is my call again?' });
  const t = s.turns.at(-1)!;
  assert.match(t.route, /^sales:/); assert.equal(t.error, null);
  assert.ok(t.reply?.includes(label) && t.reply.includes(LAB_CONFIG.where), `${t.reply}`);
  assert.deepEqual(t.tools, []);
  assert.equal(s.tables.messages.at(-1)?.prompt_version, SETTER_RETURNING_PROMPT_VERSION);

  for (const [message, change] of [['Can I move it to Thursday?', 'reschedule'], ['Please cancel my call.', 'cancel']] as const) {
    let r = await labBooked('automatic');
    r = await runLabTurn(r, { message });
    const x = r.turns.at(-1)!;
    assert.deepEqual(x.tools.map(y => [y.name, y.input.booking_change]), [['escalate_human', change]]);
    assert.equal(x.reply, BOOKING_CHANGE_SAY[change]); assert.equal(x.handedTo, 'human');
    assert.equal(r.tables.handoffs.at(-1)?.owner, 'human');
    assert.equal(r.tables.appointments.length, 1); assert.equal(r.calendar.length, 1); assert.equal(r.tables.contacts[0].state, 'booked');
    assertNothingSent(r.wouldSend); assertOutboundTagged(r.tables.messages.filter(m => m.direction === 'outbound'));
  }
});

test('Setter Lab (A-70): a booked contact asking for a person gets escalate_human and the fixed hand-off words; ordinary messages do not hand off', async () => {
  for (const message of ['Can I talk to a person?', 'can i talk to someone', 'I want to speak to a real person please', 'Can I speak with a human?']) {
    const r = await labBooked('automatic');
    const s = await runLabTurn(r, { message });
    const x = s.turns.at(-1)!;
    assert.deepEqual(x.tools.map(y => y.name), ['escalate_human'], message);
    assert.equal(x.reply, RETURNING_HANDOFF_SAY, message); assert.equal(x.handedTo, 'human', message);
    assert.equal(s.tables.handoffs.at(-1)?.owner, 'human'); assert.equal(s.tables.appointments.length, 1);
  }
  for (const message of ['Someone recommended you to me', 'Can someone fix my lashes?', 'Hi, what time is my call again?']) {
    const s = await runLabTurn(await labBooked('automatic'), { message });
    const x = s.turns.at(-1)!;
    assert.ok(!x.tools.some(y => y.name === 'escalate_human'), `${message}: no hand-off`);
    assert.equal(x.handedTo, null, message);
  }
});

// ---------------------------------------------------------------------------------------------------------------
test('other channels are unchanged: SMS, email and Meta pass only a setter hook, so a booked contact gets no AI turn; setterHooks takes booked contacts too', async () => {
  const auth = { channel: '44444444-4444-4444-8444-444444444444', key: 'k'.repeat(40) };
  const rpc = async (fn: string) => fn.startsWith('fo_ingest') ? { contact: 'c9', state: 'booked', created: false, duplicate: false, optedOut: false } : null;
  const onlySetter: string[] = [];
  const sms = await handleInboundSms(rpc, auth, { from: '+61411111111', to: '+61400000000', body: 'hi', messageSid: 'SM1' }, { setter: c => onlySetter.push(c) });
  const email = await handleInbound(rpc, auth, { via: 'email', sender: 'sam@example.com', body: 'hi', messageId: 'e1' }, { setter: c => onlySetter.push(c) });
  const meta = await handleInbound(rpc, auth, { via: 'instagram', sender: 'ig1', body: 'hi', messageId: 'ig-1' }, { setter: c => onlySetter.push(c) });
  for (const r of [sms, email, meta]) { assert.equal(r.route.agent, 'sales'); assert.equal(r.reply, null); }
  assert.deepEqual(onlySetter, [], 'no AI turn for booked contacts on SMS, email or Meta');
  const taken: string[] = [];
  const chat = await handleInbound(rpc, auth, { via: 'web-chat', sender: 'v_abcdefghijklmnop', body: 'hi', messageId: 'chat-1' }, setterHooks(c => taken.push(c)));
  assert.equal(chat.route.agent, 'sales'); assert.deepEqual(taken, ['c9']);
  // A STOP still ends the turn with the system reply; no agent turn.
  const stop = await handleInbound(async (fn) => fn.startsWith('fo_ingest') ? { contact: 'c9', state: 'booked', created: false, duplicate: false, optedOut: true } : null, auth, { via: 'web-chat', sender: 'v_abcdefghijklmnop', body: 'STOP', messageId: 'chat-2' }, setterHooks(c => taken.push(c)));
  assert.equal(stop.route.agent, null); assert.deepEqual(taken, ['c9']);
});

// ---------------------------------------------------------------------------------------------------------------
test('real chat route (H-DB, all three modes): booked visitor asks to move the call -> person, mode words, booking unchanged; the next message gets no AI reply', async () => {
  for (const mode of MODES) {
    const s = await h.dbSetup('automatic');
    const restore = h.dbEnv(s.channel, true);
    const w = h.dbWorld(s.rpc, (body) => {
      if (!/^Their booking: /m.test(body.system)) return h.offerThenBook(body);
      const last = body.messages.at(-1)?.content;
      const text = typeof last === 'string' ? last.split('\n').at(-1) ?? '' : '';
      if (/\bmove\b/i.test(text)) return [tool('escalate_human', { intent: 'reschedule booking', summary: text, booking_change: 'reschedule' })];
      return [say('Your booking has been moved.')];
    });
    try {
      const booked = await h.dbSend(`rb${mode.slice(0, 3)}000001`, 'Can I book a call?');
      assert.equal(booked.status, 200); assert.equal(booked.body.booked, true);
      // The owner changes the Setter mode after the booking was made.
      await s.rows('update public.fo_agent_settings set setter_mode = $2 where workspace_id = $1', [s.w, mode]);
      const res = await h.dbSend(`rb${mode.slice(0, 3)}000002`, 'Can I move it to Thursday afternoon?');
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.reply, changeSay(mode, 'reschedule'), mode); assert.equal(res.body.booked, false); assert.equal(res.body.live, true);
      const db = await h.dbSnapshot(s);
      assert.deepEqual(db.handoffs.map(x => [x.from_agent, x.owner]), [['setter', 'sales'], ['setter', 'human']]);
      assert.equal(db.contact[0].state, 'booked'); assert.equal(db.appointments.length, 1); assert.equal(db.appointments[0].status, 'booked');
      assert.equal(w.events.length, 1); assert.equal(db.pending.length, 0);
      const out = db.messages.filter(m => m.direction === 'outbound');
      assert.deepEqual([out.at(-1)?.body, out.at(-1)?.prompt_version], [changeSay(mode, 'reschedule'), SETTER_RETURNING_PROMPT_VERSION]);
      assertOutboundTagged(out);
      const calls = w.llmCalls();
      const next = await h.dbSend(`rb${mode.slice(0, 3)}000003`, 'Any update?');
      assert.equal(next.status, 200); assert.equal(next.body.reply, null);
      assert.equal(w.llmCalls(), calls, 'no model call while a person has the lead');
      const after = await h.dbSnapshot(s);
      assert.equal(after.messages.filter(m => m.direction === 'outbound').length, out.length);
      assert.deepEqual(w.rpcErrors, []); assert.deepEqual(w.errors, []);
      assert.ok(w.hosts.every(x => h.ALLOWED_HOSTS.has(x)), w.hosts.join(', '));
    } finally { w.restore(); restore(); await s.db.close(); }
  }
});

test('real chat route, chat switched off: a booked visitor gets the honest "with the team" note and no model call', async () => {
  const s = await h.dbSetup('automatic');
  let restore = h.dbEnv(s.channel, true);
  let w = h.dbWorld(s.rpc);
  try { assert.equal((await h.dbSend('rboff0000001', 'Can I book a call?')).body.booked, true); } finally { w.restore(); restore(); }
  restore = h.dbEnv(s.channel, false);
  w = h.dbWorld(s.rpc);
  try {
    const res = await h.dbSend('rboff0000002', 'When is my call?');
    assert.equal(res.status, 200); assert.equal(res.body.reply, null); assert.equal(res.body.live, false);
    assert.match(String(res.body.note), /with the team/);
    assert.equal(w.llmCalls(), 0);
  } finally { w.restore(); restore(); await s.db.close(); }
});
