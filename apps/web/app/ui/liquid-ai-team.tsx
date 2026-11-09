'use client';
// AI Team: exactly two AgentCards (VENTRA_UI_RULEBOOK 5C). Status is read from the saved agent settings
// (GET /api/front-office/settings, workspace owners) and never invented: signed out or unsaved = "Needs setup";
// the Receptionist stays "Coming soon" because live calling is not verified yet (HANDOFF.md).
import { useEffect, useState } from 'react';
import { Badge, GlassButton, GlassCard, IconTile, ListRow, PageHeading, Toggle } from '../design-system/liquid-glass';
import type { IconName, Tone } from '../design-system/liquid-glass';
import { fetchWorkspaces } from './workspace-list';

type Snapshot =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'not-saved' }
  | { kind: 'saved'; setterOn: boolean; receptionistOn: boolean; voiceOn: boolean };

function useAgentStatus(): Snapshot {
  const [snap, setSnap] = useState<Snapshot>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetchWorkspaces();
        const b = await r.json().catch(() => null) as { workspaces?: { id: string }[] } | null;
        if (r.status === 401 || !r.ok || !b?.workspaces?.length) { if (live) setSnap(r.status === 401 || r.ok ? { kind: 'signed-out' } : { kind: 'unavailable', message: 'Account storage is not available right now.' }); return; }
        const s = await fetch('/api/front-office/settings?workspace=' + encodeURIComponent(b.workspaces[0].id), { credentials: 'same-origin', cache: 'no-store' });
        const j = await s.json().catch(() => ({})) as { saved?: boolean; settings?: { setterOn?: boolean; receptionistOn?: boolean; voiceOn?: boolean }; error?: string };
        if (!live) return;
        if (s.status === 401) setSnap({ kind: 'signed-out' });
        else if (!s.ok || !j.settings) setSnap({ kind: 'unavailable', message: j.error ?? 'Settings could not be checked.' });
        else if (!j.saved) setSnap({ kind: 'not-saved' });
        else setSnap({ kind: 'saved', setterOn: !!j.settings.setterOn, receptionistOn: !!j.settings.receptionistOn, voiceOn: !!j.settings.voiceOn });
      } catch { if (live) setSnap({ kind: 'unavailable', message: 'Account storage is not available right now.' }); }
    })();
    return () => { live = false; };
  }, []);
  return snap;
}

type AgentState = { word: string; dot: 'off' | 'on' | 'warn'; note: string; tone: 'violet' | 'success' | 'warning' | 'neutral' };

function AgentCard({ icon, tone, name, text, state, toggle, action }: { icon: IconName; tone: Tone; name: string; text: string; state: AgentState; toggle: { on: boolean; disabled: boolean; label: string }; action: { label: string; href: string } }) {
  const noteId = `${name.replace(/\W+/g, '-').toLowerCase()}-note`;
  return <GlassCard className="vg-agent" aria-label={name}>
    <div className="vg-agent-head"><IconTile icon={icon} tone={tone} /><div className="vg-agent-copy"><h2>{name}</h2><p>{text}</p></div></div>
    <div className="vg-agent-status vg-bead">
      <span className="vg-status-word"><span className={`vg-status-dot${state.dot === 'on' ? ' is-on' : state.dot === 'warn' ? ' is-warn' : ''}`} aria-hidden="true" />{state.word}</span>
      <Toggle ariaLabel={toggle.label} checked={toggle.on} disabled describedBy={noteId} />
    </div>
    <p className="vg-agent-note" id={noteId}>{state.note}</p>
    <div className="vg-actions"><GlassButton href={action.href} iconRight="arrow">{action.label}</GlassButton></div>
  </GlassCard>;
}

export default function LiquidAiTeam() {
  const snap = useAgentStatus();
  const setter: AgentState =
    snap.kind === 'loading' ? { word: 'Checking…', dot: 'off', note: 'Reading your saved settings.', tone: 'neutral' }
    : snap.kind === 'signed-out' ? { word: 'Needs setup', dot: 'off', note: 'Sign in to see whether your Setter is switched on. Nothing is sent without your settings.', tone: 'warning' }
    : snap.kind === 'unavailable' ? { word: 'Not checked', dot: 'warn', note: snap.message, tone: 'warning' }
    : snap.kind === 'not-saved' ? { word: 'Needs setup', dot: 'off', note: 'Your AI team settings have not been saved yet. Start from the gym template, then save.', tone: 'warning' }
    : snap.setterOn ? { word: 'Switched on in settings', dot: 'on', note: 'Replies on connected channels only. Channel connections are checked in Settings > Connections.', tone: 'success' }
    : { word: 'Switched off', dot: 'off', note: 'Saved, but the Setter is off. Turn it on in the AI team settings.', tone: 'neutral' };
  const receptionistSaved = snap.kind === 'saved' && snap.receptionistOn;
  const receptionist: AgentState = { word: 'Coming soon', dot: 'off', note: receptionistSaved ? 'Switched on in settings, but live call answering has not been verified yet, so no calls are answered.' : 'Answers calls, handles enquiries and books jobs once live calling is verified. No calls are answered yet.', tone: 'violet' };
  return <>
    <PageHeading title="AI Team" description="Manage your AI agents." />
    <div className="vg-two">
      <AgentCard icon="chat" tone="teal" name="AI Setter" text="Finds leads, starts conversations and books appointments." state={setter} toggle={{ on: snap.kind === 'saved' && snap.setterOn, disabled: true, label: 'AI Setter switched on (change this in settings)' }} action={{ label: snap.kind === 'saved' ? 'Manage' : 'Set up', href: '/ai-team/settings' }} />
      <AgentCard icon="headset" tone="magenta" name="AI Receptionist" text="Answers calls, handles enquiries, provides quotes and books jobs." state={receptionist} toggle={{ on: false, disabled: true, label: 'AI Receptionist, coming soon' }} action={{ label: 'Prepare settings', href: '/ai-team/settings' }} />
    </div>
    <GlassCard tight aria-label="Status and connections">
      <div className="vg-card-head"><h2 className="vg-card-title">Status</h2><Badge tone={setter.tone === 'success' ? 'success' : setter.tone === 'warning' ? 'warning' : 'neutral'} icon={setter.tone === 'success' ? 'check' : 'alert'}>{snap.kind === 'saved' ? 'Settings saved' : snap.kind === 'loading' ? 'Checking' : 'Not set up'}</Badge></div>
      <div className="vg-rows">
        <ListRow href="/settings?section=integrations" icon="plug" tone="indigo" title="Connections" caption="Channels, phone and calendar: what is connected and what is not" />
        <ListRow href="/ai-team/settings" icon="settings" tone="violet" title="AI team settings" caption="Business facts, hours, questions and who to transfer to" />
      </div>
    </GlassCard>
  </>;
}
