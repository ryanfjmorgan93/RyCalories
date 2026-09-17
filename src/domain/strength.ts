/**
 * Estimated one-rep max. Pure functions only — no IO, no clock, no database.
 *
 * Estimates get less reliable the higher the rep count goes, and past 12 reps they are guesses
 * dressed up as numbers — so this module refuses to produce one rather than show a figure that
 * looks precise and isn't.
 */
import { roundKg } from './engine';
import { countsForRecords } from './sets';
import type { ExerciseKind, SetType } from './types';

export type E1rmFormula = 'epley' | 'brzycki';

/**
 * Estimated one-rep max. Null when reps < 1 or > 12. Epley: w × (1 + r/30); Brzycki:
 * w × 36 / (37 − r). 1 rep returns the weight itself.
 */
export function e1rm(weightKg: number, reps: number, formula: E1rmFormula = 'epley'): number | null {
  if (!Number.isFinite(reps) || reps < 1 || reps > 12) return null;
  if (reps === 1) return roundKg(weightKg);
  const raw = formula === 'brzycki' ? (weightKg * 36) / (37 - reps) : weightKg * (1 + reps / 30);
  return roundKg(raw);
}

/**
 * e1RM for a specific exercise kind. 'reps' uses the weight as is. 'bodyweight_plus' adds
 * bodyweightKg to the load when supplied — an added-kg-only e1RM would understate the lift — and
 * returns null when it is not supplied. 'carry' and 'timed' have no meaningful one-rep max.
 */
export function e1rmFor(
  kind: ExerciseKind,
  weightKg: number,
  reps: number | undefined,
  opts: { formula?: E1rmFormula; bodyweightKg?: number } = {},
): number | null {
  if (reps === undefined) return null;
  if (kind === 'carry' || kind === 'timed') return null;
  if (kind === 'bodyweight_plus') {
    if (opts.bodyweightKg === undefined) return null;
    return e1rm(opts.bodyweightKg + weightKg, reps, opts.formula);
  }
  return e1rm(weightKg, reps, opts.formula);
}

/**
 * Change in e1RM over a trailing window, from a series of {t: ms epoch, y: e1RM} points ordered
 * oldest to newest. Null when there are fewer than two points — a single point has no change to
 * report. `covered` is true only when a point at least `windowDays` before the last one exists and
 * was used as the base; otherwise the base is the very first point on record and `spanDays` is the
 * true span of what is actually there, never the window asked for.
 */
export function e1rmChange(
  series: { t: number; y: number }[],
  windowDays = 28,
): { delta: number; from: number; to: number; spanDays: number; covered: boolean } | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const cutoff = last.t - windowDays * 24 * 3600 * 1000;
  let base = series[0];
  let covered = false;
  for (const p of series) {
    if (p.t <= cutoff) {
      base = p;
      covered = true;
    }
  }
  const spanDays = Math.round((last.t - base.t) / (24 * 3600 * 1000));
  return { delta: last.y - base.y, from: base.t, to: last.t, spanDays, covered };
}

/** Best e1RM over the sets that count for records; null when none produce one. */
export function bestE1rm(
  kind: ExerciseKind,
  sets: { type: SetType; weight: number; reps?: number }[],
  opts: { formula?: E1rmFormula; bodyweightKg?: number } = {},
): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (!countsForRecords(s.type)) continue;
    const v = e1rmFor(kind, s.weight, s.reps, opts);
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}
