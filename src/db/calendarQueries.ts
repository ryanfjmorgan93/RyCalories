/**
 * Training calendar grid and consistency streak. Read-only query; call from useLiveQuery.
 */
import { db } from './db';
import { calendarGrid, encouragement, streakWeeks, type CalendarDay, type CalendarSession } from '@/domain/calendar';
import { isoToDateKey, mondayOf } from '@/domain/dates';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/types';

export interface CalendarData {
  grid: CalendarDay[][];
  streak: number;
  line: string;
  weeklyTarget: number;
  /** Completed sessions in the current week. */
  thisWeek: number;
}

export async function calendarData(weeks: number, today: string, settings: Settings): Promise<CalendarData> {
  const sessions = await db.sessions.toArray();
  const calSessions: CalendarSession[] = sessions.map((s) => ({ id: s.id, startedAt: s.startedAt, endedAt: s.endedAt, title: s.title }));
  const weeklyTarget = settings.weeklySessionTarget ?? DEFAULT_SETTINGS.weeklySessionTarget!;
  const grid = calendarGrid(calSessions, weeks, today);
  const streak = streakWeeks(calSessions, weeklyTarget, today);
  const monday = mondayOf(today);
  const thisWeek = calSessions.filter((s) => s.endedAt !== undefined && mondayOf(isoToDateKey(s.startedAt)) === monday).length;
  return { grid, streak, line: encouragement(streak), weeklyTarget, thisWeek };
}
