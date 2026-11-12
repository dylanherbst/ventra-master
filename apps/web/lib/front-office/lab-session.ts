// Lab sandbox session (task A-34). Server only. Decides where a lab (Setter Lab or Receptionist Lab) keeps its data:
//  - 'database': the signed-in user's lab sandbox workspace (lib/supabase/lab-sandbox.ts, A-25). The labs then run the real
//    pipeline against the real fo_* functions with the sandbox's own lab channel, so a lab booking is a real row that
//    GET /api/front-office/contacts returns for that workspace.
//  - 'memory': the lab's in-memory store, with a plain-English reason shown on the page (DEMO, memory only).
//
// This file reads one env NAME (FRONT_OFFICE_LAB_KEY_SECRET) from the env object it is given; it never reads process.env
// itself unless the caller passes it, never logs, and never returns the secret or the derived channel key to a caller
// that could send it to the browser (LabBackend stays on the server). Nothing here sends anything: the lab channels are
// 'lab:sms:<id>' / 'lab:voice:<id>' and no provider can deliver to them, and FRONT_OFFICE_*_LIVE switches are not read.
import type { ChannelAuth, Rpc } from './orchestrator';
import type { LabPersistence } from './contracts';
import { ensureLabSandbox, labChannelKey, LabSandboxError, rpcFromClient } from '../supabase/lab-sandbox';
import type { LabRpc, LabSandbox } from '../supabase/lab-sandbox';

/** The server-only env var holding the secret the per-user lab channel key is derived from (at least 32 characters). */
export const LAB_KEY_ENV_NAME = 'FRONT_OFFICE_LAB_KEY_SECRET';

export const MEMORY_NO_SECRET = `Lab sandbox is off: the server-only lab key secret (${LAB_KEY_ENV_NAME}) is not set, so this lab keeps everything in memory on this page only. Nothing is saved.`;
export const MEMORY_SHORT_SECRET = `Lab sandbox is off: the lab key secret (${LAB_KEY_ENV_NAME}) is too short (it needs at least 32 characters), so this lab keeps everything in memory on this page only. Nothing is saved.`;
export const MEMORY_SIGNED_OUT = 'Sign in to save lab conversations in your lab sandbox. Until then this lab keeps everything in memory on this page only. Nothing is saved.';
export const MEMORY_UNAVAILABLE = 'The lab sandbox database is not available right now, so this lab keeps everything in memory on this page only. Nothing is saved.';

/** Server-side handle on the sandbox. Never sent to the browser (it holds the channel key). */
export type LabBackend = { rpc: Rpc; auth: ChannelAuth; workspaceId: string; /** The lab channel's address ('lab:sms:<id>'), the "to" of an inbound SMS. */ address: string };
export type LabSession = {
  persistence: LabPersistence;
  /** Present only when persistence.mode is 'database'. */
  backend: LabBackend | null;
  /** The same sandbox over its voice channel (Receptionist Lab). */
  voice: LabBackend | null;
  sandbox: LabSandbox | null;
  /** The signed-in user's Supabase rpc, for the fo_lab_* functions (reset, scenarios). Null in memory mode. */
  userRpc: LabRpc | null;
};

export type LabSessionInput = {
  /** Server env (pass process.env). Only LAB_KEY_ENV_NAME is read. */
  env: Record<string, string | undefined>;
  /** The server-verified user id, or null when nobody is signed in. Never taken from the browser. */
  userId: string | null;
  /** The signed-in user's rpc (rpcFromClient on a client carrying the user's token); null when none. */
  rpc: LabRpc | null;
  /** The rpc the pipeline runs on (default: rpc). Unlike rpc it should pass the database's own error text through, so
   * the Setter and Receptionist tools see why a call was refused. */
  pipelineRpc?: LabRpc;
};

const memory = (reason: string): LabSession => ({ persistence: { mode: 'memory', reason }, backend: null, voice: null, sandbox: null, userRpc: null });

