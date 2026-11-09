'use client';
// Home in the approved Liquid Glass look (docs/design/reference/home-approved.png): exactly four modules
// (VENTRA_UI_RULEBOOK 5A). Numbers are real or shown as "—" with a caption; the analytics card is labelled sample data.
import { useEffect, useState } from 'react';
import { AnalyticsCard, Badge, SelectPill, StatCard } from '../design-system/liquid-glass';
import { contactStorageKey, restoreContacts } from '../../lib/local-crm-contacts';
import { useWorkspace } from './ventra-context';

type Range = 'today' | 'tomorrow' | 'week';
const RANGE_LABELS: Record<Range, string> = { today: 'Today', tomorrow: 'Tomorrow', week: 'This week' };
const RANGE_OPTIONS = (Object.keys(RANGE_LABELS) as Range[]).map(value => ({ value, label: RANGE_LABELS[value] }));
const rangeKey = 'ventra.home.bookings-range';

// Illustrative only. Labelled "Sample data" on screen; never presented as this business's figures.
const SAMPLE_POINTS = [3, 5, 4, 7, 6, 9, 8, 11];
const SAMPLE_METRICS = [{ value: '42', label: 'Total bookings' }, { value: '78%', label: 'Show-up rate' }, { value: '$18,240', label: 'Estimated value' }];

function useSavedContactCount(profileId: string | undefined): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!profileId) { setCount(null); return; }
    const read = () => { try { setCount(restoreContacts(localStorage.getItem(contactStorageKey(profileId)), profileId).length); } catch { setCount(null); } };
    read();
    window.addEventListener('storage', read); window.addEventListener('ventra:updated', read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener('ventra:updated', read); };
  }, [profileId]);
  return count;
}

export default function LiquidHome() {
  const { profile } = useWorkspace();
  const [range, setRange] = useState<Range>('today');
  useEffect(() => { try { const v = sessionStorage.getItem(rangeKey); if (v === 'today' || v === 'tomorrow' || v === 'week') setRange(v); } catch { /* keep default */ } }, []);
  function pickRange(v: Range) { setRange(v); try { sessionStorage.setItem(rangeKey, v); } catch { /* this visit only */ } }
  const contacts = useSavedContactCount(profile?.id);
  const dash = <span className="vg-stat-value is-empty" aria-label="No data">—</span>;
  return <div className="vg-home">
    <h1 className="vg-sr-only">Home</h1>
    <StatCard icon="calendar" tone="violet" label="Bookings" value={dash} href="/bookings" caption={`${RANGE_LABELS[range]}: no calendar connected`}
      control={<SelectPill label="Bookings period" options={RANGE_OPTIONS} value={range} onChange={e => pickRange(e.target.value as Range)} />}
      menu={[...RANGE_OPTIONS.map(o => ({ id: o.value, label: o.label, selected: o.value === range, onSelect: () => pickRange(o.value) })), { id: 'open', label: 'Open bookings', icon: 'calendar', href: '/bookings' }]} />
    <StatCard icon="chat" tone="teal" label="Current conversations" value={dash} href="/customers" caption={contacts === null ? 'No messaging channel connected' : `No channel connected · ${contacts} ${contacts === 1 ? 'contact' : 'contacts'} saved in Leads`}
      menu={[{ id: 'leads', label: 'Open leads', icon: 'leads', href: '/customers' }, { id: 'inbox', label: 'Inbox', icon: 'message', href: '/inbox' }, { id: 'connect', label: 'Connect a channel', icon: 'plug', href: '/settings?section=integrations' }]} />
    <StatCard icon="headset" tone="magenta" label="AI Receptionist tasks" value={dash} badge={<Badge tone="violet" icon="clock">Coming soon</Badge>} href="/ai-team" caption="No calls are answered yet"
      menu={[{ id: 'team', label: 'Open AI Team', icon: 'sparkle', href: '/ai-team' }]} />
    <AnalyticsCard title="Booking analytics" note="Sample data · connect a calendar for your real figures" points={SAMPLE_POINTS} metrics={SAMPLE_METRICS} />
  </div>;
}
