'use client';
// Notifications: the existing in-app centre (computed from saved browser data; nothing is emailed or pushed) on a glass card.
import { EmptyState, GlassButton, GlassCard, PageHeading } from '../design-system/liquid-glass';
import NotificationsCentre from './notifications-centre';
import { useWorkspace } from './ventra-context';
import { useLiquidTheme } from './liquid-shell';

export default function LiquidNotifications() {
  const { profile, ready } = useWorkspace();
  const theme = useLiquidTheme();
  return <>
    <PageHeading title="Notifications" description="New leads, due follow-ups and reminders, worked out from what you have saved. Nothing is emailed or pushed." back={{ href: '/', label: 'Home' }} />
    {!ready ? <GlassCard><p className="vg-text" role="status">Restoring your workspace…</p></GlassCard>
      : profile ? <GlassCard aria-label="Notification list"><div className="ventra-app vg-legacy" data-theme={theme}><NotificationsCentre profile={profile} /></div></GlassCard>
      : <EmptyState icon="bell" tone="teal" title="Set up your business first" action={<GlassButton variant="primary" href="/onboarding">Set up your business</GlassButton>}>Notifications are worked out from your saved contacts, content and invoices. Save your business details to begin.</EmptyState>}
  </>;
}
