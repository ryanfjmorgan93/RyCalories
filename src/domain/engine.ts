/**
 * The progression engine. Pure functions only — no IO, no dates, no DB.
 *
 * Four set types (see `domain/sets.ts`): warm-up, working, failure, drop.
 *   - working and failure sets both drive progression (`countsForProgression`); a failure set
 *     with no RIR logged reads as RIR 0, so a slot holding one is never read as Easy (`slotEffort`).
 *   - warm-up and drop sets are ignored entirely by the engine.
 *
 * Double progression (§4.1), with the slot's effort chip (Easy / Good / Hard) deciding the size
 * of the step when every counted set reached the top of the range:
 *   - every counted set ≥ repMax, marked Easy          → increase by two increments
 *   - every counted set ≥ repMax, marked Good / no chip → increase by `increment`
 *   - every counted set ≥ repMax, marked Hard          → hold the weight one more session (`hold_hard`)
 *   - otherwise                                        → hold (the chip changes nothing below the top)
 *   - fewer counted sets than targetSets → hold (missing sets count as misses)
 *   - working sets at different weights (moved up or down mid-session): progress from the heaviest
 *     weight lifted for at least repMin reps (`progressFrom`), never from a prescription the owner
 *     has already outlifted; a step up needs targetSets sets at that weight, every one at the top
 *   - calibrating exercises produce no decision
 *   - carry / timed exercises never produce a weight decision
 */
import { countsForProgression, effortRir, feelOf } from './sets';
import type { ExerciseKind, ProgressionMode, ProgressionRule, SetType } from './types';

export interface EngineRoutineExercise {
  id: string;
  kind: ExerciseKind;
  mode: ProgressionMode;
  targetSets: number;
  repMin: number;
  repMax: number;
  currentWeight: number;
  increment: number;
}

export interface EngineSet {
  type: SetType;
  weight: number;
  reps?: number;
  rir?: number;
  distanceM?: number;
  seconds?: number;
}

/** How the slot felt, read from the stored RIR: Easy 3+, Good 2, Hard 1 or less. */
export type Effort = 'easy' | 'good' | 'hard';

export interface Decision {
  routineExerciseId: string;
  rule: ProgressionRule;
  /** The prescribed weight going into the session (rx.currentWeight). */
  fromWeight: number;
  /** The weight the engine proposes for next session. Equals fromWeight on hold. */
  toWeight: number;
  /** The weight actually used on the working sets, if they all agree; otherwise null. */
  sessionWeight: number | null;
  /** The weight the decision progresses from: see `progressFrom`. */
  baseWeight: number;
  /** Working-set reps in logged order. */
  workingReps: number[];
  /** Working-set weights in logged order, alongside `workingReps`. */
  workingWeights: number[];
  workingSets: number;
  targetSets: number;
  /** True when the decision changes the prescription (increase, or a hold at a deviated weight). */
  changesWeight: boolean;
  /** The slot's effort chip, when it carries one. Absent when nothing was marked (read as Good). */
  effort?: Effort;
}

export type Suggestion =
  | { kind: 'regression'; holdWeight: number; dropWeight: number; setsBelowMin: number }
  | { kind: 'stalled'; sessions: number; weight: number };

/** Round to the nearest 0.01 to keep 2.5-kg arithmetic clean of float noise. */
export function roundKg(n: number): number {
  return Math.round(n * 100) / 100;
}

export function workingSets(sets: EngineSet[]): EngineSet[] {
  return sets.filter((s) => countsForProgression(s.type));
}

/** The effort a stored RIR stands for: Easy at 3 or more, Good at 2, Hard at 1 or less. */
export function effortOfRir(rir: number): Effort {
  return rir >= 3 ? 'easy' : rir >= 2 ? 'good' : 'hard';
}

/**
 * A slot's effort: the RIR its counted sets share (`feelOf`), as Easy / Good / Hard. Null when
 * nothing was marked, or the sets disagree. A failure set reads as RIR 0 whatever the chip says
 * (`effortRir`), so a slot holding one is never Easy — it falls back to Good, today's step.
 */
export function slotEffort(sets: EngineSet[]): Effort | null {
  const working = workingSets(sets);
  const shared = feelOf(working);
  if (shared === null) return null;
  const effort = effortOfRir(shared);
  if (effort === 'easy' && working.some((s) => (effortRir(s) ?? 3) < 3)) return 'good';
  return effort;
}

