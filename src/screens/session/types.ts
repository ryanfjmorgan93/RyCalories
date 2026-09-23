/**
 * Shared shapes for the live session screen and its split-out components
 * (src/screens/session/*). No IO here — just the plain data the screen passes down.
 */
import type { Exercise, RoutineExercise } from '@/domain/types';

/**
 * The live row's in-progress values. Distance/seconds are carry/timed only. Always logs as a
 * `working` set — there is no chip to pick a type before logging any more (a warm-up ghost row
 * logs itself directly, at its own fixed weight/reps); `failure`/`drop`/`warmup` are reached only
 * by retyping a logged set afterwards, in `EditSetSheet`.
 */
export interface Draft {
  weight: number | null;
  reps: number | null;
  distanceM: number | null;
  seconds: number | null;
}

/** One card in the session: a routine-exercise, or a session-only extra (rx null). */
export interface Slot {
  key: string;
  rx: RoutineExercise | null;
  exercise: Exercise;
  optional: boolean;
}

/** A lone slot, or adjacent required slots sharing an `rx.supersetId` (a superset). */
export interface SlotGroup {
  key: string;
  slots: Slot[];
}
