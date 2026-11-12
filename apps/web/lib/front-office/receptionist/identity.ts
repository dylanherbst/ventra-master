// Caller identity check for the AI Receptionist (task A-20). Caller ID can be spoofed, so the number alone never lets
// a caller move or cancel a booking: they must also give a second factor that matches the stored booking, either the
// name it is under or its date and time. One helper, used by the production session (agent.ts), which the Vapi tool
// webhook, the Receptionist Lab and the live AI test all run, so there is a single rule everywhere.

export type IdentityCheck = 'ok' | 'missing' | 'wrong';

const clean = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const norm = (v: string) => v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/['-]/g, '').split(/\s+/).filter(Boolean);

/** Note: norm() keeps only Latin letters, so a non-Latin name never matches and that caller verifies by day and time only.
 * Name given vs name on the booking: ignores case, spacing and accents. Equal, or the same first name (a surname the
 * caller leaves out is fine; two different surnames are not). Nothing on file never matches. */
export function nameMatches(given: string, onFile: string | null | undefined): boolean {
  const g = norm(given), f = norm(onFile ?? '');
  if (!g.length || !f.length || g[0].length < 2) return false;
  if (g[0] !== f[0]) return false;
  return g.length === 1 || f.length === 1 || g.at(-1) === f.at(-1);
}

/** The booking start as local "YYYY-MM-DDTHH:mm" in the business's time zone. */
export function localMinute(ms: number, timeZone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Date and time given vs the booking's start. Needs both the date and the time: an ISO time with a zone, or a local
 * "YYYY-MM-DDTHH:mm" in the business's time zone. A bare time of day is too easy to guess and never matches. */
export function timeMatches(given: string, startsIso: string, timeZone: string): boolean {
  if (!given) return false;
  const start = Date.parse(startsIso);
  if (Number.isNaN(start)) return false;
  if (/(?:z|[+-]\d\d:?\d\d)$/i.test(given)) { const t = Date.parse(given); return !Number.isNaN(t) && Math.abs(t - start) < 60_000; }
  const m = given.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  return !!m && `${m[1]}T${m[2]}:${m[3]}` === localMinute(start, timeZone);
}

/** Does the caller's second factor match this booking? 'missing': they gave neither, so ask. 'wrong': they gave
 * something and none of it matches. Either detail correct is enough. */
export function verifyBookingCaller(input: Record<string, unknown>, contactName: string | null, appointment: { starts: string }, timeZone: string): IdentityCheck {
  const name = clean(input.verify_name, 160), time = clean(input.verify_time, 60);
  if (!name && !time) return 'missing';
  if (name && nameMatches(name, contactName)) return 'ok';
  if (time && timeMatches(time, appointment.starts, timeZone)) return 'ok';
  return 'wrong';
}

export const VERIFY_ARGS = {
  verify_name: { type: 'string', description: 'The name the caller says the booking is under. Ask for it; never offer it yourself.' },
  verify_time: { type: 'string', description: 'The date and time the caller says their booking is for, as local time in the business time zone, YYYY-MM-DDTHH:mm (for example 2026-11-11T10:00). Ask for it; never offer it yourself.' },
} as const;

export const ASK_TO_VERIFY = 'Not done yet: before changing a booking you must confirm who is calling. Ask the caller for the name the booking is under, or the day and time of the booking, then call this tool again with it as verify_name or verify_time. Do not say or hint at the name or time on file.';
export const REFUSED_UNVERIFIED = 'Not done, and nothing was changed: what the caller gave does not match the booking. Do not say what is on file, do not say which detail was wrong and do not try again. Tell them you cannot change this booking on this call, that you have passed it to the team and someone will check and call them back. Then offer to help with anything else.';
