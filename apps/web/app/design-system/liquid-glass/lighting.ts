/** Time-of-day ambient lighting (VENTRA_UI_RULEBOOK section 7). Only the wall's light and shadow direction change, never the glass. */
export type LightPhase = 'morning' | 'midday' | 'afternoon' | 'evening';

/** Neutral phase used during server rendering so hydration never mismatches. */
export const SERVER_LIGHT_PHASE: LightPhase = 'midday';
/** Re-check interval on the client (10 minutes). */
export const LIGHT_PHASE_INTERVAL_MS = 10 * 60 * 1000;

export function lightPhaseForHour(hour: number): LightPhase {
  if (!Number.isFinite(hour)) return SERVER_LIGHT_PHASE;
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 15) return 'midday';
  if (h >= 15 && h < 19) return 'afternoon';
  return 'evening';
}

export function lightPhaseForDate(date: Date): LightPhase { return lightPhaseForHour(date.getHours()); }
