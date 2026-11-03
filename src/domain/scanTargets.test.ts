import { describe, expect, it } from 'vitest';
import { activityFactor, leanMassOf, scanTargetLines, scanTargets } from './scanTargets';
import type { BodyScan } from './types';

const scan = (over: Partial<BodyScan> = {}): BodyScan => ({ id: 's', date: '2026-11-01', source: 'csv', importedAt: '2026-11-01T09:00:00Z', ...over });
const SETTINGS = { weeklySessionTarget: 4, weeklyGainTargetMin: 0.25, weeklyGainTargetMax: 0.5 };

describe('lean mass', () => {
  it('is the measured figure, else weight less fat mass, else weight less its body fat share', () => {
    expect(leanMassOf({ leanMassKg: 66.2, weightKg: 82, bodyFatKg: 15 })).toBe(66.2);
    expect(leanMassOf({ weightKg: 82, bodyFatKg: 15 })).toBe(67);
    expect(leanMassOf({ weightKg: 80, bodyFatPct: 20 })).toBe(64);
    expect(leanMassOf({ weightKg: 80 })).toBeUndefined();
  });
});

describe('targets from a scan', () => {
  it('sets protein from lean mass and calories from BMR, training days and the gain wanted', () => {
    const t = scanTargets(scan({ weightKg: 82, bodyFatKg: 15.8, leanMassKg: 66.2, bmrKcal: 1800 }), SETTINGS);
    // 2.5 × 66.2 = 165.5 → 165 g.
    expect(t.protein).toEqual({ grams: 165, leanKg: 66.2 });
    // 1,800 × 1.55 = 2,790 to maintain; 0.375 kg a week × 7,700 / 7 = 412.5 → +410; 3,200 → 3,200 kcal.
    expect(t.calories).toEqual({ kcal: 3200, bmr: 1800, factor: 1.55, sessions: 4, maintenance: 2790, surplus: 410, gain: [0.25, 0.5] });
    expect(scanTargetLines(t)).toEqual([
      '≈3,200 kcal: BMR 1,800 × 1.55 (4 sessions a week) = 2,790 to maintain, + 410 for gaining 0.25–0.5 kg a week',
      '165 g protein: 2.5 g per kg of lean mass (66.2 kg)',
    ]);
  });

  it('takes the activity factor from the sessions a week aimed for', () => {
    expect([1, 2, 3, 4, 5, 7].map(activityFactor)).toEqual([1.375, 1.375, 1.55, 1.55, 1.725, 1.725]);
  });

  it('offers no calories without a BMR, and no protein without a way to lean mass', () => {
    expect(scanTargets(scan({ weightKg: 82, bodyFatPct: 18 }), SETTINGS)).toEqual({ protein: { grams: 170, leanKg: 67.2 }, calories: null });
    expect(scanTargets(scan({ bmrKcal: 1700 }), SETTINGS).protein).toBeNull();
  });

  it('takes a weight-loss goal off maintenance, and says so', () => {
    const t = scanTargets(scan({ leanMassKg: 60, bmrKcal: 1700 }), { weeklySessionTarget: 3, weeklyGainTargetMin: -0.5, weeklyGainTargetMax: -0.25 });
    expect(t.calories).toMatchObject({ maintenance: 2635, surplus: -410, kcal: 2250 });
    expect(scanTargetLines(t)[0]).toBe('≈2,250 kcal: BMR 1,700 × 1.55 (3 sessions a week) = 2,635 to maintain, − 410 for losing 0.25–0.5 kg a week');
  });
});
