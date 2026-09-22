import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { db } from '@/db/db';
import { calendarData, type CalendarData } from '@/db/calendarQueries';
import { getMeal, loggedDays, mealsOnDay, recentMeals, suggestFoods, type MealWithItems } from '@/db/foodRepo';
import { nextSessionPlan, type SessionPlan } from '@/db/planQueries';
import { e1rmSeries, recentRecords, volumeSeries } from '@/db/recordsQueries';
import { exerciseHistory, getActiveSession, lastCompletedSession, recentSessions, routineItems, type RoutineItem } from '@/db/repo';
import { muscleRecency, weeklySetsTable, type WeeklySetsRow } from '@/db/volumeQueries';
import { toDateKey } from '@/domain/dates';
import type { Exercise, FoodMemory, MuscleGroup, Routine, Session, Settings } from '@/domain/types';

/** Live settings row (undefined while loading). */
export function useSettings(): Settings | undefined {
  return useLiveQuery(() => db.settings.get('settings'), []);
}

/** Active (non-archived) routines in weekly order. */
export function useRoutines(): Routine[] | undefined {
  return useLiveQuery(async () => (await db.routines.toArray()).filter((r) => !r.archived).sort((a, b) => a.order - b.order), []);
}

export function useRoutine(id: string | undefined): Routine | undefined {
  return useLiveQuery(() => (id ? db.routines.get(id) : undefined), [id]);
}

export function useRoutineItems(routineId: string | undefined): RoutineItem[] | undefined {
  return useLiveQuery(() => (routineId ? routineItems(routineId) : []), [routineId]);
}

export function useExercises(): Exercise[] | undefined {
  return useLiveQuery(async () => (await db.exercises.toArray()).sort((a, b) => a.name.localeCompare(b.name)), []);
}

export function useExercise(id: string | undefined): Exercise | undefined {
  return useLiveQuery(() => (id ? db.exercises.get(id) : undefined), [id]);
}

/** The in-progress session, or null when there is none (undefined while loading). */
export function useActiveSession(): Session | null | undefined {
  return useLiveQuery(async () => (await getActiveSession()) ?? null, []);
}

/**
 * The running workout, when the floating session dock should show for it; otherwise null.
 *
 * Tab screens only — the session screens are the workout itself — and not Home, whose
 * in-progress card already offers Resume (showing both put two Resume buttons on one screen).
 * The Shell's padding and the rest timer's position both read this, so all three agree.
 */
export function useSessionDock(): Session | null {
  const active = useActiveSession();
  const { pathname } = useLocation();
  if (!active || pathname === '/' || pathname.startsWith('/session/')) return null;
  return active;
}

export function useSession(id: string | undefined): Session | undefined {
  return useLiveQuery(() => (id ? db.sessions.get(id) : undefined), [id]);
}

export function useLastCompletedSession(): Session | null | undefined {
  return useLiveQuery(async () => (await lastCompletedSession()) ?? null, []);
}

export function useRecentSessions(limit = 3): Session[] | undefined {
  return useLiveQuery(() => recentSessions(limit), [limit]);
}

/** Re-render every `ms` (default 1 s). Returns the current time. */
export function useNow(ms = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    const onVis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms, enabled]);
  return now;
}

/** True when the page is offline (navigator.onLine false). */
export function useOffline(): boolean {
  const [off, setOff] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false);
  useEffect(() => {
    const on = () => setOff(false);
    const offH = () => setOff(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', offH);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', offH);
    };
  }, []);
  return off;
}

// ---------------------------------------------------------------------------
// Nutrition

/** Every meal on a day with its items and derived macros. */
export function useDayMeals(date: string): MealWithItems[] | undefined {
  return useLiveQuery(() => mealsOnDay(date), [date]);
}

export function useMeal(id: string | undefined): MealWithItems | null | undefined {
  return useLiveQuery(async () => (id ? ((await getMeal(id)) ?? null) : null), [id]);
}

/** Days with anything logged, newest first. */
export function useLoggedDays(limit = 30): string[] | undefined {
  return useLiveQuery(() => loggedDays(limit), [limit]);
}

/** Today's date key, re-read when the tab regains focus so a session over midnight rolls over. */
export function useToday(): string {
  const [key, setKey] = useState(() => toDateKey());
  useEffect(() => {
    const check = () => setKey(toDateKey());
    document.addEventListener('visibilitychange', check);
    const id = window.setInterval(check, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(id);
    };
  }, []);
  return key;
}

/**
 * Remembered foods ranked for a search box. An empty query means "most eaten, most recently";
 * `null` means the caller does not want suggestions at all and asks the database for nothing.
 */
export function useFoodSuggestions(query: string | null, limit = 6): FoodMemory[] | undefined {
  return useLiveQuery(() => (query === null ? [] : suggestFoods(query, limit)), [query, limit]);
}

/** Distinct meals eaten recently, for repeating one onto `date`. */
export function useRecentMeals(date: string, limit = 8): MealWithItems[] | undefined {
  return useLiveQuery(() => recentMeals(date, limit), [date, limit]);
}

// ---------------------------------------------------------------------------
// Training queries (WP3)

/** The next session's plan for a routine (undefined while `routineId`/`settings` are not ready). */
export function useNextSessionPlan(routineId: string | undefined, settings: Settings | undefined, deload = false): SessionPlan | null | undefined {
  return useLiveQuery(() => (routineId && settings ? nextSessionPlan(routineId, settings, { deload }) : undefined), [routineId, settings, deload]);
}

/** The training calendar grid and streak. */
export function useCalendar(weeks: number, today: string, settings: Settings | undefined): CalendarData | undefined {
  return useLiveQuery(() => (settings ? calendarData(weeks, today, settings) : undefined), [weeks, today, settings]);
}

/** This week's sets per muscle group against any target, sorted by sets descending. */
export function useWeeklySets(weekStart: string, settings: Settings | undefined): WeeklySetsRow[] | undefined {
  return useLiveQuery(() => (settings ? weeklySetsTable(weekStart, settings) : undefined), [weekStart, settings]);
}

/** Days since the most recent counted set per muscle group. */
export function useMuscleRecency(today: string): Partial<Record<MuscleGroup, number>> | undefined {
  return useLiveQuery(() => muscleRecency(today), [today]);
}

/** The most recent personal records across every exercise, newest first. */
export function useRecentRecords(limit = 10) {
  return useLiveQuery(() => recentRecords(limit), [limit]);
}

/** e1RM and volume series for an exercise's chart, plus its existing top-set history. */
export function useExerciseSeries(exerciseId: string | undefined) {
  return useLiveQuery(async () => {
    if (!exerciseId) return undefined;
    const [history, e1rm, volume] = await Promise.all([exerciseHistory(exerciseId), e1rmSeries(exerciseId), volumeSeries(exerciseId)]);
    return { history, e1rm, volume };
  }, [exerciseId]);
}
