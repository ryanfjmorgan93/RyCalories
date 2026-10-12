/**
 * Session-only changes to a routine-exercise's plan ("Change today"). Pure: no IO, no clock.
 *
 * The saved routine is the plan; `Session.planOverrides` holds what the owner changed for today
 * alone. The live screen builds its slots from `effectiveRx`, so the prescription, the set table,
 * the verdict, completion and rest all see today's plan, and `buildSummary` judges a session
 * against today's sets and rep range (so cutting a lift to two sets and doing two is not a miss).
 *
 * An override's `weight` sets today's prescribed weight only. Progression still decides from the
 * sets actually logged, and `judgedRx` leaves the saved weight on the rx the engine sees.
 */
import { roundKg } from './engine';
import { fmtKg, fmtRange, fmtWeight } from './format';
import type { ExerciseKind, PlanOverride, RoutineExercise, Session } from './types';

/** The routine-exercise fields an override can touch. */
type Plan = Pick<RoutineExercise, 'id' | 'targetSets' | 'targetSetsMax' | 'repMin' | 'repMax' | 'currentWeight' | 'mode'>;

type HasOverrides = Pick<Session, 'planOverrides'> | null | undefined;

const KEYS: (keyof PlanOverride)[] = ['targetSets', 'repMin', 'repMax', 'weight'];

/** The same ceiling the routine editor puts on sets. */
export const MAX_TARGET_SETS = 12;
const MAX_REPS = 999;
const MAX_WEIGHT = 2000;

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Drops anything that is not a usable number and rounds/clamps the rest. Never returns undefined keys. */
export function cleanOverride(o: PlanOverride | null | undefined): PlanOverride {
  const out: PlanOverride = {};
  if (!o) return out;
  if (finite(o.targetSets)) out.targetSets = Math.min(MAX_TARGET_SETS, Math.max(1, Math.round(o.targetSets)));
  if (finite(o.repMin)) out.repMin = Math.min(MAX_REPS, Math.max(1, Math.round(o.repMin)));
  if (finite(o.repMax)) out.repMax = Math.min(MAX_REPS, Math.max(1, Math.round(o.repMax)));
  if (finite(o.weight)) out.weight = Math.min(MAX_WEIGHT, Math.max(0, roundKg(o.weight)));
  return out;
}

export function isEmptyOverride(o: PlanOverride | null | undefined): boolean {
  return Object.keys(cleanOverride(o)).length === 0;
}

/** The override stored for a routine-exercise in this session, if any. */
export function overrideFor(rxId: string, session: HasOverrides): PlanOverride | undefined {
  const o = session?.planOverrides?.[rxId];
  return o && !isEmptyOverride(o) ? o : undefined;
}

/**
 * `rx` with an override applied: sets at least 1 (an explicit set count also drops the routine's
 * "up to" count, which would otherwise read "2–4" after cutting to 2), repMin never above repMax
 * (the bound that was just changed wins; two inverted bounds swap), and a weight only on a
 * lift with a working weight. Applying an override twice gives the same plan, so it is safe to
 * pass an already-effective rx.
 */
export function applyOverride<T extends Plan>(rx: T, override: PlanOverride | null | undefined): T {
  const c = cleanOverride(override);
  if (Object.keys(c).length === 0) return rx;
  const next: T = { ...rx };
  if (c.targetSets !== undefined) {
    next.targetSets = c.targetSets;
    next.targetSetsMax = undefined;
  }
  if (c.repMin !== undefined || c.repMax !== undefined) {
    let lo = c.repMin ?? rx.repMin;
    let hi = c.repMax ?? rx.repMax;
    if (lo > hi) {
      if (c.repMax === undefined) hi = lo;
      else if (c.repMin === undefined) lo = hi;
      else [lo, hi] = [hi, lo];
    }
    next.repMin = lo;
    next.repMax = hi;
  }
  if (c.weight !== undefined && rx.mode === 'normal') next.currentWeight = c.weight;
  const same =
    next.targetSets === rx.targetSets &&
    next.targetSetsMax === rx.targetSetsMax &&
    next.repMin === rx.repMin &&
    next.repMax === rx.repMax &&
    next.currentWeight === rx.currentWeight;
  return same ? rx : next;
}

