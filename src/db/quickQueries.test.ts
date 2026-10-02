import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { loadQuickInput } from './quickQueries';
import { startQuickSession } from './quickRepo';
import { addRoutineExercise, createExercise, createRoutine, exerciseHistory, logSet, resetToSeed, saveSettings, startSession, updateSession } from './repo';
import { SEED_EXERCISE_IDS, SEED_EXERCISES, SEED_ROUTINE_IDS } from './seed';
import { muscleRecency, weeklySetsByMuscle } from './volumeQueries';
import { loadCatalogue } from '@/data/catalogue';
import { exerciseFromCatalogue, type CatalogueEntry } from '@/domain/catalogue';
import { mondayOf } from '@/domain/dates';
import type { Candidate, QuickPlan, QuickRow } from '@/domain/quickSession';
import type { Exercise, Session, Settings } from '@/domain/types';

const TODAY = '2026-09-30';
/** An ISO timestamp at local noon, `days` before TODAY. */
const noon = (days: number): string => new Date(2026, 8, 30 - days, 12, 0, 0).toISOString();

const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];
const PUSH = SEED_ROUTINE_IDS['Upper (Push)'];
const PULL = SEED_ROUTINE_IDS['Upper (Pull)'];
const ARMS = SEED_ROUTINE_IDS['Arms (Day 5)'];

const BENCH = SEED_EXERCISE_IDS['Bench Press (Barbell)'];
const INCLINE = SEED_EXERCISE_IDS['Incline DB Press'];
const RDL = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'];
const DB_CURL = SEED_EXERCISE_IDS['DB Curl'];
const CABLE_CRUNCH = SEED_EXERCISE_IDS['Cable Crunch'];

const settings = async (): Promise<Settings> => (await db.settings.get('settings'))!;
const load = async (includeNew = false) => loadQuickInput({ today: TODAY, settings: await settings(), includeNew });
const candidate = async (id: string, includeNew = false): Promise<Candidate> => (await load(includeNew)).input.candidates.find((c) => c.id === id)!;

interface Logged {
  exerciseId: string;
  weight: number;
  reps: number;
  type?: 'working' | 'warmup' | 'drop';
}

/**
 * A finished real session on a seeded routine, `daysAgo` before TODAY. An exercise the routine has
 * is logged against its row; any other is an extra, as a session can have.
 */
async function realSession(routineId: string, daysAgo: number, sets: Logged[], durationSec = 1800): Promise<Session> {
  const s = await startSession(routineId);
  const rows = await db.routineExercises.where('routineId').equals(routineId).toArray();
  for (const x of sets) {
    await logSet({
      sessionId: s.id,
      routineExerciseId: rows.find((r) => r.exerciseId === x.exerciseId)?.id ?? null,
      exerciseId: x.exerciseId,
      type: x.type ?? 'working',
      weight: x.weight,
      reps: x.reps,
    });
  }
  await db.setLogs.where('sessionId').equals(s.id).modify({ completedAt: noon(daysAgo) });
  await updateSession(s.id, { startedAt: noon(daysAgo), endedAt: noon(daysAgo), durationSec });
  return (await db.sessions.get(s.id))!;
}

function candidateOf(e: Exercise): Candidate {
  return {
    id: e.id,
    name: e.name,
    muscleGroup: e.muscleGroup,
    equipment: e.equipment,
    kind: e.kind,
    isCompound: e.isCompound,
    isLowerBody: e.isLowerBody,
    unilateral: e.unilateral,
    defaultIncrement: e.defaultIncrement,
    defaultRestSec: e.defaultRestSec,
    origin: 'own',
  };
}

function rowOf(e: Exercise, over: Partial<QuickRow> = {}): QuickRow {
  return { candidate: candidateOf(e), sets: 2, repMin: 10, repMax: 15, weightKg: 20, mode: 'normal', restSec: 75, daysSince: null, ...over };
}

