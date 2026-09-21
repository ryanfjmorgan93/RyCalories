import { describe, expect, it } from 'vitest';
import { stepValue } from './NumberField';

describe('stepValue', () => {
  it('empty field, fallback 0: + steps off zero instead of landing on it', () => {
    // This is the exact shape of the weight field for a calibrating exercise
    // (LiveSessionScreen passes fallback={0}) — the bug this guards against.
    expect(stepValue(null, 1, 2.5, 0, 9999, 0)).toBe(2.5);
  });

  it('empty field, fallback 0: − also steps off zero, clamped at the floor', () => {
    expect(stepValue(null, -1, 2.5, 0, 9999, 0)).toBe(0);
    // With a negative floor available, − actually moves.
    expect(stepValue(null, -1, 2.5, -10, 9999, 0)).toBe(-2.5);
  });

  it('empty field, no explicit fallback: min doubles as the fallback, same zero rule', () => {
    expect(stepValue(null, 1, 2.5, 0, 9999)).toBe(2.5);
  });

  it('empty field, non-zero fallback: first tap lands exactly on the fallback, no step applied', () => {
    // e.g. an empty rep field with fallback = repMin.
    expect(stepValue(null, 1, 1, 0, 50, 8)).toBe(8);
    expect(stepValue(null, -1, 1, 0, 50, 8)).toBe(8);
  });

  it('non-empty field: steps by `step` in the given direction as normal', () => {
    expect(stepValue(50, 1, 2.5, 0, 9999)).toBe(52.5);
    expect(stepValue(50, -1, 2.5, 0, 9999)).toBe(47.5);
  });

  it('clamps to max when stepping up past it', () => {
    expect(stepValue(9, 1, 2.5, 0, 10)).toBe(10);
  });

  it('clamps to min when stepping down past it', () => {
    expect(stepValue(1, -1, 2.5, 0, 10)).toBe(0);
  });

  it('rounds to 2 decimal places to avoid float noise', () => {
    expect(stepValue(0.1, 1, 0.2, 0, 10)).toBe(0.3);
  });
});
