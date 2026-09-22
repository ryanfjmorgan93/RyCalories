/**
 * The set table's pure model: given a slot's rx, its logged sets and its history, produce the
 * ordered rows a live session shows for that slot — logged sets, warm-up ghosts, and pending
 * target/extra rows with their ghost weight/reps and "Previous" text. No IO, no clock, no database.
 */
import { fmtSetsLine } from './format';
import { countsForProgression, setBadges } from './sets';
import type { Equipment, ExerciseKind, ProgressionMode, SetLog, SetType } from './types';
import { genericWarmupRamp, warmupRamp, type WarmupSet } from './warmup';
import type { PlateOptions } from './plates';

/** The rx fields `planRows` needs; a subset of `RoutineExercise`. */
export interface SetTableRx {
  targetSets: number;
  repMin: number;
  repMax: number;
  mode: ProgressionMode;
  increment: number;
  distanceMinM?: number;
  distanceMaxM?: number;
}

export interface PlanRowsInput {
  kind: ExerciseKind;
  equipment?: Equipment;
  rx: SetTableRx;
  /** This slot's logged sets this session, sorted by index. */
  loggedSets: SetLog[];
  /** The previous session's sets for this slot (`repo.previousSets(...).sets`), unfiltered — every
   * set type. `planRows` filters to `countsForProgression` itself. */
  previousSets: SetLog[];
  /** The working weight, already deload-adjusted by the caller. Null when calibrating. */
  prescribedWeight: number | null;
  /** Warm-up settings: barbell plate maths, or the increment grid for everything else. */
  warmup: PlateOptions;
  /** Extra rows the user added via the ⋯ menu, appended after the target rows. */
  extraRows: number;
}

export type RowStatus = 'next' | 'later';

export interface LoggedRow {
  kind: 'logged';
  set: SetLog;
  badge: 'W' | 'D' | number;
}

/** A warm-up ramp step not yet logged as a warm-up — its own kind, with its own weight/reps. */
export interface WarmupGhostRow {
  kind: 'warmup-ghost';
  weight: number;
  reps: number;
}

export interface PendingRow {
  kind: 'target' | 'extra';
  status: RowStatus;
  /** The counted (working/failure) index this row will become once logged, 0-based. */
  position: number;
  /** The previous session's counted set at this position, clamped to its last counted set, else null. */
  previous: SetLog | null;
  /** "65 × 8" (or the carry/timed equivalent), '' when there is no previous set to show. */
  previousText: string;
  ghostWeight: number | null;
  /** Reps/bodyweight_plus only; null for carry/timed. Never `rx.repMax` — an untouched row must
   * never look like it earned a weight increase. */
  ghostReps: number | null;
  /** Carry only; null otherwise. */
  ghostDistanceM: number | null;
  /** Timed and carry only; null otherwise. */
  ghostSeconds: number | null;
}

export type PlanRow = LoggedRow | WarmupGhostRow | PendingRow;

/** { countedDone, target, complete } from a slot's logged sets and its target. */
export function completionOf(sets: { type: SetType }[], targetSets: number): { countedDone: number; target: number; complete: boolean } {
  const countedDone = sets.filter((s) => countsForProgression(s.type)).length;
  return { countedDone, target: targetSets, complete: countedDone >= targetSets };
}

/** True the moment counted sets cross the target — the event a reload never replays. */
export function justCompleted(countedBefore: number, countedAfter: number, targetSets: number): boolean {
  return countedBefore < targetSets && countedAfter >= targetSets;
}

function previousAt(prevCounted: SetLog[], position: number): SetLog | null {
  return prevCounted[position] ?? prevCounted[prevCounted.length - 1] ?? null;
}

export function planRows(input: PlanRowsInput): PlanRow[] {
  const { kind, equipment, rx, loggedSets, previousSets, prescribedWeight, warmup, extraRows } = input;

  const rows: PlanRow[] = [];

  // (a) every logged set, in logged order, badged.
  const badges = setBadges(loggedSets);
  loggedSets.forEach((set, i) => rows.push({ kind: 'logged', set, badge: badges[i] }));

  const countedDone = loggedSets.filter((s) => countsForProgression(s.type)).length;

  // (b) warm-up ghosts, only before the first counted set of the slot, and only for a weighted
  // reps/bodyweight_plus exercise with a known working weight (carry/timed never show a ramp).
  // A logged warm-up consumes the next ramp step, whatever weight it was actually logged at.
  const isWeighted = kind === 'reps' || kind === 'bodyweight_plus';
  if (countedDone === 0 && isWeighted && prescribedWeight !== null && prescribedWeight > 0) {
    const ramp: WarmupSet[] = equipment === 'barbell' ? warmupRamp(prescribedWeight, warmup) : genericWarmupRamp(prescribedWeight, rx.increment);
    const warmupsLogged = loggedSets.filter((s) => s.type === 'warmup').length;
    for (const step of ramp.slice(warmupsLogged)) rows.push({ kind: 'warmup-ghost', weight: step.weight, reps: step.reps });
  }

  const prevCounted = previousSets.filter((s) => countsForProgression(s.type));
  // The weight actually logged on the last counted set this session, else null.
  const lastCountedWeight = [...loggedSets].reverse().find((s) => countsForProgression(s.type))?.weight ?? null;

  const pendingTargetCount = Math.max(0, rx.targetSets - countedDone);
  let position = countedDone;
  let firstPending = true;

  const buildPending = (rowKind: 'target' | 'extra'): PendingRow => {
    const previous = previousAt(prevCounted, position);
    const status: RowStatus = firstPending ? 'next' : 'later';
    firstPending = false;

    const ghostWeight = prescribedWeight ?? lastCountedWeight ?? previous?.weight ?? null;
    const ghostReps = isWeighted ? (previous?.reps ?? rx.repMin) : null;
    const ghostDistanceM = kind === 'carry' ? (previous?.distanceM ?? rx.distanceMinM ?? null) : null;
    const ghostSeconds = kind === 'timed' ? (previous?.seconds ?? rx.repMin) : kind === 'carry' ? (previous?.seconds ?? null) : null;
    const previousText = previous ? fmtSetsLine([previous], kind) : '';

    const row: PendingRow = {
      kind: rowKind,
      status,
      position,
      previous,
      previousText,
      ghostWeight,
      ghostReps,
      ghostDistanceM,
      ghostSeconds,
    };
    position += 1;
    return row;
  };

  // (c) pending target rows up to targetSets − countedDone.
  for (let i = 0; i < pendingTargetCount; i++) rows.push(buildPending('target'));
  // (d) extra rows, always appended regardless of completion.
  for (let i = 0; i < extraRows; i++) rows.push(buildPending('extra'));

  return rows;
}