/** A finished quick session, `daysAgo` before TODAY, with sets logged on the hidden routine's rows. */
async function quickSession(rows: QuickRow[], effort: 'light' | 'normal', daysAgo: number, sets: { row: number; weight: number; reps: number }[]): Promise<Session> {
  const plan: QuickPlan = { rows, estimateMin: 20, shortfall: 0, unmet: [], relaxed: false, focus: [], seed: 1 };
  const s = await startQuickSession(plan, [], effort);
  const hidden = await db.routineExercises.where('routineId').equals(s.routineId).sortBy('order');
  for (const x of sets) {
    await logSet({ sessionId: s.id, routineExerciseId: hidden[x.row].id, exerciseId: hidden[x.row].exerciseId, type: 'working', weight: x.weight, reps: x.reps });
  }
  await db.setLogs.where('sessionId').equals(s.id).modify({ completedAt: noon(daysAgo) });
  await updateSession(s.id, { startedAt: noon(daysAgo), endedAt: noon(daysAgo), durationSec: 1200 });
  return (await db.sessions.get(s.id))!;
}

async function customExercise(over: Partial<Exercise> = {}): Promise<Exercise> {
  const { id: _id, createdAt: _createdAt, ...rest } = SEED_EXERCISES.find((e) => e.id === BENCH)! as Exercise;
  return createExercise({ ...rest, name: 'Custom Press', aliases: undefined, demo: undefined, standard: undefined, equipment: 'dumbbell', isCompound: false, muscleGroup: 'shoulders', ...over });
}

beforeEach(async () => {
  await resetToSeed();
});

// ---------------------------------------------------------------------------

describe('loadQuickInput: every exercise of the owner, with its base', () => {
  it('has a candidate for each exercise, all of them the owner\'s own', async () => {
    const { input, catalogueEntries } = await load();
    expect(input.candidates.map((c) => c.id).sort()).toEqual(SEED_EXERCISES.map((e) => e.id).sort());
    expect(input.candidates.every((c) => c.origin === 'own')).toBe(true);
    expect(catalogueEntries).toEqual([]);
  });

  it('reads each base from the exercise\'s row in a real routine: sets, reps and weight', async () => {
    expect((await candidate(BENCH)).base).toEqual({ sets: 4, repMin: 6, repMax: 8, weightKg: 65, mode: 'normal' });
    expect((await candidate(RDL)).base).toEqual({ sets: 4, repMin: 6, repMax: 8, weightKg: 110, mode: 'normal' });
  });

  it('an exercise only ever calibrating has a calibrating base with no weight', async () => {
    expect((await candidate(INCLINE)).base).toEqual({ sets: 3, repMin: 6, repMax: 8, weightKg: null, mode: 'calibrating' });
  });

  it('takes the lowest working weight when two routines have the same exercise, and ignores a calibrating row beside them', async () => {
    const rows = await db.routineExercises.where('exerciseId').equals(DB_CURL).toArray();
    expect(rows.map((r) => r.routineId).sort()).toEqual([PULL, ARMS].sort());
    const [pull, arms] = [rows.find((r) => r.routineId === PULL)!, rows.find((r) => r.routineId === ARMS)!];
    await db.routineExercises.update(pull.id, { currentWeight: 14 });
    await db.routineExercises.update(arms.id, { currentWeight: 12, targetSets: 5 });
    expect((await candidate(DB_CURL)).base).toMatchObject({ weightKg: 12, sets: 5, mode: 'normal' });

    await db.routineExercises.update(arms.id, { mode: 'calibrating', currentWeight: 0 });
    expect((await candidate(DB_CURL)).base).toMatchObject({ weightKg: 14, mode: 'normal' });
  });

  it('reads nothing from an archived routine', async () => {
    await db.routines.update(HINGE, { archived: true });
    expect((await candidate(RDL)).base).toBeUndefined();
  });

  it('prefers the routine\'s weight to what was lifted last', async () => {
    await realSession(PUSH, 4, [{ exerciseId: BENCH, weight: 100, reps: 5 }]);
    expect((await candidate(BENCH)).base).toMatchObject({ weightKg: 65 });
  });

  it('for an exercise in no routine, reads the last top working set of a real finished session', async () => {
    const press = await customExercise();
    await realSession(PUSH, 20, [{ exerciseId: press.id, weight: 100, reps: 5 }]);
    await realSession(PUSH, 3, [
      { exerciseId: press.id, weight: 20, reps: 10, type: 'warmup' },
      { exerciseId: press.id, weight: 90, reps: 6 },
      { exerciseId: press.id, weight: 90, reps: 5 },
      { exerciseId: press.id, weight: 70, reps: 8, type: 'drop' },
    ]);
    // Last time, not the best ever; warm-ups and drop sets are not what it was done at.
    expect((await candidate(press.id)).base).toEqual({ sets: 2, repMin: 5, repMax: 6, weightKg: 90, mode: 'normal' });
  });

  it('has no base for an exercise in no routine that was never done', async () => {
    const press = await customExercise();
    expect((await candidate(press.id)).base).toBeUndefined();
  });

  it('agrees with the history the exercise screen shows', async () => {
    const press = await customExercise();
    await realSession(PUSH, 12, [{ exerciseId: press.id, weight: 60, reps: 8 }]);
    await realSession(PUSH, 6, [{ exerciseId: press.id, weight: 65, reps: 8 }, { exerciseId: press.id, weight: 62.5, reps: 8 }]);
    const latest = (await exerciseHistory(press.id)).find((h) => h.topWeight > 0)!;
    const base = (await candidate(press.id)).base!;
    expect(base.weightKg).toBe(latest.topWeight);
    expect(base.repMax).toBe(latest.topReps);
  });
});

