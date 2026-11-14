// The shared permission check (task A-2). Every AI Setter and AI Receptionist action that books, reschedules, cancels,
// sends, follows up or transfers asks decide() first; pending-actions.ts gate() is the one place that acts on the answer.
//
// Rules (per business, per product; see OperatingMode in contracts.ts):
// - automatic: everything is performed within the business rules.
// - owner_approval: commitments (book, reschedule, cancel, send, follow_up) are held for the owner; transfer and
//   take_message are performed.
// - enquiry_only: commitments are refused (the AI takes a message instead); transfer and take_message are performed.
// - take_message is not a PendingActionKind: capturing what someone wants is never a commitment, so it is always allowed.
// - transfer (a live hand-off to a person) is always allowed in all three modes (owner decision 2026-11-14, A-14): a
//   customer asking for a human is never blocked or held. The 'transfer' PendingActionKind is therefore never produced
//   by gate(); the type stays because other code uses it.
// - A reply inside a conversation the customer started is not a 'send'. 'send' means a message the business starts
//   (a confirmation, an outbound text or email); 'follow_up' a scheduled one.
// - Anything unknown is treated safely: an unknown mode is read as DEFAULT_OPERATING_MODE, an unknown action is refused.
//
// Pure: no I/O, no clock, no imports at runtime.

import { DEFAULT_OPERATING_MODE, isOperatingMode, pendingActionKinds } from './contracts';
import type { OperatingMode, PendingActionKind, PermissionDecision } from './contracts';

/** Everything the permission check answers for: the held kinds plus taking a message. */
export const permissionActions = [...pendingActionKinds, 'take_message'] as const;
export type PermissionAction = typeof permissionActions[number];

/** The kinds that commit the business to something. */
export const commitmentKinds: readonly PendingActionKind[] = ['book', 'reschedule', 'cancel', 'send', 'follow_up'];

export type Permission = {
  decision: PermissionDecision;
  /** The mode actually applied (an unknown mode falls back to the default). */
  mode: OperatingMode;
  /** Plain English for the owner and the activity log: why this answer. */
  reason: string;
  /** Plain English the AI may say to the customer or caller. Never promises what did not happen. */
  say: string;
};

export const isPermissionAction = (v: unknown): v is PermissionAction =>
  typeof v === 'string' && (permissionActions as readonly string[]).includes(v);

const isCommitment = (a: PermissionAction): a is PendingActionKind => (commitmentKinds as readonly string[]).includes(a);

// What the action is, in words for the owner, and what to tell the customer when it is held or refused.
const words: Record<PendingActionKind, { what: string; held: string; refused: string }> = {
  book: { what: 'Booking an appointment', held: 'I have passed your booking request to the team to confirm. You will hear back once it is confirmed.', refused: 'I cannot book that myself, but I have noted what you would like and the team will get back to you to arrange it.' },
  reschedule: { what: 'Moving a booking', held: 'I have asked the team to confirm the new time. Your current booking stays as it is until they do.', refused: 'I cannot change bookings myself, but I have noted the time you would prefer and the team will get back to you.' },
  cancel: { what: 'Cancelling a booking', held: 'I have passed your cancellation to the team to confirm. You will hear back once it is done.', refused: 'I cannot cancel bookings myself, but I have noted your request and the team will get back to you.' },
  send: { what: 'Sending a message', held: 'The team will check that message before it goes out.', refused: 'I cannot send that myself, but the team has your details and will be in touch.' },
  follow_up: { what: 'Sending a follow-up', held: 'The team will check the follow-up before it goes out.', refused: 'The team has your details and will be in touch.' },
  transfer: { what: 'Transferring to a person', held: '', refused: '' },
};

/** The one permission check. Pure and total: any input gets an answer, never an exception. */
export function decide(mode: unknown, action: unknown): Permission {
  const m: OperatingMode = isOperatingMode(mode) ? mode : DEFAULT_OPERATING_MODE;
  if (!isPermissionAction(action)) {
    return { decision: 'refuse', mode: m, reason: 'Unknown action. Nothing was done.', say: 'I cannot do that, but I have noted your request for the team.' };
  }
  if (action === 'take_message') {
    return { decision: 'perform', mode: m, reason: 'Taking a message is always allowed: it commits the business to nothing.', say: '' };
  }
  if (action === 'transfer') {
    return { decision: 'perform', mode: m, reason: 'Passing the customer to a person is always allowed.', say: '' };
  }
  if (!isCommitment(action)) {
    return { decision: 'refuse', mode: m, reason: 'Unknown action. Nothing was done.', say: 'I cannot do that, but I have noted your request for the team.' };
  }
  const w = words[action];
  switch (m) {
    case 'automatic':
      return { decision: 'perform', mode: m, reason: `${w.what} is allowed: the AI runs in automatic mode.`, say: '' };
    case 'owner_approval':
      return { decision: 'hold_for_approval', mode: m, reason: `${w.what} waits for the owner: the AI runs in owner approval mode.`, say: w.held };
    case 'enquiry_only':
      return { decision: 'refuse', mode: m, reason: `${w.what} is not allowed: the AI runs in enquiry only mode, so it takes a message instead.`, say: w.refused };
  }
}
