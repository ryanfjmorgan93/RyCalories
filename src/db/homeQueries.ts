/**
 * What the Home routine cards read: each routine with how long since what it trains was last
 * trained (`loadRoutinesByRest`), how many exercises it has, and the top set of its lead lift last
 * time. Read-only; call from useLiveQuery.
 */
import { db } from './db';
import { routineItems } from './repo';
import { loadRoutinesByRest } from './routineRestQueries';
import { leadTopSet } from '@/domain/homeToday';
import type { RoutineRest } from '@/domain/routineOrder';

export interface HomeRoutine extends RoutineRest {
  /** How many exercises the routine has; zero means there is nothing to start. */
  exerciseCount: number;
  /** The heaviest set of the routine's lead lift in its last finished session ("Barbell Row 80 kg × 8"); null when it has not been done. */
  lastTop: string | null;
  /** The routine's exercises' picture keys, in routine order: Home shows the first that has a robot render. */
  demos: string[];
}

/**
 * The top set of the routine's lead lift the last time the routine was done. Three small indexed
 * reads, so it is cheap for the handful of routines Home shows.
 */
async function lastTopFor(routineId: string): Promise<string | null> {
  const done = await db.sessions
    .where('routineId')
    .equals(routineId)
    .filter((s) => !!s.endedAt)
    .toArray();
  const last = done.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!last) return null;
  const [items, sets] = await Promise.all([routineItems(routineId), db.setLogs.where('sessionId').equals(last.id).toArray()]);
  return leadTopSet(
    items.map(({ exercise }) => ({
      name: exercise.name,
      kind: exercise.kind,
      sets: sets.filter((s) => s.exerciseId === exercise.id),
    })),
  );
}

/** The routines Home offers, most rested first (archived and quick routines never appear), as of `today`. */
export async function loadHomeRoutines(today: string): Promise<HomeRoutine[]> {
  const rests = await loadRoutinesByRest(today);
  return Promise.all(
    rests.map(async (rest) => ({
      ...rest,
      exerciseCount: await db.routineExercises.where('routineId').equals(rest.routine.id).count(),
      lastTop: await lastTopFor(rest.routine.id),
      demos: (await routineItems(rest.routine.id)).flatMap(({ exercise }) => (exercise.demo ? [exercise.demo] : [])),
    })),
  );
}