describe('loadQuickInput: a quick session is neither a base nor a recency for an exercise', () => {
  it('leaves the base and the days since as the real sessions made them', async () => {
    const press = await customExercise();
    await realSession(PUSH, 10, [{ exerciseId: press.id, weight: 60, reps: 8 }]);
    // Yesterday, light: a fraction of the working weight.
    await quickSession([rowOf(press, { weightKg: 39 })], 'light', 1, [{ row: 0, weight: 39, reps: 12 }]);

    const c = await candidate(press.id);
    expect(c.base).toMatchObject({ weightKg: 60 });
    expect(c.daysSinceUsed).toBe(10);
  });

  it('gives an exercise done only in a quick session no base and no days since', async () => {
    const press = await customExercise();
    await quickSession([rowOf(press)], 'normal', 2, [{ row: 0, weight: 40, reps: 10 }]);
    const c = await candidate(press.id);
    expect(c.base).toBeUndefined();
    expect(c).not.toHaveProperty('daysSinceUsed');
  });

  it('reads nothing from the hidden routine\'s rows', async () => {
    const press = await customExercise();
    const live = await startQuickSession({ rows: [rowOf(press, { weightKg: 26 })], estimateMin: 10, shortfall: 0, unmet: [], relaxed: false, focus: [], seed: 1 }, [], 'light');
    expect(live.routineId).toBeTruthy();
    expect((await candidate(press.id)).base).toBeUndefined();
  });

  it('still counts toward the muscles\' recency and weekly sets: a light session does train the muscle', async () => {
    const press = await customExercise({ muscleGroup: 'shoulders' });
    await quickSession([rowOf(press)], 'light', 1, [{ row: 0, weight: 20, reps: 12 }, { row: 0, weight: 20, reps: 12 }]);
    const { input } = await load();
    expect(input.recency.shoulders).toBe(1);
    expect(input.weeklySets.shoulders).toBe(2);
  });
});

describe('loadQuickInput: days since, recency, weekly sets, targets, pace', () => {
  it('counts whole days from the latest counted set of a real session', async () => {
    await realSession(PUSH, 12, [{ exerciseId: BENCH, weight: 65, reps: 8 }]);
    await realSession(PUSH, 6, [{ exerciseId: BENCH, weight: 65, reps: 8 }]);
    expect((await candidate(BENCH)).daysSinceUsed).toBe(6);
    expect(await candidate(INCLINE)).not.toHaveProperty('daysSinceUsed');
  });

  it('reads the muscles\' recency and this week\'s sets from the tables', async () => {
    // TODAY is a Wednesday: 1 day ago is Tuesday of the same week, 9 days ago is the week before.
    await realSession(PUSH, 1, [{ exerciseId: BENCH, weight: 65, reps: 8 }, { exerciseId: BENCH, weight: 65, reps: 8 }]);
    await realSession(PUSH, 9, [{ exerciseId: INCLINE, weight: 20, reps: 8 }]);
    const { input } = await load();
    expect(input.recency.chest).toBe(1);
    expect(input.weeklySets.chest).toBe(2);
    expect(input.recency.hamstrings).toBeUndefined();
  });

  it('carries the weekly targets and the rest and plate settings', async () => {
    await saveSettings({ weeklySetTargets: { chest: 12, biceps: 10 }, restCompoundSec: 200, barKg: 15 });
    const { input } = await load();
    expect(input.weeklyTargets).toEqual({ chest: 12, biceps: 10 });
    expect(input.settings).toMatchObject({ restCompoundSec: 200, restIsolationSec: 75, restCarrySec: 90, barKg: 15 });
  });

  it('is at the owner\'s own pace once they have three finished sessions, and 1 before', async () => {
    const press = await customExercise({ isCompound: true, defaultRestSec: 150 });
    const three = [{ exerciseId: press.id, weight: 50, reps: 8 }, { exerciseId: press.id, weight: 50, reps: 8 }, { exerciseId: press.id, weight: 50, reps: 8 }];
    await realSession(PUSH, 9, three, 600);
    await realSession(PUSH, 6, three, 600);
    expect((await load()).input.pace).toBe(1);
    await realSession(PUSH, 3, three, 600);
    // Three sets with 150 s rest model as 60 + 3 x 40 + 2 x 150 = 480 s; it took 600.
    expect((await load()).input.pace).toBeCloseTo(600 / 480, 10);
  });
});

