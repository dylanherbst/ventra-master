// Scheduled touches (tracker 1.4, 1.5): the follow-up ladder, pre-call reminders and the no-show rescue. Jobs live in
// fo_jobs; an inbound reply cancels pending follow-ups and rescues in the database, so a lead who answers never gets a
// nudge. Every text is logged with its prompt version before it is sent.
//
// Permission check (task A-17): with input.permissions (the jobs runner passes channelPermissions()), every job that
// sends (each follow-up step, both reminders and each no-show rescue message) is checked again when it falls due:
// opt-out, a person having taken over, recorded consent (follow-ups: the contact messaged the business first, or an
// explicit fo_contact_consents grant for the channel, A-45), the
// Setter's operating mode through pending-actions.ts gate() and quiet hours in the business's time zone (DST-safe: the
// job moves to the end of the quiet hours by the local clock). Modes: automatic sends once; enquiry_only never sends;
// owner_approval holds this exact message (one item per step, reminder or rescue message) and sends it only once the
// owner approved it and the approval is still fresh (approvalWindow). While the owner has not decided, the job is
// checked again every hour (outside quiet hours); a rejected, expired or stale approval cancels it. A mode that cannot be
// read is the safe default (enquiry_only). Without input.permissions the runner behaves as before A-17.
// Approving a held job item: use createJobsExecutor(createSetterExecutor(...)) so the item becomes 'performed'.
import { timingSafeEqual } from 'node:crypto';
import { formatSlot } from './calendar/slots';
import { DEFAULT_OPERATING_MODE, deliverableEmail, hasConsent, isDeliverableEmail } from './contracts';
import type { ContactConsent, PendingActionPayload } from './contracts';
import type { ChannelAuth, Rpc } from './orchestrator';
import type { Channel } from './handoff';
import { DEFAULT_TTL_MINUTES, gate } from './pending-actions';
import type { ActionExecutor, ApproveOptions, PendingActionStore } from './pending-actions';
import type { QuietHours, SetterPermissions } from './setter/actions';
import { fillTemplate } from './setter/config';
import type { SetterConfig } from './setter/config';
import type { SmsSender } from './sms-send';
import type { EmailSender } from './email';
import { inReplyWindow } from './meta';
import type { MetaKind, MetaSender } from './meta';

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** Gap before each follow-up: touches at 5 min, 1 h, 21 h, about 3 d and 7 d after going quiet, then monthly. Step 3 is
 * 20 h after step 2 (A-29) so on Instagram and Messenger it still lands inside Meta's 24-hour reply window. */
export const ladderGaps = [5 * MIN, 55 * MIN, 20 * HOUR, 2 * DAY, 4 * DAY];
export const MONTHLY = 30 * DAY, LADDER_MAX_STEP = 10;
export const rescueGaps = [15 * MIN, DAY];
export const FOLLOW_UP_PROMPT = 'setter/follow-up@1', REMINDER_PROMPT = 'setter/reminder@1', RESCUE_PROMPT = 'setter/no-show-rescue@1';
const iso = (t: number) => new Date(t).toISOString();
const done = new Set(['booked', 'disqualified', 'customer']);

export const gapBefore = (step: number) => step <= ladderGaps.length ? ladderGaps[step - 1] : MONTHLY;

