import { connection } from 'next/server';
import { cookies } from 'next/headers';
import { googleConfigFromEnv } from '../../../lib/front-office/calendar/google';
import { anthropicConfigFromEnv } from '../../../lib/front-office/llm';
import { modeLabel, usageLine, IDENTITY_NOTE } from './check';
import { loadLabOverview } from './overview';

// Isolated test page for the whole Front Office (task A-27). Plain markup, no design system. It links the two labs, shows
// the real operating modes and lab spend, and runs the cross-channel check (Setter-qualified contact -> Receptionist
// recognition only after the A-20 identity check) against real stored records under the owner's own session.
// Read only: it never sends anything and never honours FRONT_OFFICE_SEND_LIVE.
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 200) ?? '';

export default async function FrontOfficeLabPage({ searchParams }: { searchParams: Search }) {
  await connection();
  const sp = await searchParams;
  const q = { workspace: one(sp.workspace), phone: one(sp.phone), email: one(sp.email), verifyName: one(sp.verify_name) };
  const token = (await cookies()).get('lp-access')?.value;
  const o = await loadLabOverview(token, q);
  const connections = [
    { name: 'Account storage (Supabase)', state: o.supabase === 'connected' ? 'CONNECTED' : 'NEEDS LOCAL SUPABASE' },
    { name: 'Your sign-in', state: o.session === 'signed_in' ? 'SIGNED IN' : o.session === 'signed_out' ? 'SIGNED OUT' : 'NOT CHECKED' },
    { name: 'AI model', state: anthropicConfigFromEnv() ? 'CONFIGURED' : 'NOT CONFIGURED' },
    { name: 'Google Calendar', state: googleConfigFromEnv() ? 'CONNECTED' : 'NOT CONNECTED' },
    { name: 'Voice channel (Vapi)', state: process.env.FRONT_OFFICE_VOICE_CHANNEL_ID?.trim() ? 'CONNECTED' : 'NOT CONNECTED' },
    { name: 'Live sending (FRONT_OFFICE_SEND_LIVE), reported only, never used by this page', state: process.env.FRONT_OFFICE_SEND_LIVE === '1' ? 'ON' : 'OFF' },
  ];
  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 760, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Front Office Lab</h1>
      <p><strong data-testid="mode-badge">{o.badge}</strong>{' '}
        {o.badge === 'LIVE' ? 'Showing real stored data read under your own session.' : 'DEMO: no stored data is shown until Supabase and your sign-in are connected.'} Nothing on this page sends anything to a customer.</p>

      <h2>Labs</h2>
      <ul>
        <li><a href="/tools/setter-lab">AI Setter Lab</a></li>
        <li><a href="/tools/receptionist-lab">AI Receptionist Lab</a></li>
      </ul>

      <h2>Connections</h2>
      <ul data-testid="connections">{connections.map(c => <li key={c.name}>{c.name}: <strong>{c.state}</strong></li>)}</ul>
      {o.blocked && <p role="status" data-testid="blocked">{o.blocked}</p>}

      <h2>Operating mode</h2>
      {o.modes
        ? <ul data-testid="modes"><li>AI Setter: <strong>{modeLabel(o.modes.setter)}</strong></li><li>AI Receptionist: <strong>{modeLabel(o.modes.receptionist)}</strong></li></ul>
        : <p>Not read (see the connection state above).</p>}

      <h2>Lab usage today</h2>
      <p data-testid="usage">{o.usage ? usageLine(o.usage) : 'Not read.'}</p>

      <h2>Cross-channel check</h2>
      <p>{IDENTITY_NOTE}</p>
      <form method="get">
        <p><label>Workspace id <input name="workspace" defaultValue={q.workspace} size={40} /></label></p>
        <p><label>Phone <input name="phone" defaultValue={q.phone} /></label> <label>or email <input name="email" defaultValue={q.email} /></label></p>
        <p><label>Name the caller gives (identity check) <input name="verify_name" defaultValue={q.verifyName} /></label></p>
        <button type="submit">Run check</button>
      </form>
      {o.check
        ? <div data-testid="check"><p><strong>{o.check.recognised ? 'RECOGNISED' : 'NOT RECOGNISED'}</strong> ({o.check.status})</p><p>{o.check.message}</p>
          {o.check.contact && <p>Record: {o.check.contact.name ?? 'no name'}, state {o.check.contact.state}, Setter-qualified: {o.check.contact.setterQualified ? 'yes' : 'no'}</p>}</div>
        : <p data-testid="check-empty">{o.blocked ?? 'Enter a phone or email and run the check.'}</p>}
    </main>
  );
}