describe('loadQuickInput: each table is read once', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the set logs, sessions and exercises once each, not once more for each figure drawn from them', async () => {
    await realSession(PUSH, 1, [{ exerciseId: BENCH, weight: 65, reps: 8 }]);
    // Spies call through: the real tables are read, and counted.
    const reads = [db.setLogs, db.sessions, db.exercises].map((table) => vi.spyOn(table, 'toArray'));

    await load();

    expect(reads.map((r) => r.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('gives the recency and weekly sets the standalone readers give, counting a quick session and not a live, deleted or unknown one', async () => {
    const press = await customExercise({ muscleGroup: 'shoulders' });
    const ghost = await customExercise({ name: 'Ghost Raise', muscleGroup: 'calves' });
    await realSession(PUSH, 1, [{ exerciseId: BENCH, weight: 65, reps: 8 }, { exerciseId: BENCH, weight: 65, reps: 8 }]);
    await realSession(PULL, 9, [{ exerciseId: DB_CURL, weight: 14, reps: 10 }]);
    await realSession(PUSH, 3, [{ exerciseId: ghost.id, weight: 10, reps: 10 }]);
    await db.exercises.delete(ghost.id);
    await quickSession([rowOf(press)], 'light', 2, [{ row: 0, weight: 20, reps: 12 }]);
    const live = await startSession(ARMS);
    await logSet({ sessionId: live.id, routineExerciseId: null, exerciseId: CABLE_CRUNCH, type: 'working', weight: 30, reps: 12 });

    const { input } = await load();

    expect(input.recency).toEqual(await muscleRecency(TODAY));
    expect(input.weeklySets).toEqual(await weeklySetsByMuscle(mondayOf(TODAY)));
    // Not vacuous: the figures are there to be compared.
    expect(input.weeklySets).toEqual({ chest: 2, shoulders: 1 });
    expect(input.recency).toMatchObject({ chest: 1, shoulders: 2, biceps: 9 });
    expect(input.recency.calves).toBeUndefined();
    expect(input.recency.abs).toBeUndefined();
  });
});

describe('loadQuickInput: the catalogue', () => {
  it('adds no catalogue candidate without includeNew', async () => {
    const { input, catalogueEntries } = await load(false);
    expect(input.candidates.filter((c) => c.origin === 'catalogue')).toEqual([]);
    expect(catalogueEntries).toEqual([]);
  });

  it('with includeNew, suggests only bodyweight and the equipment the owner has used, in a routine or with a logged set, none expert', async () => {
    const fresh = await load(true);
    const freshCat = fresh.input.candidates.filter((c) => c.origin === 'catalogue');
    // A fresh install has logged nothing, but its routines are built on barbells, dumbbells, machines and cables.
    expect(freshCat.length).toBeGreaterThan(0);
    expect(new Set(freshCat.map((c) => c.equipment))).toEqual(new Set(['bodyweight', 'barbell', 'dumbbell', 'machine', 'cable']));

    // A set on a kettlebell exercise no routine has opens up kettlebell, and only kettlebell.
    const swing = await customExercise({ name: 'Custom Swing', equipment: 'kettlebell', muscleGroup: 'glutes' });
    await realSession(PULL, 2, [{ exerciseId: swing.id, weight: 16, reps: 12 }]);
    const after = await load(true);
    const cat = after.input.candidates.filter((c) => c.origin === 'catalogue');
    expect(new Set(cat.map((c) => c.equipment))).toEqual(new Set(['bodyweight', 'barbell', 'dumbbell', 'machine', 'cable', 'kettlebell']));
    expect(cat.some((c) => c.level === 'expert')).toBe(false);
    expect(new Set(cat.map((c) => c.level))).toEqual(new Set(['beginner', 'intermediate']));
  });

  it('equipment an exercise brings by being in one of the owner\'s routines counts with no set logged; one in an archived routine, the hidden quick one or no routine does not', async () => {
    const bell = async (name: string) => customExercise({ name, equipment: 'kettlebell', muscleGroup: 'glutes' });
    const kettlebellEntries = async () => (await load(true)).catalogueEntries.filter((e) => e.equipment === 'kettlebell');
    expect(await kettlebellEntries()).toEqual([]);

    // In no routine: nothing.
    const loose = await bell('Loose Swing');
    expect(await kettlebellEntries()).toEqual([]);

    // In an archived routine: nothing.
    const gone = await createRoutine({ name: 'Old', isLowerBody: false });
    await addRoutineExercise(gone.id, (await bell('Archived Swing')).id);
    await db.routines.update(gone.id, { archived: true });
    expect(await kettlebellEntries()).toEqual([]);

    // In the hidden routine of a quick session: nothing.
    await startQuickSession({ rows: [rowOf(loose)], estimateMin: 10, shortfall: 0, unmet: [], relaxed: false, focus: [], seed: 1 }, [], 'normal');
    expect(await kettlebellEntries()).toEqual([]);

    // In one of their routines, never logged: kettlebell.
    await addRoutineExercise(PUSH, (await bell('Routine Swing')).id);
    expect((await kettlebellEntries()).length).toBeGreaterThan(0);
  });

  it('returns the entries behind the candidates, and each candidate is the entry it says it is', async () => {
    await realSession(PULL, 2, [{ exerciseId: CABLE_CRUNCH, weight: 30, reps: 12 }]);
    const { input, catalogueEntries } = await load(true);
    const cat = input.candidates.filter((c) => c.origin === 'catalogue');
    expect(catalogueEntries.map((e) => `cat:${e.slug}`)).toEqual(cat.map((c) => c.id));
    const all = await loadCatalogue();
    for (const c of cat) {
      const entry = all.find((e) => e.slug === c.catalogueSlug)!;
      expect(c).toMatchObject({ name: entry.name, muscleGroup: entry.muscleGroup, equipment: entry.equipment, level: entry.level });
      expect(catalogueEntries).toContainEqual(entry);
    }
  });

  it('leaves out an entry the owner already has, by its picture key or by name', async () => {
    const all = await loadCatalogue();
    const bodyweight = all.filter((e) => e.equipment === 'bodyweight' && e.level !== 'expert');
    const [byDemo, byName, free] = bodyweight;
    const before = (await load(true)).catalogueEntries.map((e) => e.slug);
    expect(before).toEqual(expect.arrayContaining([byDemo.slug, byName.slug, free.slug]));

    // One under its picture key, with another name; one by name alone.
    await createExercise({ ...exerciseFromCatalogue(byDemo), name: 'My version' });
    await createExercise({ ...exerciseFromCatalogue(byName), demo: undefined, name: byName.name.toUpperCase() });

    const after = (await load(true)).catalogueEntries.map((e) => e.slug);
    expect(after).not.toContain(byDemo.slug);
    expect(after).not.toContain(byName.slug);
    expect(after).toContain(free.slug);
    expect(after).toHaveLength(before.length - 2);
  });

  it('leaves out an entry whose exercise was made from it earlier, such as one a quick session used', async () => {
    const all: CatalogueEntry[] = await loadCatalogue();
    const entry = all.find((e) => e.equipment === 'bodyweight' && e.level === 'beginner')!;
    const row: QuickRow = {
      candidate: { ...candidateOf({ ...exerciseFromCatalogue(entry), id: `cat:${entry.slug}`, createdAt: '' }), origin: 'catalogue', catalogueSlug: entry.slug, level: entry.level },
      sets: 2,
      repMin: 10,
      repMax: 15,
      weightKg: null,
      mode: 'calibrating',
      restSec: 75,
      daysSince: null,
    };
    await startQuickSession({ rows: [row], estimateMin: 10, shortfall: 0, unmet: [], relaxed: false, focus: [], seed: 1 }, [entry], 'normal');
    const { input, catalogueEntries } = await load(true);
    expect(catalogueEntries.map((e) => e.slug)).not.toContain(entry.slug);
    // It is one of the owner's own exercises now.
    const made = input.candidates.find((c) => c.origin === 'own' && c.name === entry.name);
    expect(made).toBeDefined();
  });
});
