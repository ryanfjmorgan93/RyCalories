import { describe, expect, it } from 'vitest';
import { hasNoExercises } from './schedule';

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
