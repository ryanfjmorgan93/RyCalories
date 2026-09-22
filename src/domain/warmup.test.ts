import { describe, expect, it } from 'vitest';
import { DEFAULT_PLATES } from './plates';
import { genericWarmupRamp, warmupRamp, type WarmupSet } from './warmup';

describe('warmupRamp', () => {
  it('100 kg with defaults -> 20x10, 50x5, 70x3, 90x1', () => {
    expect(warmupRamp(100, DEFAULT_PLATES)).toEqual<WarmupSet[]>([
      { weight: 20, reps: 10 },
      { weight: 50, reps: 5 },
      { weight: 70, reps: 3 },
      { weight: 90, reps: 1 },
    ]);
  });

  it('60 kg with defaults -> 20x10, 30x5, 40x3 (0.7x60=42 rounds to 40), 52.5x1 (0.9x60=54 rounds to 52.5)', () => {
    expect(warmupRamp(60, DEFAULT_PLATES)).toEqual<WarmupSet[]>([
      { weight: 20, reps: 10 },
      { weight: 30, reps: 5 },
      { weight: 40, reps: 3 },
      { weight: 52.5, reps: 1 },
    ]);
  });

  it('25 kg with defaults -> 20x10 only, then 22.5x1 (0.5x25=12.5 and 0.7x25=17.5 both round to the bar and are dropped; 0.9x25=22.5 rounds to 22.5, above the bar, and is kept)', () => {
    expect(warmupRamp(25, DEFAULT_PLATES)).toEqual<WarmupSet[]>([
      { weight: 20, reps: 10 },
      { weight: 22.5, reps: 1 },
    ]);
  });

  it('20 kg (at the bar) with defaults -> []', () => {
    expect(warmupRamp(20, DEFAULT_PLATES)).toEqual([]);
  });

  it('below the bar or non-finite -> []', () => {
    expect(warmupRamp(15, DEFAULT_PLATES)).toEqual([]);
    expect(warmupRamp(NaN, DEFAULT_PLATES)).toEqual([]);
    expect(warmupRamp(Infinity, DEFAULT_PLATES)).toEqual([]);
  });

  it('40 kg with plates limited to [20, 10] -> 20x10 only (every step rounds down to the bar and is dropped)', () => {
    expect(warmupRamp(40, { barKg: 20, plates: [20, 10] })).toEqual<WarmupSet[]>([{ weight: 20, reps: 10 }]);
  });

  it('honours custom steps and drops a step that does not clear the previous one', () => {
    const result = warmupRamp(100, { ...DEFAULT_PLATES, steps: [[0.5, 5], [0.5, 5], [0.9, 1]] });
    // Second 0.5 step (also 50 kg) is dropped: it is not above the previous kept step.
    expect(result).toEqual<WarmupSet[]>([
      { weight: 20, reps: 10 },
      { weight: 50, reps: 5 },
      { weight: 90, reps: 1 },
    ]);
  });
});

describe('genericWarmupRamp', () => {
  it('100 kg, 2.5 kg increment -> 50x5, 70x3, 90x1, with no empty-bar first step', () => {
    expect(genericWarmupRamp(100, 2.5)).toEqual<WarmupSet[]>([
      { weight: 50, reps: 5 },
      { weight: 70, reps: 3 },
      { weight: 90, reps: 1 },
    ]);
  });

  it('60 kg, 2.5 kg increment -> 30x5, 42.5x3 (0.7x60=42, 16.8 rounds up to 17 steps of 2.5), 55x1', () => {
    expect(genericWarmupRamp(60, 2.5)).toEqual<WarmupSet[]>([
      { weight: 30, reps: 5 },
      { weight: 42.5, reps: 3 },
      { weight: 55, reps: 1 },
    ]);
  });

  it('rounds every step to the exercise increment, not a plate set', () => {
    expect(genericWarmupRamp(20, 5)).toEqual<WarmupSet[]>([
      { weight: 10, reps: 5 },
      { weight: 15, reps: 3 },
      { weight: 20, reps: 1 },
    ]);
  });

  it('drops a step that rounds to 0 or does not clear the previous one', () => {
    // 0.5x3=1.5 and 0.7x3=2.1 both round to 0 and are dropped; 0.9x3=2.7 rounds to 1x5=5.
    expect(genericWarmupRamp(3, 5)).toEqual<WarmupSet[]>([{ weight: 5, reps: 1 }]);
    // 0.7x100=70 rounds to 50 (a 50 kg increment), which does not clear the 50 kg first step.
    expect(genericWarmupRamp(100, 50)).toEqual<WarmupSet[]>([
      { weight: 50, reps: 5 },
      { weight: 100, reps: 1 },
    ]);
  });

  it('a non-finite or non-positive increment falls back to 2.5 kg', () => {
    expect(genericWarmupRamp(50, 0)).toEqual<WarmupSet[]>([
      { weight: 25, reps: 5 },
      { weight: 35, reps: 3 },
      { weight: 45, reps: 1 },
    ]);
    expect(genericWarmupRamp(50, NaN)).toEqual(genericWarmupRamp(50, 0));
  });

  it('0, negative or non-finite working weight -> []', () => {
    expect(genericWarmupRamp(0, 2.5)).toEqual([]);
    expect(genericWarmupRamp(-10, 2.5)).toEqual([]);
    expect(genericWarmupRamp(NaN, 2.5)).toEqual([]);
    expect(genericWarmupRamp(Infinity, 2.5)).toEqual([]);
  });
});
