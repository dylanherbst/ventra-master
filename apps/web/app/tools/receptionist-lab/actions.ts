'use server';
// Runs one simulated call for the Receptionist Test Lab. Everything happens in memory (scripted model, fake store,
// fake calendar, recording senders): no call is placed or answered, nothing is sent, no database or provider is used.
import { fixtureById, fixtures, simulateCall } from '../../../lib/front-office/receptionist/simulate';
import type { SimResult } from '../../../lib/front-office/receptionist/simulate';
import { checkedReceptionistLab } from '../../../lib/front-office/receptionist/lab-live';
import type { ReceptionistLabState } from '../../../lib/front-office/receptionist/lab-live';
import type { LabPersistence, LabScenarioInfo } from '../../../lib/front-office/contracts';
import type { LabSession } from '../../../lib/front-office/lab-session';
import { labSessionFromToken, readToken, resetSandbox, scenarioDelete, scenarioList, scenarioLoad, scenarioSave } from '../setter-lab/sandbox';
import { labUsageToday } from '../../../lib/front-office/lab-usage';
import type { LabUsageToday } from '../../../lib/front-office/lab-usage';
import { endCall, liveTurn, startCall } from './live';
import type { LiveCallResult } from './live';

export type LabState = { result: SimResult | null; error: string | null };

// Live AI Test (task A-41): the real model through the A-26 engine (lib/front-office/receptionist/lab-live.ts), with the
// store, calendar and senders sandboxed. Starting and ending a call are free (no model). A turn is paid, so the caller is
// built ONLY from the server-verified Supabase session (lp-access cookie read here); no user id is taken from the browser.
//
// Lab sandbox (task A-34): when the server-only lab key secret is set and the visitor is signed in, the live call runs on the
// visitor's own lab sandbox (real fo_* functions over its lab voice channel); otherwise on the in-memory store, and every
// result says which (persistence). The fixture simulation (runLab below) always stays in memory. Nothing is ever sent.
async function session(): Promise<LabSession> {
  let token: string | undefined;
  try { token = await readToken(); } catch { token = undefined; }
  return labSessionFromToken(token);
}
const withSession = (r: LiveCallResult, s: LabSession): LiveCallResult => ({ ...r, persistence: s.persistence });

/** Where this lab keeps its data right now, and its saved scenarios (database mode only). */
export async function getReceptionistLabSession(): Promise<{ persistence: LabPersistence; scenarios: LabScenarioInfo[] }> {
  const s = await session();
  return { persistence: s.persistence, scenarios: await scenarioList(s, 'receptionist') };
}

export async function startLiveCall(): Promise<LiveCallResult> {
  const s = await session();
  return withSession(await startCall(s.voice ?? undefined), s);
}

export async function sendLiveTurn(state: ReceptionistLabState, says: string): Promise<LiveCallResult> {
  const s = await session();
  return withSession(await liveTurn(state, says, { token: readToken, backend: s.voice ?? undefined }), s);
}

export async function endLiveCall(state: ReceptionistLabState): Promise<LiveCallResult> {
  const s = await session();
  return withSession(await endCall(state, s.voice ?? undefined), s);
}

/** Reset: deletes the sandbox's conversation rows (database mode) and starts a fresh call. */
export async function resetLiveLab(): Promise<LiveCallResult> {
  const s = await session();
  const r = await resetSandbox(s);
  if (!r.ok) return { state: null, error: r.error, persistence: s.persistence };
  const cleared = r.value ? Object.entries(r.value).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') : '';
  return { ...withSession(await startCall(s.voice ?? undefined), s), notice: s.persistence.mode === 'database' ? `Sandbox reset${cleared ? ` (cleared ${cleared})` : ''}.` : 'Call cleared (memory only).' };
}

export async function saveCallScenario(state: ReceptionistLabState, name: string): Promise<LiveCallResult> {
  const s = await session();
  try {
    const r = await scenarioSave(s, 'receptionist', typeof name === 'string' ? name : '', checkedReceptionistLab(state));
    if (!r.ok) return { state: null, error: r.error, persistence: s.persistence };
    return { state: null, error: null, persistence: s.persistence, scenarios: await scenarioList(s, 'receptionist'), notice: `Saved "${r.value.name}" (revision ${r.value.revision}).` };
  } catch (e) { return { state: null, error: e instanceof Error ? e.message.slice(0, 300) : 'The lab failed.', persistence: s.persistence }; }
}

export async function loadCallScenario(name: string): Promise<LiveCallResult> {
  const s = await session();
  try {
    const r = await scenarioLoad(s, 'receptionist', typeof name === 'string' ? name : '');
    if (!r.ok) return { state: null, error: r.error, persistence: s.persistence };
    return { state: checkedReceptionistLab(r.value), error: null, persistence: s.persistence, scenarios: await scenarioList(s, 'receptionist'), notice: `Loaded "${String(name).slice(0, 80)}".` };
  } catch (e) { return { state: null, error: e instanceof Error ? e.message.slice(0, 300) : 'The lab failed.', persistence: s.persistence }; }
}

export async function deleteCallScenario(name: string): Promise<LiveCallResult> {
  const s = await session();
  const r = await scenarioDelete(s, 'receptionist', typeof name === 'string' ? name : '');
  if (!r.ok) return { state: null, error: r.error, persistence: s.persistence };
  return { state: null, error: null, persistence: s.persistence, scenarios: await scenarioList(s, 'receptionist'), notice: 'Scenario deleted.' };
}

export async function getLiveUsage(): Promise<LabUsageToday> {
  return labUsageToday();
}

export async function runLab(_prev: LabState, form: FormData): Promise<LabState> {
  const id = String(form.get('fixture') ?? '');
  const fixture = fixtureById(id) ?? fixtures[0];
  const lines = String(form.get('lines') ?? '').slice(0, 3000).split('\n').map(l => l.trim()).filter(Boolean).slice(0, 8);
  try {
    const result = await simulateCall(fixture, {
      liveSwitch: form.get('live') === 'on',
      receptionistOn: form.get('receptionistOn') === 'on',
      transfer: form.get('transfer') === 'on',
      calendar: form.get('calendar') === 'on',
      callerLines: form.get('custom') === 'on' ? lines : [],
    });
    return { result, error: null };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : 'The simulation failed.' };
  }
}
