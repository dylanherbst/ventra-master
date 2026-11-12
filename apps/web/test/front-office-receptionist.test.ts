// AI Receptionist (phone, via Vapi) and per-business settings. The model is scripted, so these check the records each
// call leaves behind: FAQ hit and miss, qualify and book, reschedule, cancel, transfer, message, and the Vapi endpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRequest } from './helpers/route-harness.ts';

const { store } = await import('./helpers/front-office-store.ts');
const { checkedAgentSettings, templateSettings, setterConfigFor, loadSetter, availabilityFor } = await import('../lib/front-office/settings.ts');
const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');
const { runReceptionistTurn, matchFaqs, callTranscript } = await import('../lib/front-office/receptionist/agent.ts');
const { greeting, RECEPTIONIST_PROMPT_VERSION } = await import('../lib/front-office/receptionist/prompt.ts');
const { streamOf } = await import('../lib/front-office/llm.ts');
const { offerTimes } = await import('../lib/front-office/booking.ts');
const { parseVapiChat, parseVapiEvent, chunkWriter, vapiToken } = await import('../lib/front-office/vapi.ts');
const { vapiChat, vapiWebhook } = await import('../lib/front-office/vapi-route.ts');
type Llm = import('../lib/front-office/llm.ts').Llm;
type Block = import('../lib/front-office/llm.ts').Block;
type AgentSettings = import('../lib/front-office/settings.ts').AgentSettings;

const NOW = Date.parse('2026-11-09T00:30:00Z'); // Monday 8:30 am Perth
const auth = { channel: '55555555-5555-4555-8555-555555555555', key: 'k'.repeat(40) };
const tool = (name: string, input: Record<string, unknown>, id = name): Block => ({ type: 'tool_use', id, name, input });
const say = (text: string): Block => ({ type: 'text', text });
function scripted(steps: Block[][]): Llm {
  let i = 0;
  return async () => { const content = steps[Math.min(i++, steps.length - 1)]; return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }; };
}
const gym = (extra: Partial<AgentSettings> = {}): AgentSettings => checkedAgentSettings({
  ...templateSettings('gym', 'Iron Gym'),
  hours: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']] },
  faqs: [{ q: 'What are your opening hours?', a: 'We are open 5 am to 9 pm on weekdays.' }, { q: 'Is there parking?', a: 'Yes, free parking out the back.' }],
  staffPhone: '+61400000009', staffEmail: 'team@irongym.example', ...extra,
});

/** The in-memory store plus the voice, reschedule and cancel RPCs. */
function voiceStore(state = 'new') {
  const base = store(state, [], '+61411111111');
  const log = { outcomes: [] as string[], replies: [] as { message: string; prompt: string }[], ends: [] as Record<string, unknown>[], turns: [] as Record<string, unknown>[], moved: [] as string[], cancelled: 0 };
  let settings: unknown = null;
  const rpc = async (fn: string, a: Record<string, unknown>): Promise<unknown> => {
    switch (fn) {
      case 'fo_channel_settings': if (a.channel_key !== auth.key) throw new Error('Channel not recognised.'); return settings;
      case 'fo_voice_turn': log.turns.push(a); return { contact: a.caller ? 'c1' : null, state: base.db.contact.state, duplicate: false };
      case 'fo_voice_outcome': log.outcomes.push(a.outcome as string); return null;
      case 'fo_voice_reply': log.replies.push({ message: a.message as string, prompt: a.prompt as string }); return 'm';
      case 'fo_voice_contact': base.db.contact.phone = a.phone_number as string; return 'c1';
      case 'fo_voice_end': log.ends.push(a); return { call: 'k1', contact: 'c1', outcomes: log.outcomes };
      case 'fo_reschedule': log.moved.push(a.starts as string); if (base.db.appointment) base.db.appointment.starts = a.starts as string; return { appointment: 'appt-1', eventId: 'vbevent0001' };
      case 'fo_cancel_booking': log.cancelled++; base.db.appointment = null; base.db.contact.state = 'qualified'; return { appointment: 'appt-1', eventId: 'vbevent0001' };
      default: return base.rpc(fn, a);
    }
  };
  return { ...base, rpc, log, setSettings: (s: unknown) => { settings = s; } };
}
function fakeCalendar() {
  const cal = { moved: [] as string[], cancelled: [] as string[], created: [] as string[],
    busy: async () => [], hasEvent: async () => false,
    createEvent: async (e: { id: string }) => { cal.created.push(e.id); return { id: e.id, htmlLink: null, existed: false }; },
    moveEvent: async (id: string, start: number) => { cal.moved.push(`${id}@${new Date(start).toISOString()}`); },
    cancelEvent: async (id: string) => { cal.cancelled.push(id); },
  };
  return cal;
}
function senders() {
  const sms: { to: string; body: string }[] = [], mail: { to: string; subject: string }[] = [];
  return { sms, mail, send: async (to: string, body: string) => { sms.push({ to, body }); return { sent: false, sid: null }; }, email: async (to: string, subject: string) => { mail.push({ to, subject }); return { sent: false, id: null }; } };
}
async function drain(gen: AsyncGenerator<{ type: string; text?: string; number?: string }, unknown>) {
  const out: { type: string; text?: string; number?: string }[] = []; let r = await gen.next();
  while (!r.done) { out.push(r.value); r = await gen.next(); }
  return { out, summary: r.value as { said: string; tools: string[]; outcomes: string[]; action: string | null }, text: out.filter(o => o.type === 'text').map(o => o.text).join('') };
}
const turnDeps = (s: ReturnType<typeof voiceStore>, steps: Block[][], settings: AgentSettings, conversation = [{ role: 'user' as const, content: 'Hi' }], cal = fakeCalendar(), snd = senders()) =>
  ({ llm: streamOf(scripted(steps)), rpc: s.rpc, auth, calendar: cal, send: snd.send, email: snd.email, settings, now: NOW, call: { id: 'call_test0001', caller: '+61411111111', contact: 'c1' }, conversation });

