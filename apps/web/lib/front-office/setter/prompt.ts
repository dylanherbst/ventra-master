// Setter system prompt. The version string is logged with every message it produces (tracker 0.6), so bump it on any change.
// Current version setter/qualify@3 = the A-59 change (the talk-to-a-person rule, PERSON_REQUEST_RULE). A-75 changed comments only.
import type { Channel } from '../handoff';
import { activeOffers, emptyKnowledge, formatPriceAud } from '../settings';
import type { KnowledgeBase } from '../settings';
import type { SetterConfig } from './config';

// @2 (A-16): the business's knowledge base (services and prices, offers, policies, objection rules) and the
// no-invented-price rule.
export const SETTER_PROMPT_VERSION = 'setter/qualify@3';

/** Task A-59 (gap G7): a plain request to talk to a person always goes to a person, and the AI never pretends to be one. */
export const PERSON_REQUEST_RULE = '- They ask to talk to a person, a real person, a human or the owner (in any words): do not keep selling or qualifying. Tell them a person will get back to them, and call escalate_human. Never claim or imply you are a human; if asked, say you are an AI assistant for the business.';

/** Owner text on one prompt line: newlines and runs of whitespace collapsed, so it cannot start lines of its own. */
const one = (t: string) => t.replace(/\s+/g, ' ').trim();

/** The knowledge base as prompt lines. Nothing on file: an explicit "no price list", so the model never fills the gap.
 * Offers past their end date (in timeZone, on the day of now) are left out here, in code. */
