/**
 * The accent colour the owner picks on the colour wheel (Settings → Look). The wheel picks a hue
 * only; saturation is fixed and lightness is the lowest that keeps every pairing readable:
 * the accent as text on the darkest and the lightest dark surface, and the ink printed on an
 * accent fill. A dark blue or violet is therefore lifted until it reads, rather than shipped at
 * 3:1. Absent (`undefined`) means the signed-off ember, which src/index.css carries as its default.
 *
 * Pure: no IO, no DOM. src/ui/accentTheme.ts applies the result as CSS variables.
 */
import { contrastRatio } from './plateDiagram';

/** Hue of the signed-off ember #FF5A1F, for the wheel's starting position and its reset. */
export const EMBER_HUE = 17;
export const EMBER = { accent: '#ff5a1f', accentFg: '#000000' } as const;

/** Text-on-surface floor (WCAG AA for body text), the same one src/ui/tokens.test.ts holds the tokens to. */
export const MIN_CONTRAST = 4.5;

/**
 * Every dark surface the accent appears on as text: the black stage, the plain panel, and the top
 * of a shaded panel (its lightest point). The lightest one is the binding one.
 */
export const ACCENT_TEXT_BACKGROUNDS = ['#000000', '#1a1a1a', '#262626'] as const;

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
  if (!Number.isFinite(hue)) return EMBER_HUE;
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

/** The colours for a stored setting: the signed-off ember when none is stored. */
export function accentForSetting(accentHue: number | undefined): AccentColours {
  if (accentHue === undefined) return { hue: EMBER_HUE, ...EMBER };
  return accentFromHue(accentHue);
}
