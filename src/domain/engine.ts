/**
 * The progression engine. Pure functions only — no IO, no dates, no DB.
 *
 * Double progression (§4.1):
 *   - every working set ≥ repMax  → increase by `increment`
 *   - otherwise                    → hold
 *   - fewer working sets than targetSets → hold (missing sets count as misses)
 *   - warm-up sets are ignored entirely
 *   - calibrating exercises produce no decision
 *   - carry / timed exercises never produce a weight decision
 */
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

export interface Decision {
  routineExerciseId: string;
  rule: ProgressionRule;
  /** The prescribed weight going into the session (rx.currentWeight). */
  fromWeight: number;
  /** The weight the engine proposes for next session. Equals fromWeight on hold. */
  toWeight: number;
  /** The weight actually used on the working sets, if they all agree; otherwise null. */
  sessionWeight: number | null;
  /** Working-set reps in logged order. */
  workingReps: number[];
  workingSets: number;
  targetSets: number;
  /** True when the decision changes the prescription (increase, or a hold at a deviated weight). */
  changesWeight: boolean;
}

export type Suggestion =
  | { kind: 'double_increment'; toWeight: number; minRir: number }
  | { kind: 'regression'; holdWeight: number; dropWeight: number; setsBelowMin: number }
  | { kind: 'stalled'; sessions: number; weight: number };

/** Round to the nearest 0.01 to keep 2.5-kg arithmetic clean of float noise. */
export function roundKg(n: number): number {
  return Math.round(n * 100) / 100;
}

export function workingSets(sets: EngineSet[]): EngineSet[] {
  return sets.filter((s) => s.type === 'working');
}

/** Kinds the engine will never write a weight decision for. */
export function producesWeightDecision(kind: ExerciseKind): boolean {
  return kind === 'reps' || kind === 'bodyweight_plus';
}

/**
 * Decide next session's weight for one routine-exercise from this session's sets.
 * Returns `rule: 'calibrating'` / `'not_applicable'` when no decision applies.
 */
export function decide(rx: EngineRoutineExercise, sets: EngineSet[]): Decision {
  const working = workingSets(sets);
  const reps = working.map((s) => Math.max(0, Math.floor(s.reps ?? 0)));
  const weights = working.map((s) => s.weight);
  const sessionWeight =
    weights.length > 0 && weights.every((w) => w === weights[0]) ? weights[0] : null;

  const base: Omit<Decision, 'rule' | 'toWeight' | 'changesWeight'> = {
    routineExerciseId: rx.id,
    fromWeight: rx.currentWeight,
    sessionWeight,
    workingReps: reps,
    workingSets: working.length,
    targetSets: rx.targetSets,
  };

  if (!producesWeightDecision(rx.kind)) {
    return { ...base, rule: 'not_applicable', toWeight: rx.currentWeight, changesWeight: false };
  }
  if (rx.mode === 'calibrating') {
    return { ...base, rule: 'calibrating', toWeight: rx.currentWeight, changesWeight: false };
  }

  // The weight to progress from: what was actually lifted if every working set agrees,
  // otherwise the prescription. A deviated hold re-prescribes the deviated weight
  // (visibly — the summary shows from → to) rather than snapping back silently.
  const baseWeight = sessionWeight ?? rx.currentWeight;

  if (working.length < rx.targetSets || working.length === 0) {
    const to = roundKg(baseWeight);
    return { ...base, rule: 'hold_missing_sets', toWeight: to, changesWeight: to !== rx.currentWeight };
  }

  const allAtTop = reps.every((r) => r >= rx.repMax);
  if (allAtTop) {
    const to = roundKg(baseWeight + rx.increment);
    return { ...base, rule: 'increase', toWeight: to, changesWeight: true };
  }
  const to = roundKg(baseWeight);
  return { ...base, rule: 'hold', toWeight: to, changesWeight: to !== rx.currentWeight };
}

/** The weight that ends up stored after the user's Accept / Override. */
export function resolveWeight(decision: Decision, overrideTo?: number): number {
  if (overrideTo !== undefined && Number.isFinite(overrideTo)) return roundKg(overrideTo);
  if (decision.rule === 'calibrating' || decision.rule === 'not_applicable') return decision.fromWeight;
  return decision.toWeight;
}

/**
 * §4.3 — all working sets hit repMax with RIR ≥ 3 on every set → suggest a double increment.
 * Every working set must carry an RIR value; a missing RIR means we can't claim it was easy.
 */
export function suggestDoubleIncrement(rx: EngineRoutineExercise, decision: Decision, sets: EngineSet[]): Suggestion | null {
  if (decision.rule !== 'increase') return null;
  const working = workingSets(sets);
  if (working.length === 0) return null;
  if (!working.every((s) => typeof s.rir === 'number' && s.rir >= 3)) return null;
  const minRir = Math.min(...working.map((s) => s.rir as number));
  const baseWeight = decision.sessionWeight ?? rx.currentWeight;
  return { kind: 'double_increment', toWeight: roundKg(baseWeight + rx.increment * 2), minRir };
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
 * weight with no progression. Calibrating / not-applicable outcomes are ignored.
 */
export function detectStall(history: SessionOutcome[], threshold = 3): Suggestion | null {
  const relevant = history.filter((h) => h.rule !== 'calibrating' && h.rule !== 'not_applicable' && h.rule !== 'lock_in');
  if (relevant.length < threshold) return null;
  const recent = relevant.slice(0, threshold);
  const w = recent[0].fromWeight;
  const stuck = recent.every((h) => h.fromWeight === w && h.appliedWeight === w);
  if (!stuck) return null;
  // Count how long the stall has actually lasted (may exceed threshold).
  let n = 0;
  for (const h of relevant) {
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
