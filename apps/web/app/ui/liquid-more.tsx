'use client';
// More (VENTRA_UI_RULEBOOK 5E, adapted for this repo): the four other VENTRA products as equal glass tiles, then compact
// rows for settings, connections and help. Every link lands on an existing page; captions say what each one really does.
import { Badge, GlassCard, ListRow, PageHeading, ProductTile } from '../design-system/liquid-glass';

export default function LiquidMore() {
  return <>
    <PageHeading title="More" description="The rest of VENTRA, your settings and help." />
    <div className="vg-tiles" aria-label="Products">
      <ProductTile href="/business?tab=delivery" icon="book" tone="violet" title="Course and Mentor Builder" caption="Courses, lessons, quizzes and coaching plans" badge={<Badge tone="neutral">Browser drafts</Badge>} />
      <ProductTile href="/create/start" icon="rocket" tone="magenta" title="Business Creator" caption="Idea, validation, pricing, brand and launch checklist" badge={<Badge tone="neutral">Browser drafts</Badge>} />
      <ProductTile href="/grow" icon="trend" tone="teal" title="Business Booster" caption="Marketing, content, leads and automation plans" badge={<Badge tone="neutral">Browser drafts</Badge>} />
      <ProductTile href="/business?tab=website" icon="globe" tone="indigo" title="Website Builder" caption="Pages, storefront and link in bio" badge={<Badge tone="neutral">Not published</Badge>} />
    </div>
    <GlassCard tight aria-label="Settings and support">
      <div className="vg-rows">
        <ListRow href="/settings" icon="settings" tone="violet" title="Settings" caption="Business profile, billing, team and notifications" />
        <ListRow href="/settings?section=integrations" icon="plug" tone="indigo" title="Connections" caption="What is connected, checked by the server" />
        <ListRow href="/workspace" icon="user" tone="teal" title="Account and sign in" caption="Sign in, your workspaces and saved data" />
        <ListRow href="/insights" icon="chart" tone="indigo" title="Insights and reports" caption="Worked out from what you have saved" />
        <ListRow href="/services" icon="grid" tone="violet" title="All tools" caption="Every service and tool in one list" />
        <ListRow href="/settings?section=help" icon="help" tone="teal" title="Help and support" caption="Plain answers and how to reach us" />
      </div>
    </GlassCard>
  </>;
}
