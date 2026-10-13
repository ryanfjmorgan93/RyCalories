import { useEffect } from 'react';
import { accentForSetting, EMBER_HUE } from '@/domain/accent';
import { useSettings } from './hooks';

/**
 * Applies the accent the owner picked on the colour wheel (Settings → Look) as the two CSS
 * variables everything accent-coloured reads (`--c-accent`, `--c-accent-fg`). No stored hue means
 * the stylesheet's own ember, so the inline values are removed rather than written.
 *
 * The Settings row is the record. A copy of the hue in localStorage only lets the first paint use
 * it before the database has opened; it is a per-device convenience, read and written in try/catch,
 * and the app looks right (ember, then the stored hue a moment later) without it.
 */
const CACHE_KEY = 'iron.accentHue';

export function applyAccent(accentHue: number | undefined): void {
  const style = document.documentElement.style;
  if (accentHue === undefined) {
    style.removeProperty('--c-accent');
    style.removeProperty('--c-accent-fg');
  } else {
    const { accent, accentFg } = accentForSetting(accentHue);
    style.setProperty('--c-accent', accent);
    style.setProperty('--c-accent-fg', accentFg);
  }
  document.documentElement.dataset.accentHue = String(accentHue ?? EMBER_HUE);
}

function cacheAccent(accentHue: number | undefined): void {
  try {
    if (accentHue === undefined) localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, String(accentHue));
  } catch {
    // Not cached: the first paint is ember until Settings loads.
  }
}

/** Before the first render: the cached hue, if any. */
export function applyCachedAccent(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const hue = raw === null ? Number.NaN : Number(raw);
    if (Number.isFinite(hue)) applyAccent(hue);
  } catch {
    // Storage unavailable: ember until Settings loads.
  }
}

/** Keeps the page's accent in step with the Settings row (a restore or a reset changes it too). */
export function AccentSync(): null {
  const settings = useSettings();
  const hue = settings?.accentHue;
  const loaded = settings !== undefined;
  useEffect(() => {
    if (!loaded) return;
    applyAccent(hue);
    cacheAccent(hue);
  }, [hue, loaded]);
  return null;
}
