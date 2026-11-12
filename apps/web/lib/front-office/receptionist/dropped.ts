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
 * atomically in the database) creates the call-back. Returns true when a call-back handoff was recorded. If recording
 * fails, a staff-visible event is logged instead and false is returned (the webhook still answers 200). */
export async function recordDroppedCall(rpc: Rpc, auth: ChannelAuth, end: { contact: string | null; outcomes: string[] | null; first?: boolean }, call: { id: string; caller: string | null; reason: string; transcript: string }): Promise<boolean> {
  if (!isDroppedReason(call.reason) || !end.contact) return false;
  if (end.first !== true) {
    if (end.first === undefined) console.error('front-office dropped call: fo_voice_end gave no `first` flag (migration 202611130002 not applied?); no call-back created');
    return false;
  }
  try { return await createCallback(rpc, auth, end.contact, end.outcomes ?? [], call); }
  catch (e) {
    console.error('front-office dropped-call handoff failed:', e instanceof Error ? e.message : 'unknown');
    // Staff must still see that a caller was lost: an activity event on the contact (fo_events, kind dispatch).
    await rpc('fo_log_dispatch', { channel: auth.channel, channel_key: auth.key, contact: end.contact, agent_name: 'receptionist', reason: `Dropped call ${call.reason}: the call-back could not be saved. Please check the call log and call this person back.` }).catch(() => undefined);
    return false;
  }
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
