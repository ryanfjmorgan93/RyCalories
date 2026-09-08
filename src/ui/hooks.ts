import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '@/db/db';
import { getActiveSession, lastCompletedSession, recentSessions, routineItems, type RoutineItem } from '@/db/repo';
import type { Exercise, Routine, Session, Settings } from '@/domain/types';

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
