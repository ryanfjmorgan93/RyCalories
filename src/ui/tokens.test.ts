import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/domain/plateDiagram';

/**
 * Reads the REAL token values out of src/index.css — not a copy pasted into this test — and
 * asserts WCAG contrast for every text/background pairing this app actually renders: body text
 * and its two dimmer tiers against the page background, a surface, and a card's glass tint
 * composited over the background; every state colour used as text against bg/surface; and every
 * colour used as text ON TOP OF a solid fill (accent-fg on accent, ok-fg on ok, record-fg on
 * record). If a token is ever retuned in src/index.css, this fails the moment the retuned value
 * stops reading — the same job `plateDiagram.test.ts` already does for plate ink.
 */

const CSS_PATH = fileURLToPath(new URL('../index.css', import.meta.url));
const css = readFileSync(CSS_PATH, 'utf8');

const MIN_TEXT_CONTRAST = 4.5;

// ---------------------------------------------------------------------------------------------
// A small, deliberately literal CSS custom-property reader: this file owns the token contract, so
// the test can rely on its own shape (one `:root { ... }` block, one `[data-theme='light'] { ... }`
// block, no nested braces inside either) rather than a general CSS parser.
// ---------------------------------------------------------------------------------------------

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractBlock(source: string, selector: string): string {
  const withoutComments = stripComments(source);
  const start = withoutComments.indexOf(selector);
  if (start === -1) throw new Error(`index.css has no ${selector} block`);
  const braceStart = withoutComments.indexOf('{', start);
  const braceEnd = withoutComments.indexOf('}', braceStart);
  if (braceStart === -1 || braceEnd === -1) throw new Error(`index.css's ${selector} block is malformed`);
  return withoutComments.slice(braceStart + 1, braceEnd);
}

/** `--name: value;` declarations in a block, as a plain map (custom properties only). */
function parseDeclarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of block.split(';')) {
    const decl = raw.trim();
    if (!decl.startsWith('--')) continue;
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const name = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    map.set(name, value);
  }
  return map;
}

const rootTokens = parseDeclarations(extractBlock(css, ':root'));
const lightTokens = parseDeclarations(extractBlock(css, "[data-theme='light']"));

/** Light overrides dark for anything it redefines; anything it does not redefine (radii, motion,
 *  --blur-glass, --content-max) cascades from :root exactly as it does for the real page. */
function themeTokens(theme: 'dark' | 'light'): Map<string, string> {
  return theme === 'dark' ? rootTokens : new Map([...rootTokens, ...lightTokens]);
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseHex(hex: string): Rgba {
  const clean = hex.trim();
  const bytes = [1, 3, 5].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return { r: bytes[0], g: bytes[1], b: bytes[2], a: 1 };
}

function parseRgbFn(value: string): Rgba {
  const nums = value
    .slice(value.indexOf('(') + 1, value.lastIndexOf(')'))
    .split(',')
    .map((n) => Number.parseFloat(n.trim()));
  const [r, g, b, a = 1] = nums;
  return { r, g, b, a };
}

/** Resolves a token to its colour, following `var(--x)` aliases (e.g. --c-done: var(--c-ok)). */
function resolveColor(tokens: Map<string, string>, name: string, depth = 0): Rgba {
  if (depth > 5) throw new Error(`--${name} is a circular var() reference`);
  const raw = tokens.get(`--${name}`);
  if (raw === undefined) throw new Error(`index.css has no --${name} token`);
  const varMatch = /^var\(--([\w-]+)\)$/.exec(raw);
  if (varMatch) return resolveColor(tokens, varMatch[1], depth + 1);
  if (raw.startsWith('#')) return parseHex(raw);
  if (raw.startsWith('rgb')) return parseRgbFn(raw);
  throw new Error(`--${name} (${raw}) is not a colour this test knows how to read`);
}

function toHex({ r, g, b }: Rgba): string {
  const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** Opaque colour a token resolves to, as `#rrggbb` — fails loudly if the token turns out to carry
 *  alpha (that colour cannot be used as a flat text/background fill without compositing first). */
function opaqueHex(tokens: Map<string, string>, name: string): string {
  const c = resolveColor(tokens, name);
  if (c.a !== 1) throw new Error(`--${name} has alpha ${c.a} — composite it with compositeOverBg first`);
  return toHex(c);
}

/** A translucent tint (a glass tier) alpha-composited over an opaque base — the approximation the
 *  brief asks for: "glass-over-bg approximated by compositing the glass tint over bg". */
function compositeOverBg(tokens: Map<string, string>, tintName: string, baseName: string): string {
  const tint = resolveColor(tokens, tintName);
  const base = resolveColor(tokens, baseName);
  const mix = (t: number, b: number) => t * tint.a + b * (1 - tint.a);
  return toHex({ r: mix(tint.r, base.r), g: mix(tint.g, base.g), b: mix(tint.b, base.b), a: 1 });
}

const THEMES = ['dark', 'light'] as const;
const GLASS_TIERS = ['glass-1', 'glass-2', 'glass-3'] as const;
const TEXT_ON_FILL = [
  { text: 'c-accent-fg', fill: 'c-accent', label: 'accent-fg on accent' },
  { text: 'c-ok-fg', fill: 'c-ok', label: 'ok-fg on ok' },
  { text: 'c-record-fg', fill: 'c-record', label: 'record-fg on record' },
] as const;
const STATE_TEXT = ['c-accent', 'c-ok', 'c-warn', 'c-danger', 'c-info', 'c-record'] as const;
const SURFACES = ['c-bg', 'c-surface'] as const;

describe.each(THEMES)('%s theme tokens', (theme) => {
  const tokens = themeTokens(theme);

  it.each(['c-fg', 'c-muted', 'c-dim'])('%s reaches 4.5:1 on bg and on surface', (textToken) => {
    for (const surfaceToken of SURFACES) {
      const ratio = contrastRatio(opaqueHex(tokens, textToken), opaqueHex(tokens, surfaceToken));
      expect(ratio, `${textToken} on ${surfaceToken}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it.each(GLASS_TIERS)('c-fg, c-muted and c-dim all reach 4.5:1 on %s composited over bg', (tier) => {
    const composited = compositeOverBg(tokens, tier, 'c-bg');
    for (const textToken of ['c-fg', 'c-muted', 'c-dim']) {
      const ratio = contrastRatio(opaqueHex(tokens, textToken), composited);
      expect(ratio, `${textToken} on ${tier} over bg`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it.each(STATE_TEXT)('%s reaches 4.5:1 as text on bg and on surface', (stateToken) => {
    for (const surfaceToken of SURFACES) {
      const ratio = contrastRatio(opaqueHex(tokens, stateToken), opaqueHex(tokens, surfaceToken));
      expect(ratio, `${stateToken} on ${surfaceToken}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it.each(TEXT_ON_FILL)('$label reaches 4.5:1', ({ text, fill }) => {
    const ratio = contrastRatio(opaqueHex(tokens, text), opaqueHex(tokens, fill));
    expect(ratio).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});

describe('token aliases', () => {
  it.each(THEMES)('--c-done is --c-ok and --c-rest is --c-info in the %s theme', (theme) => {
    const tokens = themeTokens(theme);
    expect(opaqueHex(tokens, 'c-done')).toBe(opaqueHex(tokens, 'c-ok'));
    expect(opaqueHex(tokens, 'c-rest')).toBe(opaqueHex(tokens, 'c-info'));
  });
});
