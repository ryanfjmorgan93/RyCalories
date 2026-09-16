import { describe, expect, it } from 'vitest';
import { calendarGrid, encouragement, streakWeeks, type CalendarSession } from './calendar';

function s(id: string, startedAt: string, over: Partial<CalendarSession> = {}): CalendarSession {
  return { id, startedAt, endedAt: startedAt, title: 'Session', ...over };
}

describe('calendarGrid', () => {
  it('is Monday-first and oldest week first, ending with the week containing today', () => {
    const grid = calendarGrid([], 2, '2026-03-04'); // Wednesday of week starting 2026-03-02
    expect(grid).toHaveLength(2);
    expect(grid[0][0].date).toBe('2026-02-23'); // Monday, oldest week
    expect(grid[1][0].date).toBe('2026-03-02'); // Monday, current week
    expect(grid[1][6].date).toBe('2026-03-08'); // Sunday, current week
  });

  it('includes days after today as empty, still part of the grid', () => {
    const grid = calendarGrid([], 1, '2026-03-04'); // Wednesday
    const friday = grid[0].find((d) => d.date === '2026-03-06');
    expect(friday?.sessions).toEqual([]);
  });

  it('only counts completed sessions — one with no endedAt never appears', () => {
    const sessions = [s('a', '2026-03-02T18:00:00.000Z'), s('b', '2026-03-02T19:00:00.000Z', { endedAt: undefined })];
    const grid = calendarGrid(sessions, 1, '2026-03-04');
    const monday = grid[0][0];
    expect(monday.sessions.map((x) => x.id)).toEqual(['a']);
  });

  it('groups multiple sessions on the same local day', () => {
    const sessions = [s('a', '2026-03-02T08:00:00'), s('b', '2026-03-02T18:00:00')];
    const grid = calendarGrid(sessions, 1, '2026-03-04');
    expect(grid[0][0].sessions.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('streakWeeks', () => {
  const target = 3;

  function weekSessions(monday: string, count: number): CalendarSession[] {
    return Array.from({ length: count }, (_, i) => s(`${monday}-${i}`, `${monday}T18:00:00`));
  }

  it('counts the current week once it meets target, ending today mid-week', () => {
    // Week of 2026-03-02 (Mon), today is Wednesday 2026-03-04, 3 sessions already logged this week.
    const sessions = weekSessions('2026-03-02', 3);
    expect(streakWeeks(sessions, target, '2026-03-04')).toBe(1);
  });

  it('does not count the current week until it meets target — falls back to the last full week', () => {
    // Current week (2026-03-02) has only 1 session so far; the prior full week met target.
    const sessions = [...weekSessions('2026-03-02', 1), ...weekSessions('2026-02-23', 3)];
    expect(streakWeeks(sessions, target, '2026-03-04')).toBe(1);
  });

  it('is zero when the latest relevant week is below target', () => {
    const sessions = weekSessions('2026-03-02', 1); // below target, and current week not yet met
    expect(streakWeeks(sessions, target, '2026-03-04')).toBe(0);
  });

  it('a week below target breaks the streak — earlier good weeks do not count through it', () => {
    const sessions = [
      ...weekSessions('2026-03-02', 3), // this week, meets target
      ...weekSessions('2026-02-23', 1), // prior week, below target — breaks it
      ...weekSessions('2026-02-16', 3), // meets target, but unreachable behind the break
    ];
    expect(streakWeeks(sessions, target, '2026-03-04')).toBe(1);
  });

  it('counts consecutive qualifying weeks', () => {
    const sessions = [
      ...weekSessions('2026-03-02', 3),
      ...weekSessions('2026-02-23', 3),
      ...weekSessions('2026-02-16', 4), // extra sets still count, no ceiling
    ];
    expect(streakWeeks(sessions, target, '2026-03-04')).toBe(3);
  });

  it('never counts a future week', () => {
    const sessions = weekSessions('2026-03-09', 5); // next week, in the future relative to today
    expect(streakWeeks(sessions, target, '2026-03-04')).toBe(0);
  });
});

describe('encouragement', () => {
  it('is empty at zero', () => {
    expect(encouragement(0)).toBe('');
  });

  it('matches the exact copy for each band', () => {
    expect(encouragement(1)).toBe('One week in.');
    expect(encouragement(2)).toBe('Two weeks running.');
    expect(encouragement(3)).toBe('Three weeks. Keep going.');
    expect(encouragement(4)).toBe('4 weeks straight. Good work.');
    expect(encouragement(7)).toBe('7 weeks straight. Good work.');
    expect(encouragement(8)).toBe('8 weeks. That is consistency.');
    expect(encouragement(11)).toBe('11 weeks. That is consistency.');
    expect(encouragement(12)).toBe('12 weeks without a miss.');
    expect(encouragement(20)).toBe('20 weeks without a miss.');
  });
});
