/**
 * Personal records. Pure functions only — no IO, no clock, no database.
 *
 * Only sets that count for progression (working, failure) can set or hold a record — a drop set
 * is lighter by definition and a warm-up was never meant to be a max effort. A tie is not an
 * improvement: showing "matched" as a record would be a number that flatters.
 */
import { countsForRecords } from './sets';
import { e1rmFor, type E1rmFormula } from './strength';
import type { ExerciseKind, SetType } from './types';

export interface RecordSet {
  type: SetType;
  weight: number;
  reps?: number;
}

export interface RecordSession {
  sessionId: string;
  startedAt: string;
  source?: 'hevy' | 'backup';
  sets: RecordSet[];
}

export type RecordKind = 'weight' | 'e1rm' | 'set_volume' | 'reps_at_weight';

export interface PersonalRecord {
  kind: RecordKind;
  /** The new best: kg for weight, kg for e1rm, kg×reps for set_volume, reps for reps_at_weight. */
  value: number;
  weight: number;
  reps?: number;
  /** Index into the new sets that set it. */
  setIndex: number;
  /** The best it beat, null when there was no prior counted set at all. */
  previous: number | null;
  /** Where the beaten best came from: 'hevy' when the prior best session had source 'hevy', 'app' otherwise, null when no prior. */
  previousSource: 'app' | 'hevy' | null;
}

export interface Bests {
  weight: number | null;
  e1rm: number | null;
  setVolume: number | null;
  repsAtWeight: Map<number, number>;
}

interface BestsOpts {
  formula?: E1rmFormula;
  bodyweightKg?: number;
}

interface Candidate {
  value: number;
  setIndex: number;
  weight: number;
  reps?: number;
  /** The prior session that held the best this candidate beats, for attribution. */
  holder: RecordSession | null;
}

function countedSets(sets: RecordSet[]): RecordSet[] {
  return sets.filter((s) => countsForRecords(s.type));
}

function setVolume(s: RecordSet): number {
  return s.weight * (s.reps ?? 0);
}

/** A backup counts as the app; only an actual Hevy import is attributed to Hevy. */
function sourceLabel(source: RecordSession['source']): 'app' | 'hevy' {
  return source === 'hevy' ? 'hevy' : 'app';
}

/** The best figures a set of sessions has produced, over the sets that count for records. */
export function bestsFor(kind: ExerciseKind, sessions: RecordSession[], opts: BestsOpts = {}): Bests {
  const bests: Bests = { weight: null, e1rm: null, setVolume: null, repsAtWeight: new Map() };
  for (const session of sessions) {
    for (const s of countedSets(session.sets)) {
      if (bests.weight === null || s.weight > bests.weight) bests.weight = s.weight;

      const e = e1rmFor(kind, s.weight, s.reps, opts);
      if (e !== null && (bests.e1rm === null || e > bests.e1rm)) bests.e1rm = e;

      if (s.reps !== undefined) {
        const vol = setVolume(s);
        if (bests.setVolume === null || vol > bests.setVolume) bests.setVolume = vol;

        const priorReps = bests.repsAtWeight.get(s.weight);
        if (priorReps === undefined || s.reps > priorReps) bests.repsAtWeight.set(s.weight, s.reps);
      }
    }
  }
  return bests;
}

/**
 * Find the best candidate among `newSets` for one record kind: `valueOf` returns the value a set
 * would set (or undefined when this kind does not apply to it), and `priorBestFor` returns the
 * threshold that value has to strictly beat, keyed on the set itself (reps_at_weight's threshold
 * depends on the set's own weight). `holderFor` locates the prior session that held that
 * threshold, for attribution.
 */
function pickBest(
  newSets: RecordSet[],
  valueOf: (s: RecordSet) => number | undefined,
  priorBestFor: (s: RecordSet) => number | null,
  holderFor: (s: RecordSet, priorBest: number) => RecordSession | null,
): Candidate | null {
  let best: Candidate | null = null;
  newSets.forEach((s, setIndex) => {
    if (!countsForRecords(s.type)) return;
    const value = valueOf(s);
    if (value === undefined) return;
    const priorBest = priorBestFor(s);
    if (priorBest !== null && value <= priorBest) return;
    if (best !== null && value <= best.value) return;
    best = { value, setIndex, weight: s.weight, reps: s.reps, holder: priorBest === null ? null : holderFor(s, priorBest) };
  });
  return best;
}