export async function startFollowUps(rpc: Rpc, auth: ChannelAuth, contact: string, now: number) {
  return rpc('fo_schedule_job', { channel: auth.channel, channel_key: auth.key, contact, job_kind: 'follow-up', job_step: 1, due: iso(now + gapBefore(1)), appointment: null });
}
export async function scheduleReminders(rpc: Rpc, auth: ChannelAuth, contact: string, appointment: string, start: number, now: number) {
  for (const [kind, before] of [['reminder-24h', DAY], ['reminder-2h', 2 * HOUR]] as const) {
    if (start - before > now + 5 * MIN) await rpc('fo_schedule_job', { channel: auth.channel, channel_key: auth.key, contact, job_kind: kind, job_step: 1, due: iso(start - before), appointment });
  }
}
/** Sales or a human marks a missed call: the contact moves to no-show and the rescue starts. */
export async function markNoShow(rpc: Rpc, auth: ChannelAuth, contact: string, now: number, by: 'sales' | 'human' = 'human') {
  await rpc('fo_set_state', { channel: auth.channel, channel_key: auth.key, contact, new_state: 'no-show', agent_name: by, reason: 'Missed the booked call' });
  await rpc('fo_schedule_job', { channel: auth.channel, channel_key: auth.key, contact, job_kind: 'no-show-rescue', job_step: 1, due: iso(now + rescueGaps[0]), appointment: null });
}

// ---------------------------------------------------------------------------------------------------------------------
// Quiet hours by the business's local clock (DST-safe)
// ---------------------------------------------------------------------------------------------------------------------

/** 8 pm to 8 am local: the same hours as setter/actions.ts DEFAULT_QUIET_HOURS. */
export const JOB_QUIET_HOURS: QuietHours = { start: 20, end: 8 };
type Wall = { y: number; mo: number; d: number; h: number; mi: number };
function wallClock(t: number, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  const n = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return { y: n('year'), mo: n('month'), d: n('day'), h: n('hour') % 24, mi: n('minute') };
}
/** The instant a local wall-clock time happens in timeZone, using the UTC offset in force at that instant (not now). */
function zonedInstant(w: Wall, timeZone: string): number {
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  const offset = (t: number) => { const x = wallClock(t, timeZone); return Date.UTC(x.y, x.mo - 1, x.d, x.h, x.mi) - (t - (t % MIN)); };
  const first = asUtc - offset(asUtc);
  return asUtc - offset(first);
}
/** True when t falls in the quiet hours by the local clock in timeZone. start > end wraps midnight. */
export function inJobQuietHours(t: number, timeZone: string, q: QuietHours = JOB_QUIET_HOURS): boolean {
  const w = wallClock(t, timeZone), m = w.h * 60 + w.mi, s = q.start * 60, e = q.end * 60;
  if (s === e) return false;
  return s > e ? m >= s || m < e : m >= s && m < e;
}
/** t, or the first instant the local clock shows the end of the quiet hours. Across a daylight-saving change the night
 * is an hour shorter or longer, so the wait is worked out from the local date, never as a fixed number of minutes. */
export function afterJobQuietHours(t: number, timeZone: string, q: QuietHours = JOB_QUIET_HOURS): number {
  if (!inJobQuietHours(t, timeZone, q)) return t;
  const w = wallClock(t, timeZone);
  const sameDay = w.h * 60 + w.mi < q.end * 60;
  const day = new Date(Date.UTC(w.y, w.mo - 1, w.d + (sameDay ? 0 : 1)));
  const end = zonedInstant({ y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate(), h: q.end, mi: 0 }, timeZone);
  return end > t ? end : t + HOUR; // never earlier than t (defensive: an end hour inside a DST gap)
}

type Job = { id: string; contact: string; kind: 'follow-up' | 'reminder-24h' | 'reminder-2h' | 'no-show-rescue'; step: number; appointment: string | null };
type Ctx = {
  /** consent: explicit consent per channel from fo_contact_context (migration 202611110004, A-38; only the boolean true
   * counts, a missing field from an older database is no consent). metaRoute() uses it to move a Meta contact to SMS or
   * email outside the 24-hour window; without it an owner task is created instead. optedOut always wins. */
  contact: { name: string | null; phone: string | null; email: string | null; state: string; optedOut: boolean; consent?: Partial<ContactConsent> };
  appointment: { id: string; starts: string } | null;
  messages?: { direction: 'inbound' | 'outbound'; at?: string }[];
  handoffs?: { owner: string }[];
};
export type JobOutcome = { id: string; kind: Job['kind']; outcome: 'done' | 'cancelled' | 'failed'; note: string; sent: boolean };

