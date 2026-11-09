// VENTRA Liquid Glass icons: Lucide-style line icons on a 24px grid, 1.8 stroke, round caps. Inline SVG, no dependency.
// The first group is the approved set from docs/design/ventra-ui/components.js; the rest are additions for the app shell
// (settings, help, products) drawn in the same style.
import { useId } from 'react';

export const ICON_PATHS = {
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z',
  leads: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.5a4 4 0 0 1 0 7.5M19 14a5 5 0 0 1 3 5v2',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 9h16M8 2v4M16 2v4M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  bell: 'M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0',
  user: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM4 21a8 8 0 0 1 16 0',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  chat: 'M4 12a8 8 0 0 1 8-8 8 8 0 0 1 0 16H4l2-2.8A7.9 7.9 0 0 1 4 12zM8.5 12h.01M12 12h.01M15.5 12h.01',
  headset: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2zM18 18a4 4 0 0 1-4 3h-2',
  chart: 'M6 20V12M12 20V5M18 20v-9',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  check: 'M5 12.5l4.5 4.5L19 7',
  chevron: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  alert: 'M12 9v4M12 17h.01M10.3 4l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z',
  // Additions (same grid and stroke).
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01',
  plug: 'M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5',
  book: 'M4 5a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2zM4 17a2 2 0 0 1 2-2h14M8 7h7',
  rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3 0 6 3 6 6-3 5-7 8-11 9l-4-4c1-4 4-8 9-11zM15 9h.01',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  mail: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 8l8 6 8-6',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM12 15v2',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  logout: 'M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3M16 17l5-5-5-5M21 12H9',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  message: 'M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z',
  wallet: 'M3 7a2 2 0 0 1 2-2h14v4M3 7v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H3M16 13h.01',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
} as const;

export type IconName = keyof typeof ICON_PATHS;
export type Tone = 'violet' | 'teal' | 'magenta' | 'indigo';

export interface IconProps { name: IconName; size?: number; strokeWidth?: number; gradient?: Tone; className?: string }

export function Icon({ name, size, strokeWidth, gradient, className }: IconProps) {
  const d = ICON_PATHS[name] ?? ICON_PATHS.more;
  const id = useId();
  const stroke = gradient ? `url(#vg-ig-${id})` : 'currentColor';
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth ?? (name === 'more' ? 3.2 : 1.8)} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" width={size} height={size} className={className}>
      {gradient && (
        <defs>
          <linearGradient id={`vg-ig-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className={`vg-g-${gradient}-a`} />
            <stop offset="1" className={`vg-g-${gradient}-b`} />
          </linearGradient>
        </defs>
      )}
      <path d={d} />
    </svg>
  );
}
