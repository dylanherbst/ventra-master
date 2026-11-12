'use client';
import { useState, useTransition } from 'react';
import { decideAction, deleteScenario, getLabUsage, loadScenario, resetLab, saveScenario, sendLiveMessage, sendMessage, startLab } from './actions';
import type { LabResult } from './actions';
import type { LabState } from '../../../lib/front-office/setter/lab';
import type { LabUsageToday } from '../../../lib/front-office/lab-usage';
import type { LabPersistence, LabScenarioInfo, OperatingMode } from '../../../lib/front-office/contracts';
import type { LiveAiState } from './live-auth';
import { turnBadge, turnUsageLine, usageTodayLine } from './format';

type LabRun = 'demo' | 'live';
const CONNECTED_REASON = 'Needs an approved Instagram/Messenger connection (task A-11)';
const LIVE_AI_LABEL: Record<LiveAiState, string> = {
  unknown: 'UNKNOWN (send a Live AI Test message to check)',
  configured: 'CONFIGURED',
  not_configured: 'NOT CONFIGURED (no model key or model name on this server)',
};

// Plain functional markup on purpose (no design system): this is a test page, not product UI.
const MODES: { id: OperatingMode; label: string }[] = [
  { id: 'automatic', label: 'Automatic (perform)' },
  { id: 'owner_approval', label: 'Owner approval (held for approval)' },
  { id: 'enquiry_only', label: 'Enquiry only (refused, message taken)' },
];
const json = (v: unknown) => JSON.stringify(v, null, 2);

