import { describe, expect, it } from 'vitest';
import { isStaleSession, sessionAgeMs, startedHoursAgoLabel } from './session';

const START = '2026-09-29T08:00:00.000Z';
const at = (hoursAfter: number) => Date.parse(START) + hoursAfter * 3_600_000;

describe('sessionAgeMs', () => {
  it('is the milliseconds between the start and now', () => {
    expect(sessionAgeMs(START, at(0))).toBe(0);
    expect(sessionAgeMs(START, at(1.5))).toBe(5_400_000);
  });

  it('does not clamp a start time in the future', () => {
    expect(sessionAgeMs(START, at(-2))).toBe(-7_200_000);
  });

  it('is NaN for a start time that is not a date', () => {
    expect(sessionAgeMs('not a date', at(1))).toBeNaN();
  });
});

describe('isStaleSession', () => {
  it('is fresh just under eight hours and stale at exactly eight', () => {
    expect(isStaleSession(START, at(8) - 1)).toBe(false);
    expect(isStaleSession(START, at(8))).toBe(true);
    expect(isStaleSession(START, at(30))).toBe(true);
  });

  it('is fresh for an ordinary workout', () => {
    expect(isStaleSession(START, at(0))).toBe(false);
    expect(isStaleSession(START, at(1.25))).toBe(false);
  });

  it('takes the threshold as a parameter', () => {
    expect(isStaleSession(START, at(3), 2)).toBe(true);
    expect(isStaleSession(START, at(3), 4)).toBe(false);
  });

  it('is never stale for a future or unreadable start time', () => {
    expect(isStaleSession(START, at(-1))).toBe(false);
    expect(isStaleSession('not a date', at(100))).toBe(false);
  });
});

describe('startedHoursAgoLabel', () => {
  it('counts whole hours, rounding down', () => {
    expect(startedHoursAgoLabel(START, at(9))).toBe('Started 9 h ago');
    expect(startedHoursAgoLabel(START, at(9.99))).toBe('Started 9 h ago');
    expect(startedHoursAgoLabel(START, at(8))).toBe('Started 8 h ago');
    expect(startedHoursAgoLabel(START, at(26))).toBe('Started 26 h ago');
  });
});
