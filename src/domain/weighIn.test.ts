import { describe, expect, it } from 'vitest';
import { addDays, toDateKey } from './dates';
import { DEFAULT_REMINDERS, planReminders, type ReminderInput } from './reminders';
import { lastWeekReading, weighInDue, weighedThisWeek } from './weighIn';

// Monday 12 October 2026.
const MON = '2026-10-12';

describe('weighedThisWeek', () => {
  it('counts a reading from this week, Monday to today', () => {
    expect(weighedThisWeek(['2026-10-12'], MON)).toBe(true);
    expect(weighedThisWeek(['2026-10-12'], '2026-10-15')).toBe(true);
    expect(weighedThisWeek(['2026-10-14'], '2026-10-18')).toBe(true); // Sunday, the week's last day
  });

  it('does not count last week, a future day, or nothing', () => {
    expect(weighedThisWeek(['2026-10-11'], MON)).toBe(false); // Sunday of last week
    expect(weighedThisWeek(['2026-10-13'], MON)).toBe(false); // tomorrow
    expect(weighedThisWeek([], MON)).toBe(false);
  });

  it('starts a new week on Monday, not Sunday', () => {
    expect(weighedThisWeek(['2026-10-11'], '2026-10-11')).toBe(true); // that Sunday still belongs to the week of the 5th
    expect(weighedThisWeek(['2026-10-11'], '2026-10-12')).toBe(false);
  });
});

describe('weighInDue', () => {
  it('is the opposite of weighed this week', () => {
    expect(weighInDue([], MON)).toBe(true);
    expect(weighInDue(['2026-10-12'], MON)).toBe(false);
  });
});

describe('lastWeekReading', () => {
  const entries = [
    { date: '2026-09-28', kg: 81.9 },
    { date: '2026-10-05', kg: 82.4 },
    { date: '2026-10-12', kg: 82.9 },
  ];

  it('is the latest reading from before this week began', () => {
    expect(lastWeekReading(entries, '2026-10-14')?.kg).toBe(82.4);
    expect(lastWeekReading(entries, '2026-10-12')?.date).toBe('2026-10-05');
  });

  it('falls back to an older reading when last week was skipped', () => {
    expect(lastWeekReading(entries.slice(0, 1), '2026-10-12')?.kg).toBe(81.9);
  });

  it('is null with nothing older', () => {
    expect(lastWeekReading([], MON)).toBeNull();
    expect(lastWeekReading([{ date: '2026-10-13', kg: 80 }], '2026-10-13')).toBeNull();
  });
});

describe('agrees with the Monday reminder', () => {
  const base: ReminderInput = { meals: [], lastSessionDate: null, muscleRows: [], bodyweightDates: [] };
  const prefs = { ...DEFAULT_REMINDERS, food: { ...DEFAULT_REMINDERS.food, on: false }, training: { ...DEFAULT_REMINDERS.training, on: false } };

  it('the reminder is planned for a Monday exactly when the card would be due', () => {
    // Early Monday morning, so the 12:00 reminder is still ahead.
    const now = new Date(2026, 9, 12, 7, 0, 0);
    const today = toDateKey(now);
    const planned = (dates: string[]) =>
      planReminders({ ...base, bodyweightDates: dates }, now, prefs).some((r) => r.title === 'Weigh-in' && toDateKey(r.at) === today);
    for (let back = -1; back <= 9; back++) {
      const dates = [addDays(today, -back)];
      expect(planned(dates), `reading ${back} days back`).toBe(weighInDue(dates, today));
    }
    expect(planned([])).toBe(weighInDue([], today));
  });
});
