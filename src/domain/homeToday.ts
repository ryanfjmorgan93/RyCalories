/**
 * What Home says about the day, in small pure pieces: the facts the coach is given when the app
 * opens, and the last top set shown on a routine card. No IO, no clock (the caller passes the
 * hour, the day names and the numbers).
 */
import { fmtNum, fmtRange, fmtSignedKg, fmtWeight } from './format';
import type { Prescription } from './prescription';
import { TRAINING_REGIONS, type TrainingRegion } from './routineOrder';
import { countsForRecords } from './sets';
import type { ExerciseKind, RoutineExercise, SetType } from './types';

// ---------------------------------------------------------------------------
// The coach line at app open

/** The region left alone the longest, among those ever trained, with its days. Null when none has been trained. */
export function mostRestedRegion(byRegion: Partial<Record<TrainingRegion, number>>): { region: TrainingRegion; days: number } | null {
  let best: { region: TrainingRegion; days: number } | null = null;
  for (const region of TRAINING_REGIONS) {
    const days = byRegion[region];
    if (typeof days !== 'number') continue;
    if (best === null || days > best.days) best = { region, days };
  }
  return best;
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening';

export function partOfDay(hour: number): PartOfDay {
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

export interface OpenFactsInput {
  /** "Monday". */
  weekday: string;
  /** Local hour, 0 to 23. */
  hour: number;
  rested: { region: TrainingRegion; days: number } | null;
  /** Whole days since the last finished session; null when there has been none. */
  daysSinceSession: number | null;
  /** Eaten so far today. */
  kcal: number;
  protein: number;
  /** Today's targets; null when the calorie target is not set. */
  kcalTarget: number | null;
  proteinTarget: number | null;
  weighInDue: boolean;
}

/** Nearest multiple of `step`. */
function nearest(n: number, step: number): number {
  return Math.round(n / step) * step;
}

/**
 * The compact facts the app-open line is asked for. Today's food is rounded (kcal to 100, protein
 * to 10 g): the coach is asked again whenever the facts change, and a single logged snack should
 * not be a reason for a new line. The numbers the owner sees are on the food card, unrounded.
 */
export function openFacts(i: OpenFactsInput): Record<string, string | number | boolean | undefined> {
  return {
    weekday: i.weekday,
    timeOfDay: partOfDay(i.hour),
    mostRestedRegion: i.rested?.region,
    daysSinceMostRestedRegion: i.rested?.days,
    daysSinceLastSession: i.daysSinceSession ?? undefined,
    caloriesSoFar: nearest(i.kcal, 100),
    calorieTarget: i.kcalTarget ?? undefined,
    proteinSoFarGrams: nearest(i.protein, 10),
    proteinTargetGrams: i.proteinTarget ?? undefined,
    weighInDue: i.weighInDue,
  };
}

// ---------------------------------------------------------------------------
// A routine's last top set

export interface TopSetExercise {
  name: string;
  kind: ExerciseKind;
  /** The sets of the routine's last session for this exercise. */
  sets: { type: SetType; weight: number; reps?: number }[];
}

/**
 * The heaviest set the routine's lead lift saw last time, "Barbell Row 80 kg × 8". `exercises` is in
 * routine order; the lead lift is the first with a counted set of reps (a carry or a hold has no top
 * set in this sense). Heaviest weight wins; the same weight is decided by reps. Null when no
 * exercise qualifies.
 */
export function leadTopSet(exercises: readonly TopSetExercise[]): string | null {
  for (const ex of exercises) {
    if (ex.kind !== 'reps' && ex.kind !== 'bodyweight_plus') continue;
    let top: { weight: number; reps: number } | null = null;
    for (const s of ex.sets) {
      if (!countsForRecords(s.type) || !s.reps || s.reps <= 0) continue;
      if (top === null || s.weight > top.weight || (s.weight === top.weight && s.reps > top.reps)) top = { weight: s.weight, reps: s.reps };
    }
    if (top) return `${ex.name} ${fmtWeight(ex.kind, top.weight)} × ${fmtNum(top.reps)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A row of a routine's next-session plan

export interface PlanRowInput {
  kind: ExerciseKind;
  rx: Pick<RoutineExercise, 'targetSets' | 'targetSetsMax' | 'repMin' | 'repMax' | 'mode' | 'distanceMinM' | 'distanceMaxM'>;
  prescription: Pick<Prescription, 'weight' | 'weightDelta' | 'flags'>;
}

export interface PlanRow {
  /** "65 kg", "+10 kg", "bodyweight" or "calibrating"; null for a lift with no weight (a hold, a walk). */
  weight: string | null;
  /** "4 × 6–8", "3 × 30–40 s", "3 walks · 30–40 m". */
  scheme: string;
  /** How the weight moved since last time, when it did. */
  change: { text: string; tone: 'ok' | 'warn' } | null;
  /** Words worth a flag beside the row. */
  flags: string[];
}

const FLAG_TEXT: Partial<Record<Prescription['flags'][number], string>> = {
  stalled: 'Stalled',
  regression: 'Down on last time',
};

/** One line of the plan Home shows when a routine card is opened. */
export function planRow({ kind, rx, prescription }: PlanRowInput): PlanRow {
  const sets = rx.targetSetsMax && rx.targetSetsMax > rx.targetSets ? `${rx.targetSets}–${rx.targetSetsMax}` : `${rx.targetSets}`;
  let scheme: string;
  if (kind === 'carry') {
    const dist = rx.distanceMinM !== undefined && rx.distanceMaxM !== undefined ? ` · ${fmtRange(rx.distanceMinM, rx.distanceMaxM, 'm')}` : '';
    scheme = `${sets} walks${dist}`;
  } else if (kind === 'timed') {
    scheme = `${sets} × ${fmtRange(rx.repMin, rx.repMax, 's')}`;
  } else {
    scheme = `${sets} × ${fmtRange(rx.repMin, rx.repMax)}`;
  }
  const hasWeight = kind === 'reps' || kind === 'bodyweight_plus';
  const weight = rx.mode === 'calibrating' && hasWeight ? 'calibrating' : hasWeight && prescription.weight !== null ? fmtWeight(kind, prescription.weight) : null;
  const delta = prescription.weightDelta;
  const change = delta !== null && delta !== 0 ? { text: fmtSignedKg(delta), tone: delta > 0 ? ('ok' as const) : ('warn' as const) } : null;
  const flags = prescription.flags.map((f) => FLAG_TEXT[f]).filter((t): t is string => !!t);
  return { weight, scheme, change, flags };
}