test('settings: gym template validates with empty FAQs and hours; bad values get plain messages; Setter config follows the business', async () => {
  const g = templateSettings('gym', 'Iron Gym');
  assert.deepEqual(g.faqs, []); assert.deepEqual(g.hours, {}, 'never invent gym hours'); assert.equal(g.voiceOn, false);
  assert.doesNotThrow(() => checkedAgentSettings(g));
  assert.throws(() => checkedAgentSettings({ ...g, businessName: '' }), /Business name is required/);
  assert.throws(() => checkedAgentSettings({ ...g, staffPhone: '0412 345' }), /\+61412345678/);
  assert.throws(() => checkedAgentSettings({ ...g, questions: g.questions.slice(0, 2) }), /3 to 5/);
  assert.throws(() => checkedAgentSettings({ ...g, hours: { 1: [['17:00', '09:00']] } }), /must end after/);
  assert.throws(() => checkedAgentSettings({ ...g, timeZone: 'Mars/Base' }), /time zone/i);
  assert.equal(checkedAgentSettings({ ...g, staffPhone: '+61 412 345 678' }).staffPhone, '+61412345678');
  const cfg = setterConfigFor(gym());
  assert.equal(cfg.businessName, 'Iron Gym'); assert.equal(cfg.questions[0].id, 'goal');
  assert.ok(cfg.facts.some(f => f.includes('free parking'))); assert.ok(cfg.followUps.every(t => !t.includes('{business}')));
  assert.equal(availabilityFor(gym()).slotMinutes, 45);
  assert.doesNotThrow(() => checkedAgentSettings(templateSettings('ventra')));
  // Channels without saved settings (or an unreachable database) keep Ventra's own Setter.
  const s = voiceStore();
  assert.equal((await loadSetter(s.rpc, auth)).config, ventraSetterConfig);
  s.setSettings(gym());
  const loaded = await loadSetter(s.rpc, auth);
  assert.equal(loaded.config.businessName, 'Iron Gym'); assert.equal(loaded.on, true);
  s.setSettings({ ...gym(), setterOn: false });
  assert.equal((await loadSetter(s.rpc, auth)).on, false);
  assert.equal((await loadSetter(async () => { throw new Error('down'); }, auth)).config, ventraSetterConfig);
});

