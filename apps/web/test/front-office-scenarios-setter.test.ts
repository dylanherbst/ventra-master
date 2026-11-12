// A-28 / A-49: the Setter QA scenario suite S1-S12 in Demo mode (spec docs/agents/briefs/A-28_QA_SCENARIOS.md sections
// 0, 1 and 5). Scripted models, in-memory or PGlite stores, global fetch trapped, nothing sent, cost 0. Each scenario
// writes one JSON record through the recorder in helpers/front-office-scenarios.ts and asserts outcomes (state, rows,
// tool calls, permission decisions), not wording. Known code gaps (section 6) are pinned as today's safe baseline plus a
// test.todo naming the gap.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const h = await import('./helpers/front-office-scenarios.ts');
const { tool, say, scripted, lead, agentSetup, AGENT_NOW, CID, OWNER, assertNothingSent, assertOutboundTagged, assertNoFalseBooking, BOOKED_WORDING } = h;
const { newLab, runLabTurn, runLabTurnWith, decideLabAction, labStore, scriptedSetterModel, LAB_CONFIG, LAB_AUTH } = await import('../lib/front-office/setter/lab.ts');
const { runSetterTurn, SETTER_FALLBACK_REPLY, SETTER_FALLBACK_PROMPT } = await import('../lib/front-office/setter/agent.ts');
const { inQuietHours } = await import('../lib/front-office/setter/actions.ts');
const { decide } = await import('../lib/front-office/permissions.ts');
const { offerTimes } = await import('../lib/front-office/booking.ts');
const { approvePendingAction } = await import('../lib/front-office/pending-actions.ts');
const { handleInboundSms } = await import('../lib/front-office/orchestrator.ts');
const { anthropicLlm } = await import('../lib/front-office/llm.ts');
const { localParts, formatSlot } = await import('../lib/front-office/calendar/slots.ts');
const { SETTER_RETURNING_PROMPT_VERSION } = await import('../lib/front-office/setter/prompt.ts');
const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');
const { checkedAgentSettings, checkedKnowledge, templateSettings, setterConfigFor } = await import('../lib/front-office/settings.ts');
type LabState = import('../lib/front-office/setter/lab.ts').LabState;
type Mode = import('../lib/front-office/contracts.ts').OperatingMode;
type Llm = import('../lib/front-office/llm.ts').Llm;
type ScenarioToolCall = import('./helpers/front-office-scenarios.ts').ScenarioToolCall;

const trap = h.trapFetch();
before(() => trap.install());
after(() => { trap.restore(); assert.deepEqual(trap.attempts, [], 'no network calls'); });

const rec = h.createRecorder();
const MODES: Mode[] = ['automatic', 'owner_approval', 'enquiry_only'];
const QUALIFY = 'Hi, I\'m Sam. I run a gym in Fremantle. We get about 40 enquiries a week from Instagram. We are slow to reply and miss a lot of them. I want it fixed this week.';
const PRICE_OR_DIGIT = /[$\d]/;

/** Lab globals: nothing sent, every outbound tagged, no booked wording without an appointment. */
function labGlobals(s: LabState) {
  assertNothingSent(s.wouldSend);
  assertOutboundTagged(s.tables.messages.filter(m => m.direction === 'outbound'));
  assertNoFalseBooking(s.turns.map(t => t.reply), s.tables.appointments);
}
const labTools = (s: LabState): ScenarioToolCall[] => s.turns.flatMap(t => t.tools.map(({ name, input, result, isError }) => ({ name, input, result, isError })));
const labDb = (s: LabState) => ({ ...s.tables, pending: s.pending, calendar: s.calendar, wouldSend: s.wouldSend });
const toOffer = async (mode: Mode) => runLabTurn(newLab(mode), { message: QUALIFY });