/** While the owner has not decided on a held job, it is checked again this often. */
export const JOB_RECHECK_MS = HOUR;
/** How long an owner's approval of a held job counts after the decision: the job's own due window. A follow-up step's
 * approval lasts until the next step would have been due (at least a day); a reminder's or rescue message's a day
 * (a reminder is also never sent after the booked time). Older approvals send nothing. */
export function approvalWindow(kind: Job['kind'], step: number): number {
  return kind === 'follow-up' ? Math.max(DAY, gapBefore(step + 1)) : DAY;
}

/** Why a job may not go out under the business rules, or null. Same rules as setter/actions.ts checkFollowUp.
 * via: the channel the conversation is on (the runner channel the job belongs to; null when not known). by: the channel
 * this job would go out on. A person who took over stops every job. For a follow-up, in order: an opt-out always wins
 * (the runner cancels opted-out contacts before this check); a reply on the same channel the contact messaged on
 * (inbound and via === by) is allowed without a grant; any other channel needs an open consent grant for it (A-47: an
 * inbound on website chat does not allow a text); a missing or unknown via, or a missing consent record, is no consent
 * (fail closed). */
function jobBlocked(job: Job, ctx: Ctx, via: Channel | null, by: 'sms' | 'email' | MetaKind): string | null {
  if (ctx.handoffs?.at(-1)?.owner === 'human') return 'A person is looking after this contact.';
  if (job.kind !== 'follow-up') return null;
  const inbound = (ctx.messages ?? []).some(m => m.direction === 'inbound');
  if (inbound && via !== null && via === by) return null;
  if ((by === 'sms' || by === 'email') && hasConsent(ctx.contact.consent, by)) return null;
  if (!inbound) return 'No recorded consent: the contact has not messaged the business.';
  return `No recorded consent for ${by === 'sms' ? 'texts' : by === 'email' ? 'email' : by}: the contact messaged on ${via ?? 'a channel that is not known'} and has not agreed to be contacted another way.`;
}
/** When the contact last messaged the business (0 if unknown): a new conversation starts a new follow-up ladder. */
function lastInbound(ctx: Ctx): number {
  let t = 0;
  for (const m of ctx.messages ?? []) if (m.direction === 'inbound') { const at = Date.parse(m.at ?? ''); if (at > t) t = at; }
  return t;
}
/** The approval queue key for one held job. Follow-up step 1 uses the Setter's own key (setter/agent.ts), so the owner
 * is never asked twice for it. Later steps and rescue messages carry the conversation (last inbound message), so a new
 * ladder asks again instead of reusing an old decision; a reminder is keyed by its booking. */
export function jobApprovalKey(job: Job, lastInboundAt: number): string {
  const gen = lastInboundAt.toString(36);
  if (job.kind === 'follow-up') return job.step === 1 ? `setter:follow_up:${job.contact}:1` : `setter:follow_up:${job.contact}:${job.step}:${gen}`;
  if (job.kind === 'no-show-rescue') return `setter:send:rescue:${job.contact}:${job.step}:${gen}`;
  return `setter:send:${job.kind}:${job.appointment}`;
}

/** The executor for approving held items. Items the runner held (a follow-up after step 1, a reminder or a rescue
 * message) are only marked approved here: the runner sends that exact job at its next check, after the business rules
 * and quiet hours, so it goes out once and at the step it was held at. Everything else goes to the Setter's executor. */
