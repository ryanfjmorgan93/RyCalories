import { describe, expect, it } from 'vitest';
import { bandStatus, weeklyDelta } from './bodyweight';
import { addDays, daysBetween, toDateKey } from './dates';
import { calorieTargetOn, proteinTarget } from './nutrition';
import { isConsecutiveLower, suggestNextRoutine } from './schedule';
import type { Bodyweight, Routine } from './types';

const routines: Routine[] = [
  { id: 'hinge', name: 'Lower (Hinge)', order: 0, isLowerBody: true },
  { id: 'push', name: 'Upper (Push)', order: 1, isLowerBody: false },
  { id: 'squat', name: 'Lower (Squat)', order: 2, isLowerBody: true },
  { id: 'pull', name: 'Upper (Pull)', order: 3, isLowerBody: false },
  { id: 'day5', name: 'Arms (Day 5)', order: 4, isLowerBody: false },
];

describe('next routine suggestion', () => {
  it('suggests the first routine when nothing has been done', () => {
    expect(suggestNextRoutine(routines, null)?.id).toBe('hinge');
  });
  it('suggests the next in order after the last completed one', () => {
    expect(suggestNextRoutine(routines, 'hinge')?.id).toBe('push');
    expect(suggestNextRoutine(routines, 'pull')?.id).toBe('day5');
  });
  it('wraps round after the last routine', () => {
    expect(suggestNextRoutine(routines, 'day5')?.id).toBe('hinge');
  });
  it('ignores archived routines and unknown ids', () => {
    const withArchived = [...routines, { id: 'old', name: 'Old', order: 5, isLowerBody: false, archived: true }];
    expect(suggestNextRoutine(withArchived, 'day5')?.id).toBe('hinge');
    expect(suggestNextRoutine(routines, 'nope')?.id).toBe('hinge');
    expect(suggestNextRoutine([], null)).toBeNull();
  });
  it('avoids two lower-body days in a row when asked (§8)', () => {
    const reordered: Routine[] = [
      { id: 'hinge', name: 'Hinge', order: 0, isLowerBody: true },
      { id: 'squat', name: 'Squat', order: 1, isLowerBody: true },
      { id: 'push', name: 'Push', order: 2, isLowerBody: false },
    ];
    expect(suggestNextRoutine(reordered, 'hinge')?.id).toBe('squat');
    expect(suggestNextRoutine(reordered, 'hinge', { avoidConsecutiveLower: true })?.id).toBe('push');
    const allLower = reordered.map((r) => ({ ...r, isLowerBody: true }));
    expect(suggestNextRoutine(allLower, 'hinge', { avoidConsecutiveLower: true })?.id).toBe('squat');
  });
  it('flags a lower day picked straight after a lower day', () => {
    expect(isConsecutiveLower(routines, 'hinge', 'squat')).toBe(true);
    expect(isConsecutiveLower(routines, 'hinge', 'push')).toBe(false);
    expect(isConsecutiveLower(routines, null, 'squat')).toBe(false);
  });
});

describe('dates', () => {
  it('formats local date keys and does whole-day arithmetic', () => {
    expect(toDateKey(new Date(2026, 8, 8, 23, 59))).toBe('2026-09-08');
    expect(addDays('2026-09-08', 14)).toBe('2026-09-22');
    expect(daysBetween('2026-09-08', '2026-09-22')).toBe(14);
    expect(daysBetween('2026-09-22', '2026-09-08')).toBe(-14);
  });
});

describe('reverse-diet stepper (§9)', () => {
  const s = { calorieStart: 1900, calorieStep: 200, calorieStepDays: 14, calorieCeiling: 3000, calorieStartDate: '2026-09-08' };
  it('is null until a start date exists', () => {
    expect(calorieTargetOn('2026-09-08', { ...s, calorieStartDate: undefined })).toBeNull();
  });
  it('starts at 1,900 and steps +200 every 14 days', () => {
    expect(calorieTargetOn('2026-09-08', s)?.kcal).toBe(1900);
    expect(calorieTargetOn('2026-09-21', s)?.kcal).toBe(1900);
    expect(calorieTargetOn('2026-09-22', s)?.kcal).toBe(2100);
    expect(calorieTargetOn('2026-10-06', s)?.kcal).toBe(2300);
    expect(calorieTargetOn('2026-09-08', s)?.nextStepOn).toBe('2026-09-22');
    expect(calorieTargetOn('2026-09-21', s)?.daysUntilNextStep).toBe(1);
  });
  it('caps at the ceiling', () => {
    const late = calorieTargetOn('2027-09-08', s);
    expect(late?.kcal).toBe(3000);
    expect(late?.nextStepOn).toBeNull();
  });
  it('protein is 170 g, 200 g on lower-body days', () => {
    const p = { proteinTarget: 170, proteinTargetLegDay: 200 };
    expect(proteinTarget(p, false)).toBe(170);
    expect(proteinTarget(p, true)).toBe(200);
  });
});

describe('bodyweight weekly delta (§10.6)', () => {
  const bw = (date: string, kg: number): Bodyweight => ({ id: date, date, kg });
  it('needs at least two readings', () => {
    expect(weeklyDelta([bw('2026-09-08', 74)], '2026-09-08')).toBeNull();
  });
  it('compares 7-day rolling averages when both windows have readings', () => {
    const entries = [
      bw('2026-08-26', 73.8),
      bw('2026-08-28', 74.0),
      bw('2026-08-30', 74.2),
      bw('2026-09-02', 74.3),
      bw('2026-09-05', 74.4),
      bw('2026-09-08', 74.6),
    ];
    const d = weeklyDelta(entries, '2026-09-08');
    expect(d?.method).toBe('avg');
    // current window 2 Sep–8 Sep: 74.3, 74.4, 74.6 → 74.43 ; previous 26 Aug–1 Sep: 73.8, 74.0, 74.2 → 74.0
    expect(d?.deltaKg).toBeCloseTo(0.43, 2);
  });
  it('falls back to two readings a week apart', () => {
    const d = weeklyDelta([bw('2026-09-03', 74), bw('2026-09-08', 74.5)], '2026-09-08');
    expect(d?.method).toBe('points');
    expect(d?.deltaKg).toBeCloseTo(0.7, 2);
  });
  it('scales point-to-point to a weekly rate', () => {
    const d = weeklyDelta([bw('2026-08-25', 74), bw('2026-09-08', 75)], '2026-09-08');
    expect(d?.deltaKg).toBeCloseTo(0.5, 2);
  });
  it('classifies against the target band', () => {
    expect(bandStatus(0.1, 0.25, 0.5)).toBe('below');
    expect(bandStatus(0.3, 0.25, 0.5)).toBe('in');
    expect(bandStatus(0.8, 0.25, 0.5)).toBe('above');
  });
});