/**
 * The weight to progress from. Every working set at one weight: that weight. Sets at different
 * weights (a ramp to a heavier weight, or a drop after one): the heaviest weight lifted for at least
 * `repMin` reps, the heaviest the owner showed they own today. When no set got there, or nothing was
 * logged, the prescription.
 */
export function progressFrom(rx: Pick<EngineRoutineExercise, 'repMin' | 'currentWeight'>, sets: EngineSet[]): number {
  const working = workingSets(sets);
  if (working.length === 0) return rx.currentWeight;
  if (working.every((s) => s.weight === working[0]!.weight)) return working[0]!.weight;
  const owned = working.filter((s) => Math.floor(s.reps ?? 0) >= rx.repMin).map((s) => s.weight);
  return owned.length > 0 ? Math.max(...owned) : rx.currentWeight;
}

/** Kinds the engine will never write a weight decision for. */
export function producesWeightDecision(kind: ExerciseKind): boolean {
  return kind === 'reps' || kind === 'bodyweight_plus';
}

/**
 * Decide next session's weight for one routine-exercise from this session's sets.
 * Returns `rule: 'calibrating'` / `'not_applicable'` when no decision applies.
 * `opts.deload` marks a session that started as a deload: prescriptions were reduced and no
 * progression is decided, but calibrating and not-applicable still take precedence over it.
 */
export function decide(rx: EngineRoutineExercise, sets: EngineSet[], opts?: { deload?: boolean }): Decision {
  const working = workingSets(sets);
  const reps = working.map((s) => Math.max(0, Math.floor(s.reps ?? 0)));
  const weights = working.map((s) => s.weight);
  const sessionWeight =
    weights.length > 0 && weights.every((w) => w === weights[0]) ? weights[0] : null;

  const effort = slotEffort(sets);
  // The weight to progress from: what was actually lifted (see `progressFrom`), not a prescription
  // the owner has already moved off. A deviated hold re-prescribes the deviated weight (visibly —
  // the summary shows from → to) rather than snapping back silently.
  const baseWeight = progressFrom(rx, sets);
  const base: Omit<Decision, 'rule' | 'toWeight' | 'changesWeight'> = {
    routineExerciseId: rx.id,
    fromWeight: rx.currentWeight,
    sessionWeight,
    baseWeight,
    workingReps: reps,
    workingWeights: weights,
    workingSets: working.length,
    targetSets: rx.targetSets,
    ...(effort ? { effort } : {}),
  };

  if (!producesWeightDecision(rx.kind)) {
    return { ...base, rule: 'not_applicable', toWeight: rx.currentWeight, changesWeight: false };
  }
  if (rx.mode === 'calibrating') {
    return { ...base, rule: 'calibrating', toWeight: rx.currentWeight, changesWeight: false };
  }
  if (opts?.deload) {
    return { ...base, rule: 'deload', toWeight: rx.currentWeight, changesWeight: false };
  }

  if (working.length < rx.targetSets || working.length === 0) {
    const to = roundKg(baseWeight);
    return { ...base, rule: 'hold_missing_sets', toWeight: to, changesWeight: to !== rx.currentWeight };
  }

  // Judged at the weight progressed from. With every set at one weight that is every set; after a
  // ramp it is the sets at the top weight, and a step up needs a full target of them at the top of
  // the range (two sets at a new weight are not yet three).
  const atBase = reps.filter((_, i) => weights[i] === baseWeight);
  const allAtTop = atBase.length >= rx.targetSets && atBase.every((r) => r >= rx.repMax);
  if (allAtTop) {
    // The chip decides the step: Hard holds, Easy takes two increments, Good or none takes one.
    if (effort === 'hard') {
      const to = roundKg(baseWeight);
      return { ...base, rule: 'hold_hard', toWeight: to, changesWeight: to !== rx.currentWeight };
    }
    const to = roundKg(baseWeight + rx.increment * (effort === 'easy' ? 2 : 1));
    return { ...base, rule: 'increase', toWeight: to, changesWeight: true };
  }
  const to = roundKg(baseWeight);
  return { ...base, rule: 'hold', toWeight: to, changesWeight: to !== rx.currentWeight };
}

