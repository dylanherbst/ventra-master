// Server logic for the Front Office Lab page (task A-27). Read only: it reads the owner's operating modes, the lab spend
// and the matching customer records under the OWNER'S OWN signed-in session (RLS applies), and sends nothing to anyone.
// FRONT_OFFICE_SEND_LIVE is not read for any decision here (the page only reports whether it is on).
import { CONTACT_COLUMNS, contactFromRow, normaliseEmail, readPhone } from '../../../lib/front-office/crm';
import type { ContactRow } from '../../../lib/front-office/crm';
import type { Contact, OperatingMode } from '../../../lib/front-office/contracts';
import { createSupabasePendingActionStore } from '../../../lib/front-office/pending-actions';
import type { Rpc } from '../../../lib/front-office/orchestrator';
import { labUsageToday } from '../../../lib/front-office/lab-usage';
import type { LabUsageToday } from '../../../lib/front-office/lab-usage';
import { createSupabaseClient } from '../../../lib/supabase/client';
import { verifiedCaller } from '../setter-lab/live-auth';
import { crossChannelCheck } from './check';
import type { CrossChannelResult } from './check';

export const NEEDS_LOCAL_SUPABASE = 'Needs local Supabase: account storage is not connected on this server, so no customer records or operating modes can be read. Nothing is faked.';
export const NEEDS_SIGN_IN = 'Sign in as the business owner to read the operating modes and customer records. Without a session nothing is read.';
export const NEEDS_WORKSPACE = 'Enter the workspace id (a UUID) to read its operating modes and customer records.';
export const NO_ACCESS = 'You are not an active member of that workspace.';
export const READ_FAILED = 'Could not read from the database. Check that local Supabase is running and the migrations are applied.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LabQuery = { workspace: string; phone: string; email: string; verifyName: string };
export type LabModes = { setter: OperatingMode; receptionist: OperatingMode };
/** 'live' only when real stored data was read under a verified session; otherwise 'demo' (nothing stored is shown). */
export type LabOverview = {
  badge: 'LIVE' | 'DEMO';
  supabase: 'connected' | 'needs_local_supabase';
  session: 'signed_in' | 'signed_out' | 'unknown';
  /** Why the live section is empty, or null. */
  blocked: string | null;
  modes: LabModes | null;
  check: CrossChannelResult | null;
  usage: LabUsageToday | null;
};

export type OverviewDeps = {
  configured?: () => boolean;
  verify?: (token: string | undefined) => Promise<{ error: string | null; userId?: string }>;
  isMember?: (token: string, userId: string, workspace: string) => Promise<boolean>;
  modes?: (token: string, workspace: string) => Promise<LabModes>;
  contacts?: (token: string, workspace: string, keys: { phone: string | null; email: string | null }) => Promise<ContactRow[]>;
  usage?: () => Promise<LabUsageToday>;
};

const supabaseConfigured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const userDb = (token: string) => createSupabaseClient({ fetch: (url, init) => { const h = new Headers(init?.headers); h.set('Authorization', 'Bearer ' + token); return fetch(url, { ...init, headers: h, cache: 'no-store' }); } });

const defaults = {
  verify: async (token: string | undefined) => {
    const r = await verifiedCaller(token);
    return r.caller ? { error: null, userId: r.caller.userId } : { error: r.error };
  },
  isMember: async (token: string, userId: string, workspace: string) => {
    const m = await userDb(token).from('memberships').select('user_id').eq('workspace_id', workspace).eq('user_id', userId).eq('active', true);
    if (m.error) throw new Error(m.error.message);
    return !!m.data?.length;
  },
  modes: async (token: string, workspace: string): Promise<LabModes> => {
    const db = userDb(token);
    const rpc: Rpc = async (fn, args) => { const r = await db.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; };
    const store = createSupabasePendingActionStore({ rpc, workspaceId: workspace });
    return { setter: await store.mode('setter'), receptionist: await store.mode('receptionist') };
  },
  contacts: async (token: string, workspace: string, keys: { phone: string | null; email: string | null }): Promise<ContactRow[]> => {
    const db = userDb(token), rows: ContactRow[] = [];
    for (const [col, value] of [['phone', keys.phone], ['email', keys.email]] as const) {
      if (!value) continue;
      const r = await db.from('fo_contacts').select(CONTACT_COLUMNS).eq('workspace_id', workspace).eq(col, value).limit(10);
      if (r.error) throw new Error(r.error.message);
      rows.push(...((r.data ?? []) as unknown as ContactRow[]));
    }
    return rows;
  },
};

/** Builds everything the page shows. Never throws: each failure becomes a plain-English `blocked` line. */
export async function loadLabOverview(token: string | undefined, q: LabQuery, deps: OverviewDeps = {}): Promise<LabOverview> {
  const usage = await (deps.usage ?? labUsageToday)().catch(() => null);
  const base: LabOverview = { badge: 'DEMO', supabase: 'connected', session: 'unknown', blocked: null, modes: null, check: null, usage };
  if (!(deps.configured ?? supabaseConfigured)()) return { ...base, supabase: 'needs_local_supabase', blocked: NEEDS_LOCAL_SUPABASE };
  const v = await (deps.verify ?? defaults.verify)(token).catch(() => ({ error: READ_FAILED } as { error: string | null; userId?: string }));
  if (v.error || !v.userId) return { ...base, session: token ? 'unknown' : 'signed_out', blocked: v.error ?? NEEDS_SIGN_IN };
  const signedIn: LabOverview = { ...base, session: 'signed_in' };
  const workspace = q.workspace.trim();
  if (!UUID.test(workspace)) return { ...signedIn, blocked: NEEDS_WORKSPACE };
  try {
    if (!(await (deps.isMember ?? defaults.isMember)(token as string, v.userId, workspace))) return { ...signedIn, blocked: NO_ACCESS };
    const modes = await (deps.modes ?? defaults.modes)(token as string, workspace);
    const out: LabOverview = { ...signedIn, badge: 'LIVE', modes };
    const phone = q.phone.trim() ? readPhone(q.phone.trim()) : null, email = q.email.trim() ? normaliseEmail(q.email) : null;
    if (!q.phone.trim() && !q.email.trim()) return out;
    const keys = { phone: phone && phone.ok ? phone.phone : null, email };
    const rows = keys.phone || keys.email ? await (deps.contacts ?? defaults.contacts)(token as string, workspace, keys) : [];
    const contacts = rows.map(contactFromRow).filter((c): c is Contact => c !== null && c.workspaceId === workspace);
    return { ...out, check: crossChannelCheck({ phone: q.phone, email: q.email, verifyName: q.verifyName }, contacts) };
  } catch { return { ...signedIn, blocked: READ_FAILED }; }
}
