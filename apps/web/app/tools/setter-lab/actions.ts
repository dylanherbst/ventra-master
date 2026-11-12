'use server';
// Server actions for the Setter Test Lab. The lab state lives in the browser and comes back with each call.
// Demo actions (startLab, sendMessage, decideAction): scripted model only, anyone can call them without signing in, and
// no paid model is reachable from them. Any model choice sent by the client is ignored.
// Live AI Test (sendLiveMessage, task A-23b): the real model through runLiveLabTurn, sandboxed side effects. The caller is
// built ONLY from the server-verified Supabase user (session cookie read here, checked by verifiedCaller); no user id is
// ever accepted from the browser. Not signed in means a plain error and no model call.
//
// Lab sandbox (task A-34): when the lab key secret is set on the server AND the visitor is signed in, the conversation is
// written to the visitor's own lab sandbox workspace through the real fo_* functions (see lib/front-office/lab-session.ts);
// reset and save / load scenario work on those rows. Otherwise the lab keeps its in-memory store and every result says
// why (persistence.mode 'memory' with a plain reason). Nothing is ever sent; the lab channels have no provider.
import { checkedLab, decideLabAction, newLab, runLabTurn } from '../../../lib/front-office/setter/lab';
import type { LabState } from '../../../lib/front-office/setter/lab';
import { runLiveLabTurn } from '../../../lib/front-office/setter/lab-live';
import { labUsageToday } from '../../../lib/front-office/lab-usage';
import type { LabUsageToday } from '../../../lib/front-office/lab-usage';
import { isOperatingMode } from '../../../lib/front-office/contracts';
import type { LabPersistence, LabScenarioInfo, OperatingMode } from '../../../lib/front-office/contracts';
import { safeLabError } from '../../../lib/front-office/lab-session';
import type { LabSession } from '../../../lib/front-office/lab-session';
import { LIVE_FAILED, SIGN_IN_CHECK_FAILED, liveError, verifiedCaller } from './live-auth';
import type { LiveAiState } from './live-auth';
import { labSessionFromToken, readToken, resetSandbox, scenarioDelete, scenarioList, scenarioLoad, scenarioSave } from './sandbox';

export type LabResult = { state: LabState | null; error: string | null; liveAi?: LiveAiState; persistence?: LabPersistence; scenarios?: LabScenarioInfo[]; notice?: string };
// Error text goes through safeLabError (the rpcFromClient filter), so raw database detail never reaches the browser.
const fail = async (e: unknown, persistence?: LabPersistence): Promise<LabResult> => ({ state: null, error: (await safeLabError(e)) || 'The lab failed.', persistence });
const CLEARS_ALL = 'This clears the whole lab sandbox, including the Receptionist Lab data (both labs share it).';

/** The visitor's lab session (sandbox or memory). A missing request context (tests, build) is memory mode, never an error. */
async function session(): Promise<LabSession> {
  let token: string | undefined;
  try { token = await readToken(); } catch { token = undefined; }
  return labSessionFromToken(token);
}

/** Where this lab keeps its data right now, and the saved scenarios (database mode only). Safe to call on page load. */
export async function getLabSession(): Promise<{ persistence: LabPersistence; scenarios: LabScenarioInfo[] }> {
  const s = await session();
  return { persistence: s.persistence, scenarios: await scenarioList(s, 'setter') };
}

/** A new conversation. In database mode this is a destructive reset: it deletes ALL the sandbox's conversation rows, the
 * Receptionist Lab's too (both labs share one sandbox; not other users', not a business's). The notice says so. */
export async function startLab(mode: OperatingMode): Promise<LabResult> {
  const s = await session();
  const r = await resetSandbox(s);
  if (!r.ok) return fail(new Error(r.error), s.persistence);
  return { state: newLab(isOperatingMode(mode) ? mode : 'owner_approval'), error: null, persistence: s.persistence, notice: s.persistence.mode === 'database' ? `New conversation started. ${CLEARS_ALL}` : undefined };
}