/** The plan the live screen runs today: the saved routine-exercise with this session's override on it. Same object when there is none. */
export function effectiveRx<T extends Plan>(rx: T, session: HasOverrides): T {
  const o = overrideFor(rx.id, session);
  return o ? applyOverride(rx, o) : rx;
}

/**
 * What the progression engine judges today's sets against: today's set count and rep range, but
 * the SAVED weight. The override weight is only what was prescribed for the day; the decision
 * still reads the weight actually lifted and reports the move from the routine's own weight, so a
 * lighter day can never pass as an increase.
 */
export function judgedRx<T extends Plan>(rx: T, session: HasOverrides): T {
  const o = overrideFor(rx.id, session);
  if (!o) return rx;
  const rest = cleanOverride(o);
  delete rest.weight;
  return applyOverride(rx, rest);
}

/**
 * Fold a patch into an existing override. A key present in `patch` with a number sets that field;
 * a key present with `undefined` removes it; an absent key is left alone.
 */
export function mergeOverride(existing: PlanOverride | undefined, patch: PlanOverride): PlanOverride {
  const out: PlanOverride = { ...existing };
  for (const key of KEYS) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v === undefined) delete out[key];
    else out[key] = v;
  }
  return cleanOverride(out);
}

/** Drops every field that equals what the saved routine-exercise already says, so an override only ever holds a real difference. */
export function pruneOverride(rx: Plan, override: PlanOverride): PlanOverride {
  const c = cleanOverride(override);
  const hasRange = rx.targetSetsMax !== undefined && rx.targetSetsMax > rx.targetSets;
  if (c.targetSets !== undefined && c.targetSets === rx.targetSets && !hasRange) delete c.targetSets;
  if (c.repMin !== undefined && c.repMin === rx.repMin) delete c.repMin;
  if (c.repMax !== undefined && c.repMax === rx.repMax) delete c.repMax;
  if (c.weight !== undefined && (rx.mode !== 'normal' || c.weight === roundKg(rx.currentWeight))) delete c.weight;
  return c;
}

/**
 * "Today: 3 × 8–10 at 60 kg". Only the parts that were changed are named, so a sets-only change
 * reads "Today: 3 sets" and a weight-only one "Today: 60 kg". Pass the saved or the effective rx.
 * Empty string when the override changes nothing.
 */
export function describeOverride(rx: Plan, override: PlanOverride | null | undefined, kind: ExerciseKind = 'reps'): string {
  const c = cleanOverride(override);
  if (Object.keys(c).length === 0) return '';
  const eff = applyOverride(rx, c);
  const sets = c.targetSets !== undefined ? eff.targetSets : undefined;
  const reps = c.repMin !== undefined || c.repMax !== undefined ? fmtRange(eff.repMin, eff.repMax, kind === 'timed' ? 's' : '') : undefined;
  const weight = c.weight !== undefined && rx.mode === 'normal' ? (kind === 'bodyweight_plus' ? fmtWeight(kind, eff.currentWeight) : fmtKg(eff.currentWeight)) : undefined;
  let body: string | undefined;
  if (sets !== undefined && reps !== undefined) body = `${sets} × ${reps}`;
  else if (sets !== undefined) body = `${sets} ${sets === 1 ? 'set' : 'sets'}`;
  else if (reps !== undefined) body = kind === 'timed' ? reps : `${reps} reps`;
  const parts = body !== undefined && weight !== undefined ? `${body} at ${weight}` : (body ?? weight);
  return parts === undefined ? '' : `Today: ${parts}`;
}