// ---------------------------------------------------------------------------------------------------------------
test('S1 new lead (H-LAB, automatic): one question back, at most qualifying, no booking tools, prompt names the business AI', async () => {
  await rec.scenario({ id: 'S1', operatingMode: 'automatic', expected: 'new -> at most qualifying; 1 in + 1 out; one question; no appointment/pending/handoff; no offer_times/book_time' }, async (c) => {
    const systems: string[] = [];
    const base = scriptedSetterModel();
    const spy: Llm = async (req) => { systems.push(req.system); return base(req); };
    const message = 'Hi, saw your ad. What do you do?';
    c.input(message);
    const s = await runLabTurnWith(newLab('automatic'), { message }, { base: spy, model: 'scripted' });
    const t = s.turns[0];
    c.output({ reply: t.reply, state: t.state }); c.tools(...labTools(s)); c.db(labDb(s));
    assert.equal(t.error, null);
    assert.ok(t.state === 'new' || t.state === 'qualifying', `state ${t.state}`);
    assert.equal(s.tables.messages.filter(m => m.direction === 'inbound').length, 1);
    assert.equal(s.tables.messages.filter(m => m.direction === 'outbound').length, 1);
    assert.equal((t.reply?.match(/\?/g) ?? []).length, 1, 'exactly one question');
    for (const x of t.tools) assert.ok(['save_answers', 'set_stage'].includes(x.name), `allowed tool only: ${x.name}`);
    assert.equal(s.tables.appointments.length, 0); assert.equal(s.pending.length, 0); assert.equal(s.tables.handoffs.length, 0);
    // The scripted model does not write the greeting; the prompt rule that makes the real model do it is checked here.
    assert.ok(systems[0].includes(`You are the AI assistant for ${LAB_CONFIG.businessName}`));
    assert.ok(systems[0].includes('Your first message to a contact names the business and that you are its AI assistant'));
    labGlobals(s);
    c.actual(`state ${t.state}, tools [${t.tools.map(x => x.name).join(', ')}]`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test('S2 pricing (H-LAB + H-AGENT, all three modes): escalated to a person, no number or currency, nothing held', async () => {
  for (const mode of MODES) {
    await rec.scenario({ id: 'S2', operatingMode: mode, expected: 'escalate_human; human handoff; no number/currency; 0 pending; transfer performs in every mode' }, async (c) => {
      const message = 'How much does it cost?';
      c.input(message);
      const s = await runLabTurn(newLab(mode), { message });
      const t = s.turns[0];
      c.output({ lab: t.reply });
      assert.equal(t.error, null);
      assert.deepEqual(t.tools.map(x => x.name), ['escalate_human']);
      assert.equal(t.handedTo, 'human');
      assert.deepEqual(s.tables.handoffs.map(x => x.owner), ['human']);
      assert.doesNotMatch(t.reply ?? '', PRICE_OR_DIGIT, 'no price invented');
      assert.equal(s.pending.length, 0); assert.equal(s.tables.appointments.length, 0);
      assert.equal(decide(mode, 'transfer').decision, 'perform', 'TODO(A-14): transfer always performs today');
      labGlobals(s);

      // The production permission path (gate() with the business's mode).
      const a = agentSetup(mode, lead('qualifying', [{ direction: 'inbound', body: message }]));
      const m = scripted([[tool('escalate_human', { intent: 'pricing question', summary: message })], [say('Good question. A person from the team will get back to you on that.')]]);
      const turn = await runSetterTurn(CID, a.deps(m.llm));
      c.output({ agent: turn.reply }); c.tools(...labTools(s), ...m.calls());
      assert.equal(turn.actions.find(x => x.action === 'transfer')?.decision, 'perform');
      assert.equal(turn.handedTo, 'human'); assert.equal(a.db.handoffs[0].owner, 'human');
      assert.doesNotMatch(turn.reply ?? '', PRICE_OR_DIGIT);
      assert.equal(a.pending.items.length, 0); assert.equal(a.db.appointment, null);
      c.db({ lab: labDb(s), agent: a.db });
      c.actual(`lab tools [${t.tools.map(x => x.name)}], agent transfer ${turn.actions.find(x => x.action === 'transfer')?.decision}`);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
test('S3 qualified (H-LAB, automatic): answers under config ids, qualified, 2-3 real offered times in the reply, no appointment', async () => {
  await rec.scenario({ id: 'S3', operatingMode: 'automatic', expected: 'save_answers, set_stage(qualified), offer_times; reply lists 2-3 offered labels; no appointment' }, async (c) => {
    const message = `${QUALIFY} Email me at sam@example.com`;
    c.input(message);
    const s = await runLabTurn(newLab('automatic'), { message });
    const t = s.turns[0];
    c.output({ reply: t.reply, state: t.state }); c.tools(...labTools(s)); c.db(labDb(s));
    assert.equal(t.error, null);
    assert.deepEqual(t.tools.map(x => x.name), ['save_answers', 'set_stage', 'offer_times']);
    const ids = new Set(LAB_CONFIG.questions.map(q => q.id));
    for (const k of Object.keys(t.tools[0].input.answers as Record<string, string>)) assert.ok(ids.has(k), `answer under a config id: ${k}`);
    assert.equal(t.tools[1].input.stage, 'qualified');
    assert.equal(t.state, 'qualified');
    const contact = s.tables.contacts[0];
    assert.deepEqual(Object.keys(contact.answers).sort(), LAB_CONFIG.questions.filter(q => q.required).map(q => q.id).sort());
    assert.equal(contact.name, 'Sam'); assert.equal(contact.email, 'sam@example.com');
    const offers = JSON.parse(t.tools[2].result ?? '[]') as { label: string; start: string }[];
    assert.ok(offers.length >= 2 && offers.length <= 3, `${offers.length} offers`);
    for (const o of offers) assert.ok(t.reply?.includes(o.label), `reply offers ${o.label}`);
    assert.equal(s.tables.appointments.length, 0); assert.equal(t.booking, null);
    labGlobals(s);
    c.actual(`state ${t.state}, ${offers.length} offers`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test('S4 unqualified (H-AGENT, automatic): disqualified, no times offered, no follow-ups, no pitch', async () => {
  const cases = [
    { message: 'Who is this? Wrong number', reply: 'Sorry for the mix-up. We will not message again.' },
    { message: 'Just curious, I do not have a business, I am a student.', reply: 'Thanks for letting me know. This is built for businesses, so it would not suit you right now. All the best with your studies.' },
  ];
  for (const k of cases) {
    await rec.scenario({ id: 'S4', operatingMode: 'automatic', expected: 'set_stage(disqualified); no offer_times; no jobs; polite, no pitch' }, async (c) => {
      c.input(k.message);
      const a = agentSetup('automatic', lead('new', [{ direction: 'inbound', body: k.message }]));
      const m = scripted([[tool('set_stage', { stage: 'disqualified', reason: 'Not a fit' })], [say(k.reply)]]);
      const turn = await runSetterTurn(CID, a.deps(m.llm));
      c.output(turn.reply); c.tools(...m.calls()); c.db(a.db);
      assert.equal(turn.state, 'disqualified'); assert.equal(a.db.contact.state, 'disqualified');
      assert.ok(!turn.tools.includes('offer_times') && !turn.tools.includes('book_time'));
      assert.equal(a.db.jobs.length, 0, 'no follow-ups or reminders');
      assert.equal(a.db.handoffs.length, 0); assert.equal(a.pending.items.length, 0); assert.equal(a.db.appointment, null);
      assert.doesNotMatch(turn.reply ?? '', /\b(book|offer|price|deal)\b|\$/i, 'no pitch');
      assert.ok(turn.reply, 'still answered politely');
      c.actual(`state ${turn.state}, jobs ${a.db.jobs.length}`);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
test('S5 booking, automatic (H-LAB): one appointment and event, booked, sales handoff, reminders; a replay books nothing more', async () => {
  await rec.scenario({ id: 'S5', operatingMode: 'automatic', expected: '1 appointment, 1 event, booked, sales handoff, reminders; replay books nothing more' }, async (c) => {
    // The last offered time: far enough ahead that both reminders are due after LAB_NOW (jobs.ts scheduleReminders).
    c.input(QUALIFY, 'The last one please.', 'The last one please.');
    let s = await runLabTurn(await toOffer('automatic'), { message: 'The last one please.' });
    const t = s.turns[1];
    assert.equal(t.booking?.decision, 'perform'); assert.equal(t.booking?.booked, true);
    assert.equal(t.state, 'booked');
    assert.equal(s.tables.appointments.length, 1); assert.ok(s.tables.appointments[0].event_id);
    assert.equal(s.calendar.length, 1);
    assert.ok(s.tables.handoffs.some(x => x.owner === 'sales'), 'handed to Sales');
    assert.ok(s.tables.jobs.some(j => j.kind.startsWith('reminder') && j.status === 'pending'), 'reminders scheduled');
    assert.ok(!s.tables.jobs.some(j => j.kind === 'follow-up' && j.status === 'pending'), 'no follow-up after a booking');
    assert.equal(s.pending.length, 0);
    assert.match(t.reply ?? '', BOOKED_WORDING, 'the confirmation is the reply');
    // The same pick again: the contact is booked, so the router hands it to Sales and nothing new is booked. Since A-54
    // (G1) the Setter answers with the booking it already has, using no booking tools.
    s = await runLabTurn(s, { message: 'The last one please.' });
    assert.equal(s.tables.appointments.length, 1, 'still one appointment'); assert.equal(s.calendar.length, 1, 'still one event');
    assert.match(s.turns[2].route, /^sales:/);
    assert.ok(s.turns[2].reply?.includes(formatSlot(Date.parse(s.tables.appointments[0].starts), LAB_CONFIG.availability.timeZone)), `the booking is restated: ${s.turns[2].reply}`);
    assert.deepEqual(s.turns[2].tools, [], 'no booking tools on the replay');
    labGlobals(s);
    c.output(...s.turns.map(x => x.reply)); c.tools(...labTools(s)); c.db(labDb(s));
    c.actual(`appointments ${s.tables.appointments.length}, events ${s.calendar.length}`);
  });
});

test('S5 booking, owner approval (H-LAB + H-AGENT): held with decide() words; approve books once; reject books none', async () => {
  await rec.scenario({ id: 'S5', operatingMode: 'owner_approval', expected: '1 pending book (setter:book:<contact>:<start>), no appointment, reply = decide().say; approve once; reject none' }, async (c) => {
    c.input(QUALIFY, 'The last one please.');
    let s = await runLabTurn(await toOffer('owner_approval'), { message: 'The last one please.' });
    const t = s.turns[1];
    assert.equal(t.booking?.decision, 'hold_for_approval');
    assert.equal(t.reply, decide('owner_approval', 'book').say);
    assert.equal(s.tables.appointments.length, 0); assert.equal(s.calendar.length, 0); assert.equal(t.state, 'qualified');
    assert.equal(s.pending.length, 1); assert.equal(s.pending[0].status, 'pending');
    labGlobals(s);
    const id = s.pending[0].id;
    s = await decideLabAction(s, id, 'approve');
    assert.equal(s.decisions[0].outcome, 'performed');
    assert.equal(s.tables.appointments.length, 1); assert.equal(s.calendar.length, 1); assert.equal(s.tables.contacts[0].state, 'booked');
    s = await decideLabAction(s, id, 'approve');
    assert.equal(s.decisions[1].outcome, 'already_decided');
    assert.equal(s.tables.appointments.length, 1, 'approve books exactly once'); assert.equal(s.calendar.length, 1);
    assertNothingSent(s.wouldSend);

    let r = await runLabTurn(await toOffer('owner_approval'), { message: 'The second one.' });
    r = await decideLabAction(r, r.pending[0].id, 'reject');
    assert.equal(r.decisions[0].outcome, 'rejected'); assert.equal(r.tables.appointments.length, 0); assert.equal(r.calendar.length, 0);

    // Production path: the held item's idempotency key is setter:book:<contact>:<start>.
    const a = agentSetup('owner_approval');
    const slot = (await offerTimes(a.calendar, ventraSetterConfig.availability, AGENT_NOW))[0];
    const m = scripted([[tool('book_time', { start: new Date(slot.start).toISOString() })]]);
    const turn = await runSetterTurn(CID, a.deps(m.llm));
    assert.equal(a.pending.items.length, 1); assert.equal(a.pending.items[0].payload.kind, 'book');
    assert.equal(a.pending.items[0].idempotencyKey, `setter:book:${CID}:${slot.start}`);
    assert.equal(turn.reply, decide('owner_approval', 'book').say); assert.equal(turn.booked, false);
    assert.equal(a.db.appointment, null); assert.equal(a.calendar.events.length, 0);
    c.output(t.reply, turn.reply); c.tools(...labTools(s), ...m.calls()); c.db({ approved: labDb(s), rejected: labDb(r), agent: { pending: a.pending.items, appointment: a.db.appointment } });
    c.actual(`held -> approve x2: ${s.decisions.map(d => d.outcome)}; reject: ${r.decisions[0].outcome}`);
  });
});

test('S5 booking, enquiry only (H-LAB + H-AGENT): no appointment, nothing held, human handoff, decide() words; offer_times refuses', async () => {
  await rec.scenario({ id: 'S5', operatingMode: 'enquiry_only', expected: 'no appointment/pending; human handoff; reply = decide().say; offer_times refuses' }, async (c) => {
    c.input(QUALIFY, 'The first one please.');
    const s = await runLabTurn(await toOffer('enquiry_only'), { message: 'The first one please.' });
    const t = s.turns[1];
    assert.equal(t.booking?.decision, 'refuse');
    assert.equal(t.reply, decide('enquiry_only', 'book').say);
    assert.equal(s.tables.appointments.length, 0); assert.equal(s.calendar.length, 0); assert.equal(s.pending.length, 0);
    assert.equal(t.handedTo, 'human'); assert.ok(s.tables.handoffs.some(x => x.owner === 'human'));
    labGlobals(s);

    const a = agentSetup('enquiry_only');
    const m = scripted([[tool('offer_times')], [say('Which day and time would suit you? The team will get back to you to arrange it.')]]);
    const turn = await runSetterTurn(CID, a.deps(m.llm));
    assert.match(m.results[0], /You cannot offer or book times/);
    assert.equal(a.calendar.events.length, 0); assert.equal(a.db.appointment, null); assert.equal(a.pending.items.filter(x => x.payload.kind === 'book').length, 0);
    assert.equal(turn.booked, false);
    c.output(t.reply, turn.reply); c.tools(...labTools(s), ...m.calls()); c.db({ lab: labDb(s), agent: a.db });
    c.actual(`booking ${t.booking?.decision}, offer_times: ${m.results[0]}`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// S6: the knowledge base's objection rules drive the reply (prompt.ts knowledgeLines). The model stand-in does only what
// the system prompt says (as promptFollower in front-office-knowledge.test.ts), and calls escalate_human only when the
// rule says so.
const kb = checkedKnowledge({
  services: [{ id: 'pt', name: 'Personal training', description: 'One-on-one with a coach.', priceAud: 80, priceUnit: 'per session', durationMinutes: 60 }],
  offers: [{ id: 'intro', name: 'Intro week', details: 'Seven days of unlimited classes for new members.', priceAud: 29, validUntil: '2026-12-31' }],
  policies: [],
  objections: [
    { id: 'price', triggers: ['too expensive', "can't afford"], response: 'Totally fair. The intro week is $29, so you can try it before committing to anything.', escalate: false },
    { id: 'think', triggers: ['need to think'], response: 'Of course, take your time. Someone from the team can answer any questions.', escalate: true },
  ],
});
const gymConfig = setterConfigFor(checkedAgentSettings({ ...templateSettings('gym', 'Iron Gym'), hours: { 1: [['09:00', '17:00']] }, knowledge: kb }));
function objectionFollower() {
  let matched: { reply: string; escalate: boolean } | null = null;
  const llm: Llm = async (req) => {
    const last = req.messages.at(-1);
    if (typeof last?.content === 'string') {
      const said = last.content.toLowerCase();
      matched = null;
      for (const l of req.system.split('\n')) {
        const m = l.match(/^- "(.+)": (.+?)( Then call escalate_human.*)?$/);
        if (m && m[1].split('", "').some(x => said.includes(x))) { matched = { reply: m[2], escalate: !!m[3] }; break; }
      }
      if (matched?.escalate) return { content: [tool('escalate_human', { intent: 'objection', summary: last.content })], stopReason: 'tool_use' };
    }
    return { content: [say(matched?.reply ?? 'What are you hoping to achieve?')], stopReason: 'end_turn' };
  };
  return llm;
}
test('S6 objection (H-AGENT + knowledge, automatic): the owner rule answers it; escalates only when the rule says so; no invented discount', async () => {
  for (const k of [{ message: "Honestly that's too expensive for me", escalate: false }, { message: 'I need to think about it', escalate: true }]) {
    await rec.scenario({ id: 'S6', operatingMode: 'automatic', expected: `objection rule reply; escalate ${k.escalate}; no booking; no invented discount` }, async (c) => {
      c.input(k.message);
      const a = agentSetup('automatic', lead('qualifying', [{ direction: 'inbound', body: k.message }]));
      const systems: string[] = [];
      const base = objectionFollower();
      const turn = await runSetterTurn(CID, a.deps(async (req) => { systems.push(req.system); return base(req); }, { config: gymConfig }));
      c.output(turn.reply); c.tools(...turn.tools.map(name => ({ name, input: null, result: null, isError: false }))); c.db(a.db);
      const rule = kb.objections.find(o => k.message.toLowerCase().includes(o.triggers[0]))!;
      assert.equal(turn.reply, rule.response, 'the owner\'s objection reply');
      assert.equal(turn.tools.includes('escalate_human'), k.escalate);
      assert.equal(turn.handedTo, k.escalate ? 'human' : null);
      assert.equal(a.db.handoffs.length, k.escalate ? 1 : 0);
      assert.equal(turn.booked, false); assert.equal(a.db.appointment, null);
      assert.doesNotMatch(turn.reply ?? '', /discount|% off|half price|free/i);
      for (const n of (turn.reply ?? '').match(/\d+/g) ?? []) assert.ok(systems[0].includes(n), `number ${n} is on file`);
      c.actual(`reply from rule ${rule.id}, escalated ${turn.tools.includes('escalate_human')}`);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
test('S7 wants a human (H-AGENT, all three modes; H-LAB deal trigger): handed to a person, AI then stays quiet, never claims to be human', async () => {
  const CLAIMS_HUMAN = /\bI(?:'m| am) (?:a )?(?:human|real person|real)\b/i;
  for (const mode of MODES) {
    await rec.scenario({ id: 'S7', operatingMode: mode, expected: 'escalate_human; fo_handoffs owner human; next inbound gets no AI reply; never claims to be human' }, async (c) => {
      const message = 'Can I talk to a real person?';
      c.input(message, 'Hello? Anyone there?');
      const a = agentSetup(mode, lead('qualifying', [{ direction: 'inbound', body: message }]));
      const m = scripted([[tool('escalate_human', { intent: 'wants a person', summary: message })], [say('Sure. I am the Ventra AI assistant, and a person from the team will be in touch soon.')]]);
      const turn = await runSetterTurn(CID, a.deps(m.llm));
      assert.equal(turn.actions.find(x => x.action === 'transfer')?.decision, 'perform');
      assert.equal(turn.handedTo, 'human'); assert.equal(a.db.handoffs.length, 1); assert.equal(a.db.handoffs[0].owner, 'human');
      assert.doesNotMatch(turn.reply ?? '', CLAIMS_HUMAN);
      a.db.messages.push({ direction: 'inbound', body: 'Hello? Anyone there?', agent: null, at: '' });
      const outBefore = a.db.outbound.length;
      const next = scripted([[say('Hi again!')]]);
      const t2 = await runSetterTurn(CID, a.deps(next.llm));
      assert.equal(t2.reply, null); assert.equal(next.rounds(), 0, 'model never called'); assert.equal(a.db.outbound.length, outBefore);

      // Demo lab: the scripted model has no "human" trigger (G7), so the escalation is driven by "deal".
      const s = await runLabTurn(newLab(mode), { message: 'Can I talk to someone about a deal?' });
      assert.deepEqual(s.turns[0].tools.map(x => x.name), ['escalate_human']);
      assert.ok(s.tables.handoffs.some(x => x.owner === 'human'));
      assert.doesNotMatch(s.turns[0].reply ?? '', CLAIMS_HUMAN);
      labGlobals(s);
      c.output(turn.reply, t2.reply, s.turns[0].reply); c.tools(...m.calls(), ...labTools(s)); c.db({ agent: a.db, lab: labDb(s) });
      c.actual(`handoff ${a.db.handoffs[0].owner}, second turn reply ${t2.reply}`);
    });
  }
});
test.todo('S7 G7: the Setter prompt has no plain "talk to a person" rule and the lab script has no "human" trigger (setter/prompt.ts:71-72, setter/lab.ts:273)');
test('S7 lab fidelity (H-LAB, all three modes, A-61): after a hand-off to a person the lab AI stays quiet like production', async () => {
  for (const mode of MODES) {
    await rec.scenario({ id: 'S7-lab', operatingMode: mode, expected: 'lab: escalate_human; next inbound stored, no model call, no AI reply, no outbound; turn says a person is looking after this contact' }, async (c) => {
      c.input('Can I talk to someone about a deal?', 'Hello? Anyone there?');
      const s1 = await runLabTurn(newLab(mode), { message: 'Can I talk to someone about a deal?' });
      assert.equal(s1.turns[0].handedTo, 'human');
      const outBefore = s1.tables.messages.filter(m => m.direction === 'outbound').length;
      let calls = 0;
      const base = scriptedSetterModel();
      const spy: Llm = async (req) => { calls++; return base(req); };
      const s2 = await runLabTurnWith(s1, { message: 'Hello? Anyone there?' }, { base: spy, model: 'scripted' });
      const t = s2.turns[1];
      assert.equal(t.error, null);
      assert.equal(t.reply, null, 'no AI reply');
      assert.equal(calls, 0, 'model never called');
      assert.deepEqual(t.tools, []);
      assert.equal(s2.tables.messages.filter(m => m.direction === 'outbound').length, outBefore, 'nothing new outbound');
      assert.equal(s2.tables.messages.filter(m => m.direction === 'inbound').at(-1)?.body, 'Hello? Anyone there?', 'the message is still stored');
      assert.match(t.route, /A person is looking after this contact/);
      labGlobals(s2);
      c.output(s1.turns[0].reply, t.reply); c.tools(...labTools(s2)); c.db(labDb(s2));
      c.actual(`second lab turn reply ${t.reply}, model calls ${calls}`);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
test('S8 interruption (H-AGENT + H-LAB, automatic): consecutive messages merge, answers kept and not re-asked, a replayed message id is a no-op', async () => {
  await rec.scenario({ id: 'S8', operatingMode: 'automatic', expected: 'consecutive inbound merge; nothing re-asked; replayed msg_id no-op; state kept' }, async (c) => {
    const three = ['Hi, I run a gym in Perth', 'oh wait', 'are you open on weekends? we get about 40 enquiries a week'];
    c.input(...three);
    // H-AGENT: three inbound before any reply reach the model as one user turn.
    const a = agentSetup('automatic', lead('qualifying', three.map(body => ({ direction: 'inbound' as const, body }))));
    a.db.contact.answers.business = 'Gym in Perth';
    const seen: { messages: unknown[]; system: string }[] = [];
    const llm: Llm = async (req) => { seen.push({ messages: structuredClone(req.messages), system: req.system }); return { content: [say('Thanks. What is the main problem with how you handle them now?')], stopReason: 'end_turn' }; };
    const turn = await runSetterTurn(CID, a.deps(llm));
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].messages, [{ role: 'user', content: three.join('\n') }], 'one merged user turn');
    assert.match(seen[0].system, /Answers so far: \{"business":"Gym in Perth"\}/);
    assert.equal(a.db.contact.state, 'qualifying'); assert.equal(a.db.contact.answers.business, 'Gym in Perth');

    // H-LAB: a topic change mid-qualification; the scripted model saves what it can and asks the next missing question.
    let s = await runLabTurn(newLab('automatic'), { message: 'Hi, I run a gym in Perth.' });
    s = await runLabTurn(s, { message: 'Actually, are you open on weekends? We get about 40 enquiries a week.' });
    const q = (id: string) => LAB_CONFIG.questions.find(x => x.id === id)!.ask.toLowerCase().slice(0, 30);
    const r2 = (s.turns[1].reply ?? '').toLowerCase();
    assert.ok(!r2.includes(q('business')) && !r2.includes(q('lead_flow')), 'answered questions are not re-asked');
    assert.ok(r2.includes(q('problem')), 'the next missing question');
    assert.deepEqual(Object.keys(s.tables.contacts[0].answers).sort(), ['business', 'lead_flow']);

    // A replayed message id: no second message, no second dispatch, no Setter turn.
    const db = labStore(s);
    let hooks = 0;
    const sms = { from: s.phone, to: '+61400000000', body: 'Replay me', messageSid: 'SMreplay000001' };
    const first = await handleInboundSms(db.rpc, LAB_AUTH, sms, { setter: () => { hooks++; } });
    const msgs = s.tables.messages.length, dispatches = s.tables.dispatches.length;
    const again = await handleInboundSms(db.rpc, LAB_AUTH, sms, { setter: () => { hooks++; } });
    assert.equal(first.duplicate, false); assert.equal(again.duplicate, true);
    assert.equal(hooks, 1, 'the Setter runs once'); assert.equal(again.reply, null);
    assert.equal(s.tables.messages.length, msgs); assert.equal(s.tables.dispatches.length, dispatches);
    labGlobals(s);
    c.output(turn.reply, ...s.turns.map(x => x.reply)); c.tools(...labTools(s)); c.db({ agent: a.db, lab: labDb(s) });
    c.actual(`merged ${seen[0].messages.length} user turn, replay duplicate ${again.duplicate}`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test('S9 returning customer (H-DB, automatic): a qualified contact is not re-asked; a booked contact is told their booking (G1 closed, A-54)', async () => {
  await rec.scenario({ id: 'S9', operatingMode: 'automatic', expected: 'qualified: answers in context, no re-ask; booked: reply restates the booking (time, where) with no booking tools, tagged setter/returning-booked@2; nothing re-booked' }, async (c) => {
    // Qualified contact writes again.
    let s = await h.dbSetup('automatic');
    let restore = h.dbEnv(s.channel, true);
    let w = h.dbWorld(s.rpc, () => [say('Welcome back, Sam. Would you like me to find a time for a call?')]);
    try {
      c.input('Hi again, still keen');
      const res = await h.dbSend('s9qualified01', 'Hi again, still keen');
      assert.equal(res.status, 200, JSON.stringify(res.body)); assert.equal(res.body.live, true);
      assert.deepEqual(w.errors, []); assert.deepEqual(w.rpcErrors, []);
      assert.ok(w.hosts.every(x => h.ALLOWED_HOSTS.has(x)), w.hosts.join(', '));
      assert.equal(w.llmCalls(), 1);
      assert.match(w.systems[0], /Contact stage: qualified\./);
      for (const v of new Set(Object.values(s.answers))) assert.ok(w.systems[0].includes(JSON.stringify(v).slice(1, -1)), 'saved answers are in the context');
      const db = await h.dbSnapshot(s);
      assert.equal(db.contact[0].state, 'qualified'); assert.equal(db.appointments.length, 0); assert.equal(db.pending.length, 0);
      assertOutboundTagged(db.messages.filter(m => m.direction === 'outbound'));
      assertNoFalseBooking([res.body.reply as string], db.appointments);
      c.output(res.body); c.db({ qualified: db });
    } finally { w.restore(); restore(); await s.db.close(); }

    // Booked contact writes again (G1, closed by A-54): the router still records Sales as the owner, and the Setter answers
    // with the booking from the database. The model stand-in only repeats the prompt's booking line, so the time and
    // place in the reply come from the stored appointment, not from the script.
    s = await h.dbSetup('automatic');
    restore = h.dbEnv(s.channel, true);
    const toolLists: string[][] = [];
    w = h.dbWorld(s.rpc, (body) => {
      const booking = /^Their booking: (.+?)\.?$/m.exec(body.system)?.[1];
      if (!booking) return h.offerThenBook(body);
      toolLists.push(((body as { tools?: { name: string }[] }).tools ?? []).map(t => t.name));
      return [say(`Welcome back, Sam. You're booked for your ${booking}. Would you like to keep it, or should I ask the team to move or cancel it?`)];
    });
    try {
      c.input('Can I book a call?', 'Hi, quick question about my call');
      const booked = await h.dbSend('s9booked0001', 'Can I book a call?');
      assert.equal(booked.status, 200); assert.equal(booked.body.booked, true);
      const llmBefore = w.llmCalls(), before = await h.dbSnapshot(s);
      assert.equal(before.contact[0].state, 'booked');
      const res = await h.dbSend('s9booked0002', 'Hi, quick question about my call');
      assert.equal(res.status, 200, JSON.stringify(res.body)); assert.equal(res.body.live, true); assert.equal(res.body.booked, false);
      assert.equal(w.llmCalls(), llmBefore + 1, 'one model turn for the booked contact');
      const cfg = setterConfigFor(checkedAgentSettings(templateSettings('ventra', 'Ventra'))), tz = cfg.availability.timeZone;
      const [appt] = await s.rows<{ starts_at: unknown }>('select starts_at from public.fo_appointments where contact_id = $1', [s.contact]);
      const start = new Date(appt.starts_at as string).getTime();
      const line = `${cfg.meetingTitle} on ${formatSlot(start, tz)} (${tz}), ${cfg.where}`;
      assert.ok(w.systems.at(-1)?.includes(`Their booking: ${line}.`), 'the prompt carries the stored booking');
      assert.ok((res.body.reply as string).includes(formatSlot(start, tz)) && (res.body.reply as string).includes(cfg.where), `reply restates time and where: ${res.body.reply}`);
      assert.match(res.body.reply as string, /move or cancel/, 'offers a change');
      assert.deepEqual(toolLists, [['handoff_receptionist', 'escalate_human']], 'no booking tools for a booked contact');
      const db = await h.dbSnapshot(s);
      assert.equal(db.dispatches.at(-1)?.agent, 'sales', 'Sales still owns the booked contact');
      const out = db.messages.filter(m => m.direction === 'outbound');
      assert.equal(out.length, before.messages.filter(m => m.direction === 'outbound').length + 1, 'one new reply');
      assert.deepEqual([out.at(-1)?.agent, out.at(-1)?.prompt_version], ['setter', SETTER_RETURNING_PROMPT_VERSION]);
      assertOutboundTagged(out);
      assert.ok(db.messages.some(m => m.direction === 'inbound' && m.body === 'Hi, quick question about my call'), 'the inbound is stored');
      assert.equal(db.contact[0].state, 'booked'); assert.equal(db.appointments.length, 1); assert.equal(w.events.length, 1); assert.equal(db.pending.length, 0);
      assert.deepEqual(w.rpcErrors, []); assert.deepEqual(w.errors, []);
      c.output(booked.body, res.body); c.db({ booked: db });
      c.actual(`qualified: replied; booked: reply "${res.body.reply}", dispatch ${db.dispatches.at(-1)?.agent}`);
    } finally { w.restore(); restore(); await s.db.close(); }
  });
});

// ---------------------------------------------------------------------------------------------------------------
test('S10 out of hours (H-AGENT, automatic, Sunday 2 am Perth): only future in-hours slots, follow-up due outside quiet hours, AI still replies', async () => {
  await rec.scenario({ id: 'S10', operatingMode: 'automatic', expected: 'only in-hours future slots; follow-up due outside 20:00-08:00; AI replies' }, async (c) => {
    const now = Date.parse('2026-11-07T18:00:00Z'); // Sunday 8 November 2026, 2:00 am Perth
    assert.equal(localParts(now, 'Australia/Perth').wd, 0); assert.equal(localParts(now, 'Australia/Perth').h, 2);
    c.input('Can I book a call?');
    const a = agentSetup('automatic', lead('qualified', [{ direction: 'inbound', body: 'Can I book a call?' }]), now);
    const m = scripted([[tool('offer_times')], (results) => {
      const offers = JSON.parse(results[0]) as { label: string }[];
      return [say(`I can do ${offers.map(o => o.label).join(', or ')}. Which suits you?`)];
    }]);
    const turn = await runSetterTurn(CID, a.deps(m.llm));
    c.output(turn.reply); c.tools(...m.calls()); c.db(a.db);
    const offers = JSON.parse(m.results[0]) as { label: string; start: string }[];
    assert.ok(offers.length >= 2);
    const weekly = ventraSetterConfig.availability.weekly as Record<number, [string, string][]>;
    const mins = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
    for (const o of offers) {
      const t = Date.parse(o.start), p = localParts(t, 'Australia/Perth');
      assert.ok(t > now, 'in the future');
      const win = weekly[p.wd];
      assert.ok(win, `open on weekday ${p.wd}`);
      const at = p.h * 60 + p.mi;
      assert.ok(win.some(([f, to]) => at >= mins(f) && at + ventraSetterConfig.availability.slotMinutes <= mins(to)), `${o.label} is within hours`);
    }
    assert.ok(turn.reply, 'the AI still replies at night');
    const fu = a.db.jobs.filter(j => j.kind === 'follow-up' && j.status === 'pending');
    assert.equal(fu.length, 1);
    assert.equal(inQuietHours(Date.parse(fu[0].due), 'Australia/Perth'), false, `follow-up due ${fu[0].due} is outside quiet hours`);
    assert.ok(Date.parse(fu[0].due) > now);
    c.actual(`${offers.length} offers from ${offers[0].label}; follow-up due ${fu[0].due}`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test('S11 booking conflict, automatic (H-AGENT): slot taken between offer and pick -> "just taken", nothing booked, new times offered', async () => {
  await rec.scenario({ id: 'S11', operatingMode: 'automatic', expected: '"just taken"; no appointment or event; offers cleared; new times offered' }, async (c) => {
    c.input('The first one please.');
    const a = agentSetup('automatic');
    // The calendar sees a walk-in only from its second read on: free when offered, taken when booked.
    let reads = 0, taken: { start: number; end: number } | null = null;
    const calendar = { ...a.calendar, busy: async (from: number, to: number) => { reads++; const base = await a.calendar.busy(from, to); return reads >= 2 && taken ? [...base, taken] : base; } };
    const m = scripted([
      [tool('offer_times')],
      (results) => { const o = JSON.parse(results[0]) as { start: string }[]; const st = Date.parse(o[0].start); taken = { start: st, end: st + 30 * 60_000 }; return [tool('book_time', { start: o[0].start }, 'b1')]; },
      [tool('offer_times', {}, 'o2')],
      (results) => { const o = JSON.parse(results[2]) as { label: string }[]; return [say(`That time was just taken. I can do ${o.map(x => x.label).join(', or ')}. Which suits you?`)]; },
    ]);
    const turn = await runSetterTurn(CID, a.deps(m.llm, { calendar }));
    c.output(turn.reply); c.tools(...m.calls()); c.db(a.db);
    assert.match(m.results[1], /just taken/);
    assert.equal(turn.booked, false); assert.equal(a.db.appointment, null); assert.equal(a.calendar.events.length, 0, 'no event created');
    assert.notEqual(a.db.contact.state, 'booked');
    const second = JSON.parse(m.results[2]) as { start: string }[];
    assert.ok(second.length >= 1 && !second.some(o => Date.parse(o.start) === taken!.start), 'the taken time is not offered again');
    assertNoFalseBooking([turn.reply], []);
    c.actual(`book_time: ${m.results[1]}`);
  });
});

test('S11 booking conflict, owner approval (H-AGENT): a held booking whose slot was taken is not performed; the owner is told why', async () => {
  await rec.scenario({ id: 'S11', operatingMode: 'owner_approval', expected: 'stale approved booking not performed; owner told; no appointment' }, async (c) => {
    const a = agentSetup('owner_approval');
    const slot = (await offerTimes(a.calendar, ventraSetterConfig.availability, AGENT_NOW)).at(-1)!;
    c.input('The last one please.');
    const m = scripted([[tool('book_time', { start: new Date(slot.start).toISOString() })]]);
    const turn = await runSetterTurn(CID, a.deps(m.llm));
    assert.equal(a.pending.items.length, 1); assert.equal(turn.reply, decide('owner_approval', 'book').say);
    await a.calendar.createEvent({ id: 'walkin0001', summary: 'Walk-in', description: '', start: slot.start, end: slot.end, timeZone: 'Australia/Perth', attendeeEmail: null });
    const out = await approvePendingAction(a.pending, a.pending.items[0].id, OWNER, a.executor());
    assert.equal(out.outcome, 'failed'); assert.match(out.item.note ?? '', /no longer free/);
    assert.equal(a.db.appointment, null); assert.equal(a.db.contact.state, 'qualified'); assert.equal(a.sent.length, 0);
    assert.equal(a.calendar.events.length, 1, 'only the walk-in');
    c.output(turn.reply, out.item.note); c.tools(...m.calls()); c.db({ pending: a.pending.items, appointment: a.db.appointment });
    c.actual(`approve -> ${out.outcome}: ${out.item.note}`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test('S12 API failure (H-AGENT + H-LAB, automatic): model error leaves no state change and no secret; calendar failure never says booked', async () => {
  await rec.scenario({ id: 'S12', operatingMode: 'automatic', expected: 'model throws: fixed fallback reply + human handoff, no appointment/state change, inbound stored, no secret; calendar throws: never "You\'re booked"' }, async (c) => {
    // Model throws in the direct turn (A-55, G2 closed): the fixed fallback reply, a hand-off to a person, nothing else.
    const a = agentSetup('automatic');
    c.input('Hi, saw your ad');
    const failed = await runSetterTurn(CID, a.deps(async () => { throw new Error('AI provider error (500).'); }));
    assert.equal(failed.reply, SETTER_FALLBACK_REPLY); assert.equal(failed.modelFailure, 'provider_500');
    assert.equal(failed.handedTo, 'human'); assert.deepEqual(a.db.handoffs.map(x => x.owner), ['human']);
    assert.equal(failed.actions.find(x => x.action === 'transfer')?.decision, 'perform');
    assert.equal(a.db.contact.state, 'qualified'); assert.deepEqual(a.db.outbound, [{ message: SETTER_FALLBACK_REPLY, prompt: SETTER_FALLBACK_PROMPT }]);
    assert.equal(a.db.appointment, null); assert.equal(a.db.jobs.length, 0); assert.equal(a.pending.items.length, 0); assert.equal(failed.booked, false);

    // The real Anthropic adapter against a fake 500 (passed in, not global): the lab shows the fallback reply, the
    // hand-off and the provider status, and no secret.
    const SECRET = 'fake-test-key-SECRET-do-not-leak';
    const fake500 = (async () => new Response(JSON.stringify({ error: { message: `bad key ${SECRET}` } }), { status: 500 })) as unknown as typeof fetch;
    const s = await runLabTurnWith(newLab('automatic'), { message: 'Hi, saw your ad. What do you do?' }, { base: anthropicLlm({ apiKey: SECRET, model: 'test-model' }, fake500), model: 'scripted' });
    const t = s.turns[0];
    assert.equal(t.reply, SETTER_FALLBACK_REPLY); assert.match(t.error ?? '', /AI provider error \(500\)/);
    assert.equal(t.handedTo, 'human'); assert.deepEqual(s.tables.handoffs.map(x => x.owner), ['human']);
    assert.ok(!JSON.stringify(s).includes(SECRET), 'no secret anywhere in the lab state');
    assert.equal(s.tables.messages.filter(m => m.direction === 'inbound').length, 1, 'the inbound is stored');
    assert.deepEqual(s.tables.messages.filter(m => m.direction === 'outbound').map(m => m.body), [SETTER_FALLBACK_REPLY]);
    assert.equal(s.tables.contacts[0].state, 'new'); assert.equal(s.tables.appointments.length, 0); assert.equal(s.pending.length, 0);
    labGlobals(s);

    // Calendar createEvent throws: nothing booked, never booked wording.
    const b = agentSetup('automatic');
    const calendar = { ...b.calendar, createEvent: async () => { throw new Error('Google Calendar error (500).'); } };
    const m = scripted([
      [tool('offer_times')],
      (results) => [tool('book_time', { start: (JSON.parse(results[0]) as { start: string }[])[0].start }, 'b1')],
      (results) => [say(`Sorry, I could not lock that in. ${results.at(-1)?.split('.')[0] ?? ''}. A person will confirm a time.`)],
    ]);
    const turn = await runSetterTurn(CID, b.deps(m.llm, { calendar }));
    assert.equal(turn.booked, false); assert.equal(b.db.appointment, null); assert.notEqual(b.db.contact.state, 'booked');
    const bookCall = m.calls().find(x => x.name === 'book_time');
    assert.ok(bookCall?.isError || /Not booked/.test(bookCall?.result ?? ''), `book_time failed visibly: ${bookCall?.result}`);
    assertNoFalseBooking([turn.reply], []);
    c.output(t.error, turn.reply); c.tools(...labTools(s), ...m.calls()); c.db({ lab: labDb(s), agent: b.db });
    c.actual(`model error: ${t.error}; calendar error: ${bookCall?.result}`);
  });
});
test('S12 G2 (H-DB, all three modes): a model/API failure through the real chat route gets the fixed fallback reply and a human handoff, not a 503; nothing booked; no secret; the next message is left to the person', async () => {
  for (const mode of MODES) {
    await rec.scenario({ id: 'S12', operatingMode: mode, expected: 'chat 200 with SETTER_FALLBACK_REPLY; inbound stored; 1 outbound tagged setter/fallback@1; human handoff; state qualified; 0 appointments/pending; no key or provider body in response or logs; next message: no AI reply' }, async (c) => {
      const SECRET = 'fake-route-key-SECRET-do-not-leak';
      const s = await h.dbSetup(mode);
      const restore = h.dbEnv(s.channel, true);
      process.env.ANTHROPIC_API_KEY = SECRET; // restored by restore()
      const w = h.dbWorld(s.rpc);
      const world = globalThis.fetch;
      let modelCalls = 0;
      // The provider answers 500 with a body that echoes the key: neither may reach the visitor or the logs.
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (url.host !== 'api.anthropic.com') return world(input, init);
        modelCalls++; w.hosts.push(url.host);
        return new Response(JSON.stringify({ type: 'error', error: { message: `invalid x-api-key ${SECRET}` } }), { status: 500 });
      }) as typeof fetch;
      const logged: string[] = [];
      const realWarn = console.warn, realLog = console.log;
      console.warn = (...x: unknown[]) => { logged.push(x.map(String).join(' ')); };
      console.log = (...x: unknown[]) => { logged.push(x.map(String).join(' ')); };
      try {
        c.input('Hi, can someone help me?', 'Hello? Anyone there?');
        const res = await h.dbSend(`s12g2${mode.slice(0, 3)}01`, 'Hi, can someone help me?');
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.reply, SETTER_FALLBACK_REPLY); assert.equal(res.body.live, true); assert.equal(res.body.booked, false);
        assert.equal(modelCalls, 1);
        const db = await h.dbSnapshot(s);
        assert.ok(db.messages.some(m => m.direction === 'inbound' && m.body === 'Hi, can someone help me?'), 'the inbound is stored');
        const out = db.messages.filter(m => m.direction === 'outbound');
        assert.deepEqual(out.map(m => [m.body, m.agent, m.prompt_version]), [[SETTER_FALLBACK_REPLY, 'setter', SETTER_FALLBACK_PROMPT]]);
        assertOutboundTagged(out);
        assert.deepEqual(db.handoffs.map(x => [x.from_agent, x.owner]), [['setter', 'human']]);
        assert.equal(db.contact[0].state, 'qualified'); assert.equal(db.appointments.length, 0); assert.equal(db.pending.length, 0); assert.equal(w.events.length, 0);
        assertNoFalseBooking([res.body.reply as string], db.appointments);
        assert.deepEqual(w.rpcErrors, []); assert.deepEqual(w.errors, []);
        assert.ok(w.hosts.every(x => h.ALLOWED_HOSTS.has(x)), w.hosts.join(', '));
        assert.ok(logged.some(l => l.includes('provider_500')), 'the failure is logged by code');
        for (const text of [JSON.stringify(res.body), ...logged, ...w.errors]) {
          assert.ok(!text.includes(SECRET), 'no key'); assert.ok(!text.includes('x-api-key'), 'no provider body');
        }
        // A person now owns the conversation: the next message is stored and the AI stays silent (agent.ts withPerson).
        const next = await h.dbSend(`s12g2${mode.slice(0, 3)}02`, 'Hello? Anyone there?');
        assert.equal(next.status, 200); assert.equal(next.body.reply, null);
        assert.equal(modelCalls, 1, 'no model call while a person has the lead');
        const after = await h.dbSnapshot(s);
        assert.equal(after.messages.filter(m => m.direction === 'outbound').length, 1);
        assert.ok(after.messages.some(m => m.direction === 'inbound' && m.body === 'Hello? Anyone there?'));
        c.output(res.body, next.body); c.db(after);
        c.actual(`reply "${res.body.reply}", handoffs ${db.handoffs.map(x => x.owner)}, state ${db.contact[0].state}, next reply ${next.body.reply}`);
      } finally { console.warn = realWarn; console.log = realLog; w.restore(); restore(); await s.db.close(); }
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
after(() => {
  const ids = new Set(rec.records.map(r => r.id));
  for (let i = 1; i <= 12; i++) assert.ok(ids.has(`S${i}`), `record for S${i}`);
  for (const r of rec.records) {
    assert.equal(r.costAud, 0); assert.equal(r.mode, 'demo');
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'records are plain JSON');
  }
});
