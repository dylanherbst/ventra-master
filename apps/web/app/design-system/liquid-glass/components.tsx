'use client';
// VENTRA Liquid Glass components, ported to TSX from docs/design/ventra-ui/components.js. The `vg-*` class names are
// unchanged so glass.css applies as approved (docs/design/LIQUID_GLASS_SPEC.md, reference/kit-approved.png).
import Link from 'next/link';
import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { Icon } from './icons';
import type { IconName, Tone } from './icons';
import { GlassMenu } from './menu';
import type { MenuItem } from './menu';
import { NAV_ITEMS } from './nav';
import type { NavId, NavItem } from './nav';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
const internal = (href: string) => href.startsWith('/') && !href.startsWith('//');

/* ---------- Wordmark ---------- */
export function Wordmark({ href = '/', markOnly = false, className }: { href?: string | null; markOnly?: boolean; className?: string }) {
  const id = useId();
  const body = <>
    <svg viewBox="0 0 34 30" aria-hidden="true"><defs><linearGradient id={`vg-mark-${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" className="vg-mark-a" /><stop offset="1" className="vg-mark-b" /></linearGradient></defs><polygon points="0,0 9.5,0 17,18.6 24.5,0 34,0 21.1,30 12.9,30" fill={`url(#vg-mark-${id})`} /></svg>
    {!markOnly && <span>VENTRA</span>}
  </>;
  return href ? <Link className={cx('vg-wordmark', className)} href={href} aria-label="VENTRA home">{body}</Link> : <span className={cx('vg-wordmark', className)} aria-label="VENTRA">{body}</span>;
}

/* ---------- Buttons ---------- */
type ButtonVariant = 'primary' | 'secondary' | 'glass' | 'ghost';
export interface GlassButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; icon?: IconName; iconRight?: IconName; block?: boolean; href?: string; type?: 'button' | 'submit';
}
export function GlassButton({ variant = 'glass', size = 'md', icon, iconRight, block, href, className, children, type = 'button', ...rest }: GlassButtonProps) {
  const cls = cx('vg-btn', 'vg-btn-' + variant, variant === 'glass' && 'vg-bead', size !== 'md' && 'vg-btn-' + size, block && 'vg-btn-block', className);
  const body = <>{icon && <Icon name={icon} />}{children}{iconRight && <Icon name={iconRight} />}</>;
  if (href) return internal(href) ? <Link href={href} className={cls} aria-disabled={rest.disabled || undefined} onClick={rest.onClick as never}>{body}</Link> : <a href={href} className={cls}>{body}</a>;
  return <button type={type} className={cls} {...rest}>{body}</button>;
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon: IconName; label: string; dot?: boolean; variant?: 'glass' | 'violet'; size?: 'sm' | 'md'; strokeWidth?: number; href?: string;
}
export function IconButton({ icon, label, dot, variant = 'glass', size = 'md', strokeWidth, href, className, ...rest }: IconButtonProps) {
  const cls = cx('vg-iconbtn', variant === 'violet' ? 'vg-iconbtn-violet' : 'vg-bead', size === 'sm' && 'vg-iconbtn-sm', className);
  const body = <><Icon name={icon} strokeWidth={strokeWidth} />{dot && <span className="vg-dot" aria-hidden="true" />}</>;
  if (href) return <Link href={href} aria-label={label} className={cls}>{body}</Link>;
  return <button type="button" aria-label={label} className={cls} {...rest}>{body}</button>;
}

/* ---------- Cards ---------- */
export interface GlassCardProps { as?: 'section' | 'div' | 'article' | 'li'; tight?: boolean; promo?: boolean; cyan?: boolean; className?: string; children: ReactNode; style?: CSSProperties; 'aria-label'?: string; 'aria-labelledby'?: string; id?: string }
export function GlassCard({ as: Tag = 'section', tight, promo, cyan, className, children, ...rest }: GlassCardProps) {
  return <Tag className={cx('vg-card vg-glass', tight && 'vg-card-tight', promo && 'vg-promo', cyan && 'vg-cyan', className)} {...rest}>{children}</Tag>;
}

/** A floating card that is also a link: the whole card is the tap target (Home modules open their detail view). */
export function LinkCard({ href, className, children, label }: { href: string; className?: string; children: ReactNode; label: string }) {
  return <Link href={href} aria-label={label} className={cx('vg-card vg-glass vg-linkcard', className)}>{children}</Link>;
}

export function IconTile({ icon, tone = 'violet', size = 'md', className }: { icon: IconName; tone?: Tone; size?: 'sm' | 'md'; className?: string }) {
  return <span className={cx('vg-tile vg-bead', 'vg-tone-' + tone, size === 'sm' && 'vg-tile-sm', className)} aria-hidden="true"><Icon name={icon} strokeWidth={2.4} gradient={tone} /></span>;
}

export type BadgeTone = 'violet' | 'success' | 'warning' | 'danger' | 'neutral';
export function Badge({ tone = 'neutral', icon, trend, className, children }: { tone?: BadgeTone; icon?: IconName; trend?: 'up' | 'down'; className?: string; children: ReactNode }) {
  const name = icon ?? (trend === 'up' ? 'up' : trend === 'down' ? 'down' : undefined);
  return <span className={cx('vg-badge', 'vg-badge-' + tone, className)}>{name && <Icon name={name} strokeWidth={2.4} />}{children}</span>;
}

export function Chip({ icon, className, children, selected, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; selected?: boolean }) {
  return <button type="button" className={cx('vg-chip vg-bead', selected && 'is-selected', className)} aria-pressed={selected} {...rest}><span>{children}</span>{icon && <Icon name={icon} />}</button>;
}

/* ---------- StatCard ---------- */
export interface StatCardProps { icon: IconName; tone?: Tone; label: string; value: ReactNode; badge?: ReactNode; control?: ReactNode; menu?: MenuItem[]; href?: string; caption?: ReactNode; className?: string }
export function StatCard({ icon, tone = 'violet', label, value, badge, control, menu, href, caption, className }: StatCardProps) {
  const id = useId();
  // The whole card opens its detail view through an overlay link (no interactive content inside an <a>); the period
  // control and the menu sit above the overlay and keep working on their own.
  return <div className={cx('vg-stat-wrap', href && 'has-link', className)}>
    <section className="vg-card vg-glass vg-stat" aria-labelledby={id}>
      {href && <Link href={href} className="vg-stat-link" aria-label={`Open ${label}`} />}
      <IconTile icon={icon} tone={tone} />
      <div className="vg-stat-body">
        <div className="vg-stat-label" id={id}>{label}</div>
        <div className="vg-stat-row"><span className="vg-stat-value">{value}</span>{badge}{control && <span className="vg-stat-control">{control}</span>}</div>
        {caption && <div className="vg-stat-caption">{caption}</div>}
      </div>
    </section>
    {menu && <span className="vg-stat-menu"><GlassMenu label={`Options for ${label}`} items={menu} trigger={p => <IconButton icon="more" size="sm" strokeWidth={3.2} label={`More options for ${label}`} {...p} />} /></span>}
  </div>;
}

/* ---------- Analytics ---------- */
function smooth(xy: [number, number][]) {
  if (!xy.length) return '';
  let d = `M${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] ?? xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] ?? p2;
    const c = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]];
    d += ' C' + c.map(n => n.toFixed(1)).join(' ');
  }
  return d;
}
export interface AnalyticsMetric { value: string; label: string; delta?: string; trend?: 'up' | 'down' }
export interface AnalyticsCardProps { title: string; points: number[]; metrics: AnalyticsMetric[]; note?: string; className?: string; empty?: ReactNode }
export function AnalyticsCard({ title, points, metrics, note, className, empty }: AnalyticsCardProps) {
  const id = useId();
  const w = 640, ht = 170, pad = 12, top = 18;
  const max = Math.max(1, ...points), min = Math.min(0, ...points), span = (max - min) || 1;
  const xy: [number, number][] = points.map((v, i) => [pad + i * (w - pad * 2) / Math.max(points.length - 1, 1), ht - pad - (v - min) / span * (ht - pad - top)]);
  const line = smooth(xy);
  const area = xy.length ? `${line} L${xy[xy.length - 1][0].toFixed(1)} ${ht} L${xy[0][0].toFixed(1)} ${ht} Z` : '';
  return <GlassCard className={cx('vg-analytics', className)} aria-label={title}>
    <div className="vg-analytics-head"><IconTile icon="chart" tone="indigo" size="sm" /><div className="vg-analytics-title"><h2>{title}</h2>{note && <span className="vg-sample">{note}</span>}</div></div>
    {points.length ? <svg className="vg-chart" viewBox={`0 0 ${w} ${ht}`} role="img" aria-label={`${title} trend`}>
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="vg-area-a" /><stop offset="1" className="vg-area-b" /></linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" className="vg-line-a" /><stop offset="1" className="vg-line-b" /></linearGradient>
      </defs>
      <rect className="plot" x={pad} y={4} width={w - pad * 2} height={ht - 4} rx={14} />
      <path d={area} fill={`url(#${id}a)`} /><path className="line" d={line} stroke={`url(#${id}l)`} />
      {xy.map((q, i) => { const last = i === xy.length - 1; return (i === 0 || last || i % 2 === 1) ? <circle key={i} className={last ? 'end' : 'pt'} cx={q[0]} cy={q[1]} r={last ? 9 : 4.5} /> : null; })}
    </svg> : empty}
    {metrics.length > 0 && <div className="vg-metrics">{metrics.map((m, i) => <div key={i} className="vg-metric"><span className="vg-metric-value">{m.value}</span><span className="vg-metric-label">{m.label}</span>{m.delta && <Badge tone={m.trend === 'down' ? 'danger' : 'success'} trend={m.trend ?? 'up'}>{m.delta}</Badge>}</div>)}</div>}
  </GlassCard>;
}

/* ---------- Fields ---------- */
export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> { label?: string; action?: { icon: IconName; label: string; onClick?: () => void; href?: string }; className?: string }
export function SearchField({ label = 'Search', action, className, style, ...rest }: SearchFieldProps) {
  return <label className={cx('vg-field vg-bead', className)} style={style}>
    <Icon name="search" /><span className="vg-sr-only">{label}</span>
    <input type="search" {...rest} />
    {action && <IconButton icon={action.icon} label={action.label} variant="violet" size="sm" onClick={action.onClick} href={action.href} />}
  </label>;
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> { label?: string; hint?: string; state?: 'valid' | 'invalid'; icon?: IconName; wrapClassName?: string }
export function TextField({ label, hint, state, icon, id, wrapClassName, ...rest }: TextFieldProps) {
  const auto = useId();
  const fieldId = id ?? `vg-f-${auto}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return <div className={wrapClassName}>
    {label && <label className="vg-field-label" htmlFor={fieldId}>{label}</label>}
    <div className={cx('vg-field vg-bead', state === 'valid' && 'vg-field-valid', state === 'invalid' && 'vg-field-invalid')}>
      {icon && <Icon name={icon} />}
      <input id={fieldId} aria-invalid={state === 'invalid' || undefined} aria-describedby={hintId} {...rest} />
      {state === 'valid' && <span className="vg-field-state" aria-label="Looks good"><Icon name="check" strokeWidth={2.6} /></span>}
      {state === 'invalid' && <span className="vg-field-state" aria-hidden="true"><Icon name="alert" strokeWidth={2.2} /></span>}
    </div>
    {hint && <p id={hintId} className={cx('vg-field-hint', state === 'invalid' && 'is-error')}>{hint}</p>}
  </div>;
}

export interface SelectPillProps extends SelectHTMLAttributes<HTMLSelectElement> { label: string; options: readonly (string | { value: string; label: string })[]; className?: string }
export function SelectPill({ label, options, className, ...rest }: SelectPillProps) {
  return <span className={cx('vg-select vg-bead', className)}>
    <select aria-label={label} {...rest}>{options.map(o => { const v = typeof o === 'string' ? o : o.value; return <option key={v} value={v}>{typeof o === 'string' ? o : o.label}</option>; })}</select>
    <Icon name="chevron" strokeWidth={2.2} />
  </span>;
}

export function SegmentedTabs({ items, label, value, defaultValue, onChange, className }: { items: readonly string[]; label: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; className?: string }) {
  const [own, setOwn] = useState(defaultValue ?? items[0]);
  const current = value ?? own;
  return <div className={cx('vg-tabs vg-glass', className)} role="tablist" aria-label={label}>
    {items.map(it => <button key={it} type="button" role="tab" className="vg-tab" aria-selected={it === current} onClick={() => { setOwn(it); onChange?.(it); }}>{it}</button>)}
  </div>;
}

export interface ToggleProps { label?: string; ariaLabel?: string; checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void; disabled?: boolean; describedBy?: string }
export function Toggle({ label, ariaLabel, checked, defaultChecked, onChange, disabled, describedBy }: ToggleProps) {
  const [own, setOwn] = useState(!!defaultChecked);
  const on = checked ?? own;
  const btn = <button type="button" role="switch" aria-checked={on} aria-label={label ? undefined : ariaLabel} aria-describedby={describedBy} className="vg-toggle" disabled={disabled} onClick={() => { if (disabled) return; setOwn(!on); onChange?.(!on); }} />;
  return label ? <label className="vg-inline">{btn}{label}</label> : btn;
}

export function Checkbox({ label, checked, defaultChecked, onChange }: { label: string; checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void }) {
  const [own, setOwn] = useState(!!defaultChecked);
  const on = checked ?? own;
  return <label className="vg-inline"><button type="button" role="checkbox" aria-checked={on} className="vg-check" onClick={() => { setOwn(!on); onChange?.(!on); }}><Icon name="check" strokeWidth={3} /></button>{label}</label>;
}

/* ---------- Chrome ---------- */
export function TopBar({ unread = 0, homeHref = '/', notificationsHref = '/settings?section=notifications', account, className }: { unread?: number; homeHref?: string; notificationsHref?: string; account?: ReactNode; className?: string }) {
  return <header className={cx('vg-topbar', className)}>
    <Wordmark href={homeHref} />
    <IconButton icon="bell" href={notificationsHref} label={unread ? `Notifications, ${unread} unread` : 'Notifications'} dot={unread > 0} />
    {account ?? <IconButton icon="user" label="Account" href="/settings" />}
  </header>;
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  return <Link href={item.href} aria-current={active ? 'page' : undefined} onClick={onNavigate}><Icon name={item.icon} /><span>{item.label}</span></Link>;
}
export function BottomNav({ active, items = NAV_ITEMS, className }: { active: NavId | null; items?: readonly NavItem[]; className?: string }) {
  return <nav className={cx('vg-nav vg-glass', className)} aria-label="Main">{items.map(it => <NavLink key={it.id} item={it} active={it.id === active} />)}</nav>;
}
/** Desktop (≥1024px): the same five items as a left glass sidebar. Rendered by the shell; CSS shows one nav system at a time. */
export function SideNav({ active, items = NAV_ITEMS, footer, className }: { active: NavId | null; items?: readonly NavItem[]; footer?: ReactNode; className?: string }) {
  return <aside className={cx('vg-sidenav vg-glass vg-sheet', className)}>
    <Wordmark href="/" />
    <nav className="vg-nav vg-nav-vertical" aria-label="Main">{items.map(it => <NavLink key={it.id} item={it} active={it.id === active} />)}</nav>
    {footer && <div className="vg-sidenav-foot">{footer}</div>}
  </aside>;
}

export function AppFrame({ children, className, ...rest }: { children: ReactNode; className?: string; id?: string }) {
  return <div className={cx('vg-frame vg-glass vg-sheet', className)} {...rest}>{children}</div>;
}

export function PromoCard({ title, text, action, className }: { title: string; text?: string; action?: { label: string; icon?: IconName; onClick?: () => void; href?: string }; className?: string }) {
  return <GlassCard promo className={className}>
    <span className="vg-promo-glow" aria-hidden="true" />
    <h3 className="vg-promo-title">{title}</h3>
    {text && <p className="vg-promo-text">{text}</p>}
    {action && <GlassButton variant="glass" icon={action.icon} onClick={action.onClick} href={action.href}>{action.label}</GlassButton>}
  </GlassCard>;
}

/* ---------- Page patterns ---------- */
export function PageHeading({ title, description, action, back }: { title: string; description?: ReactNode; action?: ReactNode; back?: { href: string; label: string } }) {
  return <div className="vg-page-heading">
    {back && <Link className="vg-back" href={back.href}><Icon name="back" />{back.label}</Link>}
    <div className="vg-page-heading-row"><div><h1 className="vg-h1">{title}</h1>{description && <p className="vg-page-sub">{description}</p>}</div>{action}</div>
  </div>;
}

export function EmptyState({ icon = 'calendar', tone = 'violet', title, children, action, className }: { icon?: IconName; tone?: Tone; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return <GlassCard className={cx('vg-empty', className)} aria-label={title}>
    <IconTile icon={icon} tone={tone} />
    <h2 className="vg-empty-title">{title}</h2>
    {children && <p className="vg-empty-text">{children}</p>}
    {action && <div className="vg-empty-action">{action}</div>}
  </GlassCard>;
}

/** A compact row inside a card: icon well, title + caption, trailing status or chevron. Used by More and Bookings. */
export function ListRow({ href, icon, tone = 'violet', title, caption, trailing, onClick }: { href?: string; icon: IconName; tone?: Tone; title: string; caption?: ReactNode; trailing?: ReactNode; onClick?: () => void }) {
  const body = <><IconTile icon={icon} tone={tone} size="sm" /><span className="vg-row-body"><strong>{title}</strong>{caption && <small>{caption}</small>}</span><span className="vg-row-trailing">{trailing ?? <Icon name="chevron-right" strokeWidth={2.2} />}</span></>;
  if (href) return <Link href={href} className="vg-row">{body}</Link>;
  return <button type="button" className="vg-row" onClick={onClick}>{body}</button>;
}

/** A square glass tile: icon well above a title and caption. Used for the More grid. */
export function ProductTile({ href, icon, tone = 'violet', title, caption, badge }: { href: string; icon: IconName; tone?: Tone; title: string; caption?: string; badge?: ReactNode }) {
  return <Link href={href} className="vg-card vg-glass vg-tilecard vg-linkcard"><IconTile icon={icon} tone={tone} size="sm" /><span className="vg-tilecard-title">{title}</span>{caption && <span className="vg-tilecard-caption">{caption}</span>}{badge && <span className="vg-tilecard-badge">{badge}</span>}</Link>;
}
