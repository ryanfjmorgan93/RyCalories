import { describe, expect, it } from 'vitest';
import { ACCENT_TEXT_BACKGROUNDS, BRASS, BRASS_HUE, MIN_CONTRAST, PRESETS, WHITE, WHITE_HUE, accentForSetting, accentFromHue, hslToHex, inkOn, normaliseHue } from './accent';
import { contrastRatio } from './plateDiagram';

describe('hslToHex', () => {
  it('converts the primaries and greys', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
    expect(hslToHex(0, 0, 0)).toBe('#000000');
    expect(hslToHex(0, 0, 100)).toBe('#ffffff');
  });
});

describe('normaliseHue', () => {
  it('wraps and rounds into 0–359', () => {
    expect(normaliseHue(-10)).toBe(350);
    expect(normaliseHue(360)).toBe(0);
    expect(normaliseHue(725.4)).toBe(5);
    expect(normaliseHue(Number.NaN)).toBe(BRASS_HUE);
  });
});

describe('accentFromHue', () => {
  it('reads on every dark surface and carries readable ink, for every hue on the wheel', () => {
    for (let h = 0; h < 360; h++) {
      const { accent, accentFg } = accentFromHue(h);
      for (const bg of ACCENT_TEXT_BACKGROUNDS) expect(contrastRatio(accent, bg), `hue ${h} on ${bg}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrastRatio(accentFg, accent), `ink on hue ${h}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('lifts a dark blue rather than shipping it unreadable', () => {
    const plain = hslToHex(240, 100, 56);
    expect(contrastRatio(plain, '#262626')).toBeLessThan(MIN_CONTRAST);
    const lifted = accentFromHue(240).accent;
    expect(lifted).not.toBe(plain);
    expect(contrastRatio(lifted, ACCENT_TEXT_BACKGROUNDS[2])).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('leaves an amber that already reads where it is', () => {
    expect(accentFromHue(BRASS_HUE).accent).toBe(hslToHex(BRASS_HUE, 100, 56));
  });
});

describe('accentForSetting', () => {
  it('is the default brass when nothing is stored', () => {
    expect(accentForSetting(undefined)).toEqual({ hue: BRASS_HUE, ...BRASS });
    expect(contrastRatio(BRASS.accentFg, BRASS.accent)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    for (const bg of ACCENT_TEXT_BACKGROUNDS) expect(contrastRatio(BRASS.accent, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('uses the wheel when a hue is stored', () => {
    expect(accentForSetting(200)).toEqual(accentFromHue(200));
  });

  it('is white with black ink for the white setting, readable on every dark surface', () => {
    expect(accentForSetting(WHITE_HUE)).toEqual({ hue: WHITE_HUE, accent: '#ffffff', accentFg: '#000000' });
    // Every named preset reads as text on every dark surface, and its ink reads on it as a fill.
    for (const p of PRESETS) {
      const c = accentForSetting(p.hue);
      expect(c.accent).toBe(p.accent);
      expect(contrastRatio(c.accentFg, c.accent), p.name).toBeGreaterThanOrEqual(MIN_CONTRAST);
      for (const bg of ACCENT_TEXT_BACKGROUNDS) expect(contrastRatio(c.accent, bg), `${p.name} on ${bg}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    expect(new Set(PRESETS.map((p) => p.hue)).size).toBe(PRESETS.length);
    expect(accentForSetting(-99)).toEqual(accentForSetting(undefined));
    expect(contrastRatio(WHITE.accentFg, WHITE.accent)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    for (const bg of ACCENT_TEXT_BACKGROUNDS) expect(contrastRatio(WHITE.accent, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    // Not a hue on the wheel: 359 must stay a red, not turn white.
    expect(accentForSetting(359)).toEqual(accentFromHue(359));
  });
});

describe('inkOn', () => {
  it('picks white on a dark fill and black on a light one', () => {
    expect(inkOn('#101010')).toBe('#ffffff');
    expect(inkOn('#ffd000')).toBe('#000000');
  });
});
