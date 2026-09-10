import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '@/db/db';
import { getActiveSession, lastCompletedSession, recentSessions, routineItems, type RoutineItem } from '@/db/repo';
import { getMeal, loggedDays, mealsOnDay, suggestFoods, type MealWithItems } from '@/db/foodRepo';
import { toDateKey } from '@/domain/dates';
import type { Exercise, FoodMemory, Routine, Session, Settings } from '@/domain/types';

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
