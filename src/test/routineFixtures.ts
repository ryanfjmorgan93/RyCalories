/**
 * Fixtures for the routine builder's tests.
 *
 * `seededInput` is the owner's real starting data as a builder input: the 27 seeded exercises with
 * the weights their seeded routines give them, the five seeded routines, and the real catalogue and
 * bundled diagrams, built through the same `buildQuickInput` the app uses. `cand` and `miniInput` make small
 * hand-built pools, for tests where one rule has to be seen changing the outcome.
 */
import { readFileSync } from 'node:fs';
import { SEED_EXERCISES, SEED_ROUTINES, SEED_ROUTINE_EXERCISES } from '../db/seed';
import { EXERCISE_DEMOS } from '../data/exerciseDemos';
import type { CatalogueEntry } from '../domain/catalogue';
import { buildQuickInput, diagramCandidateId } from '../domain/quickInput';
import type { Candidate } from '../domain/quickSession';
import type { RoutineInput } from '../domain/routineBuilder';
import { buildRoutineContext, type RoutineContext } from '../domain/routineContext';
import { DEFAULT_SETTINGS, type Equipment, type Exercise, type MuscleGroup, type Session, type SetLog, type Settings } from '../domain/types';

export const TODAY = '2026-10-01';
const CREATED = '2026-01-01T09:00:00.000Z';

/** The real catalogue, read from disk as the data file it is. */
export const CATALOGUE = JSON.parse(readFileSync(new URL('../data/exerciseCatalogue.json', import.meta.url), 'utf8')) as CatalogueEntry[];

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
  /** Without the catalogue the pool has none of it. Default: with. */
  catalogue?: boolean;
  /** Without the bundled diagrams the pool has none of them. Default: with. */
  diagrams?: boolean;
  settings?: Partial<Settings>;
  /** Without any logged set, as on a fresh install: the equipment they have used is what their routines use. Default: with. */
  sets?: boolean;
  /** Seeded exercises the owner does not have (by name), and so not in their routines either. */
  without?: string[];
}

export function seededInput(opts: FixtureOptions = {}): RoutineInput {
  const gone = new Set(opts.without ?? []);
  const exercises = OWN_EXERCISES.filter((e) => !gone.has(e.name));
  const have = new Set(exercises.map((e) => e.id));
  const routineExercises = SEED_ROUTINE_EXERCISES.filter((rx) => have.has(rx.exerciseId));
  const { sessions, setLogs } = opts.sets === false ? { sessions: [], setLogs: [] } : history(exercises);
  const settings: Settings = { ...SETTINGS, ...opts.settings, ...(opts.weeklyTargets ? { weeklySetTargets: opts.weeklyTargets } : {}) };
  const { input } = buildQuickInput(
    {
      exercises,
      routines: SEED_ROUTINES,
      routineExercises,
      sessions,
      setLogs,
      recency: opts.recency ?? {},
      weeklySets: {},
      ...(opts.catalogue === false ? {} : { catalogue: CATALOGUE }),
      ...(opts.diagrams === false ? {} : { demos: EXERCISE_DEMOS }),
    },
    settings,
    TODAY,
  );
  if (opts.context === null) return input;
  const seeded = buildRoutineContext(
    { exercises, routines: SEED_ROUTINES, routineExercises, sessions: [], decisions: [] },
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
  /** A bundled diagram they have not got yet. */
  diagram?: boolean;
  daysSinceUsed?: number;
  unilateral?: boolean;
}

/** A candidate named as the app names exercises, so its movement is read from the name as it would be in the app. */
export function cand(name: string, muscleGroup: MuscleGroup, o: CandidateOptions = {}): Candidate {
  const library = o.library === true;
  const diagram = o.diagram === true;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const id = library ? `cat:${slug}` : diagram ? diagramCandidateId(slug) : name;
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
    origin: library ? 'catalogue' : diagram ? 'diagram' : 'own',
  };
  if (library) {
    out.catalogueSlug = id.slice(4);
    out.level = 'beginner';
  }
  if (diagram) out.demoSlug = slug;
  if (o.weight !== undefined) out.base = { sets: 3, repMin: 8, repMax: 12, weightKg: o.weight, mode: 'normal' };
  if (o.daysSinceUsed !== undefined) out.daysSinceUsed = o.daysSinceUsed;
  return out;
}

export function miniInput(candidates: Candidate[], over: Partial<RoutineInput> = {}): RoutineInput {
  return { candidates, recency: {}, weeklySets: {}, settings: QUICK_SETTINGS, pace: 1, ...over };
}

export const seedsFrom = (n: number, from = 1): number[] => Array.from({ length: n }, (_, i) => from + i);