export function createJobsExecutor(setter: ActionExecutor): ActionExecutor {
  return async action => {
    const p = action.payload;
    if (action.product === 'setter' && p && (p.kind === 'send' || (p.kind === 'follow_up' && p.step > 1))) {
      return { ok: true, note: 'Approved. It goes out at its next scheduled check, outside quiet hours, unless the contact replied or opted out.' };
    }
    return setter(action);
  };
}
/** What fo_social_window returns for one Instagram or Messenger contact. */
export type SocialWindow = { recipient: string | null; optedOut: boolean; lastInbound: string | null };
export type MetaRoute = { via: 'meta'; recipient: string } | { via: 'sms' | 'email' } | { via: 'owner'; reason: string };
/** How an automated job on an Instagram or Messenger channel may reach the contact (A-29). Inside Meta's 24-hour reply
 * window (from the contact's last inbound message): by Meta. Outside it: by SMS or email only with explicit consent for
 * that channel and no opt-out; otherwise an owner task. Never the HUMAN_AGENT tag: that is for a real person only. */
export function metaRoute(w: SocialWindow, contact: Ctx['contact'], now: number, canEmail: boolean): MetaRoute {
  if (w.optedOut || contact.optedOut) return { via: 'owner', reason: 'The contact opted out.' };
  if (w.recipient && inReplyWindow(w.lastInbound, now)) return { via: 'meta', recipient: w.recipient };
  if (contact.phone && hasConsent(contact.consent, 'sms')) return { via: 'sms' };
  if (isDeliverableEmail(contact.email) && canEmail && hasConsent(contact.consent, 'email')) return { via: 'email' };
  return { via: 'owner', reason: w.recipient ? 'Meta’s 24-hour reply window has closed and there is no SMS or email consent.' : 'No Instagram or Messenger id for this contact.' };
}

/** The store, except that a mode that cannot be read is the safe default (enquiry_only). */
function failSafe(s: PendingActionStore): PendingActionStore {
  return { ...s, mode: async product => { try { return await s.mode(product); } catch { return DEFAULT_OPERATING_MODE; } } };
}

/** Every job kind (follow-ups, no-show rescues and the 24h/2h reminders) goes by SMS when the contact has a mobile,
 * otherwise by email when an email sender is given. On the email runner (via 'email') all of them, reminders and rescues
 * included, go by email whenever the contact has a deliverable address and a sender is configured (A-48); with no email
 * sender configured the runner falls back to SMS for a contact with a phone; a follow-up then needs an SMS grant, while reminders and rescues are not
 * consent-gated (jobBlocked only checks follow-ups). */
/** config: the business's Setter texts, or a loader that is only called when there are jobs to run. */
/** permissions: the Setter's approval queue and mode (live runner: channelPermissions()); see the note at the top. */
/** via: what this channel is ('sms', 'web-chat', 'email', 'voice'; runnerChannels() name), for the follow-up consent
 * check (jobBlocked). Instagram and Messenger use meta.kind. Not given: unknown, so a follow-up needs a consent grant. */
/** meta: set when this channel is Instagram or Messenger. Every job then goes through metaRoute(): Meta inside the
 * 24-hour window, consented SMS/email outside it, otherwise the text is queued for the owner (fo_queue_outbound) and
 * the ladder stops. gate() checks the window again for a Meta payload. */
