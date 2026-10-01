/**
 * Fixtures for the routine builder's tests.
 *
 * `seededInput` is the owner's real starting data as a builder input: the 27 seeded exercises with
 * the weights their seeded routines give them, the five seeded routines, and the real catalogue,
 * built through the same `buildQuickInput` the app uses. `cand` and `miniInput` make small
 * hand-built pools, for tests where one rule has to be seen changing the outcome.
 */
import catalogueJson from '../data/exerciseCatalogue.json';
import { SEED_EXERCISES, SEED_ROUTINES, SEED_ROUTINE_EXERCISES } from '../db/seed';
import type { CatalogueEntry } from '../domain/catalogue';
import { buildQuickInput } from '../domain/quickInput';
import type { Candidate } from '../domain/quickSession';
import type { RoutineInput } from '../domain/routineBuilder';
import { buildRoutineContext, type RoutineContext } from '../domain/routineContext';
import { DEFAULT_SETTINGS, type Equipment, type Exercise, type MuscleGroup, type Session, type SetLog, type Settings } from '../domain/types';

export const TODAY = '2026-10-01';
const CREATED = '2026-01-01T09:00:00.000Z';

export const CATALOGUE = catalogueJson as CatalogueEntry[];

export const SETTINGS: Settings = { ...DEFAULT_SETTINGS, id: 'settings', createdAt: CREATED };

export const OWN_EXERCISES: Exercise[] = SEED_EXERCISES.map((e) => ({ ...e, createdAt: CREATED }));

/** One finished session with a counted set on every seeded exercise: the equipment the owner has used is what the seeds use. */
function history(exercises: Exercise[]): { sessions: Session[]; setLogs: SetLog[] } {
  const sessions: Session[] = [{ id: 'hist', routineId: '', title: 'Past', startedAt: '2026-09-01T09:00:00.000Z', endedAt: '2026-09-01T10:00:00.000Z', durationSec: 3600 }];
  const setLogs: SetLog[] = exercises.map((e, i) => ({
    id: `hist-${i}`,
    sessionId: 'hist',
    routineExerciseId: null,
    exerciseId: e.id,
    index: 0,
    type: 'working',
    weight: 10,
    reps: 8,
    completedAt: '2026-09-01T09:30:00.000Z',
  }));
  return { sessions, setLogs };
}

export interface FixtureOptions {
  recency?: Partial<Record<MuscleGroup, number>>;
  weeklyTargets?: Partial<Record<MuscleGroup, number>>;
  /** The owner's routines, niggles and stalls. Default: their five seeded routines and nothing else. `null`: no context at all. */
  context?: Partial<RoutineContext> | null;
  /** Without the catalogue the pool is the owner's own 27. */
  catalogue?: boolean;
  settings?: Partial<Settings>;
}

export function seededInput(opts: FixtureOptions = {}): RoutineInput {
  const { sessions, setLogs } = history(OWN_EXERCISES);
  const settings: Settings = { ...SETTINGS, ...opts.settings, ...(opts.weeklyTargets ? { weeklySetTargets: opts.weeklyTargets } : {}) };
  const { input } = buildQuickInput(
    {
      exercises: OWN_EXERCISES,
      routines: SEED_ROUTINES,
      routineExercises: SEED_ROUTINE_EXERCISES,
      sessions,
      setLogs,
      recency: opts.recency ?? {},
      weeklySets: {},
      ...(opts.catalogue === false ? {} : { catalogue: CATALOGUE }),
    },
    settings,
    TODAY,
  );
  if (opts.context === null) return input;
  const seeded = buildRoutineContext(
    { exercises: OWN_EXERCISES, routines: SEED_ROUTINES, routineExercises: SEED_ROUTINE_EXERCISES, sessions: [], decisions: [] },
    TODAY,
  );
  return { ...input, context: { ...seeded, ...opts.context } };
}

// ---------------------------------------------------------------------------
// Small hand-made pools

export const QUICK_SETTINGS: RoutineInput['settings'] = {
  restCompoundSec: 150,
  restIsolationSec: 75,
  restCarrySec: 90,
  barKg: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
};

interface CandidateOptions {
  equipment?: Equipment;
  compound?: boolean;
  /** The owner's working weight; absent = never done / calibrating. */
  weight?: number;
  /** A catalogue exercise they have not got yet. */
  library?: boolean;
  daysSinceUsed?: number;
  unilateral?: boolean;
}

/** A candidate named as the app names exercises, so its movement is read from the name as it would be in the app. */
export function cand(name: string, muscleGroup: MuscleGroup, o: CandidateOptions = {}): Candidate {
  const library = o.library === true;
  const id = library ? `cat:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : name;
  const out: Candidate = {
    id,
    name,
    muscleGroup,
    equipment: o.equipment ?? 'dumbbell',
    kind: 'reps',
    isCompound: o.compound ?? false,
    isLowerBody: false,
    unilateral: o.unilateral ?? false,
    defaultIncrement: 2,
    defaultRestSec: o.compound ? 150 : 75,
    origin: library ? 'catalogue' : 'own',
  };
  if (library) {
    out.catalogueSlug = id.slice(4);
    out.level = 'beginner';
  }
  if (o.weight !== undefined) out.base = { sets: 3, repMin: 8, repMax: 12, weightKg: o.weight, mode: 'normal' };
  if (o.daysSinceUsed !== undefined) out.daysSinceUsed = o.daysSinceUsed;
  return out;
}

export function miniInput(candidates: Candidate[], over: Partial<RoutineInput> = {}): RoutineInput {
  return { candidates, recency: {}, weeklySets: {}, settings: QUICK_SETTINGS, pace: 1, ...over };
}

export const seedsFrom = (n: number, from = 1): number[] => Array.from({ length: n }, (_, i) => from + i);
