// AI Receptionist system prompt: safety and clarity rules (A-57). Checks the built prompt text, no model involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts'; // registers the extensionless import resolver used by lib/

const { templateSettings } = await import('../lib/front-office/settings.ts');
const { receptionistSystemPrompt, RECEPTIONIST_PROMPT_VERSION } = await import('../lib/front-office/receptionist/prompt.ts');

const prompt = receptionistSystemPrompt(templateSettings('gym', 'Iron Gym'), 'Monday at 9 am', 'Caller: +61411111111');
const rule = (re: RegExp) => prompt.split('\n').find(l => re.test(l)) ?? '';

test('prompt version is bumped for the safety and clarity rules', () => {
  assert.equal(RECEPTIONIST_PROMPT_VERSION, 'receptionist/voice@3');
});

test('emergency: hang up and call 000 now, never book or take a message instead, then offer a note to the business', () => {
  const r = rule(/emergency/i);
  assert.match(r, /life-threatening emergency or someone in danger/);
  assert.match(r, /hang up and call 000 now/);
  assert.match(r, /Do not book or take a message instead/);
  assert.match(r, /offer to pass a note to the business/);
});

test('urgent but not life-threatening: transfer first, else take_message (unchanged behaviour)', () => {
  const r = rule(/anything urgent/);
  assert.match(r, /not life-threatening/);
  assert.match(r, /put them through with transfer; if that is not possible, take_message/);
});

test('unclear speech or noise: ask to repeat, never guess or invent', () => {
  const r = rule(/repeat/);
  assert.match(r, /could not hear or understand the caller clearly, ask them to repeat/);
  assert.match(r, /Never guess, and never invent an answer or a detail/);
});

test('names, phone numbers and booking times are read back before saving or booking', () => {
  assert.match(rule(/Read back/), /Read back names, phone numbers and booking times to confirm them before you save or book/);
});

test('existing structure kept: business, questions, rules, speaking style, contact line', () => {
  assert.match(prompt, /^You are the AI receptionist for Iron Gym/);
  assert.match(prompt, /\nRules:\n/);
  assert.match(prompt, /\nSpeaking style: /);
  assert.ok(prompt.endsWith('Caller: +61411111111'));
});
