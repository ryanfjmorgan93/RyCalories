import { describe, expect, it } from 'vitest';
import { averagesAreMeaningful, coverage, dayRange, summarise, type DayRecord } from './trends';

function day(date: string, over: Partial<DayRecord> = {}): DayRecord {
  return { date, trained: false, ...over };
}

describe('the day range', () => {
  it('is inclusive at both ends', () => {
    expect(dayRange('2026-03-01', '2026-03-04')).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']);
  });

  it('is a single day when both ends are the same', () => {
    expect(dayRange('2026-03-01', '2026-03-01')).toEqual(['2026-03-01']);
  });

  it('is empty when the end is before the start', () => {
    expect(dayRange('2026-03-04', '2026-03-01')).toEqual([]);
  });
});

describe('averages exclude the days with nothing logged', () => {
  // The reason this module exists: counting a blank day as zero produces a figure that is not
  // imprecise but false, and it would be read as evidence for eating more.
  const week = [
    day('2026-03-01', { kcal: 3000, protein: 180, kcalTarget: 2800, proteinTarget: 170 }),
    day('2026-03-02', { kcal: 2600, protein: 150, kcalTarget: 2800, proteinTarget: 170 }),
    day('2026-03-03'),
    day('2026-03-04'),
    day('2026-03-05', { kcal: 2800, protein: 200, kcalTarget: 2800, proteinTarget: 170 }),
  ];

  it('averages over the logged days only', () => {
    const t = summarise(week);
    expect(t.kcal.value).toBeCloseTo(2800, 6);
    expect(t.kcal.days).toBe(3);
    expect(t.kcal.outOf).toBe(5);
  });

  it('would have reported nonsense had it counted the blanks', () => {
    // 8400 / 5 = 1680, which is not what was eaten on any day of that week.
    expect(summarise(week).kcal.value).not.toBeCloseTo(1680, 6);
  });

  it('averages the target over the same days, so the two figures are comparable', () => {
    const t = summarise(week);
    expect(t.kcalTarget.value).toBeCloseTo(2800, 6);
    expect(t.kcalTarget.days).toBe(3);
  });

  it('treats a logged zero as logged', () => {
    // A fast is a fact about the day; a blank is an absence of one.
    const t = summarise([day('2026-03-01', { kcal: 0, protein: 0 }), day('2026-03-02', { kcal: 2000, protein: 100 })]);
    expect(t.kcal.value).toBe(1000);
    expect(t.kcal.days).toBe(2);
    expect(t.loggedDays).toBe(2);
  });

  it('reports nothing rather than zero when the window is empty', () => {
    const t = summarise([day('2026-03-01'), day('2026-03-02')]);
    expect(t.kcal.value).toBeNull();
    expect(t.kcal.days).toBe(0);
    expect(t.loggedDays).toBe(0);
  });

  it('copes with no days at all', () => {
    const t = summarise([]);
    expect(t.kcal.value).toBeNull();
    expect(t.sessionsPerWeek).toBe(0);
    expect(coverage(t)).toBe(0);
  });
});

describe('protein against its target', () => {
  it('counts only the days that had both a figure and a target', () => {
    const t = summarise([
      day('2026-03-01', { protein: 180, proteinTarget: 170 }),
      day('2026-03-02', { protein: 150, proteinTarget: 170 }),
      day('2026-03-03', { protein: 200 }),
      day('2026-03-04'),
    ]);
    expect(t.proteinHit).toEqual({ days: 1, outOf: 2 });
  });

  it('counts hitting the target exactly as hitting it', () => {
    expect(summarise([day('2026-03-01', { protein: 170, proteinTarget: 170 })]).proteinHit).toEqual({ days: 1, outOf: 1 });
  });
});

describe('training frequency', () => {
  it('is per week, whatever the window length', () => {
    const fortnight = dayRange('2026-03-01', '2026-03-14').map((d, i) => day(d, { trained: i % 2 === 0 }));
    const t = summarise(fortnight);
    expect(t.sessions).toBe(7);
    expect(t.sessionsPerWeek).toBeCloseTo(3.5, 6);
  });

  it('is zero for a window with no training', () => {
    expect(summarise(dayRange('2026-03-01', '2026-03-07').map((d) => day(d))).sessionsPerWeek).toBe(0);
  });
});

describe('whether an average is worth showing', () => {
  it('says no when most of the window is blank', () => {
    // An average of two days out of twenty-eight describes those two days, not the month.
    const month = dayRange('2026-03-01', '2026-03-28').map((d, i) => day(d, i < 2 ? { kcal: 2500 } : {}));
    const t = summarise(month);
    expect(t.kcal.value).toBe(2500);
    expect(averagesAreMeaningful(t)).toBe(false);
  });

  it('says yes once most of the window is logged', () => {
    const week = dayRange('2026-03-01', '2026-03-07').map((d, i) => day(d, i < 5 ? { kcal: 2500 } : {}));
    expect(averagesAreMeaningful(summarise(week))).toBe(true);
  });

  it('says no when nothing at all was logged', () => {
    expect(averagesAreMeaningful(summarise([day('2026-03-01')]))).toBe(false);
  });
});

describe('the window it reports on', () => {
  it('runs from the earliest day to the latest, whatever order they arrive in', () => {
    const t = summarise([day('2026-03-05'), day('2026-03-01'), day('2026-03-03')]);
    expect([t.from, t.to]).toEqual(['2026-03-01', '2026-03-05']);
    expect(t.days.map((d) => d.date)).toEqual(['2026-03-01', '2026-03-03', '2026-03-05']);
  });
});
