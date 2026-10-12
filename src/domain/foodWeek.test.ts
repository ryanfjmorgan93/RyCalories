import { describe, expect, it } from 'vitest';
import { weekStrip, weekdayLetter } from './foodWeek';
import type { DayRecord } from './trends';

const day = (date: string, over: Partial<DayRecord> = {}): DayRecord => ({ date, trained: false, ...over });

describe('weekStrip', () => {
  it('shows a day with nothing logged as unlogged — never as zero', () => {
    const [d] = weekStrip([day('2026-10-12', { kcalTarget: 2000 })]);
    expect(d).toMatchObject({ state: 'unlogged', heightPct: 0 });
    expect(d).not.toHaveProperty('kcal');
  });

  it('keeps a day logged at zero apart from a day not logged at all', () => {
    const [zero, none] = weekStrip([day('2026-10-11', { kcal: 0, kcalTarget: 2000 }), day('2026-10-12', { kcalTarget: 2000 })]);
    expect(zero!.state).toBe('within');
    expect(none!.state).toBe('unlogged');
  });

  it('shows a day over its target as over, with by how much', () => {
    const [d] = weekStrip([day('2026-10-12', { kcal: 2400, kcalTarget: 1900 })]);
    expect(d).toMatchObject({ state: 'over', overBy: 500, kcal: 2400, target: 1900 });
  });

  it('shows a day on or under target as within', () => {
    const days = weekStrip([day('2026-10-10', { kcal: 1900, kcalTarget: 1900 }), day('2026-10-11', { kcal: 1500, kcalTarget: 1900 })]);
    expect(days.map((d) => d.state)).toEqual(['within', 'within']);
  });

  it('says so when a logged day had no target', () => {
    const [d] = weekStrip([day('2026-10-12', { kcal: 1800 })]);
    expect(d).toMatchObject({ state: 'no-target', kcal: 1800 });
    expect(d).not.toHaveProperty('targetPct');
  });

  it('draws every bar and target line on one scale, so an over day is its real height', () => {
    const days = weekStrip([
      day('2026-10-10', { kcal: 1000, kcalTarget: 2000 }),
      day('2026-10-11', { kcal: 3000, kcalTarget: 2000 }),
    ]);
    expect(days[1]!.heightPct).toBe(100);
    expect(days[0]!.heightPct).toBeCloseTo(33.33, 1);
    expect(days[1]!.targetPct).toBeCloseTo(66.67, 1);
  });

  it('copes with a week of nothing', () => {
    const days = weekStrip([day('2026-10-11'), day('2026-10-12')]);
    expect(days.every((d) => d.state === 'unlogged' && d.heightPct === 0)).toBe(true);
  });
});

describe('weekdayLetter', () => {
  it('is one letter, Monday to Sunday', () => {
    expect(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map(weekdayLetter)).toEqual([
      'M',
      'T',
      'W',
      'T',
      'F',
      'S',
      'S',
    ]);
  });
});
