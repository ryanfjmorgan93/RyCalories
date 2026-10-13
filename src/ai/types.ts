/** Small types shared by the modules in `src/ai/`. */
import type { BuiltRoutine } from '@/domain/routineBuilder';
import type { SupplementTime } from '@/domain/types';

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

/** A supplement the coach suggested adding to the owner's checklist. */
export interface SupplementSuggestion {
  name: string;
  dose?: string;
  time: SupplementTime;
  /** One short reason, shown on the offer. */
  why: string;
}

/**
 * What the coach offered this turn for the owner to accept with a tap. Nothing in an offer is
 * applied by the coach: targets change, and supplements join the list, only when the owner taps.
 */
export interface CoachOffer {
  targets?: { calories?: number; protein?: number };
  supplements?: SupplementSuggestion[];
}

/** What a turn did besides talk: the lines for the actions list, the routine draft if one was built, and any offer. */
export interface TurnRecord {
  actions: string[];
  /** The latest `build_routine` result, kept so the UI can offer to save it. Not saved by the tool. */
  draft: { routines: BuiltRoutine[]; text: string } | null;
  /** Targets and supplements offered this turn, until the owner takes them or dismisses them. */
  offer: CoachOffer | null;
}

export function newTurnRecord(): TurnRecord {
  return { actions: [], draft: null, offer: null };
}
