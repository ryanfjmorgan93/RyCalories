/**
 * Read queries for the exercise detail screen. Pure reads; call from useLiveQuery so the
 * screen re-renders when routines, routine-exercises or decisions change.
 */
import { db } from './db';
import { decisionsForRoutineExercise, stallStatus } from './repo';
import type { Suggestion } from '@/domain/engine';
import type { ProgressionDecision, Routine, RoutineExercise } from '@/domain/types';

export interface RoutineUsage {
  routine: Routine;
  rx: RoutineExercise;
  /** Present when the routine-exercise is stalled (§4.3). */
  stall: Extract<Suggestion, { kind: 'stalled' }> | null;
  /** Decision history, most recent first. */
  decisions: ProgressionDecision[];
}

/** Every active routine that includes the exercise, in weekly order, with stall state and decision history. */
export async function routineUsageForExercise(exerciseId: string): Promise<RoutineUsage[]> {
  const rxs = await db.routineExercises.where('exerciseId').equals(exerciseId).toArray();
  if (rxs.length === 0) return [];
  const routines = await db.routines.bulkGet([...new Set(rxs.map((r) => r.routineId))]);
  const byId = new Map(routines.filter((r): r is Routine => !!r && !r.archived).map((r) => [r.id, r]));
  const out: RoutineUsage[] = [];
  for (const rx of rxs) {
    const routine = byId.get(rx.routineId);
    if (!routine) continue;
    // A stall badge only means something while a weight is prescribed.
    const [stall, decisions] = await Promise.all([rx.mode === 'normal' ? stallStatus(rx.id) : Promise.resolve(null), decisionsForRoutineExercise(rx.id)]);
    out.push({ routine, rx, stall: stall && stall.kind === 'stalled' ? stall : null, decisions });
  }
  return out.sort((a, b) => a.routine.order - b.routine.order || a.rx.order - b.rx.order);
}