/**
 * New personal records set by `newSets`, against the bests already held in `prior`. Each kind is
 * reported at most once, for whichever new set produced the best value of that kind. A record
 * needs a strict improvement over the prior best — a tie sets nothing.
 */
export function newRecords(
  kind: ExerciseKind,
  newSets: RecordSet[],
  prior: RecordSession[],
  opts: BestsOpts = {},
): PersonalRecord[] {
  // A carry is a distance/load exercise and a timed hold has no reps or weight progression in
  // the sense the other kinds do — neither produces a meaningful personal record here.
  if (kind === 'carry' || kind === 'timed') return [];

  const priorBests = bestsFor(kind, prior, opts);
  const counted = (sets: RecordSet[]) => countedSets(sets);

  const findByWeight = (target: number) => {
    for (const session of prior) {
      if (counted(session.sets).some((s) => s.weight === target)) return session;
    }
    return null;
  };
  const findByE1rm = (target: number) => {
    for (const session of prior) {
      if (counted(session.sets).some((s) => e1rmFor(kind, s.weight, s.reps, opts) === target)) return session;
    }
    return null;
  };
  const findBySetVolume = (target: number) => {
    for (const session of prior) {
      if (counted(session.sets).some((s) => s.reps !== undefined && setVolume(s) === target)) return session;
    }
    return null;
  };
  const findByRepsAtWeight = (weight: number, target: number) => {
    for (const session of prior) {
      if (counted(session.sets).some((s) => s.weight === weight && s.reps === target)) return session;
    }
    return null;
  };

  const records: PersonalRecord[] = [];

  const weightCand = pickBest(
    newSets,
    (s) => s.weight,
    () => priorBests.weight,
    (_s, priorBest) => findByWeight(priorBest),
  );
  if (weightCand !== null) {
    records.push({
      kind: 'weight',
      value: weightCand.value,
      weight: weightCand.weight,
      reps: weightCand.reps,
      setIndex: weightCand.setIndex,
      previous: priorBests.weight,
      previousSource: priorBests.weight === null ? null : sourceLabel(weightCand.holder?.source),
    });
  }

  const e1rmCand = pickBest(
    newSets,
    (s) => e1rmFor(kind, s.weight, s.reps, opts) ?? undefined,
    () => priorBests.e1rm,
    (_s, priorBest) => findByE1rm(priorBest),
  );
  if (e1rmCand !== null) {
    records.push({
      kind: 'e1rm',
      value: e1rmCand.value,
      weight: e1rmCand.weight,
      reps: e1rmCand.reps,
      setIndex: e1rmCand.setIndex,
      previous: priorBests.e1rm,
      previousSource: priorBests.e1rm === null ? null : sourceLabel(e1rmCand.holder?.source),
    });
  }

  const volumeCand = pickBest(
    newSets,
    (s) => (s.reps === undefined ? undefined : setVolume(s)),
    () => priorBests.setVolume,
    (_s, priorBest) => findBySetVolume(priorBest),
  );
  if (volumeCand !== null) {
    records.push({
      kind: 'set_volume',
      value: volumeCand.value,
      weight: volumeCand.weight,
      reps: volumeCand.reps,
      setIndex: volumeCand.setIndex,
      previous: priorBests.setVolume,
      previousSource: priorBests.setVolume === null ? null : sourceLabel(volumeCand.holder?.source),
    });
  }

  // reps_at_weight only applies when that exact weight has a prior best to beat — otherwise a
  // heavier-than-ever set is a weight record, not a reps-at-weight one.
  const repsCand = pickBest(
    newSets,
    // Only a weight that has been lifted before can carry a reps-at-weight record; a weight
    // that is entirely new is a weight record, handled above.
    (s) => (s.reps === undefined || !priorBests.repsAtWeight.has(s.weight) ? undefined : s.reps),
    (s) => priorBests.repsAtWeight.get(s.weight) ?? null,
    (s, priorBest) => findByRepsAtWeight(s.weight, priorBest),
  );
  if (repsCand !== null) {
    const priorReps = priorBests.repsAtWeight.get(repsCand.weight) ?? null;
    records.push({
      kind: 'reps_at_weight',
      value: repsCand.value,
      weight: repsCand.weight,
      reps: repsCand.reps,
      setIndex: repsCand.setIndex,
      previous: priorReps,
      previousSource: priorReps === null ? null : sourceLabel(repsCand.holder?.source),
    });
  }

  return records;
}
