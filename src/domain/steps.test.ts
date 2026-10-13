import { describe, expect, it } from 'vitest';
import { cleanStepGoal, dailySteps, DEFAULT_STEP_GOAL, stepWeek, type StepRecord } from './steps';

const at = (day: number, h: number) => new Date(2026, 9, day, h, 0).toISOString();
const rec = (day: number, h: number, value: number, sourceId = 'com.sec.android.app.shealth'): StepRecord => ({ value, startDate: at(day, h), sourceId });

describe('dailySteps', () => {
  it('adds up one source\'s records per local day, oldest first, with null for a day with nothing', () => {
    const days = dailySteps([rec(13, 8, 1200), rec(13, 12, 3000), rec(12, 18, 5000)], '2026-10-13', 3);
    expect(days).toEqual([
      { date: '2026-10-11', steps: null },
      { date: '2026-10-12', steps: 5000 },
      { date: '2026-10-13', steps: 4200 },
    ]);
  });

  it('takes the larger source on a day two apps both recorded, never the sum', () => {
    const days = dailySteps([rec(13, 9, 6000, 'phone'), rec(13, 9, 5800, 'watch'), rec(13, 15, 400, 'watch')], '2026-10-13', 1);
    expect(days[0].steps).toBe(6200);
  });

  it('ignores records outside the window and malformed ones', () => {
    const days = dailySteps([rec(1, 9, 9999), { value: Number.NaN, startDate: at(13, 9) }, { value: 50, startDate: 'not a date' }, rec(13, 9, 10)], '2026-10-13', 7);
    expect(days.at(-1)!.steps).toBe(10);
    expect(days.filter((d) => d.steps !== null)).toHaveLength(1);
  });
});

describe('stepWeek', () => {
  it('averages over recorded days only and counts goal hits', () => {
    const w = stepWeek(
      [
        { date: '2026-10-11', steps: null },
        { date: '2026-10-12', steps: 9000 },
        { date: '2026-10-13', steps: 5000 },
      ],
      8000,
    );
    expect(w).toMatchObject({ today: 5000, total: 14000, average: 7000, recordedDays: 2, goalHit: 1, goal: 8000 });
  });

  it('has no average and no today when nothing was recorded', () => {
    const w = stepWeek([{ date: '2026-10-13', steps: null }], 8000);
    expect(w.average).toBeNull();
    expect(w.today).toBeNull();
    expect(w.total).toBe(0);
  });
});

describe('cleanStepGoal', () => {
  it('holds a goal to range as a whole number', () => {
    expect(cleanStepGoal(7849.4)).toBe(7849);
    expect(cleanStepGoal(50)).toBe(1000);
    expect(cleanStepGoal(999999)).toBe(50000);
    expect(cleanStepGoal(null)).toBe(DEFAULT_STEP_GOAL);
  });
});
