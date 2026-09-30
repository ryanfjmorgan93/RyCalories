import { describe, expect, it } from 'vitest';
import { hasNoExercises, isConsecutiveLower, suggestNextRoutine } from './schedule';
import type { Routine } from './types';

describe('hasNoExercises', () => {
  it('is true for a routine that is absent from loaded counts (no rows) or counted at zero', () => {
    expect(hasNoExercises(new Map([['a', 4]]), 'empty')).toBe(true);
    expect(hasNoExercises(new Map([['empty', 0]]), 'empty')).toBe(true);
  });

  it('is false for a routine with at least one exercise', () => {
    expect(hasNoExercises(new Map([['a', 1]]), 'a')).toBe(false);
    expect(hasNoExercises(new Map([['a', 4]]), 'a')).toBe(false);
  });

  it('judges nothing while the counts are still loading', () => {
    expect(hasNoExercises(undefined, 'a')).toBe(false);
  });
});

describe('lastWasLower: a last session whose routine is in no list', () => {
  const week: Routine[] = [
    { id: 'hinge', name: 'Lower (Hinge)', order: 0, isLowerBody: true },
    { id: 'push', name: 'Upper (Push)', order: 1, isLowerBody: false },
    { id: 'squat', name: 'Lower (Squat)', order: 2, isLowerBody: true },
    { id: 'pull', name: 'Upper (Pull)', order: 3, isLowerBody: false },
  ];

  it('a lower last session skips the next lower routine even though the rotation names an upper one', () => {
    // The rotation stands on Push; the true last session was a hidden lower one.
    expect(suggestNextRoutine(week, 'push', { avoidConsecutiveLower: true })?.id).toBe('squat');
    expect(suggestNextRoutine(week, 'push', { avoidConsecutiveLower: true, lastWasLower: true })?.id).toBe('pull');
  });

  it('an upper last session lifts a guard the list would have applied', () => {
    expect(suggestNextRoutine(week, 'hinge', { avoidConsecutiveLower: true })?.id).toBe('push');
    const twoLower: Routine[] = [week[0], { id: 'squat', name: 'Lower (Squat)', order: 1, isLowerBody: true }, week[1]];
    expect(suggestNextRoutine(twoLower, 'hinge', { avoidConsecutiveLower: true })?.id).toBe('push');
    expect(suggestNextRoutine(twoLower, 'hinge', { avoidConsecutiveLower: true, lastWasLower: false })?.id).toBe('squat');
  });

  it('does nothing without avoidConsecutiveLower, and unset reads the list as before', () => {
    expect(suggestNextRoutine(week, 'push', { lastWasLower: true })?.id).toBe('squat');
    expect(suggestNextRoutine(week, 'hinge', { avoidConsecutiveLower: true, lastWasLower: undefined })?.id).toBe('push');
  });

  it('with no routine to continue from, the guard still applies to the first routine', () => {
    expect(suggestNextRoutine(week, null, { avoidConsecutiveLower: true, lastWasLower: true })?.id).toBe('push');
  });

  it('isConsecutiveLower answers for the last session when told, and from the list when not', () => {
    expect(isConsecutiveLower(week, 'push', 'squat')).toBe(false);
    expect(isConsecutiveLower(week, 'push', 'squat', { lastWasLower: true })).toBe(true);
    expect(isConsecutiveLower(week, 'push', 'pull', { lastWasLower: true })).toBe(false);
    expect(isConsecutiveLower(week, 'hinge', 'squat')).toBe(true);
    expect(isConsecutiveLower(week, 'hinge', 'squat', { lastWasLower: false })).toBe(false);
    expect(isConsecutiveLower(week, null, 'squat', { lastWasLower: true })).toBe(true);
    expect(isConsecutiveLower(week, null, 'squat')).toBe(false);
  });
});
