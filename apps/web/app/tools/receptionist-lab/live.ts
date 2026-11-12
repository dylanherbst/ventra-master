// Server-only helpers for the Receptionist Lab "Live AI Test" (task A-41). Not a 'use server' module on purpose: nothing
// here is callable from the browser. actions.ts reads the session cookie and passes a token reader in.
//
// No new pipeline: every call goes to the A-26 engine in lib/front-office/receptionist/lab-live.ts. The LabCaller is
// built ONLY from the server-verified Supabase user (verifiedCaller, shared with the Setter Lab); no user id is ever
// accepted from the browser. The business settings are chosen here on the server, never sent by the page.
import { checkedReceptionistLab, endReceptionistLabCall, runLiveReceptionistTurn, startReceptionistLab } from '../../../lib/front-office/receptionist/lab-live';
import type { ReceptionistLabDeps, ReceptionistLabState } from '../../../lib/front-office/receptionist/lab-live';
import type { LabBackend } from '../../../lib/front-office/lab-session';
import type { LabPersistence, LabScenarioInfo } from '../../../lib/front-office/contracts';
import { demoSettings } from '../../../lib/front-office/receptionist/simulate';
import { LAB_TIME_ZONE, labDailyCapAud, labDay, labUsageToday } from '../../../lib/front-office/lab-usage';
import type { LabUsageToday } from '../../../lib/front-office/lab-usage';
import type { AgentSettings } from '../../../lib/front-office/settings';
import { LIVE_FAILED, SIGN_IN_CHECK_FAILED, liveError, verifiedCaller } from '../setter-lab/live-auth';
import type { LiveAiState, VerifyDeps } from '../setter-lab/live-auth';

/** signIn: what the server found when a paid turn was asked for ('verified' or 'refused'); absent when not checked. */
export type LiveCallResult = { state: ReceptionistLabState | null; error: string | null; liveAi?: LiveAiState; signIn?: 'verified' | 'refused'; persistence?: LabPersistence; scenarios?: LabScenarioInfo[]; notice?: string };

/** The business the lab answers for: the demo business's settings (knowledge, FAQs, hours, transfer number), built on
 * the server. Loading a signed-in owner's saved settings needs a workspace-scoped loader (not in this task). */
export const labBusinessSettings = (): AgentSettings => demoSettings();

export type LiveTurnDeps = {
  /** Reads the session token on the server (the httpOnly lp-access cookie in production). */
  token: () => Promise<string | undefined>;
  /** Supabase clients for verifiedCaller (tests only; production uses the real ones). */
  verify?: VerifyDeps;
  /** Engine deps (tests only): env, fetch, usage store, clock. Settings are always labBusinessSettings(). */
  engine?: Omit<ReceptionistLabDeps, 'settings' | 'backend'>;
  /** The user's lab sandbox over its voice channel (server side only; absent = in-memory). */
  backend?: LabBackend;
};

/** Plain messages from the engine about the call itself (ended, too long, unreadable, nothing said) are shown as they
 * are; everything else goes through the Setter Lab's mapping so nothing unexpected reaches the browser. */
const isCallMessage = (m: string) => m === 'Say something first.' || /^This lab call (has ended|is too long|could not be read)\. Start a new call\.$/.test(m);
export const CALL_UNREADABLE = 'This lab call could not be read. Start a new call.';
export const CALL_START_FAILED = 'The lab call could not start.';
/** Only the whitelisted call messages reach the browser; any other error (store, RPC, internal) becomes a fixed line. */
const safe = (e: unknown) => { const m = e instanceof Error ? e.message : ''; return isCallMessage(m) ? m : CALL_UNREADABLE; };

/** A new lab call: greeting only, no model, no cost. Anyone may start one; only a turn is paid. */
export async function startCall(backend?: LabBackend): Promise<LiveCallResult> {
  try { return { state: await startReceptionistLab({ settings: labBusinessSettings(), backend }), error: null }; }
  catch { return { state: null, error: CALL_START_FAILED }; }
}

/** Today's lab usage for the page, never throwing: if the usage store cannot be read the page still renders (the demo
 * section above is unaffected) and shows zero spent with a plain NOT READ note. The server still checks the cap before
 * every paid turn, so this fallback never lets a turn through. */
export async function usageForPage(read: () => Promise<LabUsageToday> = labUsageToday, clock: () => number = Date.now): Promise<LabUsageToday> {
  try { return await read(); }
  catch {
    const capAud = labDailyCapAud();
    return { day: labDay(clock()), timeZone: LAB_TIME_ZONE, spentAud: 0, capAud, remainingAud: capAud, estimate: true, persistent: false, note: USAGE_NOT_READ };
  }
}
export const USAGE_NOT_READ = 'Usage could not be read right now, so these figures are not real. The daily cap is still checked on the server before every paid turn. Press Refresh usage to try again.';

/** One caller turn on the real model. Order: the state is checked (no cookie read for junk), then the caller is
 * verified on the server, then the engine checks model config and the shared daily cap before any model call. */
export async function liveTurn(state: unknown, says: unknown, deps: LiveTurnDeps): Promise<LiveCallResult> {
  let s: ReceptionistLabState;
  try { s = checkedReceptionistLab(state); } catch (e) { return { state: null, error: safe(e) }; }
  let token: string | undefined;
  try { token = await deps.token(); } catch { return { state: null, error: SIGN_IN_CHECK_FAILED, signIn: 'refused' }; }
  const who = await verifiedCaller(token, deps.verify);
  if (!who.caller) return { state: null, error: who.error, signIn: 'refused' };
  try {
    const next = await runLiveReceptionistTurn(s, { says: typeof says === 'string' ? says : '' }, who.caller, { ...deps.engine, settings: labBusinessSettings(), backend: deps.backend });
    return { state: next, error: null, liveAi: 'configured', signIn: 'verified' };
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    if (isCallMessage(m)) return { state: null, error: m, liveAi: 'configured', signIn: 'verified' };
    const mapped = liveError(e);
    return { state: null, error: mapped.error || LIVE_FAILED, liveAi: mapped.liveAi, signIn: 'verified' };
  }
}

/** Hang up: summary and transcript saved on the in-memory call record. No model, no cost. */
export async function endCall(state: unknown, backend?: LabBackend): Promise<LiveCallResult> {
  try { return { state: await endReceptionistLabCall(checkedReceptionistLab(state), { settings: labBusinessSettings(), backend }), error: null }; }
  catch (e) { return { state: null, error: safe(e) }; }
}
