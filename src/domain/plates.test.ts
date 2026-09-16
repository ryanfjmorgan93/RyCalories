import { describe, expect, it } from 'vitest';
import { DEFAULT_PLATES, plateLabel, platesPerSide, roundToPlates, type PlateLoad } from './plates';

describe('platesPerSide', () => {
  it('breaks a target down greedily from the heaviest plate', () => {
    // (102.5 - 20) / 2 = 41.25 per side: 25 + 15 + 1.25.
    const load = platesPerSide(102.5, DEFAULT_PLATES);
    expect(load).toEqual<PlateLoad>({ perSide: [25, 15, 1.25], loaded: 102.5, remainder: 0 });
  });

  it('leaves a remainder when the target cannot be made exactly', () => {
    // (21 - 20) / 2 = 0.5 per side, smaller than the smallest plate (1.25).
    const load = platesPerSide(21, DEFAULT_PLATES);
    expect(load).toEqual<PlateLoad>({ perSide: [], loaded: 20, remainder: 1 });
  });

  it('is null below the bar or for non-finite input', () => {
    expect(platesPerSide(15, DEFAULT_PLATES)).toBeNull();
    expect(platesPerSide(NaN, DEFAULT_PLATES)).toBeNull();
    expect(platesPerSide(Infinity, DEFAULT_PLATES)).toBeNull();
    expect(platesPerSide(100, { barKg: NaN, plates: [20] })).toBeNull();
    expect(platesPerSide(100, { barKg: 20, plates: [NaN] })).toBeNull();
  });

  it('is exact on the bar itself (no plates needed)', () => {
    const load = platesPerSide(20, DEFAULT_PLATES);
    expect(load).toEqual<PlateLoad>({ perSide: [], loaded: 20, remainder: 0 });
  });

  it('cleans float noise from repeated subtraction (62.5 kg)', () => {
    // (62.5 - 20) / 2 = 21.25 per side: 20 + 1.25.
    const load = platesPerSide(62.5, DEFAULT_PLATES);
    expect(load).toEqual<PlateLoad>({ perSide: [20, 1.25], loaded: 62.5, remainder: 0 });
  });

  it('cleans float noise from repeated subtraction (57.5 kg)', () => {
    // (57.5 - 20) / 2 = 18.75 per side: 15 + 2.5 + 1.25.
    const load = platesPerSide(57.5, DEFAULT_PLATES);
    expect(load).toEqual<PlateLoad>({ perSide: [15, 2.5, 1.25], loaded: 57.5, remainder: 0 });
  });

  it('handles unordered plate lists and ignores non-positive plates', () => {
    const load = platesPerSide(70, { barKg: 20, plates: [10, 0, 25, -5, 15] });
    // (70 - 20) / 2 = 25 per side: 25 exactly.
    expect(load).toEqual<PlateLoad>({ perSide: [25], loaded: 70, remainder: 0 });
  });
});

describe('roundToPlates', () => {
  it('rounds down to the nearest exact load, never up', () => {
    // (63 - 20) / 2 = 21.5 per side: 20 + 1.25 = 21.25, loaded 62.5 < target 63.
    expect(roundToPlates(63, DEFAULT_PLATES)).toBe(62.5);
    expect(roundToPlates(63, DEFAULT_PLATES)).toBeLessThanOrEqual(63);
  });

  it('returns the bar when the target is below it or below bar + smallest pair', () => {
    expect(roundToPlates(15, DEFAULT_PLATES)).toBe(20);
    expect(roundToPlates(21, DEFAULT_PLATES)).toBe(20);
  });

  it('returns the exact load when the target is already achievable', () => {
    expect(roundToPlates(102.5, DEFAULT_PLATES)).toBe(102.5);
  });

  it('falls back to barKg for non-finite input', () => {
    expect(roundToPlates(NaN, DEFAULT_PLATES)).toBe(20);
  });
});

describe('plateLabel', () => {
  it('lists plates heaviest first, "per side"', () => {
    expect(plateLabel({ perSide: [20, 20, 5, 1.25], loaded: 102.5, remainder: 0 })).toBe(
      '20 + 20 + 5 + 1.25 per side',
    );
  });

  it('says "bar only" when no plates are needed', () => {
    expect(plateLabel({ perSide: [], loaded: 20, remainder: 0 })).toBe('bar only');
  });

  it('appends the shortfall when the target could not be made exactly', () => {
    expect(plateLabel({ perSide: [20], loaded: 60, remainder: 0.5 })).toBe('20 per side (+0.5 kg short)');
    expect(plateLabel({ perSide: [], loaded: 20, remainder: 1 })).toBe('bar only (+1 kg short)');
  });
});