/** Reset: same as a new conversation, but says what was cleared. */
export async function resetLab(mode: OperatingMode): Promise<LabResult> {
  const s = await session();
  const r = await resetSandbox(s);
  if (!r.ok) return fail(new Error(r.error), s.persistence);
  const cleared = r.value ? Object.entries(r.value).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') : '';
  return { state: newLab(isOperatingMode(mode) ? mode : 'owner_approval'), error: null, persistence: s.persistence, notice: s.persistence.mode === 'database' ? `Sandbox reset${cleared ? ` (cleared ${cleared})` : ''}. ${CLEARS_ALL}` : 'Conversation cleared (memory only).' };
}

export async function sendMessage(state: LabState, message: string, mode: OperatingMode): Promise<LabResult> {
  let s: LabSession | undefined;
  try {
    s = await session();
    const l = checkedLab(state);
    return { state: await runLabTurn(l, { message: typeof message === 'string' ? message : '', mode: isOperatingMode(mode) ? mode : l.mode }, s.backend ?? undefined), error: null, persistence: s.persistence };
  } catch (e) { return fail(e, s?.persistence); }
}

export async function sendLiveMessage(state: LabState, message: string, mode: OperatingMode): Promise<LabResult> {
  let l: LabState;
  try { l = checkedLab(state); } catch (e) { return fail(e); }
  let token: string | undefined;
  try { token = await readToken(); } catch { return { state: null, error: SIGN_IN_CHECK_FAILED }; }
  const who = await verifiedCaller(token);
  if (!who.caller) return { state: null, error: who.error };
  let s: LabSession | undefined;
  try {
    // The caller was verified just above; hand it on so verifiedCaller does not run a second time.
    s = await labSessionFromToken(token, { verified: who });
    const next = await runLiveLabTurn(l, { message: typeof message === 'string' ? message : '', mode: isOperatingMode(mode) ? mode : l.mode }, who.caller, { backend: s.backend ?? undefined });
    return { state: next, error: null, liveAi: 'configured', persistence: s.persistence };
  } catch (e) {
    const m = liveError(e);
    return { state: null, error: m.error || LIVE_FAILED, liveAi: m.liveAi, persistence: s?.persistence };
  }
}

export async function getLabUsage(): Promise<LabUsageToday> {
  return labUsageToday();
}

export async function decideAction(state: LabState, id: string, decision: 'approve' | 'reject'): Promise<LabResult> {
  let s: LabSession | undefined;
  try {
    s = await session();
    if (decision !== 'approve' && decision !== 'reject') throw new Error('Decision must be approve or reject.');
    return { state: await decideLabAction(checkedLab(state), typeof id === 'string' ? id : '', decision, s.backend ?? undefined), error: null, persistence: s.persistence };
  } catch (e) { return fail(e, s?.persistence); }
}

/** Save the current conversation (lab state and the sandbox rows) under a name. Database mode only. */
export async function saveScenario(state: LabState, name: string): Promise<LabResult> {
  let s: LabSession | undefined;
  try {
    s = await session();
    const l = checkedLab(state);
    const r = await scenarioSave(s, 'setter', typeof name === 'string' ? name : '', l);
    if (!r.ok) return { state: null, error: r.error, persistence: s.persistence };
    return { state: null, error: null, persistence: s.persistence, scenarios: await scenarioList(s, 'setter'), notice: `Saved "${r.value.name}" (revision ${r.value.revision}).` };
  } catch (e) { return fail(e, s?.persistence); }
}

/** Reset the sandbox and restore a saved scenario (rows and lab state). Database mode only. */
export async function loadScenario(name: string): Promise<LabResult> {
  let s: LabSession | undefined;
  try {
    s = await session();
    const r = await scenarioLoad(s, 'setter', typeof name === 'string' ? name : '');
    if (!r.ok) return { state: null, error: r.error, persistence: s.persistence };
    return { state: checkedLab(r.value), error: null, persistence: s.persistence, scenarios: await scenarioList(s, 'setter'), notice: `Loaded "${String(name).slice(0, 80)}".` };
  } catch (e) { return fail(e, s?.persistence); }
}

export async function deleteScenario(name: string): Promise<LabResult> {
  let s: LabSession | undefined;
  try {
    s = await session();
    const r = await scenarioDelete(s, 'setter', typeof name === 'string' ? name : '');
    if (!r.ok) return { state: null, error: r.error, persistence: s.persistence };
    return { state: null, error: null, persistence: s.persistence, scenarios: await scenarioList(s, 'setter'), notice: 'Scenario deleted.' };
  } catch (e) { return fail(e, s?.persistence); }
}