export async function runDueJobs(input: { rpc: Rpc; auth: ChannelAuth; send: SmsSender; email?: EmailSender; config: SetterConfig | (() => Promise<SetterConfig>); now: number; max?: number; permissions?: SetterPermissions; meta?: { kind: MetaKind; send: MetaSender }; via?: Channel }): Promise<JobOutcome[]> {
  const a = { channel: input.auth.channel, channel_key: input.auth.key };
  const jobs = await input.rpc('fo_claim_jobs', { ...a, max_jobs: input.max ?? 25 }) as Job[];
  if (!jobs.length) return [];
  const i = { ...input, config: typeof input.config === 'function' ? await input.config() : input.config };
  const store = input.permissions ? failSafe(input.permissions.store) : null;
  const quiet = input.permissions?.quietHours ?? JOB_QUIET_HOURS, tz = i.config.availability.timeZone;
  const out: JobOutcome[] = [];
  const moved = new Set<string>();
  for (const job of jobs) {
    let outcome: JobOutcome['outcome'] = 'done', note = 'Sent', sent = false, finished = false;
    try {
      const ctx = await i.rpc('fo_contact_context', { ...a, contact: job.contact }) as Ctx;
      let text: string | null = null, prompt = FOLLOW_UP_PROMPT, next: { step: number; gap: number; kind: Job['kind'] } | null = null;
      const reachable = !!i.meta || !!ctx.contact.phone || (isDeliverableEmail(ctx.contact.email) && !!i.email);
      if (ctx.contact.optedOut || !reachable) { outcome = 'cancelled'; note = 'Opted out or no way to reach them'; }
      else if (job.kind === 'follow-up') {
        if (done.has(ctx.contact.state)) { outcome = 'cancelled'; note = `Contact is ${ctx.contact.state}`; }
        else {
          text = fillTemplate(i.config.followUps[Math.min(job.step - 1, i.config.followUps.length - 1)], { name: ctx.contact.name });
          if (job.step < LADDER_MAX_STEP) next = { step: job.step + 1, gap: gapBefore(job.step + 1), kind: 'follow-up' };
        }
      } else if (job.kind === 'no-show-rescue') {
        if (ctx.contact.state !== 'no-show') { outcome = 'cancelled'; note = `Contact is ${ctx.contact.state}`; }
        else {
          prompt = RESCUE_PROMPT;
          text = fillTemplate(i.config.noShowRescue[job.step - 1] ?? i.config.noShowRescue.at(-1)!, { name: ctx.contact.name });
          if (job.step < Math.min(i.config.noShowRescue.length, rescueGaps.length)) next = { step: job.step + 1, gap: rescueGaps[job.step], kind: 'no-show-rescue' };
        }
      } else {
        if (!ctx.appointment || ctx.appointment.id !== job.appointment || ctx.contact.state !== 'booked') { outcome = 'cancelled'; note = 'Appointment no longer booked'; }
        else {
          prompt = REMINDER_PROMPT;
          const time = formatSlot(Date.parse(ctx.appointment.starts), i.config.availability.timeZone);
          text = fillTemplate(job.kind === 'reminder-24h' ? i.config.reminder24h : i.config.reminder2h, { name: ctx.contact.name, meeting: i.config.meetingTitle, time });
        }
      }
      // Instagram / Messenger channel: Meta's 24-hour window decides the route before anything can be sent.
      let route: MetaRoute | null = null, socialInbound: string | null = null;
      if (text && i.meta) {
        const w = await i.rpc('fo_social_window', { ...a, contact: job.contact }) as SocialWindow;
        socialInbound = w.lastInbound;
        route = metaRoute(w, ctx.contact, i.now, !!i.email);
        if (route.via === 'owner') {
          if (!w.optedOut && !ctx.contact.optedOut) await i.rpc('fo_queue_outbound', { ...a, contact: job.contact, message: text, prompt });
          outcome = 'cancelled'; note = `Not sent automatically: ${route.reason}${w.optedOut || ctx.contact.optedOut ? '' : ' Queued for the owner to reply from the Instagram or Facebook app.'}`;
          text = null; next = null;
        }
      }
      // Off Meta: by text when the contact has a mobile, otherwise by email. On the email runner (A-48) a contact with an
      // email address is answered by email even when they also left a phone number: that is the channel they used, so
      // the same-channel rule applies; a text to them would be another channel and need an SMS grant.
      const direct: 'sms' | 'email' = ctx.contact.phone && !(i.via === 'email' && isDeliverableEmail(ctx.contact.email) && i.email) ? 'sms' : 'email';
      if (text && store) {
        // Every job that sends goes through the same permission check and quiet hours (follow-ups, reminders, rescues).
        const channel = route?.via === 'meta' ? i.meta!.kind : route?.via === 'email' ? 'email' : route?.via === 'sms' ? 'sms' : direct;
        const held = await checkJob(store, job, ctx, text, prompt, channel, socialInbound);
        if (held) {
          text = null; outcome = 'cancelled'; note = held.note;
          if (held.move !== undefined) await moveJob(job, held.move, held.note, () => { finished = true; });
        }
      }
      if (text) {
        await i.rpc('fo_log_outbound', { ...a, contact: job.contact, message: text, agent_name: 'setter', prompt });
        const byEmail = route ? route.via === 'email' : direct === 'email';
        // A Meta send is a plain RESPONSE inside the window (meta.ts); automation never adds a message tag.
        if (route?.via === 'meta') sent = (await i.meta!.send(i.meta!.kind, route.recipient, text)).sent;
        else sent = !byEmail ? (await i.send(ctx.contact.phone as string, text)).sent : (await i.email!(ctx.contact.email as string, `${i.config.businessName}: ${job.kind.startsWith('reminder') ? 'your booking' : 'following up'}`, text)).sent;
        note = sent ? 'Sent' : 'Logged (live sending off)';
        if (next) {
          const due = store ? afterJobQuietHours(i.now + next.gap, tz, quiet) : i.now + next.gap;
          await i.rpc('fo_schedule_job', { ...a, contact: job.contact, job_kind: next.kind, job_step: next.step, due: iso(due), appointment: null });
        }
      }
    } catch (e) {
      outcome = 'failed'; note = e instanceof Error ? e.message.slice(0, 200) : 'Failed';
    }
    if (!finished) await i.rpc('fo_finish_job', { ...a, job: job.id, outcome, note });
    out.push({ id: job.id, kind: job.kind, outcome, note, sent });
  }
  return out;

  /** Moves this job to a later time: the running row is closed first (a reminder's booking may only have one live row
   * per kind, fo_jobs_one_reminder), then the same kind, step and booking is scheduled once. fo_schedule_job replaces a
   * pending follow-up or rescue for the contact; the moved set stops a second copy of the same step in one run. */
  async function moveJob(job: Job, due: number, note: string, closed: () => void) {
    await i.rpc('fo_finish_job', { ...a, job: job.id, outcome: 'cancelled', note });
    closed();
    const key = `${job.contact}:${job.kind}:${job.step}:${job.appointment ?? ''}`;
    if (moved.has(key)) return;
    moved.add(key);
    await i.rpc('fo_schedule_job', { ...a, contact: job.contact, job_kind: job.kind, job_step: job.step, due: iso(due), appointment: job.appointment });
  }

  /** The shared permission check for one job that would send text: null to send now, otherwise why not (and, with move,
   * when to look again). Nothing is performed inside the gate: a 'perform' answer only lets the runner send. */
  async function checkJob(s: PendingActionStore, job: Job, ctx: Ctx, text: string, prompt: string, channel: 'sms' | 'email' | MetaKind, socialInbound: string | null): Promise<{ note: string; move?: number } | null> {
    const label = job.kind === 'follow-up' ? 'No follow-up' : job.kind === 'no-show-rescue' ? 'No missed-call message' : 'No reminder';
    const what = job.kind === 'follow-up' ? `follow-up ${job.step}` : job.kind === 'no-show-rescue' ? `missed-call message ${job.step}` : 'reminder';
    const blocked = jobBlocked(job, ctx, input.via ?? input.meta?.kind ?? null, channel);
    if (blocked) return { note: `${label}: ${blocked}` };
    const start = job.appointment && ctx.appointment ? Date.parse(ctx.appointment.starts) : null;
    const late = (t: number) => start !== null && t >= start;
    const who = ctx.contact.name ?? ctx.contact.phone ?? deliverableEmail(ctx.contact.email) ?? 'this lead';
    const by = channel === 'sms' ? 'text' : channel === 'email' ? 'email' : channel === 'instagram' ? 'Instagram DM' : 'Messenger';
    const body = text.slice(0, 1000), inbound = lastInbound(ctx);
    const payload: PendingActionPayload = job.kind === 'follow-up'
      ? { kind: 'follow_up', channel, body, promptVersion: prompt, step: job.step }
      : { kind: 'send', channel, body, promptVersion: prompt };
    const ttl = input.permissions?.ttlMinutes ?? DEFAULT_TTL_MINUTES;
    const g = await gate({
      store: s, product: 'setter', action: payload.kind, channelId: input.auth.channel,
      request: {
        payload, summary: `Send ${what} to ${who} by ${by}: "${body}"`.slice(0, 300), idempotencyKey: jobApprovalKey(job, inbound), contactId: job.contact,
        // A reminder's approval request ends when the booked call starts.
        ttlMinutes: start === null ? ttl : Math.max(5, Math.min(ttl, Math.floor((start - i.now) / MIN))),
      },
      execute: async () => ({ ok: true, note: 'Allowed.' }),
      replyWindow: { lastInbound: socialInbound, now: i.now },
    });
    if (g.decision === 'refuse') return { note: `${label}: ${g.permission.reason}` };
    if (g.decision === 'hold_for_approval') {
      const item = g.item;
      if (item.status === 'pending' || item.status === 'approved') {
        const again = afterJobQuietHours(i.now + JOB_RECHECK_MS, tz, quiet);
        if (late(again)) return { note: `Waiting for the owner to approve this ${what}, and the booked time is too close. Nothing was sent.` };
        return { note: `Waiting for the owner to approve this ${what} (${item.status}). Nothing was sent; checking again ${formatSlot(again, tz)}.`, move: again };
      }
      if (item.status !== 'performed') return { note: `The owner did not approve this ${what} (${item.status}). Nothing was sent.` };
      const decided = Date.parse(item.decidedAt ?? '');
      if (!(decided >= i.now - approvalWindow(job.kind, job.step))) return { note: `The owner's approval of this ${what} has expired. Nothing was sent.` };
      if (job.kind === 'follow-up' && decided < inbound) return { note: `The owner's approval was for an earlier conversation. Nothing was sent.` };
    }
    if (inJobQuietHours(i.now, tz, quiet)) {
      const due = afterJobQuietHours(i.now, tz, quiet);
      if (late(due)) return { note: `Quiet hours last until the booked time, so no ${what} was sent.` };
      return { note: `Quiet hours: moved to ${formatSlot(due, tz)}.`, move: due };
    }
    return null;
  }
}