/** The weight that ends up stored after the user's Accept / Override. */
export function resolveWeight(decision: Decision, overrideTo?: number): number {
  if (overrideTo !== undefined && Number.isFinite(overrideTo)) return roundKg(overrideTo);
  if (decision.rule === 'calibrating' || decision.rule === 'not_applicable' || decision.rule === 'deload') {
    return decision.fromWeight;
  }
  return decision.toWeight;
}

/** Number of working sets that fell below repMin. */
export function setsBelowMin(rx: Pick<EngineRoutineExercise, 'repMin'>, sets: EngineSet[]): number {
  return workingSets(sets).filter((s) => (s.reps ?? 0) < rx.repMin).length;
}

/**
 * §4.3 — 2+ working sets below repMin in two consecutive sessions → suggest hold or drop one increment.
 * `previousSets` are the working sets of the most recent earlier session for the same routine-exercise.
 */
export function suggestRegression(
  rx: EngineRoutineExercise,
  currentSets: EngineSet[],
  previousSets: EngineSet[] | null,
): Suggestion | null {
  if (!producesWeightDecision(rx.kind) || rx.mode === 'calibrating') return null;
  if (!previousSets) return null;
  const now = setsBelowMin(rx, currentSets);
  const before = setsBelowMin(rx, previousSets);
  if (now >= 2 && before >= 2) {
    const hold = roundKg(rx.currentWeight);
    const drop = roundKg(Math.max(0, rx.currentWeight - rx.increment));
    return { kind: 'regression', holdWeight: hold, dropWeight: drop, setsBelowMin: now };
  }
  return null;
}

export interface SessionOutcome {
  /** Weight prescribed going in. */
  fromWeight: number;
  /** Weight stored after accept/override. */
  appliedWeight: number;
  rule: ProgressionRule;
}

/**
 * §4.3 — stalled when the last `threshold` sessions (most recent first) were all at the same
 * weight with no progression. Calibrating / not-applicable / lock-in outcomes are ignored, but a
 * deload is kept and breaks the streak: it's a deliberate reset, not a symptom of stalling. If
 * any of the `threshold` most recent relevant rows is a deload there is no stall, and the
 * streak-length count stops the moment it reaches one.
 */
export function detectStall(history: SessionOutcome[], threshold = 3): Suggestion | null {
  const relevant = history.filter((h) => h.rule !== 'calibrating' && h.rule !== 'not_applicable' && h.rule !== 'lock_in');
  if (relevant.length < threshold) return null;
  const recent = relevant.slice(0, threshold);
  if (recent.some((h) => h.rule === 'deload')) return null;
  const w = recent[0].fromWeight;
  const stuck = recent.every((h) => h.fromWeight === w && h.appliedWeight === w);
  if (!stuck) return null;
  // Count how long the stall has actually lasted (may exceed threshold).
  let n = 0;
  for (const h of relevant) {
    if (h.rule === 'deload') break;
    if (h.fromWeight === w && h.appliedWeight === w) n++;
    else break;
  }
  return { kind: 'stalled', sessions: n, weight: w };
}

/** Lock a calibrating exercise in at a weight; double progression starts next session. */
export function lockIn<T extends { mode: ProgressionMode; currentWeight: number }>(rx: T, weight: number): T {
  return { ...rx, mode: 'normal', currentWeight: roundKg(weight) };
}

/** A sensible lock-in default: the heaviest working-set weight logged this session. */
export function suggestedLockInWeight(sets: EngineSet[]): number | null {
  const w = workingSets(sets).map((s) => s.weight).filter((n) => Number.isFinite(n));
  if (w.length === 0) return null;
  return roundKg(Math.max(...w));
}

/**
 * The one floor for a lock-in weight, wherever it is offered (Summary and Exercise Detail both
 * use this — no more diverging rules). A missing, non-finite or negative weight is always
 * blocked. 0 is blocked too, except for `bodyweight_plus`, where 0 added kg is a real working
 * weight — bodyweight alone — not an unset field.
 */
export function lockInBlocked(weight: number | null, kind: ExerciseKind): boolean {
  if (weight === null || !Number.isFinite(weight) || weight < 0) return true;
  return weight === 0 && kind !== 'bodyweight_plus';
}
