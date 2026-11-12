'use client';
import { useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { deleteCallScenario, endLiveCall, getLiveUsage, loadCallScenario, resetLiveLab, saveCallScenario, sendLiveTurn, startLiveCall } from './actions';
import type { LiveCallResult } from './live';
import type { LabPersistence, LabScenarioInfo } from '../../../lib/front-office/contracts';
import type { ReceptionistLabState } from '../../../lib/front-office/receptionist/lab-live';
import type { LabUsageToday } from '../../../lib/front-office/lab-usage';
import type { LiveAiState } from '../setter-lab/live-auth';
import { formatAud, turnBadge, turnUsageLine, usageTodayLine } from '../setter-lab/format';
import { LANG, liveBadge, newRecognition, pickVoice, recognitionCtor, speechSupport, transcriptOf } from './voice';
import type { Recognition } from './voice';

// Receptionist Lab "Live AI Test" (task A-41). Plain functional markup on purpose (no design system): a test page.
// The owner speaks (en-AU speech-to-text) or types; each line goes to the server action, which runs the A-26 engine.
type SignIn = 'unchecked' | 'verified' | 'refused';
const SIGN_IN_LABEL: Record<SignIn, string> = { unchecked: 'NOT CHECKED YET (checked on your first turn)', verified: 'VERIFIED', refused: 'NOT SIGNED IN (Live AI Test refused)' };
const LIVE_AI_LABEL: Record<LiveAiState, string> = { unknown: 'CONFIGURED (server check)', configured: 'CONFIGURED', not_configured: 'NOT CONFIGURED (no model key or model name on this server)' };
const json = (v: unknown) => JSON.stringify(v, null, 2);
const never = () => () => {};

export default function LiveCall({ modelConfigured, initial, initialError, initialUsage, initialPersistence = { mode: 'memory', reason: 'Lab sandbox status not loaded yet; memory only.' }, initialScenarios = [] }: { modelConfigured: boolean; initial: ReceptionistLabState | null; initialError: string | null; initialUsage: LabUsageToday; initialPersistence?: LabPersistence; initialScenarios?: LabScenarioInfo[] }) {
  const [persistence, setPersistence] = useState<LabPersistence>(initialPersistence);
  const [scenarios, setScenarios] = useState<LabScenarioInfo[]>(initialScenarios);
  const [scenarioName, setScenarioName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const db = persistence.mode === 'database';
  const canListen = useSyncExternalStore(never, () => speechSupport().listen, () => false);
  const canSpeak = useSyncExternalStore(never, () => speechSupport().speak, () => false);
  const [state, setState] = useState<ReceptionistLabState | null>(initial);
  const [liveAi, setLiveAi] = useState<LiveAiState>(modelConfigured ? 'unknown' : 'not_configured');
  const [signIn, setSignIn] = useState<SignIn>('unchecked');
  const [usage, setUsage] = useState<LabUsageToday>(initialUsage);
  const [error, setError] = useState<string | null>(initialError);
  const [says, setSays] = useState('');
  const [hearing, setHearing] = useState('');
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState<string | null>(null);
  const [speakOn, setSpeakOn] = useState(true);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [pending, start] = useTransition();
  const rec = useRef<Recognition | null>(null);

  const badge = liveBadge(modelConfigured, liveAi);
  const ended = !!state?.ended;
  const closed = ended || !!state?.turns.at(-1)?.action;
  const canTalk = modelConfigured && liveAi !== 'not_configured' && !!state && !closed && !pending;

  const apply = (r: LiveCallResult) => {
    setError(r.error); setNotice(r.notice ?? null);
    if (r.persistence) setPersistence(r.persistence);
    if (r.scenarios) setScenarios(r.scenarios);
    if (r.state) setState(r.state);
    if (r.liveAi && r.liveAi !== 'unknown') setLiveAi(r.liveAi);
    if (r.signIn) setSignIn(r.signIn);
  };
  const refreshUsage = async () => { try { setUsage(await getLiveUsage()); } catch { /* keep the last known figures */ } };
  const speak = (text: string) => {
    if (!speakOn || !canSpeak || !text) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG;
    const v = pickVoice(synth.getVoices());
    if (v) u.voice = v;
    synth.speak(u);
  };
  /** Close the call for its summary. Any failure (error reply or no server) is recorded so the page shows an error line
   * with a retry hint instead of a stuck "Getting the summary…". */
  const summarise = async (s: ReceptionistLabState) => {
    setSummaryFailed(false);
    try {
      const e = await endLiveCall(s);
      if (e.state) setState(e.state);
      if (e.error) setError(e.error);
      if (!e.state?.ended) setSummaryFailed(true);
    } catch { setError('The lab could not reach the server.'); setSummaryFailed(true); }
  };
  const stopListening = () => { rec.current?.abort(); rec.current = null; setListening(false); setHearing(''); };

  const send = (text: string) => {
    const line = text.trim();
    if (!line || !state) return;
    setSays('');
    start(async () => {
      try {
        const r = await sendLiveTurn(state, line);
        apply(r);
        const last = r.state?.turns.at(-1);
        if (last?.said) speak(last.said);
        // A transfer or hang-up by the Receptionist ends the call, as on the phone: close it for the summary.
        if (r.state && last?.action) await summarise(r.state);
      } catch { setError('The lab could not reach the server.'); }
      await refreshUsage();
    });
  };

  const listen = () => {
    const ctor = recognitionCtor();
    if (!ctor) { setMicNote('Speech-to-text is not available in this browser. Type instead.'); return; }
    if (canSpeak) window.speechSynthesis.cancel();
    setMicNote(null);
    const r = newRecognition(ctor);
    r.onresult = e => {
      const t = transcriptOf(e);
      setHearing(t.final || t.interim);
      if (t.final) { setHearing(''); send(t.final); }
    };
    r.onerror = e => setMicNote(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone permission was refused. Type instead.' : e.error === 'no-speech' ? 'Nothing was heard. Try again or type instead.' : `Speech-to-text stopped (${e.error}). Type instead.`);
    r.onend = () => { rec.current = null; setListening(false); };
    rec.current = r;
    setListening(true);
    try { r.start(); } catch { rec.current = null; setListening(false); setMicNote('Speech-to-text could not start. Type instead.'); }
  };

  const newCall = () => { stopListening(); if (canSpeak) window.speechSynthesis.cancel(); setSays(''); setSummaryFailed(false); start(async () => { try { apply(await startLiveCall()); } catch { setError('The lab could not reach the server.'); } }); };
  const hangUp = () => { if (!state) return; stopListening(); setError(null); start(() => summarise(state)); };
  const summary = state?.ended?.summary ?? null;

  return <section data-testid="live-ai-test">
    <h2>Live AI Test (voice)</h2>
    <p><strong data-testid="live-mode">{badge === 'LIVE' ? 'LIVE AI TEST' : 'DEMO'}</strong> Talk to the real AI Receptionist (the same pipeline the phone uses) with the real AI model. The store, calendar and SMS/email are in memory: no call is placed, nothing is booked in a real calendar and nothing is sent. Each turn is paid (estimated cost shown) and needs you to be signed in. {badge === 'LIVE' ? '' : 'Live AI Test is off: the AI model is not configured on this server.'}</p>

    <h3>Connection state</h3>
    <ul data-testid="live-connections">
      <li data-testid="live-ai-state">AI model: <strong>{LIVE_AI_LABEL[liveAi]}</strong></li>
      <li data-testid="live-sign-in">Sign-in: <strong>{SIGN_IN_LABEL[signIn]}</strong></li>
      <li data-testid="live-stt">Speech-to-text ({LANG}): <strong>{canListen ? (listening ? 'LISTENING' : 'AVAILABLE') : 'NOT AVAILABLE (type instead)'}</strong></li>
      <li data-testid="live-tts">Spoken replies ({LANG}): <strong>{canSpeak ? (speakOn ? 'ON' : 'OFF') : 'NOT AVAILABLE (read the transcript)'}</strong></li>
      <li data-testid="live-persistence">Persistence: <strong>{db ? 'SANDBOX DATABASE' : 'MEMORY ONLY'}</strong>{persistence.mode === 'database' ? ` (your lab sandbox workspace ${persistence.workspaceId}; the caller, messages and bookings are real rows in it)` : ` (${persistence.reason})`}</li>
      <li>Store: <strong>{db ? 'LAB SANDBOX (real fo_* functions)' : 'IN-MEMORY'}</strong>; calendar, SMS and email: <strong>IN-MEMORY, nothing sent</strong></li>
      <li>Business: <strong>DEMO BUSINESS SETTINGS (chosen on the server)</strong></li>
    </ul>

    <h3>Live AI usage today (estimate, shared with the Setter Lab)</h3>
    <p data-testid="live-usage-today">{usageTodayLine(usage)}</p>
    <p>{usage.persistent ? '' : 'NOT PERSISTENT. '}{usage.note}</p>
    <button type="button" disabled={pending} onClick={() => start(refreshUsage)}>Refresh usage</button>

    <fieldset data-testid="live-scenarios">
      <legend>Reset and saved scenarios</legend>
      <button type="button" disabled={pending} onClick={() => { stopListening(); setSummaryFailed(false); start(async () => { try { apply(await resetLiveLab()); } catch { setError('The lab could not reach the server.'); } }); }}>Reset sandbox and start a new call</button>
      {!db && <p>Saving needs the lab sandbox. {persistence.mode === 'memory' ? persistence.reason : ''}</p>}
      <p><label htmlFor="live-scenario-name">Scenario name</label>{' '}
        <input id="live-scenario-name" maxLength={80} value={scenarioName} onChange={e => setScenarioName(e.target.value)} />{' '}
        <button type="button" disabled={pending || !db || !state || !scenarioName.trim()} onClick={() => { if (state) start(async () => { try { apply(await saveCallScenario(state, scenarioName)); } catch { setError('The lab could not reach the server.'); } }); }}>Save scenario</button></p>
      {scenarios.length === 0 ? <p>No saved scenarios.</p> : <ul>{scenarios.map(sc => <li key={sc.id}>
        {sc.name} (revision {sc.revision}, {sc.contacts} contact{sc.contacts === 1 ? '' : 's'}, {sc.appointments} booking{sc.appointments === 1 ? '' : 's'}){' '}
        <button type="button" disabled={pending || !db} onClick={() => start(async () => { try { apply(await loadCallScenario(sc.name)); } catch { setError('The lab could not reach the server.'); } })}>Load</button>{' '}
        <button type="button" disabled={pending || !db} onClick={() => start(async () => { try { apply(await deleteCallScenario(sc.name)); } catch { setError('The lab could not reach the server.'); } })}>Delete</button>
      </li>)}</ul>}
    </fieldset>
    {notice && <p role="status" data-testid="live-notice">{notice}</p>}

    <h3>Call</h3>
    <p>
      <button type="button" disabled={pending} onClick={newCall}>New call</button>{' '}
      <button type="button" disabled={pending || !state || ended} onClick={hangUp}>End call and show summary</button>{' '}
      {canSpeak && <label><input type="checkbox" checked={speakOn} onChange={e => { setSpeakOn(e.target.checked); if (!e.target.checked) window.speechSynthesis.cancel(); }} /> Speak replies</label>}
    </p>
    {canListen
      ? <p><button type="button" disabled={!canTalk && !listening} onClick={listening ? stopListening : listen}>{listening ? 'Stop listening' : 'Speak (microphone)'}</button>{hearing && <> Hearing: <em data-testid="live-hearing">{hearing}</em></>}</p>
      : <p data-testid="live-keyboard-only">Speech-to-text is not available in this browser. Type what the caller says below.</p>}
    {micNote && <p role="status">{micNote}</p>}
    <form onSubmit={e => { e.preventDefault(); send(says); }}>
      <label htmlFor="live-says">Caller says</label><br />
      <input id="live-says" type="text" size={80} maxLength={600} value={says} onChange={e => setSays(e.target.value)} disabled={!canTalk} placeholder="Hi, what are your opening hours on Saturday?" />{' '}
      <button type="submit" disabled={!canTalk || !says.trim()}>{pending ? 'Running…' : 'Send (Live AI Test)'}</button>
    </form>
    {closed && !ended && (summaryFailed && !pending
      ? <p role="alert" data-testid="live-summary-failed">The receptionist ended this call, but the summary could not be loaded. Press End call and show summary to try again, or start a new call.</p>
      : <p>The receptionist ended this call. Getting the summary…</p>)}
    {error && <p role="alert" data-testid="live-error">{error}</p>}

    <h3>Live transcript</h3>
    {state ? <ol data-testid="live-transcript">{state.conversation.map((c, i) => <li key={i}><strong>{c.role === 'assistant' ? 'Receptionist' : 'Caller'}:</strong> {c.content}</li>)}</ol> : <p>No call yet. Press New call.</p>}

    <h3>Turns</h3>
    {state && [...state.turns].reverse().map(t => {
      const view = { model: t.model ?? 'scripted' as const, usage: t.usage };
      const line = turnUsageLine(view);
      return <div key={t.n} data-testid="live-turn">
        <h4><strong data-testid="live-turn-badge">{t.route === 'greeting' ? 'GREETING' : turnBadge(view)}</strong> Turn {t.n} ({t.route}{t.prompt ? `, ${t.prompt}` : ''})</h4>
        <p data-testid="live-turn-latency">Latency {Math.round(t.latencyMs)} ms{t.usage ? `; estimated cost ${formatAud(t.usage.costAud)}` : t.route === 'greeting' ? '; fixed greeting, no model, no cost' : ''}</p>
        {line && <p data-testid="live-turn-usage">{line}</p>}
        {t.caller && <p><strong>Caller:</strong> {t.caller}</p>}
        <p><strong>Receptionist:</strong> {t.said || '(nothing said)'}</p>
        {t.action && <p>Action: <strong>{t.action === 'transfer' ? `transfer to ${t.transferTo ?? 'the team'}` : 'end the call'}</strong></p>}
        {t.outcomes.length > 0 && <p>Outcomes: {t.outcomes.join(', ')}</p>}
        {t.error && <p role="alert">Turn failed: {t.error}</p>}
        {t.tools.length > 0 && <table data-testid="live-tools">
          <thead><tr><th>Tool</th><th>Arguments</th><th>Result</th><th>Mode decision</th></tr></thead>
          <tbody>{t.tools.map((c, i) => <tr key={i}>
            <td>{c.name}</td><td><pre>{json(c.input)}</pre></td><td><pre>{c.isError ? 'ERROR: ' : ''}{c.result}</pre></td>
            <td>{c.mode ? `${c.mode.action}: ${c.mode.mode} (not enforced)` : 'not an action'}</td>
          </tr>)}</tbody>
        </table>}
      </div>;
    })}

    {summary && <>
      <h3>End-of-call summary</h3>
      <div data-testid="live-summary">
        <p>{summary.outcome.text}</p>
        <ul>
          <li>Caller: {summary.caller.name ?? 'unknown'}{summary.caller.phone ? ` (${summary.caller.phone})` : ''}{summary.caller.email ? `, ${summary.caller.email}` : ''}; stage {summary.caller.stage ?? 'unknown'}</li>
          <li>Reason: {summary.reason}</li>
          <li>Outcomes: {summary.outcome.outcomes.join(', ') || 'none'}; ended by {summary.outcome.endedBy}{summary.outcome.transferTo ? ` to ${summary.outcome.transferTo}` : ''}</li>
          <li>Booking: {summary.outcome.booking ? `${summary.outcome.booking.status} for ${summary.outcome.booking.starts}` : 'none'}</li>
          <li>Actions: {summary.actions.length ? summary.actions.map(a => `${a.tool}${a.isError ? ' (error)' : ''}`).join(', ') : 'none'}</li>
          <li>Would have been sent (not sent): {summary.wouldSend.length ? summary.wouldSend.map(w => `${w.channel} to ${w.to}: ${w.body}`).join(' | ') : 'nothing'}</li>
          <li>Live usage (estimate): {summary.usage.liveTurns} live turn{summary.usage.liveTurns === 1 ? '' : 's'}, {summary.usage.calls} model calls, tokens in {summary.usage.inputTokens} / out {summary.usage.outputTokens}, {Math.round(summary.usage.latencyMs)} ms, {formatAud(summary.usage.costAud)}</li>
          {summary.errors.length > 0 && <li>Errors: {summary.errors.join('; ')}</li>}
        </ul>
      </div>
    </>}

    {state && <details><summary>Raw in-memory call (tables, calendar, would-have-sent)</summary><pre>{json({ tables: state.tables, calendar: state.calendar, calendarLog: state.calendarLog, wouldSend: state.wouldSend })}</pre></details>}
  </section>;
}