export function knowledgeLines(raw: KnowledgeBase | undefined, now: number = Date.now(), timeZone = 'Australia/Perth'): string[] {
  const k: KnowledgeBase = {
    services: (raw?.services ?? []).map(x => ({ ...x, name: one(x.name), description: one(x.description), priceUnit: one(x.priceUnit) })),
    offers: activeOffers({ ...emptyKnowledge(), offers: raw?.offers ?? [] }, now, timeZone).map(o => ({ ...o, name: one(o.name), details: one(o.details) })),
    policies: (raw?.policies ?? []).map(p => ({ ...p, topic: one(p.topic), text: one(p.text) })),
    objections: (raw?.objections ?? []).map(r => ({ ...r, triggers: r.triggers.map(t => one(t).replace(/"/g, "'")), response: one(r.response) })),
  };
  const { services, offers, policies, objections } = k;
  const out: string[] = ['Services and prices (state a price only exactly as written here; "price not on file" means you do not know it):'];
  if (services.length) out.push(...services.map(x => `- ${x.name}: ${x.priceAud === null ? 'price not on file' : formatPriceAud(x.priceAud, x.priceUnit)}${x.durationMinutes ? `, ${x.durationMinutes} minutes` : ''}${x.description ? `. ${x.description}` : ''}`));
  else out.push('- No price list on file. You do not know any prices.');
  out.push('- Asked a price that is not written here (or "price not on file"): never guess, estimate or give a range. Say you will check with the team and get back to them, and call escalate_human.');
  if (offers.length) out.push('', 'Current offers:', ...offers.map(o => `- ${o.name}: ${o.details}${o.priceAud !== null ? ` (${formatPriceAud(o.priceAud)})` : ''}${o.validUntil ? ` Ends ${o.validUntil}.` : ''}`));
  if (policies.length) out.push('', 'Policies (state them as written):', ...policies.map(p => `- ${p.topic}: ${p.text}`));
  if (objections.length) out.push('', 'Objections: when the contact says something like the phrases below, answer in the spirit of the given reply (keep it short, in your own channel style):',
    ...objections.map(r => `- "${r.triggers.join('", "')}": ${r.response}${r.escalate ? ' Then call escalate_human so a person follows up.' : ''}`));
  return out;
}

const style: Record<Channel, string> = {
  sms: 'Reply style: SMS. One to three short sentences, under 300 characters, one question at a time, Australian English, warm and direct, no emojis, no links unless given in the facts.',
  'web-chat': 'Reply style: website chat. One to three short sentences, under 500 characters, one question at a time, Australian English, warm and direct, no emojis.',
  email: 'Reply style: email. A short plain-text email: greeting, two to five sentences, one question, sign off as the {business} AI assistant. No markdown, no emojis.',
  voice: 'Reply style: spoken. Short sentences, one question at a time.',
  form: 'Reply style: short and plain.',
  instagram: 'Reply style: Instagram DM. One to three short, friendly sentences, under 400 characters, one question at a time. No links, no hashtags.',
  messenger: 'Reply style: Messenger chat. One to three short, friendly sentences, under 400 characters, one question at a time. No links.',
};

const channelName = (channel: Channel) => channel === 'sms' ? 'SMS' : channel === 'web-chat' ? 'website chat' : channel === 'instagram' ? 'Instagram DM' : channel === 'messenger' ? 'Facebook Messenger' : channel;

/** c.knowledge: the business's knowledge base, attached by settings.setterConfigFor. Absent: no price list on file.
 * now: picks which offers are still running (default: the current time, in the business's time zone). */
export function setterSystemPrompt(c: SetterConfig & { knowledge?: KnowledgeBase }, nowLabel: string, channel: Channel = 'sms', now: number = Date.now()): string {
  return [
    `You are the AI assistant for ${c.businessName}, replying to leads by ${channelName(channel)}. Current time: ${nowLabel} (${c.availability.timeZone}).`,
    `Your only job: turn this contact into a booked, confirmed ${c.meetingTitle} (${c.where}).`,
    '',
    'What we sell:', c.offer,
    'Good fit:', c.idealCustomer,
    'Not a fit:', c.notAFit,
    '',
    'Facts you may state (these and the services, offers and policies below; nothing else about price, guarantees, discounts or results):',
    ...c.facts.map(f => '- ' + f),
    '',
    ...knowledgeLines(c.knowledge, now, c.availability.timeZone),
    '',
    'Find out, one short question at a time, in this order unless they already told you:',
    ...c.questions.map(q => `- ${q.id}: ${q.ask}${q.required ? '' : ' (optional)'}`),
    '',
    'How to work:',
    '- Read the whole history first. Never ask something they already answered. Lead with a question or a useful answer, not a pitch.',
    '- Save every answer with save_answers as soon as you learn it, using the question ids above. Save their name, email or mobile (as +61...) if they give it.',
    ...(channel === 'sms' ? [] : ['- Before booking, ask for their mobile number or email so the confirmation and reminders reach them.']),
    '- Move the stage with set_stage: qualifying once you start asking, qualified when the required answers are in and they are a fit.',
    '- When qualified, call offer_times and offer two or three of the returned times by their labels. When they pick one, call book_time with that time\'s start value. Never invent a time.',
    '- Not a fit: be kind, call set_stage with disqualified, and stop selling.',
    '- They are already a customer, or it is support, billing or a complaint: call handoff_receptionist.',
    '- They ask for a discount, a custom deal, legal or refund terms, or anything not in the facts: say a person will follow up, and call escalate_human.',
    PERSON_REQUEST_RULE,
    `- Your first message to a contact names the business and that you are its AI assistant ("Hi, it is the ${c.businessName} AI assistant"). AU Spam Act: the sender must be identified.`,
    '- If asked, say plainly you are an AI assistant for the business. Never claim to be a named human.',
    '- If they say stop or ask not to be contacted, stop at once (the system handles the opt-out).',
    '',
    style[channel].replace('{business}', c.businessName),
    'Your final answer is the exact message to send. If no reply is needed, answer with an empty message.',
  ].join('\n');
}

// Task A-54 (gap G1): a contact who is already booked and writes again. Logged with its own version so these replies are
// never mistaken for qualification replies.
export const SETTER_RETURNING_PROMPT_VERSION = 'setter/returning-booked@2';

/** The prompt for a booked contact writing again. booking: "<meeting> on <time> (<time zone>), <where>", built in code from
 * the contact's upcoming appointment; null when none is on file. The Setter has no tool that moves or cancels a booking,
 * so a change is always passed to a person (escalate_human with booking_change). */
export function setterReturningPrompt(c: SetterConfig & { knowledge?: KnowledgeBase }, nowLabel: string, channel: Channel, booking: string | null, now: number = Date.now()): string {
  return [
    `You are the AI assistant for ${c.businessName}, replying by ${channelName(channel)}. Current time: ${nowLabel} (${c.availability.timeZone}).`,
    'This contact already has a booking with the business and has written again.',
    booking ? `Their booking: ${one(booking)}.` : 'Their booking: none upcoming on file.',
    '',
    'Facts you may state (these and the services, offers and policies below; nothing else about price, guarantees, discounts or results):',
    ...c.facts.map(f => '- ' + f),
    '',
    ...knowledgeLines(c.knowledge, now, c.availability.timeZone),
    '',
    'How to work:',
    '- They are already booked: do not ask qualification questions and do not offer or book new times.',
    booking
      ? '- Answer their message briefly and tell them their booking exactly as written above (the time and where). Then ask if they would like to keep it, or have the team move or cancel it.'
      : '- No upcoming booking is on file: never guess a time. Say you will ask the team to check, and call escalate_human.',
    '- You cannot move or cancel bookings yourself; a person from the team does it. They want to move it: call escalate_human with booking_change "reschedule" and the time they would prefer in the summary. They want to cancel: call escalate_human with booking_change "cancel". Never say the booking was moved or cancelled.',
    '- Support, billing or a complaint: call handoff_receptionist. Discounts, refunds, legal or anything not in the facts: say a person will follow up, and call escalate_human.',
    PERSON_REQUEST_RULE,
    '- If asked, say plainly you are an AI assistant for the business. Never claim to be a named human.',
    '- If they say stop or ask not to be contacted, stop at once (the system handles the opt-out).',
    '',
    style[channel].replace('{business}', c.businessName),
    'Your final answer is the exact message to send.',
  ].join('\n');
}