export default function SetterLab({ initial, initialUsage, initialPersistence = { mode: 'memory', reason: 'Lab sandbox status not loaded yet; memory only.' }, initialScenarios = [] }: { initial: LabState; initialUsage: LabUsageToday; initialPersistence?: LabPersistence; initialScenarios?: LabScenarioInfo[] }) {
  const [persistence, setPersistence] = useState<LabPersistence>(initialPersistence);
  const [scenarios, setScenarios] = useState<LabScenarioInfo[]>(initialScenarios);
  const [scenarioName, setScenarioName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState<LabState>(initial);
  const [mode, setMode] = useState<OperatingMode>(initial.mode);
  const [labRun, setLabRun] = useState<LabRun>('demo');
  const [liveAi, setLiveAi] = useState<LiveAiState>('unknown');
  const [usage, setUsage] = useState<LabUsageToday>(initialUsage);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const apply = (r: LabResult) => {
    setError(r.error); setNotice(r.notice ?? null);
    if (r.state) { setState(r.state); setMode(r.state.mode); }
    if (r.liveAi && r.liveAi !== 'unknown') setLiveAi(r.liveAi);
    if (r.persistence) setPersistence(r.persistence);
    if (r.scenarios) setScenarios(r.scenarios);
  };
  const db = persistence.mode === 'database';
  const run = (f: () => Promise<LabResult>) => start(async () => { try { apply(await f()); } catch { setError('The lab could not reach the server.'); } });
  const refreshUsage = async () => { try { setUsage(await getLabUsage()); } catch { /* keep the last known figures */ } };
  const runLive = (m: string) => start(async () => {
    try { apply(await sendLiveMessage(state, m, mode)); } catch { setError('The lab could not reach the server.'); }
    await refreshUsage();
  });
  const contact = state.tables.contacts[0] ?? null;
  const held = state.pending;
  const live = labRun === 'live';

  return <main>
    <h1>Setter Test Lab</h1>
    <p><strong data-testid="page-mode">{live ? 'LIVE AI TEST' : 'DEMO'}</strong> Runs your messages through the real AI Setter pipeline (inbound router, Setter tools, booking, permission check) with an in-memory calendar. Nothing is sent and nothing is booked in a real calendar. {db ? 'Contacts, messages and bookings are written to your own lab sandbox workspace (test data only).' : 'Nothing is written to Supabase (memory only).'} {live ? 'Live AI Test uses the real AI model (paid, estimated cost shown) and needs you to be signed in.' : 'Demo uses a scripted model and needs no sign-in.'}</p>

    <fieldset data-testid="lab-run">
      <legend>Test mode</legend>
      <label><input type="radio" name="lab-run" value="demo" checked={labRun === 'demo'} disabled={pending} onChange={() => setLabRun('demo')} /> Demo (scripted, free)</label>{' '}
      <label><input type="radio" name="lab-run" value="live" checked={labRun === 'live'} disabled={pending} onChange={() => setLabRun('live')} /> Live AI Test (real model, sandboxed, needs sign-in)</label>{' '}
      <label><input type="radio" name="lab-run" value="connected" disabled /> Connected</label>{' '}
      <small data-testid="connected-reason">Connected is off: {CONNECTED_REASON}.</small>
    </fieldset>

    <h2>Connection state</h2>
    <ul data-testid="connections">
      <li>Model: <strong>{live ? 'REAL (Live AI Test)' : 'SCRIPTED'}</strong>{live ? '' : ' (keyword rules)'}.</li>
      <li data-testid="live-ai-state">Live AI: <strong>{LIVE_AI_LABEL[liveAi]}</strong></li>
      <li data-testid="persistence">Persistence: <strong>{db ? 'SANDBOX DATABASE' : 'MEMORY ONLY'}</strong>{persistence.mode === 'database' ? ` (your lab sandbox workspace ${persistence.workspaceId}; contacts and bookings are real rows in it)` : ` (${persistence.reason})`}</li>
      <li>Store: <strong>{db ? 'LAB SANDBOX (real fo_* functions)' : 'IN-MEMORY'}</strong> {db ? '(the calendar and the held-action queue stay in this page)' : '(this page only; reload or New conversation clears it)'}</li>
      <li>Channel: <strong>LAB</strong> (SMS shape, nothing sent)</li>
      <li>Calendar: <strong>IN-MEMORY</strong></li>
    </ul>

    <h2>Live AI usage today (estimate)</h2>
    <p data-testid="usage-today">{usageTodayLine(usage)}</p>
    <p data-testid="usage-note">{usage.persistent ? '' : 'NOT PERSISTENT. '}{usage.note}</p>
    <button type="button" disabled={pending} onClick={() => start(refreshUsage)}>Refresh usage</button>

    <fieldset>
      <legend>Settings</legend>
      <p>Operating mode for the Setter:{' '}
        {MODES.map(m => <label key={m.id}><input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} /> {m.label} </label>)}
      </p>
      <p data-testid="gate-note">Booking permission check shown here is the intended wiring; the production Setter does not call it yet (task A-8).</p>
      <button type="button" disabled={pending} onClick={() => { setMessage(''); run(() => startLab(mode)); }}>New conversation (clears the whole lab sandbox, including the Receptionist Lab)</button>{' '}
      <button type="button" disabled={pending} onClick={() => { setMessage(''); run(() => resetLab(mode)); }}>Reset sandbox (clears both labs' data)</button>
    </fieldset>

    <fieldset data-testid="scenarios">
      <legend>Saved scenarios</legend>
      {!db && <p>Saving needs the lab sandbox. {persistence.mode === 'memory' ? persistence.reason : ''}</p>}
      <label htmlFor="scenario-name">Name</label>{' '}
      <input id="scenario-name" maxLength={80} value={scenarioName} onChange={e => setScenarioName(e.target.value)} />{' '}
      <button type="button" disabled={pending || !db || !scenarioName.trim()} onClick={() => run(() => saveScenario(state, scenarioName))}>Save scenario</button>
      {scenarios.length === 0 ? <p>No saved scenarios.</p> : <ul>{scenarios.map(s => <li key={s.id}>
        {s.name} (revision {s.revision}, {s.contacts} contact{s.contacts === 1 ? '' : 's'}, {s.appointments} booking{s.appointments === 1 ? '' : 's'}){' '}
        <button type="button" disabled={pending || !db} onClick={() => run(() => loadScenario(s.name))}>Load</button>{' '}
        <button type="button" disabled={pending || !db} onClick={() => run(() => deleteScenario(s.name))}>Delete</button>
      </li>)}</ul>}
    </fieldset>
    {notice && <p role="status" data-testid="notice">{notice}</p>}

    <form onSubmit={e => { e.preventDefault(); const m = message; setMessage(''); if (live) runLive(m); else run(() => sendMessage(state, m, mode)); }}>
      <label htmlFor="msg">Customer says</label><br />
      <textarea id="msg" rows={3} cols={80} maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} placeholder="Hi, I'm Sam. I run a gym in Fremantle. We get about 40 enquiries a week. We are slow to reply. I want it fixed this week." /><br />
      <button type="submit" disabled={pending || !message.trim()}>{pending ? 'Running…' : live ? 'Send (Live AI Test)' : 'Send (Demo)'}</button>
    </form>
    <p>Try: a message with your business, enquiries a week, the problem and timing; then “the first one”. Mention price or a refund to see a hand-off to a person.</p>
    {error && <p role="alert">{error}</p>}

    <h2>Lead (CRM, in memory)</h2>
    <p data-testid="lead">{contact ? <>Contact id <code>{contact.id}</code>, lead status <strong>{contact.state}</strong>{contact.optedOut ? ', opted out' : ''}, name {contact.name ?? 'unknown'}, phone {contact.phone}</> : 'No contact yet.'}</p>

    <h2>Held for owner approval</h2>
    {held.length === 0 ? <p>Nothing in the queue.</p> : <table data-testid="pending">
      <thead><tr><th>Summary</th><th>Status</th><th>Note</th><th>Owner</th></tr></thead>
      <tbody>{held.map(a => <tr key={a.id}>
        <td>{a.summary}</td><td>{a.status}</td><td>{a.note ?? ''}</td>
        <td>{a.status === 'pending' ? <>
          <button type="button" disabled={pending} onClick={() => run(() => decideAction(state, a.id, 'approve'))}>Approve</button>{' '}
          <button type="button" disabled={pending} onClick={() => run(() => decideAction(state, a.id, 'reject'))}>Reject</button>
        </> : 'decided'}</td>
      </tr>)}</tbody>
    </table>}
    {state.decisions.length > 0 && <ul>{state.decisions.map((d, i) => <li key={i}>{d.decision}: <strong>{d.outcome}</strong>{d.note ? ` (${d.note})` : ''}. Writes: {d.writes.map(w => `${w.rpc}: ${w.detail}`).join('; ') || 'none'}</li>)}</ul>}

    <h2>Turns</h2>
    {state.turns.length === 0 && <p>No messages yet.</p>}
    {[...state.turns].reverse().map(t => { const usageLine = turnUsageLine(t); return <section key={t.n} data-testid="turn">
      <h3><strong data-testid="turn-badge">{turnBadge(t)}</strong> Turn {t.n} ({turnBadge(t) === 'LIVE' ? 'real' : 'scripted'} model)</h3>
      {usageLine && <p data-testid="turn-usage">{usageLine}</p>}
      <p><strong>Customer:</strong> {t.customer}</p>
      <p><strong>AI reply:</strong> {t.reply ?? '(no reply)'}</p>
      {t.error && <p role="alert">Turn failed: {t.error}</p>}
      <ul>
        <li>Route: {t.route || 'none'}</li>
        <li>Qualification: lead status <strong>{t.state ?? 'unknown'}</strong>; still needed: {t.missing.join(', ') || 'nothing'}</li>
        <li>Detected: business {t.detected.business ?? 'not yet'}; needs {t.detected.needs ?? 'not yet'}; timing {t.detected.timing ?? 'not yet'}; budget {t.detected.budget}</li>
        <li>Objection handling: {t.objection}</li>
        <li>Recommended offer: {t.offer}</li>
        <li>Handed to: {t.handedTo ?? 'nobody'}</li>
        <li>Booking proposal: {t.booking ? <><strong>{t.booking.decision}</strong> ({t.booking.mode}) for {t.booking.label}. {t.booking.reason}{t.booking.booked !== null ? ` Booked by the pipeline: ${t.booking.booked ? 'yes' : 'no'}.` : ''}{t.booking.pendingId ? ' Held in the queue above.' : ''}</> : 'none'}</li>
      </ul>
      <details><summary>Tool calls ({t.tools.length})</summary><pre>{json(t.tools)}</pre></details>
      <details><summary>CRM writes ({t.writes.length})</summary><ol>{t.writes.map((w, i) => <li key={i}>{w.rpc}: {w.detail}</li>)}</ol></details>
    </section>; })}

    <h2>Raw in-memory tables</h2>
    <details><summary>Tables, calendar and would-have-sent</summary><pre>{json({ tables: state.tables, calendar: state.calendar, wouldSend: state.wouldSend })}</pre></details>
  </main>;
}
