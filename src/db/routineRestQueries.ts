/**
 * The owner's routines, most rested first (`routinesByRest`). Read-only; call from useLiveQuery.
 */
import { db } from './db';
import { muscleSetRowsFrom } from './volumeQueries';
import { routinesByRest, type RoutineRest } from '@/domain/routineOrder';
import { muscleRecency } from '@/domain/volume';
import type { MuscleGroup } from '@/domain/types';

/** Non-archived, non-quick routines ordered by how long since the muscles they train were last trained, as of `today` (a local YYYY-MM-DD). */
export async function loadRoutinesByRest(today: string) {
  // One read transaction, so the routines, their exercises and the history agree.
  const t = await db.transaction('r', [db.routines, db.routineExercises, db.exercises, db.sessions, db.setLogs], async () => {
    const [routines, routineExercises, exercises, sessions, setLogs] = await Promise.all([
      db.routines.toArray(),
      db.routineExercises.toArray(),
      db.exercises.toArray(),
      db.sessions.toArray(),
      db.setLogs.toArray(),
    ]);
    return { routines, routineExercises, exercises, sessions, setLogs };
  });
  const muscleByExercise = new Map(t.exercises.map((e) => [e.id, e.muscleGroup]));
  const musclesOf = new Map<string, MuscleGroup[]>();
  for (const rx of t.routineExercises) {
    const muscle = muscleByExercise.get(rx.exerciseId);
    if (!muscle) continue;
    const list = musclesOf.get(rx.routineId);
    if (list) list.push(muscle);
    else musclesOf.set(rx.routineId, [muscle]);
  }
  const recency = muscleRecency(muscleSetRowsFrom(t.setLogs, t.sessions, t.exercises), today);
  return routinesByRest(t.routines, musclesOf, recency);
}

export type { RoutineRest };
