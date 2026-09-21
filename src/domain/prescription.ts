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
  /**
   * kg the prescribed weight actually moved by — a number, not the `reason` sentence, so a caller
   * isn't reduced to parsing it back out. Positive for an increase or a lock-in, negative for a
   * deviated hold that came in under prescription or a deload drop (today's own deload wins over
   * an older increase); null when nothing moved. Never hides a decrease.
   */
  weightDelta: number | null;
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

/**
 * The numeric counterpart of `reasonFor`. Not a per-rule lookup: for every outcome except a
 * deload, the stored weight simply moved from `fromWeight` to `appliedWeight` — that covers an
 * increase, an overridden increase, a deviated hold (§4.1's "re-prescribes the deviated weight
 * visibly rather than snapping back silently" — see `decide` in `engine.ts`), hold_missing_sets
 * and a lock-in alike, with no list of rules to keep in step with the engine. A deload outcome is
 * the one case that needs reconstructing: it stores `appliedWeight === fromWeight` (progression
 * doesn't move on a deload), so its drop is recomputed with the same `deloadLoad` maths `prescribe`
 * itself uses to show a deload weight — i.e. what that session's own prescription card would have
 * shown.
 *
 * But today's own prescription wins if today is itself a deload: the chip sits beside today's
 * line, so once that line reads a reduced weight the chip must describe that drop, not an increase
 * from a session ago — otherwise a green "+2.5 kg" would sit right next to a deload weight.
 */
function weightDeltaFor(
  lastOutcome: SessionOutcome | null | undefined,
  today: { deload: boolean; weight: number | null; currentWeight: number },
  increment: number,
  equipment: Equipment | undefined,
  barKg: number,
  plateSizes: number[],
  deloadPercent: number,
): number | null {
  if (today.deload && today.weight !== null) {
    const delta = roundKg(today.weight - today.currentWeight);
    return delta < 0 ? delta : null;
  }
  if (!lastOutcome) return null;
  if (lastOutcome.rule === 'deload') {
    const deloaded = deloadLoad(lastOutcome.fromWeight, deloadPercent, increment, equipment === 'barbell' ? { barKg, plates: plateSizes } : undefined);
    const delta = roundKg(deloaded - lastOutcome.fromWeight);
    return delta < 0 ? delta : null;
  }
  const delta = roundKg(lastOutcome.appliedWeight - lastOutcome.fromWeight);
  return delta !== 0 ? delta : null;
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

  const weightDelta = weightDeltaFor(lastOutcome, { deload: !!deload, weight, currentWeight: rx.currentWeight }, rx.increment, equipment, barKg, plateSizes, deloadPercent);

  return { weight, sets: rx.targetSets, repMin, repMax, line, reason: reasonFor(lastOutcome), weightDelta, flags };
}
