'use client';
// The VENTRA app shell in the approved Liquid Glass look (docs/design/LIQUID_GLASS_SPEC.md): one lit wall, one glass
// sheet, TopBar, and the five-item navigation (bottom bar on phones, left sidebar from 1024px). Existing pages render
// inside unchanged; only the chrome around them is new. The legacy stylesheets stay loaded for those pages.
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AppFrame, BottomNav, GlassButton, GlassMenu, IconButton, SideNav, TopBar, activeNav, isLiquidRoute } from '../design-system/liquid-glass';
import { LIGHT_PHASE_INTERVAL_MS, SERVER_LIGHT_PHASE, lightPhaseForDate } from '../design-system/liquid-glass/lighting';
import type { LightPhase } from '../design-system/liquid-glass/lighting';
import { WorkspaceProvider } from './ventra-context';
import '../design-system/tokens.css';
import '../design-system/workspace.css';
import '../design-system/refresh.css';
import '../design-system/theme.css';
import '../design-system/liquid-glass/tokens.css';
import '../design-system/liquid-glass/glass.css';
import '../design-system/liquid-glass/shell.css';

// Theme: light by default; dark or match-device are opt-in and stored only in this browser (same key as before).
type ThemeChoice = 'auto' | 'dark' | 'light';
const themeKey = 'ventra.theme.v1';
function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>('light');
  const [system, setSystem] = useState<'dark' | 'light'>('light');
  useEffect(() => {
    try { const v = localStorage.getItem(themeKey); if (v === 'dark' || v === 'auto') setChoice(v); } catch { /* storage unavailable: stay light */ }
    const q = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystem(q.matches ? 'dark' : 'light');
    sync(); q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);
  const theme = choice === 'auto' ? system : choice;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => { delete document.documentElement.dataset.theme; };
  }, [theme]);
  function set(next: ThemeChoice) { setChoice(next); try { if (next === 'light') localStorage.removeItem(themeKey); else localStorage.setItem(themeKey, next); } catch { /* applies for this visit only */ } }
  return { theme, choice, set };
}

function useLightPhase(): LightPhase {
  const [phase, setPhase] = useState<LightPhase>(SERVER_LIGHT_PHASE);
  useEffect(() => {
    const tick = () => setPhase(lightPhaseForDate(new Date()));
    tick();
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') tick(); }, LIGHT_PHASE_INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, []);
  return phase;
}

const ThemeContext = createContext<'light' | 'dark'>('light');
/** The resolved theme, for screens that embed legacy `.ventra-app` content and need `data-theme` on that wrapper. */
export function useLiquidTheme() { return useContext(ThemeContext); }

const themeLabel: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', auto: 'Match device' };

export default function LiquidShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { theme, choice, set } = useTheme();
  const phase = useLightPhase();
  const active = activeNav(pathname);
  const legacy = !isLiquidRoute(pathname);
  const accountMenu = <GlassMenu label="Account" align="right" items={[
    { id: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
    { id: 'integrations', label: 'Connections', icon: 'plug', href: '/settings?section=integrations' },
    { id: 'workspace', label: 'Account and sign in', icon: 'user', href: '/workspace' },
    { id: 'help', label: 'Help and support', icon: 'help', href: '/settings?section=help' },
    { id: 'theme', label: `Theme: ${themeLabel[choice]}`, icon: theme === 'dark' ? 'moon' : 'sun', caption: 'Light, dark or match device', onSelect: () => set(choice === 'light' ? 'dark' : choice === 'dark' ? 'auto' : 'light') },
  ]} trigger={p => <IconButton icon="user" label="Account menu" {...p} />} />;
  const themeButton = <GlassButton size="sm" icon={theme === 'dark' ? 'moon' : 'sun'} onClick={() => set(choice === 'light' ? 'dark' : choice === 'dark' ? 'auto' : 'light')} aria-label={`Colour theme: ${themeLabel[choice]}. Press to change.`}>Theme: {themeLabel[choice]}</GlassButton>;
  return <WorkspaceProvider><ThemeContext value={theme}>
    <div className="vg-app vg-stage" data-theme={theme} data-ventra-light={phase}>
      <a className="vg-skip" href="#ventra-main" onClick={e => { e.preventDefault(); document.getElementById('ventra-main')?.focus(); }}>Skip to main content</a>
      <div className="vg-layout">
        <SideNav active={active} footer={themeButton} />
        <AppFrame>
          <TopBar notificationsHref="/notifications" account={accountMenu} />
          <main id="ventra-main" className="vg-main" tabIndex={-1}>
            {legacy ? <div className="ventra-app vg-legacy" data-theme={theme}><div className="v-main v-workspace-main">{children}</div></div> : children}
          </main>
        </AppFrame>
      </div>
      <BottomNav active={active} className="vg-bottomnav" />
    </div>
  </ThemeContext></WorkspaceProvider>;
}
