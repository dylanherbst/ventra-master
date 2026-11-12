// G5: a call that drops mid-way (the caller hung up, or the line or pipeline failed) before anything was settled leaves
// one call-back handoff for staff: caller number, what was captured, and where the call stopped. Nothing is sent.
import { checkedHandoff } from '../handoff';
import type { ChannelAuth, Rpc } from '../orchestrator';
import type { ContactState } from '../state';

/** Outcomes that mean the call was dealt with (or a person already has it): no call-back needed. 'message' is also
 * what this function stores once it has recorded the call-back, so a repeated end-of-call report creates nothing. */
const SETTLED = new Set(['booked', 'rescheduled', 'cancelled', 'message', 'transfer', 'not-live']);

/** The only endedReason values that count as a drop: the caller hung up or went silent, the call hit its time limit, or the
 * line/pipeline failed. Anything else (assistant ended, forwarded, voicemail, never answered, unknown) is not a drop. */
export const DROPPED_ENDED_REASONS: readonly string[] = ['customer-ended-call', 'silence-timed-out', 'exceeded-max-duration', 'phone-call-provider-closed-websocket'];
/** Vapi failure families whose reason carries a detail suffix (e.g. pipeline-error-custom-llm-failed). */
export const DROPPED_ENDED_REASON_PREFIXES: readonly string[] = ['pipeline-error', 'call.in-progress.error', 'twilio-failed', 'vonage-failed', 'assistant-request-failed'];

export function isDroppedReason(reason: string): boolean {
  return DROPPED_ENDED_REASONS.includes(reason) || DROPPED_ENDED_REASON_PREFIXES.some(p => reason.startsWith(p));
}

type Ctx = { contact: { id: string; name: string | null; phone: string | null; email: string | null; state: ContactState; answers: Record<string, string> } };

/** Called after fo_voice_end with its result. Only the first end-of-call report for a call (`first === true`, decided
 * atomically in the database) creates the call-back; `first === false` (a duplicate) does nothing. Returns true when a
 * call-back handoff was recorded. If recording fails, a staff-visible event is logged instead and false is returned (the
 * webhook still answers 200). If `first` is missing (null/undefined, e.g. migration not applied) no call-back is created
 * (no duplicates), but an unsettled drop logs a staff-visible event so the caller is not silently lost. */
export async function recordDroppedCall(rpc: Rpc, auth: ChannelAuth, end: { contact: string | null; outcomes: string[] | null; first?: boolean | null }, call: { id: string; caller: string | null; reason: string; transcript: string }): Promise<boolean> {
  if (!isDroppedReason(call.reason) || !end.contact) return false;
  if (end.first === false) return false; // a duplicate report: the first one already handled it
  if (end.first !== true) {
    // No flag at all (null/undefined/anything else): we cannot tell if this is a duplicate, so create no call-back (no
    // duplicates) but make sure staff can see that a caller may have been lost.
    console.error('front-office dropped call: fo_voice_end gave no `first` flag (migration 202611130002 not applied?); no call-back created');
    // A call that was already settled (booked, message, ...) needs no call-back, so no alarm either (same rule as createCallback).
    if (end.outcomes?.some(o => SETTLED.has(o))) return false;
    await logDispatch(rpc, auth, end.contact, `Dropped call ${call.reason}: the system could not tell if a call-back was already made, so none was created. Please check the call log and call this person back if needed.`);
    return false;
  }
  try { return await createCallback(rpc, auth, end.contact, end.outcomes ?? [], call); }
  catch (e) {
    console.error('front-office dropped-call handoff failed:', e instanceof Error ? e.message : 'unknown');
    // Staff must still see that a caller was lost: an activity event on the contact (fo_events, kind dispatch).
    await logDispatch(rpc, auth, end.contact, `Dropped call ${call.reason}: the call-back could not be saved. Please check the call log and call this person back.`);
    return false;
  }
}

async function logDispatch(rpc: Rpc, auth: ChannelAuth, contact: string, reason: string): Promise<void> {
  await rpc('fo_log_dispatch', { channel: auth.channel, channel_key: auth.key, contact, agent_name: 'receptionist', reason }).catch(() => undefined);
}

async function createCallback(rpc: Rpc, auth: ChannelAuth, contact: string, outcomes: string[], call: { id: string; caller: string | null; reason: string; transcript: string }): Promise<boolean> {
  if (outcomes.some(o => SETTLED.has(o))) return false;
  const a = { channel: auth.channel, channel_key: auth.key };
  const ctx = await rpc('fo_contact_context', { ...a, contact }) as Ctx | null;
  if (!ctx) return false;
  const c = ctx.contact;
  const from = c.phone ?? call.caller ?? 'number withheld';
  const captured = [c.name ? `name ${c.name}` : '', ...Object.entries(c.answers ?? {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('; ') || 'nothing captured';
  const lastAi = call.transcript.split('\n').map(l => l.trim()).filter(l => /^(AI|Assistant|Bot):/i.test(l)).at(-1)?.replace(/^\w+:\s*/, '') ?? '';
  const stopped = `${call.reason}${outcomes.length ? ` after ${outcomes.join(', ')}` : ''}${lastAi ? `; last thing the AI said: "${lastAi.slice(0, 200)}"` : ''}`;
  const h = checkedHandoff({ contact: { id: c.id, name: c.name, phone: c.phone, email: c.email, state: c.state }, channel: 'voice', intent: 'call back (dropped call)',
    answers: c.answers ?? {}, summary: `Dropped call from ${from}. Captured: ${captured}. Stopped: ${stopped}.`.slice(0, 1500), nextAction: 'Call the caller back', from: 'receptionist', owner: 'human' });
  await rpc('fo_record_handoff', { ...a, contact: c.id, handoff: h });
  await rpc('fo_voice_outcome', { ...a, call_id: call.id, outcome: 'message' }).catch(() => undefined);
  return true;
}
