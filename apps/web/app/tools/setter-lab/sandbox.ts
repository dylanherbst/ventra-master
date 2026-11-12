// Server-only glue for the lab sandbox (task A-34), shared by the Setter Lab and the Receptionist Lab. Not a 'use server'
// module on purpose: nothing here is callable from the browser. The actions read the session cookie and pass the token.
//
// The user id comes ONLY from verifiedCaller (auth.getUser on the server plus the session_active check). The lab key
// secret is read from the env object by name (FRONT_OFFICE_LAB_KEY_SECRET) inside openLabSession and never leaves the
// server. When the secret, the sign-in or the database is missing the session says why and the lab uses its in-memory store.
import { createSupabaseClient } from '../../../lib/supabase/client';
import { deleteLabScenario, listLabScenarios, loadLabScenario, resetLabSandbox, rpcFromClient, saveLabScenario } from '../../../lib/supabase/lab-sandbox';
import type { LabRpc } from '../../../lib/supabase/lab-sandbox';
import { openLabSession, MEMORY_SIGNED_OUT } from '../../../lib/front-office/lab-session';
import type { LabSession } from '../../../lib/front-office/lab-session';
import type { LabProductName, LabRowCountsInfo, LabScenarioInfo } from '../../../lib/front-office/contracts';
import { verifiedCaller } from './live-auth';
import type { VerifyDeps } from './live-auth';

export type SandboxDeps = {
  env?: Record<string, string | undefined>;
  verify?: VerifyDeps;
  /** Builds the Supabase client that carries the user's token (tests pass a fake). */
  client?: (token: string) => { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> };
};

const defaultClient = (token: string): ReturnType<NonNullable<SandboxDeps['client']>> => createSupabaseClient({
  fetch: (url, init) => { const h = new Headers(init?.headers); h.set('Authorization', 'Bearer ' + token); return fetch(url, { ...init, headers: h, cache: 'no-store' }); },
}) as unknown as ReturnType<NonNullable<SandboxDeps['client']>>;

/** Pipeline calls keep the database's own message (for the tools); anything with a key in it is not in these messages. */
function rawRpc(client: ReturnType<NonNullable<SandboxDeps['client']>>): LabRpc {
  return async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(typeof error.message === 'string' ? error.message.slice(0, 300) : 'The sandbox database refused the call.');
    return data;
  };
}

export async function labSessionFromToken(token: string | undefined | null, deps: SandboxDeps = {}): Promise<LabSession> {
  const env = deps.env ?? process.env;
  let userId: string | null = null, rpc: LabRpc | null = null, pipelineRpc: LabRpc | undefined;
  if (typeof token === 'string' && token) {
    const who = await verifiedCaller(token, deps.verify);
    if (who.caller) {
      userId = who.caller.userId;
      try { const client = (deps.client ?? defaultClient)(token); rpc = rpcFromClient(client); pipelineRpc = rawRpc(client); } catch { rpc = null; }
    }
  }
  return openLabSession({ env, userId, rpc, pipelineRpc });
}

/** The session cookie, read on the server. */
export async function readToken(): Promise<string | undefined> {
  const { cookies } = await import('next/headers');
  return (await cookies()).get('lp-access')?.value;
}

export type SandboxOpResult<T> = { ok: true; value: T } | { ok: false; error: string };
const NEEDS_SANDBOX = (s: LabSession) => s.persistence.mode === 'memory' ? s.persistence.reason : MEMORY_SIGNED_OUT;
const message = (e: unknown) => (e instanceof Error ? e.message : 'The lab sandbox is unavailable. Please retry.').slice(0, 300);

/** Deletes every conversation row of the user's sandbox. Memory mode: nothing to delete. */
export async function resetSandbox(session: LabSession): Promise<SandboxOpResult<LabRowCountsInfo | null>> {
  if (!session.sandbox || !session.userRpc) return { ok: true, value: null };
  try { return { ok: true, value: await resetLabSandbox(session.userRpc, session.sandbox.workspaceId) }; } catch (e) { return { ok: false, error: message(e) }; }
}

export async function scenarioList(session: LabSession, lab: LabProductName): Promise<LabScenarioInfo[]> {
  if (!session.sandbox || !session.userRpc) return [];
  try { return await listLabScenarios(session.userRpc, session.sandbox.workspaceId, lab); } catch { return []; }
}

/** Save the lab state with the sandbox rows. Saves over the same name when it exists (revision looked up here). */
export async function scenarioSave(session: LabSession, lab: LabProductName, name: string, state: unknown): Promise<SandboxOpResult<LabScenarioInfo>> {
  if (!session.sandbox || !session.userRpc) return { ok: false, error: NEEDS_SANDBOX(session) };
  try {
    const existing = (await listLabScenarios(session.userRpc, session.sandbox.workspaceId, lab)).find(s => s.name === name.trim());
    return { ok: true, value: await saveLabScenario(session.userRpc, session.sandbox.workspaceId, { product: lab, name, state, expectedRevision: existing ? existing.revision : 0 }) };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/** Reset the sandbox and restore the saved rows; returns the saved lab state (the caller re-checks it before use). */
export async function scenarioLoad(session: LabSession, lab: LabProductName, name: string): Promise<SandboxOpResult<Record<string, unknown>>> {
  if (!session.sandbox || !session.userRpc) return { ok: false, error: NEEDS_SANDBOX(session) };
  try { return { ok: true, value: (await loadLabScenario(session.userRpc, session.sandbox.workspaceId, lab, name)).state }; } catch (e) { return { ok: false, error: message(e) }; }
}

export async function scenarioDelete(session: LabSession, lab: LabProductName, name: string): Promise<SandboxOpResult<null>> {
  if (!session.sandbox || !session.userRpc) return { ok: false, error: NEEDS_SANDBOX(session) };
  try {
    const existing = (await listLabScenarios(session.userRpc, session.sandbox.workspaceId, lab)).find(s => s.name === name.trim());
    if (!existing) return { ok: false, error: 'Scenario not found.' };
    await deleteLabScenario(session.userRpc, session.sandbox.workspaceId, lab, name, existing.revision);
    return { ok: true, value: null };
  } catch (e) { return { ok: false, error: message(e) }; }
}
