import { describe, expect, it } from 'vitest';
import { bestE1rm, e1rm, e1rmChange, e1rmFor } from './strength';

const DAY = 24 * 3600 * 1000;

describe('e1rm', () => {
  it('returns the weight itself at 1 rep', () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(100, 1, 'brzycki')).toBe(100);
  });

  it('estimates with Epley by default', () => {
    // 100 × (1 + 5/30) = 116.666...
    expect(e1rm(100, 5)).toBe(116.67);
  });

  it('estimates with Brzycki when asked', () => {
    // 100 × 36 / (37 - 5) = 112.5
    expect(e1rm(100, 5, 'brzycki')).toBe(112.5);
  });

  it('is null at 0 reps — a flattering number would invent a max from nothing', () => {
    expect(e1rm(100, 0)).toBeNull();
  });

  it('is null past 12 reps — the estimate is a guess by then, not a number', () => {
    expect(e1rm(100, 12)).not.toBeNull();
    expect(e1rm(100, 13)).toBeNull();
  });

  it('is null for negative or non-finite reps', () => {
    expect(e1rm(100, -1)).toBeNull();
    expect(e1rm(100, Number.NaN)).toBeNull();
  });
});

describe('e1rmFor exercise kind', () => {
  it('uses the weight as is for reps exercises', () => {
    expect(e1rmFor('reps', 100, 5)).toBe(e1rm(100, 5));
  });

  it('adds bodyweight for bodyweight_plus when supplied', () => {
    expect(e1rmFor('bodyweight_plus', 10, 5, { bodyweightKg: 80 })).toBe(e1rm(90, 5));
  });

  it('is null for bodyweight_plus without a bodyweight — added-kg alone understates the lift', () => {
    expect(e1rmFor('bodyweight_plus', 10, 5)).toBeNull();
  });

  it('is null for carry and timed exercises', () => {
    expect(e1rmFor('carry', 20, 5)).toBeNull();
    expect(e1rmFor('timed', 0, 5)).toBeNull();
  });

  it('is null when reps is not given', () => {
    expect(e1rmFor('reps', 100, undefined)).toBeNull();
  });
});

describe('bestE1rm', () => {
  it('picks the best estimate among sets that count for records', () => {
    const sets = [
      { type: 'warmup' as const, weight: 40, reps: 10 },
      { type: 'working' as const, weight: 100, reps: 5 },
      { type: 'working' as const, weight: 105, reps: 3 },
      { type: 'drop' as const, weight: 80, reps: 8 },
    ];
    expect(bestE1rm('reps', sets)).toBe(Math.max(e1rm(100, 5)!, e1rm(105, 3)!));
  });

  it('is null when no counted set yields an estimate', () => {
    expect(bestE1rm('carry', [{ type: 'working', weight: 20, reps: 5 }])).toBeNull();
    expect(bestE1rm('reps', [{ type: 'warmup', weight: 100, reps: 5 }])).toBeNull();
  });

  it('skips bodyweight_plus sets rather than reporting zero when bodyweight is missing', () => {
    const sets = [{ type: 'working' as const, weight: 10, reps: 5 }];
    expect(bestE1rm('bodyweight_plus', sets)).toBeNull();
    expect(bestE1rm('bodyweight_plus', sets, { bodyweightKg: 80 })).toBe(e1rm(90, 5));
  });
});

describe('e1rmChange', () => {
  it('is null with fewer than two points — one point has no change to report', () => {
    expect(e1rmChange([])).toBeNull();
    expect(e1rmChange([{ t: 0, y: 100 }])).toBeNull();
  });

  it('is covered and measures from the true base when a point at least 28 days old exists', () => {
    const series = [
      { t: 0, y: 100 },
      { t: 30 * DAY, y: 110 },
    ];
    const change = e1rmChange(series);
    expect(change).not.toBeNull();
    expect(change!.covered).toBe(true);
    expect(change!.delta).toBe(10);
    expect(change!.from).toBe(0);
    expect(change!.to).toBe(30 * DAY);
    expect(change!.spanDays).toBe(30);
  });

  it('is not covered when the whole history spans under 28 days — the true span, not the window', () => {
    const series = [
      { t: 0, y: 100 },
      { t: 2 * DAY, y: 105 },
    ];
    const change = e1rmChange(series);
    expect(change).not.toBeNull();
    expect(change!.covered).toBe(false);
    expect(change!.spanDays).toBe(2);
    expect(change!.delta).toBe(5);
    expect(change!.from).toBe(0);
  });

  it('picks the latest point at or before the cutoff as the base', () => {
    const series = [
      { t: 0, y: 100 },
      { t: 10 * DAY, y: 105 },
      { t: 40 * DAY, y: 120 },
    ];
    // last.t - 28 days = 12 days, so the point at 10 days (not 0) is the base.
    const change = e1rmChange(series);
    expect(change!.covered).toBe(true);
    expect(change!.from).toBe(10 * DAY);
    expect(change!.delta).toBe(15);
  });
});
