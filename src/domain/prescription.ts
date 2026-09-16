/**
 * Pure prescription — what to tell the user before a set: weight, set/rep targets, a one-line
 * summary and any flags worth surfacing. No IO, no clock, no database.
 */
import { producesWeightDecision, roundKg, type SessionOutcome, type Suggestion } from './engine';
import { fmtNum, fmtRange, fmtWeight } from './format';
import { roundToPlates, type PlateOptions } from './plates';
import { DEFAULT_SETTINGS, type Equipment, type ExerciseKind, type RoutineExercise, type Settings } from './types';

export interface PrescriptionInput {
  rx: Pick<
    RoutineExercise,
    'targetSets' | 'targetSetsMax' | 'repMin' | 'repMax' | 'currentWeight' | 'increment' | 'mode' | 'distanceMinM' | 'distanceMaxM'
  >;
  kind: ExerciseKind;
  equipment?: Equipment;
  lastOutcome?: SessionOutcome | null;
  stall?: Suggestion | null;
  deload?: boolean;
  settings: Pick<Settings, 'barKg' | 'plates' | 'deloadPercent'>;
}

export interface Prescription {
  /** kg; null when calibrating or not a weight exercise */
  weight: number | null;
  sets: number;
  repMin: number;
  repMax: number;
  /** "100 kg × 6–8 × 3" or "calibrating · 6–8 × 3" or "30–40 m × 3" */
  line: string;
  /** one short factual reason from the last outcome, e.g. "up 2.5 kg last time"; '' when there is none */
  reason: string;
  flags: ('calibrating' | 'stalled' | 'deload' | 'regression')[];
}

/**
 * A deload load: floor(currentWeight × percent) to the increment grid (multiples of increment),
 * then, when `plates` is given, snap down to what the bar can actually load (the caller only
 * passes plates for a barbell exercise). Never below 0.
 */
export function deloadLoad(currentWeight: number, percent: number, increment: number, plates?: PlateOptions): number {
  const raw = currentWeight * percent;
  const grid = Number.isFinite(increment) && increment > 0 ? Math.floor(raw / increment + 1e-9) * increment : raw;
  let result = roundKg(grid);
  if (plates) result = roundToPlates(result, plates);
  return Math.max(0, roundKg(result));
}

/** One short factual reason from the last outcome, in `decisionLine`'s vocabulary. */
function reasonFor(lastOutcome: SessionOutcome | null | undefined): string {
  if (!lastOutcome) return '';
  switch (lastOutcome.rule) {
    case 'increase': {
      const delta = roundKg(lastOutcome.appliedWeight - lastOutcome.fromWeight);
      return `up ${fmtNum(delta)} kg last time`;
    }
    case 'hold':
      return 'held last time';
    case 'hold_missing_sets':
      return 'held: missed sets last time';
    case 'deload':
      return 'deload last time';
    case 'lock_in':
      return 'locked in last time';
    default:
      return '';
  }
}

export function prescribe(input: PrescriptionInput): Prescription {
  const { rx, kind, equipment, lastOutcome, stall, deload, settings } = input;
  const repMin = rx.repMin;
  const repMax = rx.repMax;
  const calibrating = rx.mode === 'calibrating';
  const isWeightExercise = producesWeightDecision(kind);

  const barKg = settings.barKg ?? DEFAULT_SETTINGS.barKg!;
  const plateSizes = settings.plates ?? DEFAULT_SETTINGS.plates!;
  const deloadPercent = settings.deloadPercent ?? DEFAULT_SETTINGS.deloadPercent!;

  let weight: number | null = null;
  if (!calibrating && isWeightExercise) {
    weight = deload
      ? deloadLoad(rx.currentWeight, deloadPercent, rx.increment, equipment === 'barbell' ? { barKg, plates: plateSizes } : undefined)
      : roundKg(rx.currentWeight);
  }

  const setsLabel = rx.targetSetsMax && rx.targetSetsMax > rx.targetSets ? `${rx.targetSets}–${rx.targetSetsMax}` : `${rx.targetSets}`;

  let line: string;
  if (kind === 'carry') {
    const dist = rx.distanceMinM !== undefined && rx.distanceMaxM !== undefined ? fmtRange(rx.distanceMinM, rx.distanceMaxM, 'm') : '';
    line = calibrating ? `calibrating · ${dist} × ${setsLabel}` : `${dist} × ${setsLabel}`;
  } else if (kind === 'timed') {
    const t = fmtRange(repMin, repMax, 's');
    line = calibrating ? `calibrating · ${t} × ${setsLabel}` : `${t} × ${setsLabel}`;
  } else {
    const reps = fmtRange(repMin, repMax);
    line = calibrating ? `calibrating · ${reps} × ${setsLabel}` : `${fmtWeight(kind, weight as number)} × ${reps} × ${setsLabel}`;
  }
  if (deload) line += ' · deload';

  const flags: Prescription['flags'] = [];
  if (calibrating) flags.push('calibrating');
  if (stall?.kind === 'stalled') flags.push('stalled');
  if (deload) flags.push('deload');
  if (stall?.kind === 'regression') flags.push('regression');

  return { weight, sets: rx.targetSets, repMin, repMax, line, reason: reasonFor(lastOutcome), flags };
}
