// AI Receptionist system prompt: safety and clarity rules (A-57). Checks the built prompt text, no model involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts'; // registers the extensionless import resolver used by lib/

const { templateSettings } = await import('../lib/front-office/settings.ts');
const { receptionistSystemPrompt, RECEPTIONIST_PROMPT_VERSION } = await import('../lib/front-office/receptionist/prompt.ts');

const prompt = receptionistSystemPrompt(templateSettings('gym', 'Iron Gym'), 'Monday at 9 am', 'Caller: +61411111111');
// Rules are bullets that start with a stable label, e.g. "- Emergency: ...". Look up by label and fail loudly if it is missing.
const rule = (label: string) => {
  const line = prompt.split('\n').find(l => l.startsWith(`- ${label}`));
  assert.ok(line, `no rule starting with "- ${label}"`);
  return line;
};

test('prompt version is bumped for the safety and clarity rules', () => {
  assert.equal(RECEPTIONIST_PROMPT_VERSION, 'receptionist/voice@4');
});

test('emergency: hang up and call 000 now, call 000 if unsure, never book or take a message instead, offer a note, then goodbye and end_call', () => {
  const r = rule('Emergency:');
  assert.match(r, /If the caller is not sure whether it is an emergency, tell them to call 000/);
  assert.match(r, /Once the note is taken or they decline it, say goodbye and call end_call/);
  assert.match(r, /life-threatening emergency or someone in danger/);
  assert.match(r, /hang up and call 000 now/);
  assert.match(r, /Do not book or take a message instead/);
  assert.match(r, /Offer to pass a note to the business/);
});

test('urgent but not life-threatening: transfer first, else take_message (unchanged behaviour)', () => {
  const r = rule('Complaints, billing');
  assert.match(r, /not life-threatening/);
  assert.match(r, /put them through with transfer; if that is not possible, take_message/);
});

test('unclear speech or noise: ask to repeat, never guess or invent', () => {
  const r = rule('If you could not hear');
  assert.match(r, /could not hear or understand the caller clearly, ask them to repeat/);
  assert.match(r, /Never guess, and never invent an answer or a detail/);
});

test('names, phone numbers and booking times are read back before saving or booking', () => {
  assert.match(rule('Read back'), /Read back names, phone numbers and booking times to confirm them before you save or book/);
});

test('existing structure kept: business, questions, rules, speaking style, contact line', () => {
  assert.match(prompt, /^You are the AI receptionist for Iron Gym/);
  assert.match(prompt, /\nRules:\n/);
  assert.match(prompt, /\nSpeaking style: /);
  assert.ok(prompt.endsWith('Caller: +61411111111'));
});
