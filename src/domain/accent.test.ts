import { describe, expect, it } from 'vitest';
import { ACCENT_TEXT_BACKGROUNDS, EMBER, EMBER_HUE, MIN_CONTRAST, accentForSetting, accentFromHue, hslToHex, inkOn, normaliseHue } from './accent';
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
    expect(normaliseHue(Number.NaN)).toBe(EMBER_HUE);
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
    expect(contrastRatio(lifted, '#262626')).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('keeps an orange near the signed-off ember', () => {
    expect(accentFromHue(EMBER_HUE).accent).toBe(hslToHex(EMBER_HUE, 100, 56));
  });
});

describe('accentForSetting', () => {
  it('is the signed-off ember when nothing is stored', () => {
    expect(accentForSetting(undefined)).toEqual({ hue: EMBER_HUE, ...EMBER });
    expect(contrastRatio(EMBER.accentFg, EMBER.accent)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    for (const bg of ACCENT_TEXT_BACKGROUNDS) expect(contrastRatio(EMBER.accent, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('uses the wheel when a hue is stored', () => {
    expect(accentForSetting(200)).toEqual(accentFromHue(200));
  });
});

describe('inkOn', () => {
  it('picks white on a dark fill and black on a light one', () => {
    expect(inkOn('#101010')).toBe('#ffffff');
    expect(inkOn('#ffd000')).toBe('#000000');
  });
});
