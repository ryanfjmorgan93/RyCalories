/** Small types shared by the modules in `src/ai/`. */
import type { BuiltRoutine } from '@/domain/routineBuilder';

/**
 * What a session-only change to one exercise sets: any of the four. Mirrors the shape of
 * `Session.planOverrides[routineExerciseId]` (added to the schema by the training-engine work), so
 * `setPlanOverride(sessionId, routineExerciseId, patch)` can take it as it stands.
 */
export interface PlanOverridePatch {
  targetSets?: number;
  repMin?: number;
  repMax?: number;
  /** kg (the added kg for a bodyweight_plus exercise). */
  weight?: number;
}

/**
 * Writes a plan override on a live session. It is `repo.setPlanOverride`, supplied by whoever wires
 * the coach into the app: this module does not add it to repo.ts, and does not import it.
 */
export type SetPlanOverride = (sessionId: string, routineExerciseId: string, patch: PlanOverridePatch) => Promise<void>;

/** What a turn did besides talk: the lines for the actions list, and the routine draft if one was built. */
export interface TurnRecord {
  actions: string[];
  /** The latest `build_routine` result, kept so the UI can offer to save it. Not saved by the tool. */
  draft: { routines: BuiltRoutine[]; text: string } | null;
}

export function newTurnRecord(): TurnRecord {
  return { actions: [], draft: null };
}
