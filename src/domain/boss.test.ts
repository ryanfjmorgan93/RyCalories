import { describe, expect, it } from 'vitest';
import { attackFor, bossHealth, pickBoss, type BossSet, type Candidate } from './boss';

describe('attackFor', () => {
  it('attacks with the fewest reps in range that beat the boss', () => {
    // 85 × 5 is 99.17; at 82.5, × 6 is 99.0 (short), × 7 is 101.75.
    expect(attackFor({ weight: 85, reps: 5 }, { weight: 82.5, repMin: 6, repMax: 8 })).toEqual({ weight: 82.5, reps: 7 });
    expect(attackFor({ weight: 85, reps: 5 }, { weight: 70, repMin: 6, repMax: 8 })).toBeNull();
    // A tie is not a win: 90 × 10 and 100 × 6 are both a size of 120.
    expect(attackFor({ weight: 90, reps: 10 }, { weight: 100, repMin: 6, repMax: 6 })).toBeNull();
  });
});

describe('pickBoss', () => {
  it('picks the hardest fight the plan still wins, by name on a tie, never a lift already bossed', () => {
    const c = (exerciseId: string, name: string, best: BossSet, weight: number): Candidate => ({
      exerciseId,
      name,
      best,
      plan: { routineId: 'r', routineName: 'R', weight, repMin: 6, repMax: 8 },
    });
    const bench = c('b', 'Bench', { weight: 85, reps: 5 }, 82.5); // 101.75 vs 99.17: +2.6%
    const squat = c('s', 'Squat', { weight: 100, reps: 5 }, 100); // 120 vs 116.67: +2.9%
    expect(pickBoss([squat, bench], new Set())!.exerciseId).toBe('b');
    expect(pickBoss([squat, bench], new Set(['b']))!.exerciseId).toBe('s');
    expect(pickBoss([c('z', 'Zed', bench.best, 82.5), c('a', 'Abs', bench.best, 82.5)], new Set())!.name).toBe('Abs');
    expect(pickBoss([c('x', 'X', { weight: 85, reps: 5 }, 60)], new Set())).toBeNull();
  });
});

describe('bossHealth', () => {
  it('moves health only when a set gets closer, and never reads 0 unless beaten', () => {
    const boss = { weight: 100, reps: 5 }; // 116.67
    expect(bossHealth(boss, 110, null, false)).toBe(100);
    expect(bossHealth(boss, 110, 109, false)).toBe(100);
    expect(bossHealth(boss, 110, 113.33, false)).toBe(51); // (116.67 − 113.33) ÷ 6.67 = 50.0…% rounded up
    expect(bossHealth(boss, 110, 116.67, false)).toBe(1);
    expect(bossHealth(boss, null, 110, false)).toBe(58); // floor 105: (116.67 − 110) ÷ 11.67
    expect(bossHealth(boss, 120, 110, false)).toBe(58); // a floor not below the boss falls back to 90%
    expect(bossHealth(boss, 110, 120, true)).toBe(0);
  });
});
