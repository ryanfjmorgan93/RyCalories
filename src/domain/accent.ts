/**
 * The accent colour the owner picks on the colour wheel (Settings → Look). The wheel picks a hue
 * only; saturation is fixed and lightness is the lowest that keeps every pairing readable:
 * the accent as text on the darkest and the lightest dark surface, and the ink printed on an
 * accent fill. A dark blue or violet is therefore lifted until it reads, rather than shipped at
 * 3:1. Absent (`undefined`) means brass, the default src/index.css carries (it replaced ember with
 * the trophy-room look, November 2026; ember is still hue 17 on the wheel).
 * White, Jade, Cobalt and Coral are named accents off the wheel (white asked for in November 2026,
 * the three colours beside it soon after: "generally nice colour selections" with a name, each
 * plainly unlike the others).
 *
 * Pure: no IO, no DOM. src/ui/accentTheme.ts applies the result as CSS variables.
 */
import { contrastRatio } from './plateDiagram';

/** Hue of the default brass #C9A45C, for the wheel's starting position and its reset. */
export const BRASS_HUE = 40;
export const BRASS = { accent: '#c9a45c', accentFg: '#000000' } as const;
/** White has no hue, so it is stored as this value in `Settings.accentHue`, beside the wheel's 0–359. */
export const WHITE_HUE = -1;
export const WHITE = { accent: '#ffffff', accentFg: '#000000' } as const;

/**
 * The named accents beside brass, each stored as its own negative value in `Settings.accentHue`
 * (beside the wheel's 0–359, as white was first). Each reads on every dark surface at 4.5:1
 * (accent.test.ts).
 */
export const PRESETS = [
  { hue: WHITE_HUE, name: 'White', accent: WHITE.accent },
  { hue: -2, name: 'Jade', accent: '#5ccf9e' },
  { hue: -3, name: 'Cobalt', accent: '#6fa8ff' },
  { hue: -4, name: 'Coral', accent: '#ff7a6b' },
] as const;

/** Text-on-surface floor (WCAG AA for body text), the same one src/ui/tokens.test.ts holds the tokens to. */
export const MIN_CONTRAST = 4.5;

/**
 * Every dark surface the accent appears on as text: the warm black stage, the plain panel, and the
 * lightest panel. The lightest one is the binding one.
 */
export const ACCENT_TEXT_BACKGROUNDS = ['#0a0907', '#14120e', '#262320'] as const;

const SATURATION = 100;
const START_LIGHTNESS = 56;
const INKS = ['#000000', '#ffffff'] as const;

export interface AccentColours {
  hue: number;
  accent: string;
  /** Ink for text and icons on an accent fill. */
  accentFg: string;
}

/** A whole-degree hue in 0–359, whatever was passed (negative, past 360, fractional). */
export function normaliseHue(hue: number): number {
  if (!Number.isFinite(hue)) return BRASS_HUE;
  return ((Math.round(hue) % 360) + 360) % 360;
}

/** `hsl(h, s%, l%)` as `#rrggbb`. */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const v = light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function readsOnAll(colour: string): boolean {
  return ACCENT_TEXT_BACKGROUNDS.every((bg) => contrastRatio(colour, bg) >= MIN_CONTRAST);
}

/** Whichever of black and white contrasts better on the fill, measured rather than guessed. */
export function inkOn(fill: string): string {
  return contrastRatio(INKS[0], fill) >= contrastRatio(INKS[1], fill) ? INKS[0] : INKS[1];
}

/** The accent for a hue on the wheel: lifted in lightness until it reads on every dark surface. */
export function accentFromHue(hue: number): AccentColours {
  const h = normaliseHue(hue);
  let l = START_LIGHTNESS;
  let accent = hslToHex(h, SATURATION, l);
  while (!readsOnAll(accent) && l < 95) {
    l += 1;
    accent = hslToHex(h, SATURATION, l);
  }
  return { hue: h, accent, accentFg: inkOn(accent) };
}

/** The colours for a stored setting: the default brass when none is stored, a preset for its value, else the wheel's. */
export function accentForSetting(accentHue: number | undefined): AccentColours {
  if (accentHue === undefined) return { hue: BRASS_HUE, ...BRASS };
  const preset = PRESETS.find((p) => p.hue === accentHue);
  if (preset) return { hue: preset.hue, accent: preset.accent, accentFg: inkOn(preset.accent) };
  // An unknown negative (a preset from a later build, restored here) falls back to brass, not to a wheel colour nobody chose.
  if (accentHue < 0) return { hue: BRASS_HUE, ...BRASS };
  return accentFromHue(accentHue);
}
