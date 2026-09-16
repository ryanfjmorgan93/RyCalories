/**
 * Training calendar: the weekly grid and the consistency streak. Pure functions only — no IO,
 * no clock, no database.
 */
import { addDays, dateKeyToDate, daysBetween, isoToDateKey } from './dates';

/**
 * Monday (YYYY-MM-DD) of the local week containing `dateKey`. Kept private and duplicated from
 * volume.ts's mondayOf rather than imported, per this module's import allowlist (./types, ./sets,
 * ./dates, ./format, ./engine only) — the two must agree on what a week is, so keep the logic
 * identical if either changes.
 */
function mondayOf(dateKey: string): string {
  const dow = dateKeyToDate(dateKey).getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  return addDays(dateKey, -diffToMonday);
}

export interface CalendarSession {
  id: string;
  startedAt: string;
  endedAt?: string;
  title: string;
}

export interface CalendarDay {
  date: string;
  sessions: CalendarSession[];
}

/**
 * `weeks` rows of 7 days ending with the week that contains `today`, Monday first, oldest first.
 * Only completed sessions (those with `endedAt`) count; days after today are included, empty.
 */
export function calendarGrid(sessions: CalendarSession[], weeks: number, today: string): CalendarDay[][] {
  const completed = sessions.filter((s) => s.endedAt !== undefined);
  const byDay = new Map<string, CalendarSession[]>();
  for (const s of completed) {
    const key = isoToDateKey(s.startedAt);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }

  const thisWeekMonday = mondayOf(today);
  const firstMonday = addDays(thisWeekMonday, -7 * (weeks - 1));

  const grid: CalendarDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const weekMonday = addDays(firstMonday, 7 * w);
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(weekMonday, d);
      week.push({ date, sessions: byDay.get(date) ?? [] });
    }
    grid.push(week);
  }
  return grid;
}

/**
 * Consecutive weeks meeting `weeklyTarget` completed sessions, ending at the current week if it
 * already meets the target, else at the last full week before it. A week below target breaks
 * the count. Never counts a week that has not started, or the current week before it qualifies
 * unless assessed against the last full week instead.
 */
export function streakWeeks(sessions: CalendarSession[], weeklyTarget: number, today: string): number {
  const completed = sessions.filter((s) => s.endedAt !== undefined);
  const byWeek = new Map<string, number>();
  for (const s of completed) {
    const key = isoToDateKey(s.startedAt);
    const monday = mondayOf(key);
    byWeek.set(monday, (byWeek.get(monday) ?? 0) + 1);
  }

  const currentMonday = mondayOf(today);
  const currentCount = byWeek.get(currentMonday) ?? 0;

  // Start from the current week if it already meets target, otherwise from the last full week
  // (the week before this one) — the current, still-in-progress week is never counted as a miss.
  let cursor = currentCount >= weeklyTarget ? currentMonday : addDays(currentMonday, -7);

  let streak = 0;
  for (;;) {
    // Never count a week that has not started yet (guards a future `today`/cursor drift).
    if (daysBetween(cursor, today) < 0) break;
    const count = byWeek.get(cursor) ?? 0;
    if (count < weeklyTarget) break;
    streak++;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

/** One short sentence for the streak line, deterministic by count. Empty for 0. */
export function encouragement(streak: number): string {
  if (streak <= 0) return '';
  if (streak === 1) return 'One week in.';
  if (streak === 2) return 'Two weeks running.';
  if (streak === 3) return 'Three weeks. Keep going.';
  if (streak <= 7) return `${streak} weeks straight. Good work.`;
  if (streak <= 11) return `${streak} weeks. That is consistency.`;
  return `${streak} weeks without a miss.`;
}