/** Opens (and on first use creates) the user's sandbox, or says in plain English why the lab stays in memory. */
export async function openLabSession(input: LabSessionInput): Promise<LabSession> {
  const secret = input.env[LAB_KEY_ENV_NAME];
  if (typeof secret !== 'string' || !secret.trim()) return memory(MEMORY_NO_SECRET);
  if (secret.length < 32) return memory(MEMORY_SHORT_SECRET);
  if (!input.userId || !input.rpc) return memory(MEMORY_SIGNED_OUT);
  try {
    const key = labChannelKey(secret, input.userId);
    const sandbox = await ensureLabSandbox(input.rpc, key);
    // The Setter Lab talks over the sandbox's sms channel, the Receptionist Lab over its voice channel (chosen by the lab).
    const rpc = (input.pipelineRpc ?? input.rpc) as Rpc, workspaceId = sandbox.workspaceId;
    return {
      persistence: { mode: 'database', workspaceId, created: sandbox.created },
      backend: { rpc, auth: { channel: sandbox.channels.sms.id, key }, workspaceId, address: sandbox.channels.sms.address },
      voice: { rpc, auth: { channel: sandbox.channels.voice.id, key }, workspaceId, address: sandbox.channels.voice.address },
      sandbox, userRpc: input.rpc,
    };
  } catch (e) {
    return memory(e instanceof LabSandboxError && /Sign in required/.test(e.message) ? MEMORY_SIGNED_OUT : MEMORY_UNAVAILABLE);
  }
}

/** The labs' own plain-English validation messages (lab state checks, empty turn); these never carry database detail. */
const LAB_OWN_MESSAGE = /^(The lab state is not valid \(|Decision must be approve or reject\.|This lab call (could not be read|is too long|has ended)|Say something first\.|This lab conversation has reached \d+ messages\.|Type a message first\.|The test caller number must)/;

/**
 * The text of an error that may reach the browser. It runs the message through the same filter as rpcFromClient
 * (lib/supabase/lab-sandbox.ts): messages the fo_lab_* functions raise on purpose pass, anything else (raw PostgREST or
 * database detail) becomes the generic "The lab sandbox is unavailable. Please retry."
 */
export async function safeLabError(e: unknown): Promise<string> {
  const text = e instanceof Error ? e.message : '';
  if (LAB_OWN_MESSAGE.test(text)) return text.slice(0, 300);
  try { await rpcFromClient({ rpc: async () => ({ data: null, error: { message: text } }) })('safe', {}); return ''; } catch (x) { return (x as Error).message; }
}

// ---------------------------------------------------------------------------------------------------------------
// Test email domains. The database (fo_lab_contact_guard) only lets a sandbox contact hold a test address. A model that
// writes a real-looking address must not fail the turn, so the address is swapped for a test one before it is stored.

const TEST_EMAIL = /@(([a-z0-9-]+\.)*example\.(com|net|org)|([a-z0-9-]+\.)+(example|test|invalid|localhost))$/i;
export const isTestEmail = (email: string) => TEST_EMAIL.test(email);
export const SANDBOX_EMAIL_DOMAIN = 'lab-sandbox.test';

/** A test address for any email: test addresses pass through, a real-looking one becomes <name>@lab-sandbox.test. */
export function sandboxEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (isTestEmail(e)) return e;
  const local = (e.split('@')[0] ?? '').replace(/[^a-z0-9._-]/g, '').slice(0, 60) || 'contact';
  return `${local}@${SANDBOX_EMAIL_DOMAIN}`;
}

export type SandboxWrite = { rpc: string; detail: string };

/**
 * The pipeline's rpc over the sandbox: same functions, same arguments, plus (1) real-looking emails swapped for test
 * ones, and (2) one line per write for the lab page (kept short; never the channel key). Errors are the database's own.
 */
export function sandboxRpc(inner: Rpc, writes: SandboxWrite[]): Rpc {
  return async (fn, args) => {
    let a = args;
    if (typeof args.contact_email === 'string' && args.contact_email && !isTestEmail(args.contact_email)) {
      const swapped = sandboxEmail(args.contact_email);
      a = { ...args, contact_email: swapped };
      writes.push({ rpc: fn, detail: `email "${args.contact_email.slice(0, 80)}" looked real; stored the test address ${swapped} instead (the sandbox only holds test emails)` });
    }
    const out = await inner(fn, a);
    if (!READ_ONLY.has(fn)) writes.push({ rpc: fn, detail: `sandbox database call (${a.agent_name ?? a.job_kind ?? a.new_state ?? 'ok'})`.slice(0, 160) });
    return out;
  };
}
const READ_ONLY = new Set(['fo_contact_context', 'fo_booking_for_event', 'fo_channel_settings']);