/** Constant-time check of the runner's Authorization: Bearer header. */
export function bearerMatches(header: string | null, secret: string): boolean {
  const got = Buffer.from(header?.match(/^Bearer (.+)$/)?.[1] ?? ''), want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Every channel the runner should work through. Jobs belong to the channel the lead came in on, so each configured
 * channel (SMS, website chat, email, voice) is claimed separately. Invalid or missing pairs are skipped; duplicates removed. */
export function runnerChannels(env: Record<string, string | undefined>): { name: string; auth: ChannelAuth }[] {
  const pairs: [string, string, string][] = [['sms', 'FRONT_OFFICE_CHANNEL_ID', 'FRONT_OFFICE_CHANNEL_KEY'], ['web-chat', 'FRONT_OFFICE_CHAT_CHANNEL_ID', 'FRONT_OFFICE_CHAT_CHANNEL_KEY'], ['email', 'FRONT_OFFICE_EMAIL_CHANNEL_ID', 'FRONT_OFFICE_EMAIL_CHANNEL_KEY'], ['voice', 'FRONT_OFFICE_VOICE_CHANNEL_ID', 'FRONT_OFFICE_VOICE_CHANNEL_KEY']];
  const out: { name: string; auth: ChannelAuth }[] = [];
  for (const [name, idKey, keyKey] of pairs) {
    const channel = (env[idKey] ?? '').trim(), key = (env[keyKey] ?? '').trim();
    if (UUID_RE.test(channel) && key.length >= 32 && !out.some(o => o.auth.channel === channel)) out.push({ name, auth: { channel, key } });
  }
  return out;
}

/** Instagram and Messenger channels for the runner (A-32): FRONT_OFFICE_INSTAGRAM_CHANNEL_ID/_KEY and
 * FRONT_OFFICE_MESSENGER_CHANNEL_ID/_KEY. Each is run with meta set, so every job goes through metaRoute() and the
 * 24-hour window. A channel already listed by runnerChannels(), invalid pairs and duplicates are skipped. These are
 * deliberately not part of runnerChannels(): every Meta job must go through metaRoute(). The approval route re-checks Meta's window itself since A-37 (socialWindowCheck). */
export function metaRunnerChannels(env: Record<string, string | undefined>): { name: MetaKind; auth: ChannelAuth }[] {
  const taken = new Set(runnerChannels(env).map(c => c.auth.channel));
  const out: { name: MetaKind; auth: ChannelAuth }[] = [];
  for (const [name, idKey, keyKey] of [['instagram', 'FRONT_OFFICE_INSTAGRAM_CHANNEL_ID', 'FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY'], ['messenger', 'FRONT_OFFICE_MESSENGER_CHANNEL_ID', 'FRONT_OFFICE_MESSENGER_CHANNEL_KEY']] as const) {
    const channel = (env[idKey] ?? '').trim(), key = (env[keyKey] ?? '').trim();
    if (UUID_RE.test(channel) && key.length >= 32 && !taken.has(channel)) { taken.add(channel); out.push({ name, auth: { channel, key } }); }
  }
  return out;
}

/** The approval-time window check for approvePendingAction (A-32) on an Instagram or Messenger channel: reads
 * fo_social_window for the item's contact; an opted-out contact or one without a Meta id counts as outside the window.
 * onClosed queues the held text for the owner to send from the Instagram or Facebook app (fo_queue_outbound), the same
 * owner task the runner creates, unless the contact opted out. optedOut lets the approval note say the contact opted
 * out (A-43) instead of the window-closed wording. */
export function socialWindowCheck(rpc: Rpc, auth: ChannelAuth, now: () => number = Date.now): NonNullable<ApproveOptions['replyWindow']> {
  const a = { channel: auth.channel, channel_key: auth.key };
  const read = async (contact: string) => await rpc('fo_social_window', { ...a, contact }) as SocialWindow | null;
  // optedOut's read is handed to the lastInbound call that follows it for the same item, so approval still reads
  // fo_social_window once (A-43). onClosed always reads again before queuing anything.
  let handoff: { id: string; w: SocialWindow | null } | null = null;
  return {
    now,
    async optedOut(item) {
      handoff = null;
      if (!item.contactId) return false;
      const w = await read(item.contactId);
      handoff = { id: item.id, w };
      return w?.optedOut === true;
    },
    async lastInbound(item) {
      const kept = handoff && handoff.id === item.id ? handoff : null;
      handoff = null;
      if (!item.contactId) return null;
      const w = kept ? kept.w : await read(item.contactId);
      return w && w.recipient && !w.optedOut ? w.lastInbound : null;
    },
    async onClosed(item) {
      const p = item.payload;
      if (!item.contactId || !p || (p.kind !== 'send' && p.kind !== 'follow_up')) return;
      const w = await read(item.contactId);
      if (w?.optedOut) return;
      await rpc('fo_queue_outbound', { ...a, contact: item.contactId, message: p.body, prompt: p.promptVersion });
    },
  };
}

/** Runner secrets that are long enough to trust: Vercel Cron's CRON_SECRET and our own FRONT_OFFICE_CRON_SECRET. */
export function runnerSecrets(env: Record<string, string | undefined>): string[] {
  return [env.CRON_SECRET, env.FRONT_OFFICE_CRON_SECRET].map(s => (s ?? '').trim()).filter(s => s.length >= 32);
}

/** True when the Authorization header carries any configured runner secret (each compared in constant time). */
export function runnerAuthorized(header: string | null, secrets: string[]): boolean {
  let ok = false;
  for (const s of secrets) if (bearerMatches(header, s)) ok = true;
  return ok;
}
