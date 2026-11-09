import type { IconName } from './icons';

/** The frozen five-item navigation (VENTRA_UI_RULEBOOK section 2). Shared by BottomNav and SideNav. */
export type NavId = 'home' | 'leads' | 'team' | 'bookings' | 'more';
export interface NavItem { id: NavId; label: string; icon: IconName; href: string }

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home', href: '/' },
  { id: 'leads', label: 'Leads', icon: 'leads', href: '/customers' },
  { id: 'team', label: 'AI Team', icon: 'sparkle', href: '/ai-team' },
  { id: 'bookings', label: 'Bookings', icon: 'calendar', href: '/bookings' },
  { id: 'more', label: 'More', icon: 'more', href: '/more' },
];

/** Screens already built from Liquid Glass components. Every other route is an existing page: the shell wraps it in the
 *  legacy `.ventra-app` scope so its own styles keep applying, with the new chrome around it. */
export function isLiquidRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/ai-team' || pathname === '/bookings' || pathname === '/more' || pathname === '/notifications';
}

/** Which of the five destinations an existing route belongs to. Old routes keep working; they only light up a nav item. */
export function activeNav(pathname: string): NavId | null {
  if (pathname === '/') return 'home';
  const is = (...roots: string[]) => roots.some(r => pathname === r || pathname.startsWith(r + '/'));
  if (is('/customers', '/inbox', '/sales')) return 'leads';
  if (is('/ai-team')) return 'team';
  if (is('/bookings')) return 'bookings';
  if (is('/more', '/settings', '/services', '/insights', '/business', '/create', '/grow', '/onboarding', '/workspace')) return 'more';
  return null;
}
