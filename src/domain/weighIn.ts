/**
 * The weekly weigh-in on Home: when the card shows and what it says about last week. Pure: no IO,
 * no clock (the caller passes `today`, a local YYYY-MM-DD).
 *
 * The rule is the Monday reminder's (`planReminders` in ./reminders): a weigh-in happened this week
 * when there is a reading dated from this week's Monday up to today. So the card shows on any day
 * of the week, Monday to Sunday, until one is logged, and the reminder and the card can never
 * disagree about whether the week has been weighed.
 */
import { mondayOf } from './dates';

export interface Reading {
  date: string;
  kg: number;
}

/** Whether any of these reading dates falls in the week that `today` belongs to, up to today. */
export function weighedThisWeek(dates: readonly string[], today: string): boolean {
  const weekStart = mondayOf(today);
  return dates.some((d) => d >= weekStart && d <= today);
}

/** The weigh-in card shows until a reading is logged this week. */
export function weighInDue(dates: readonly string[], today: string): boolean {
  return !weighedThisWeek(dates, today);
}

/**
 * The most recent reading from before this week began: "last week's reading", or the latest older
 * one when last week was skipped. Null when there is none.
 */
export function lastWeekReading<T extends Reading>(entries: readonly T[], today: string): T | null {
  const weekStart = mondayOf(today);
  let best: T | null = null;
  for (const e of entries) {
    if (e.date >= weekStart) continue;
    if (best === null || e.date > best.date) best = e;
  }
  return best;
}
