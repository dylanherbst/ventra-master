'use client';
// Bookings (VENTRA_UI_RULEBOOK 5D) in the Liquid Glass look. No calendar is connected to the app yet, so the list is an
// honest empty state with "Connect calendar"; the week strip is real (device-local dates) and the existing
// availability draft and reminder preferences are reachable as utility rows.
import { useEffect, useState } from 'react';
import { EmptyState, GlassButton, GlassCard, IconButton, ListRow, PageHeading } from '../design-system/liquid-glass';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function addDays(d: Date, n: number) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date) { const day = d.getDay(); return addDays(d, day === 0 ? -6 : 1 - day); }
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function LiquidBookings() {
  // Dates are device-local; render after mount so the server and the browser never disagree.
  const [today, setToday] = useState<Date | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => { setToday(new Date()); }, []);
  const anchor = today ? addDays(today, offset * 7) : null;
  const week = anchor ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)) : [];
  const label = anchor ? (offset === 0 ? 'This week' : anchor.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })) : '';
  return <>
    <PageHeading title="Bookings" description="Your appointments and jobs." />
    <GlassCard aria-label="Week">
      <div className="vg-bookings-head">
        <IconButton icon="chevron-left" size="sm" label="Previous week" onClick={() => setOffset(o => o - 1)} />
        <GlassButton size="sm" onClick={() => setOffset(0)} aria-label="Back to this week">{label || 'This week'}</GlassButton>
        <IconButton icon="chevron-right" size="sm" label="Next week" onClick={() => setOffset(o => o + 1)} />
      </div>
      <div className="vg-daystrip" role="list" aria-label="Days this week">
        {week.length ? week.map((d, i) => <span key={isoDate(d)} role="listitem" className="vg-day" aria-current={today && isoDate(d) === isoDate(today) ? 'date' : undefined}>{DAY[i]}<b>{d.getDate()}</b></span>) : DAY.map(d => <span key={d} className="vg-day">{d}<b>·</b></span>)}
      </div>
    </GlassCard>
    <EmptyState icon="calendar" tone="violet" title="No calendar connected" action={<><GlassButton variant="primary" href="/settings?section=integrations" icon="plug">Connect calendar</GlassButton><GlassButton href="/sales?tab=appointments">Availability draft</GlassButton></>}>
      Bookings appear here once a calendar is connected to your workspace. Until then nothing is booked, moved or cancelled from this screen.
    </EmptyState>
    <GlassCard tight aria-label="Booking tools">
      <div className="vg-rows">
        <ListRow href="/settings?section=integrations" icon="plug" tone="indigo" title="Connect calendar" caption="Google Calendar is supported by the AI team; not connected in this workspace" />
        <ListRow href="/sales?tab=appointments" icon="clock" tone="violet" title="Availability" caption="Your booking page draft: hours and appointment types" />
        <ListRow href="/settings?section=notifications" icon="bell" tone="teal" title="Reminders" caption="Notification preferences for bookings and follow-ups" />
      </div>
    </GlassCard>
  </>;
}
