import { describe, expect, it } from 'vitest';
import { countedSets, mondayOf, muscleRecency, sessionVolume, weeklySetsByMuscle } from './volume';

describe('sessionVolume', () => {
  it('sums weight×reps over everything but warm-ups', () => {
    const sets = [
      { type: 'warmup' as const, weight: 40, reps: 10 },
      { type: 'working' as const, weight: 100, reps: 5 },
      { type: 'failure' as const, weight: 100, reps: 6 },
      { type: 'drop' as const, weight: 80, reps: 8 },
    ];
    // 100*5 + 100*6 + 80*8 = 500 + 600 + 640 = 1740 (warm-up excluded)
    expect(sessionVolume(sets)).toBe(1740);
  });

  it('a warm-up-only session has zero volume, not a missing figure that could be misread', () => {
    expect(sessionVolume([{ type: 'warmup', weight: 100, reps: 10 }])).toBe(0);
  });

  it('a set with no reps contributes nothing', () => {
    expect(sessionVolume([{ type: 'working', weight: 100 }])).toBe(0);
  });
});

describe('countedSets', () => {
  it('counts only working and failure sets', () => {
    const sets = [{ type: 'warmup' as const }, { type: 'working' as const }, { type: 'drop' as const }, { type: 'failure' as const }];
    expect(countedSets(sets)).toBe(2);
  });
});

describe('mondayOf', () => {
  it('is itself for a Monday', () => {
    expect(mondayOf('2026-03-02')).toBe('2026-03-02'); // 2026-03-02 is a Monday
  });

  it('goes back to Monday for any day of that week', () => {
    expect(mondayOf('2026-03-04')).toBe('2026-03-02'); // Wednesday
    expect(mondayOf('2026-03-08')).toBe('2026-03-02'); // Sunday
  });

  it('rolls over a month boundary', () => {
    expect(mondayOf('2026-03-01')).toBe('2026-02-23'); // Sunday 1 March -> Monday 23 Feb
  });
});

describe('weeklySetsByMuscle', () => {
  const weekStart = '2026-03-02'; // Monday

  it('counts sets within the local week, excluding warm-ups', () => {
    const rows = [
      { muscleGroup: 'chest' as const, type: 'working' as const, completedAt: '2026-03-02T18:00:00.000Z' },
      { muscleGroup: 'chest' as const, type: 'warmup' as const, completedAt: '2026-03-02T18:00:00.000Z' },
      { muscleGroup: 'chest' as const, type: 'drop' as const, completedAt: '2026-03-05T18:00:00.000Z' },
      { muscleGroup: 'quads' as const, type: 'working' as const, completedAt: '2026-03-08T18:00:00.000Z' }, // Sunday, same week
    ];
    expect(weeklySetsByMuscle(rows, weekStart)).toEqual({ chest: 2, quads: 1 });
  });

  it('excludes sets from a different week', () => {
    const rows = [{ muscleGroup: 'chest' as const, type: 'working' as const, completedAt: '2026-03-09T18:00:00.000Z' }];
    expect(weeklySetsByMuscle(rows, weekStart)).toEqual({});
  });

  it('a muscle group with no sets that week is absent, not zero', () => {
    const rows = [{ muscleGroup: 'chest' as const, type: 'working' as const, completedAt: '2026-03-02T18:00:00.000Z' }];
    const result = weeklySetsByMuscle(rows, weekStart);
    expect(result.chest).toBe(1);
    expect('quads' in result).toBe(false);
  });

  it('counts a late-night set to its local day, not the UTC day', () => {
    // 00:20 local in a UTC+... offset could land on the previous UTC day or vice versa; what
    // matters is it is attributed using the local-day helper, not a raw string slice of the ISO.
    const rows = [{ muscleGroup: 'chest' as const, type: 'working' as const, completedAt: '2026-03-02T00:20:00' }];
    // No 'Z' means the Date constructor parses this as local time already, landing in week weekStart.
    expect(weeklySetsByMuscle(rows, weekStart)).toEqual({ chest: 1 });
  });
});

describe('muscleRecency', () => {
  it('reports days since the most recent counted set', () => {
    const rows = [
      { muscleGroup: 'chest' as const, type: 'working' as const, completedAt: '2026-03-01T18:00:00' },
      { muscleGroup: 'chest' as const, type: 'working' as const, completedAt: '2026-03-04T18:00:00' },
      { muscleGroup: 'chest' as const, type: 'warmup' as const, completedAt: '2026-03-08T18:00:00' },
    ];
    expect(muscleRecency(rows, '2026-03-09')).toEqual({ chest: 5 });
  });

  it('is absent for a muscle group never trained', () => {
    const rows = [{ muscleGroup: 'chest' as const, type: 'working' as const, completedAt: '2026-03-01T18:00:00' }];
    const result = muscleRecency(rows, '2026-03-05');
    expect('quads' in result).toBe(false);
  });

  it('is zero for a set trained today', () => {
    const rows = [{ muscleGroup: 'chest' as const, type: 'working' as const, completedAt: '2026-03-05T18:00:00' }];
    expect(muscleRecency(rows, '2026-03-05')).toEqual({ chest: 0 });
  });
});
