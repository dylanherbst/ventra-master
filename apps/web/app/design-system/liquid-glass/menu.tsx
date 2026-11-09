'use client';
// Anchored glass menu. Aligns to its own trigger, clamps to the viewport, flips up when there is no room below, and
// dismisses on outside tap, Escape and navigation. Portalled to the app root: glass surfaces use backdrop-filter, which
// would otherwise become the containing block of a fixed-position menu (rulebook section 4, "Menus").
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import type { IconName } from './icons';

export interface MenuItem { id: string; label: string; icon?: IconName; href?: string; onSelect?: () => void; selected?: boolean; disabled?: boolean; caption?: string }
export interface TriggerProps { ref: (el: HTMLElement | null) => void; onClick: () => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean; 'aria-controls': string }
export interface GlassMenuProps { trigger: (props: TriggerProps) => ReactNode; items: MenuItem[]; align?: 'left' | 'right'; label: string }

const GAP = 8, VIEWPORT_PAD = 12, MIN_WIDTH = 200;

export function GlassMenu({ trigger, items, align = 'right', label }: GlassMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const pathname = usePathname();
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  useEffect(() => { setPortal(triggerRef.current?.closest<HTMLElement>('.vg-app') ?? document.body); }, []);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => { close(); }, [pathname, close]);
  useLayoutEffect(() => {
    if (!open) return;
    const t = triggerRef.current, m = menuRef.current;
    if (!t || !m) return;
    const r = t.getBoundingClientRect();
    const mw = Math.max(MIN_WIDTH, m.offsetWidth), mh = m.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left = align === 'left' ? r.left : r.right - mw;
    left = Math.min(Math.max(VIEWPORT_PAD, left), Math.max(VIEWPORT_PAD, vw - mw - VIEWPORT_PAD));
    const below = r.bottom + GAP;
    const top = below + mh <= vh - VIEWPORT_PAD ? below : Math.max(VIEWPORT_PAD, r.top - GAP - mh);
    setPos({ position: 'fixed', top, left, minWidth: mw });
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { const t = e.target as Node; if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return; close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); triggerRef.current?.focus(); } };
    const onResize = () => close();
    document.addEventListener('pointerdown', onPointer); document.addEventListener('keydown', onKey); window.addEventListener('resize', onResize);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, [open, close]);
  useEffect(() => { if (open) menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus(); }, [open, pos]);
  const setTrigger = useCallback((el: HTMLElement | null) => { triggerRef.current = el; }, []);
  return <>
    {trigger({ ref: setTrigger, onClick: () => setOpen(o => !o), 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': id })}
    {open && portal && createPortal(
      <div ref={menuRef} id={id} role="menu" aria-label={label} className="vg-menu vg-bead" style={pos ?? { position: 'fixed', top: -9999, left: -9999 }}>
        {items.map(item => {
          const role = item.selected !== undefined ? 'menuitemradio' : 'menuitem';
          const body = <>{item.icon && <Icon name={item.icon} size={18} />}<span className="vg-menu-body"><span>{item.label}</span>{item.caption && <small>{item.caption}</small>}</span>{item.selected && <Icon name="check" size={16} strokeWidth={2.6} className="vg-menu-check" />}</>;
          if (item.href && !item.disabled) return <Link key={item.id} href={item.href} role={role} aria-checked={item.selected} className="vg-menu-item" onClick={close}>{body}</Link>;
          return <button key={item.id} type="button" role={role} aria-checked={item.selected} className="vg-menu-item" disabled={item.disabled} onClick={() => { item.onSelect?.(); close(); }}>{body}</button>;
        })}
      </div>, portal)}
  </>;
}