test('helpers: FAQ match, call transcript, greeting carries the AI disclosure and recording notice', () => {
  const s = gym();
  assert.equal(matchFaqs('what time do you open in the morning, hours?', s.faqs)[0].a, 'We are open 5 am to 9 pm on weekdays.');
  assert.equal(matchFaqs('Do you have a sauna?', s.faqs).length, 0);
  const t = callTranscript([{ role: 'assistant', content: 'Thanks for calling.' }, { role: 'user', content: 'hi' }, { role: 'user', content: 'you there?' }]);
  assert.deepEqual(t.map(m => m.role), ['user', 'assistant', 'user']); assert.equal(t[2].content, 'hi\nyou there?');
  const g = greeting(gym({ recordingNotice: 'This call may be recorded.' }));
  assert.match(g, /Thanks for calling Iron Gym\. I'm the Iron Gym AI assistant\. This call may be recorded\. How can I help today\?/);
});

test('receptionist: FAQ answered only from the business’s answers; reply logged with the prompt version', async () => {
  const s = voiceStore();
  const r = await drain(runReceptionistTurn(turnDeps(s, [[tool('answer_faq', { question: 'Is there parking?' })], [say('Yes, there is free parking out the back.')]], gym())));
  assert.equal(r.text, 'Yes, there is free parking out the back.');
  assert.deepEqual(s.log.outcomes, ['faq']);
  assert.deepEqual(s.log.replies, [{ message: 'Yes, there is free parking out the back.', prompt: RECEPTIONIST_PROMPT_VERSION }]);
  assert.equal(r.summary.action, null);
});

test('receptionist: FAQ miss becomes a message; the team is told (by the gated senders) and a person owns the call back', async () => {
  const s = voiceStore(); const snd = senders();
  const r = await drain(runReceptionistTurn(turnDeps(s, [
    [tool('answer_faq', { question: 'Do you have a sauna?' })],
    [say('I don’t have that in front of me. '), tool('take_message', { message: 'Asked whether there is a sauna.', name: 'Sam' })],
    [say('I’ve passed that on and the team will call you back.')],
  ], gym(), undefined, fakeCalendar(), snd)));
  assert.deepEqual(s.log.outcomes, ['faq-miss', 'message']);
  assert.equal(s.db.handoffs.length, 1); assert.equal(s.db.handoffs[0].owner, 'human'); assert.equal(s.db.handoffs[0].channel, 'voice');
  assert.match(String(s.db.handoffs[0].summary), /sauna/);
  assert.equal(snd.sms[0].to, '+61400000009'); assert.equal(snd.mail[0].to, 'team@irongym.example');
  assert.match(r.text, /call you back/);
});

test('receptionist: qualify, offer real times, book; reminders scheduled; confirmation text goes through the sender', async () => {
  const s = voiceStore(); const cal = fakeCalendar(); const snd = senders(); const settings = gym();
  const first = (await offerTimes(cal, availabilityFor(settings), NOW)).at(-1)!; // a later day, so reminders fit
  const answers = { goal: 'Get stronger', experience: 'Some, no injuries', preferred_times: 'Weekday mornings', start_timeframe: 'Next week' };
  const r = await drain(runReceptionistTurn(turnDeps(s, [
    [tool('qualify', { answers, name: 'Sam Lee' })],
    [say('One moment, let me check. '), tool('check_availability', {})],
    [tool('book', { start: new Date(first.start).toISOString() })],
    [say(`You’re booked for ${first.label}.`)],
  ], settings, undefined, cal, snd)));
  assert.equal(s.db.contact.state, 'booked'); assert.deepEqual(s.db.states, ['new', 'qualifying', 'qualified', 'booked']);
  assert.deepEqual(s.log.outcomes, ['qualified', 'booked']);
  assert.equal(cal.created.length, 1); assert.equal(snd.sms.length, 1, 'confirmation via the (dry-run) sender');
  assert.ok(s.db.jobs.some(j => j.kind.startsWith('reminder')), 'reminder scheduled');
  assert.equal(r.text.startsWith('One moment, let me check.'), true, 'filler is streamed before the calendar check');
});

test('receptionist: booking refused until the required questions are answered, and only at an offered time', async () => {
  const s = voiceStore(); const cal = fakeCalendar();
  await drain(runReceptionistTurn(turnDeps(s, [[tool('book', { start: '2026-11-10T01:00:00.000Z' })], [say('Can I ask a few questions first?')]], gym(), undefined, cal)));
  assert.equal(cal.created.length, 0); assert.equal(s.db.contact.state, 'new');
});

test('receptionist: reschedule moves the calendar event and the record; cancel removes both and reminders stop', async () => {
  const s = voiceStore('booked'); const cal = fakeCalendar(); const settings = gym();
  s.db.appointment = { id: 'appt-1', starts: '2026-11-11T02:00:00.000Z', ends: '2026-11-11T02:45:00.000Z', status: 'booked' };
  const [first] = await offerTimes(cal, availabilityFor(settings), NOW);
  await drain(runReceptionistTurn(turnDeps(s, [[tool('check_availability', {})], [tool('reschedule', { start: new Date(first.start).toISOString(), verify_time: '2026-11-11T10:00' })], [say('Done, all moved.')]], settings, undefined, cal)));
  assert.deepEqual(cal.moved, [`vbevent0001@${new Date(first.start).toISOString()}`]);
  assert.deepEqual(s.log.moved, [new Date(first.start).toISOString()]); assert.deepEqual(s.log.outcomes, ['rescheduled']);
  assert.ok(s.db.outbound.some(o => o.prompt === 'receptionist/booking-moved@1'));
  await drain(runReceptionistTurn(turnDeps(s, [[tool('cancel', { reason: 'Away that week', verify_time: new Date(first.start).toISOString() })], [say('That’s cancelled.')]], settings, undefined, cal)));
  assert.deepEqual(cal.cancelled, ['vbevent0001']); assert.equal(s.log.cancelled, 1); assert.equal(s.db.contact.state, 'qualified');
  assert.ok(s.db.outbound.some(o => o.prompt === 'receptionist/booking-cancelled@1'));
});

test('receptionist: transfer to the business number, or a message when no number is set; end_call hangs up', async () => {
  let s = voiceStore();
  let r = await drain(runReceptionistTurn(turnDeps(s, [[say('Putting you through now. '), tool('transfer', { reason: 'Billing question' })]], gym({ transferNumber: '+61893330000' }))));
  assert.deepEqual(r.out.at(-1), { type: 'transfer', number: '+61893330000' }); assert.deepEqual(s.log.outcomes, ['transfer']);
  assert.equal(s.db.handoffs[0].owner, 'human');
  s = voiceStore();
  r = await drain(runReceptionistTurn(turnDeps(s, [[tool('transfer', { reason: 'Complaint' })], [say('Nobody is free right now. Can I take a message?')]], gym())));
  assert.equal(r.out.some(o => o.type === 'transfer'), false); assert.match(r.text, /take a message/);
  s = voiceStore();
  r = await drain(runReceptionistTurn(turnDeps(s, [[say('Thanks for calling, bye. '), tool('end_call', {})]], gym())));
  assert.deepEqual(r.out.at(-1), { type: 'end' });
});

// Fixtures shaped like the Vapi docs: https://docs.vapi.ai/customization/tool-calling-integration and
// https://docs.vapi.ai/server-url/events
const chatBody = (messages: { role: string; content: string }[], callId = 'call_fixture01') => JSON.stringify({ model: 'ventra-receptionist', messages: [{ role: 'system', content: 'ignored' }, ...messages], temperature: 0.5, stream: true, call: { id: callId, customer: { number: '+61411111111' } } });
const vapiHeaders = (token = auth.key) => ({ 'content-type': 'application/json', authorization: 'Bearer ' + token });
function voiceEnv(extra: Record<string, string> = {}) {
  const keys = ['FRONT_OFFICE_VOICE_CHANNEL_ID', 'FRONT_OFFICE_VOICE_CHANNEL_KEY', 'FRONT_OFFICE_VOICE_LIVE'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, { FRONT_OFFICE_VOICE_CHANNEL_ID: auth.channel }, extra);
  return () => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}
const chunks = (sse: string) => sse.split('\n\n').filter(Boolean).map(l => l.replace(/^data: /, '')).map(l => l === '[DONE]' ? '[DONE]' : JSON.parse(l));

test('vapi: parsing the custom-LLM request and server events; tokens; chunk format', () => {
  const c = parseVapiChat(JSON.parse(chatBody([{ role: 'assistant', content: 'Hi' }, { role: 'user', content: 'Book me in' }, { role: 'tool', content: 'x' }])));
  assert.equal(c.callId, 'call_fixture01'); assert.equal(c.caller, '+61411111111'); assert.equal(c.turn, 1); assert.equal(c.lastUser, 'Book me in');
  assert.deepEqual(c.conversation.map(t => t.role), ['assistant', 'user']);
  const e = parseVapiEvent({ message: { type: 'tool-calls', call: { id: 'call_fixture01' }, toolCallList: [{ id: 'abc123', type: 'function', function: { name: 'take_message', arguments: '{"message":"call me"}' } }] } });
  assert.deepEqual(e.toolCalls, [{ id: 'abc123', name: 'take_message', args: { message: 'call me' } }]);
  const end = parseVapiEvent({ message: { type: 'end-of-call-report', endedReason: 'hangup', call: { id: 'call_fixture01', customer: { number: '+61411111111' } }, artifact: { transcript: 'AI: How can I help? User: hi', messages: [] }, analysis: { summary: 'Short call.' } } });
  assert.equal(end.endedReason, 'hangup'); assert.equal(end.summary, 'Short call.'); assert.match(end.transcript, /How can I help/); assert.equal(end.caller, '+61411111111');
  assert.throws(() => parseVapiEvent({}), /type/);
  assert.equal(vapiToken(new Headers({ authorization: 'Bearer abc' })), 'abc'); assert.equal(vapiToken(new Headers({ 'x-vapi-secret': 'def' })), 'def');
  const w = chunkWriter('m', NOW);
  const t = JSON.parse(w.tool('transferCall', { destination: '+61893330000' }).split('\n\n')[0].slice(6));
  assert.equal(t.object, 'chat.completion.chunk'); assert.equal(t.choices[0].delta.tool_calls[0].function.name, 'transferCall');
  assert.deepEqual(JSON.parse(t.choices[0].delta.tool_calls[0].function.arguments), { destination: '+61893330000' });
});

test('vapi chat endpoint: wrong token 401; not connected 503; not live says so honestly, takes a call-back message and hangs up', async () => {
  let restore = voiceEnv({ FRONT_OFFICE_VOICE_CHANNEL_ID: '' });
  try { assert.equal((await vapiChat(makeRequest('/x', { method: 'POST', cookie: null, headers: vapiHeaders(), body: chatBody([]) }), null, { rpc: voiceStore().rpc })).status, 503); } finally { restore(); }
  restore = voiceEnv();
  try {
    const s = voiceStore(); s.setSettings(gym({ voiceOn: true }));
    assert.equal((await vapiChat(makeRequest('/x', { method: 'POST', cookie: null, headers: vapiHeaders('w'.repeat(40)), body: chatBody([]) }), null, { rpc: s.rpc })).status, 401);
    assert.equal((await vapiChat(makeRequest('/x', { method: 'POST', cookie: null, headers: { 'content-type': 'application/json' }, body: chatBody([]) }), null, { rpc: s.rpc })).status, 401);
    // FRONT_OFFICE_VOICE_LIVE is not set: never answers as the AI.
    const res = await vapiChat(makeRequest('/x', { method: 'POST', cookie: null, headers: vapiHeaders(), body: chatBody([{ role: 'user', content: 'Hello?' }]) }), null, { rpc: s.rpc, llm: streamOf(scripted([[say('should not run')]])), now: () => NOW });
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const c = chunks(await res.text());
    const text = c.filter(x => x !== '[DONE]').map(x => x.choices[0].delta.content ?? '').join('');
    assert.match(text, /isn't switched on yet/); assert.ok(!text.includes('should not run'));
    assert.ok(c.some(x => x !== '[DONE]' && x.choices[0].delta.tool_calls?.[0].function.name === 'endCall'));
    assert.equal(c.at(-1), '[DONE]');
    assert.deepEqual(s.log.outcomes, ['not-live', 'message']); assert.equal(s.db.handoffs[0].owner, 'human');
  } finally { restore(); }
});

test('vapi chat endpoint (live): fixed greeting first, then streamed turns with a transferCall when the caller is put through', async () => {
  const restore = voiceEnv({ FRONT_OFFICE_VOICE_LIVE: '1', FRONT_OFFICE_VOICE_CHANNEL_KEY: auth.key });
  try {
    const s = voiceStore(); s.setSettings(gym({ voiceOn: true, transferNumber: '+61893330000' }));
    const g = chunks(await (await vapiChat(makeRequest('/x', { method: 'POST', cookie: null, headers: vapiHeaders(), body: chatBody([]) }), null, { rpc: s.rpc, llm: streamOf(scripted([[say('x')]])) })).text());
    assert.match(g.filter(x => x !== '[DONE]').map(x => x.choices[0].delta.content ?? '').join(''), /AI assistant/);
    assert.equal(s.log.replies[0].prompt, 'receptionist/greeting@1');
    const res = await vapiChat(makeRequest('/x', { method: 'POST', cookie: null, headers: vapiHeaders(), body: chatBody([{ role: 'assistant', content: 'Thanks for calling Iron Gym.' }, { role: 'user', content: 'I need to talk to someone about my bill' }]) }), null,
      { rpc: s.rpc, llm: streamOf(scripted([[say('Putting you through now. '), tool('transfer', { reason: 'Billing' })]])), now: () => NOW });
    const c = chunks(await res.text());
    const call = c.find(x => x !== '[DONE]' && x.choices[0].delta.tool_calls);
    assert.equal(call.choices[0].delta.tool_calls[0].function.name, 'transferCall');
    assert.ok(c.some(x => x !== '[DONE]' && x.choices[0].finish_reason === 'tool_calls'));
    assert.equal(s.log.turns.at(-1)?.message, 'I need to talk to someone about my bill');
    // The env route also checks the configured key in constant time.
    assert.equal((await vapiChat(makeRequest('/x', { method: 'POST', cookie: null, headers: vapiHeaders('z'.repeat(40)), body: chatBody([]) }), null, { rpc: s.rpc })).status, 401);
  } finally { restore(); }
});

test('vapi webhook: transfer destination, end-of-call report, tool calls, other events', async () => {
  const restore = voiceEnv();
  try {
    const s = voiceStore(); s.setSettings(gym({ transferNumber: '+61893330000' }));
    const post = (message: Record<string, unknown>) => vapiWebhook(makeRequest('/x', { method: 'POST', cookie: null, headers: vapiHeaders(), body: JSON.stringify({ message: { call: { id: 'call_fixture01', customer: { number: '+61411111111' } }, ...message } }) }), null, { rpc: s.rpc, now: () => NOW });
    let r = await post({ type: 'transfer-destination-request' });
    assert.deepEqual((await r.json()).destination, { type: 'number', number: '+61893330000', message: 'Putting you through now.' });
    s.setSettings(gym());
    r = await post({ type: 'transfer-destination-request' });
    assert.match((await r.json()).error, /take a message/);
    r = await post({ type: 'end-of-call-report', endedReason: 'customer-ended-call', artifact: { transcript: 'User: hi' }, analysis: { summary: 'Hung up early.' } });
    assert.equal(r.status, 200); assert.equal(s.log.ends[0].reason, 'customer-ended-call'); assert.equal(s.log.ends[0].call_summary, 'Hung up early.');
    r = await post({ type: 'tool-calls', toolCallList: [{ id: 'abc123', type: 'function', function: { name: 'answer_faq', arguments: { question: 'Is there parking?' } } }] });
    const j = await r.json();
    assert.equal(j.results[0].toolCallId, 'abc123'); assert.match(j.results[0].result, /free parking/);
    assert.equal((await post({ type: 'status-update', status: 'in-progress' })).status, 200);
    const bad = await vapiWebhook(makeRequest('/x', { method: 'POST', cookie: null, headers: vapiHeaders('q'.repeat(40)), body: '{}' }), null, { rpc: s.rpc });
    assert.equal(bad.status, 401);
  } finally { restore(); }
});

test('anthropic stream: text deltas arrive as they come; tool input JSON is assembled; stop reason kept', async () => {
  const { anthropicStream } = await import('../lib/front-office/llm.ts');
  const events = [
    { type: 'message_start' }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'One moment, ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'let me check.' } }, { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'check_availability', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '1}' } }, { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' },
  ];
  const sse = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  let sent: Record<string, unknown> = {};
  const fakeFetch = (async (_url: string, init: { body: string }) => { sent = JSON.parse(init.body); return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }); }) as unknown as typeof fetch;
  const out = [];
  for await (const ev of anthropicStream({ apiKey: 'x', model: 'm' }, fakeFetch)({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] })) out.push(ev);
  assert.equal(sent.stream, true);
  assert.deepEqual(out, [{ type: 'text', text: 'One moment, ' }, { type: 'text', text: 'let me check.' }, { type: 'tool', block: { type: 'tool_use', id: 'tu1', name: 'check_availability', input: { a: 1 } } }, { type: 'stop', reason: 'tool_use' }]);
});
