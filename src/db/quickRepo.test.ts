import Papa from 'papaparse';
import { beforeEach, describe, expect, it } from 'vitest';
import { gatherContext } from './assistantQueries';
import { exportBackup, exportCsv, importBackup, type Backup } from './backup';
import { calendarData } from './calendarQueries';
import { addCatalogueExercise, addDemoExercise } from './catalogueRepo';
import { db } from './db';
import { reconcileWeights } from './hevy';
import { startQuickSession } from './quickRepo';
import { bestsForExercise, e1rmSeries, recentRecords, recordsForNewSets, volumeSeries } from './recordsQueries';
import {
  addRoutineExercise,
  buildSummary,
  createExercise,
  createRoutine,
  deleteExercise,
  deleteSession,
  excludeQuickRoutineExercises,
  exerciseUsage,
  finishSession,
  getActiveSession,
  lastCompletedSession,
  lastWorkingTopWeight,
  listArchivedRoutines,
  listRoutines,
  logSet,
  nextRoutineContext,
  previousSets,
  resetToSeed,
  restoreRoutine,
  routineItems,
  startSession,
  updateRoutineExercise,
  updateSession,
  wipeAll,
  deleteRoutine,
  exerciseHistory,
} from './repo';
import { SEED_EXERCISE_IDS, SEED_EXERCISES, SEED_ROUTINE_IDS } from './seed';
import { legDayFor, wasLegDay } from './todayQueries';
import { weeklySetsByMuscle } from './volumeQueries';
import { buildContextBlock } from '@/domain/assistant';
import { exerciseFromCatalogue, isCatalogueDemo, type CatalogueEntry } from '@/domain/catalogue';
import { addDays, toDateKey } from '@/domain/dates';
import { exerciseFromDemo, type DemoLike } from '@/domain/library';
import type { Candidate, QuickPlan, QuickRow } from '@/domain/quickSession';
import { isConsecutiveLower, suggestNextRoutine } from '@/domain/schedule';
import { e1rm } from '@/domain/strength';
import type { Exercise, Session } from '@/domain/types';

const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];
const PUSH = SEED_ROUTINE_IDS['Upper (Push)'];
const SQUAT = SEED_ROUTINE_IDS['Lower (Squat)'];
const PULL = SEED_ROUTINE_IDS['Upper (Pull)'];

const ex = (id: string): Exercise => ({ ...SEED_EXERCISES.find((e) => e.id === id)!, createdAt: '' });
const RDL = ex(SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)']);
const HIP_THRUST = ex(SEED_EXERCISE_IDS['Hip Thrust (Barbell)']);
const LEG_CURL = ex(SEED_EXERCISE_IDS['Lying Leg Curl (Machine)']);
const BENCH = ex(SEED_EXERCISE_IDS['Bench Press (Barbell)']);
const INCLINE = ex(SEED_EXERCISE_IDS['Incline DB Press']);
const CRUNCH = ex(SEED_EXERCISE_IDS['Cable Crunch']);

// ---------------------------------------------------------------------------
// Fixtures: a plan is built by hand, so what reaches the database is exactly what each test says.

function candidateOf(e: Exercise, over: Partial<Candidate> = {}): Candidate {
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
    ...over,
  };
}

function rowOf(e: Exercise, over: Partial<QuickRow> = {}): QuickRow {
  return { candidate: candidateOf(e), sets: 2, repMin: 10, repMax: 15, weightKg: 20, mode: 'normal', restSec: 75, daysSince: null, ...over };
}

function planOf(rows: QuickRow[]): QuickPlan {
  return { rows, estimateMin: 20, shortfall: 0, unmet: [], relaxed: false, focus: [], seed: 1 };
}

function entryOf(slug: string, over: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return { slug, name: 'Cable Woodchop', muscleGroup: 'abs', equipment: 'cable', kind: 'reps', isCompound: false, unilateral: false, level: 'beginner', ...over };
}

function catalogueRowOf(entry: CatalogueEntry, over: Partial<QuickRow> = {}): QuickRow {
  const c = candidateOf({ ...exerciseFromCatalogue(entry), id: `cat:${entry.slug}`, createdAt: '' }, { origin: 'catalogue', catalogueSlug: entry.slug, level: entry.level });
  return { candidate: c, sets: 2, repMin: 10, repMax: 15, weightKg: null, mode: 'calibrating', restSec: 75, daysSince: null, ...over };
}

function demoOf(slug: string, over: Partial<DemoLike> = {}): DemoLike {
  return { slug, name: 'Cable Rear Delt Fly', equipment: 'Cable', muscleGroup: 'rear delts', ...over };
}

function diagramRowOf(demo: DemoLike, over: Partial<QuickRow> = {}): QuickRow {
  const c = candidateOf({ ...exerciseFromDemo(demo), id: `demo:${demo.slug}`, createdAt: '' }, { origin: 'diagram', demoSlug: demo.slug });
  return { candidate: c, sets: 2, repMin: 10, repMax: 15, weightKg: null, mode: 'calibrating', restSec: 75, daysSince: null, ...over };
}

interface LoggedSet {
  /** Index of the row in the plan (quick) or the exercise (real). */
  row?: number;
  exerciseId?: string;
  weight: number;
  reps: number;
}

/** A finished real session on a seeded routine. Ended directly: nothing here is about what finishing decides. */
async function realSession(routineId: string, startedAt: string, sets: LoggedSet[]): Promise<Session> {
  const s = await startSession(routineId);
  await updateSession(s.id, { startedAt });
  const rxs = await db.routineExercises.where('routineId').equals(routineId).toArray();
  for (const x of sets) {
    const rx = rxs.find((r) => r.exerciseId === x.exerciseId)!;
    await logSet({ sessionId: s.id, routineExerciseId: rx.id, exerciseId: x.exerciseId!, type: 'working', weight: x.weight, reps: x.reps });
  }
  await updateSession(s.id, { endedAt: startedAt, durationSec: 1800 });
  return (await db.sessions.get(s.id))!;
}

/** A finished quick session. Ended directly, for the same reason. */
async function quickSession(rows: QuickRow[], effort: 'light' | 'normal', startedAt: string, sets: LoggedSet[] = []): Promise<Session> {
  const s = await startQuickSession(planOf(rows), [], effort);
  await updateSession(s.id, { startedAt });
  const items = await routineItems(s.routineId);
  for (const x of sets) {
    const item = items[x.row!];
    await logSet({ sessionId: s.id, routineExerciseId: item.rx.id, exerciseId: item.exercise.id, type: 'working', weight: x.weight, reps: x.reps });
  }
  await updateSession(s.id, { endedAt: startedAt, durationSec: 1500 });
  return (await db.sessions.get(s.id))!;
}

async function counts() {
  const [exercises, routines, routineExercises, sessions, setLogs] = await Promise.all([
    db.exercises.count(),
    db.routines.count(),
    db.routineExercises.count(),
    db.sessions.count(),
    db.setLogs.count(),
  ]);
  return { exercises, routines, routineExercises, sessions, setLogs };
}

beforeEach(async () => {
  await resetToSeed();
});

// ---------------------------------------------------------------------------

describe('startQuickSession: what it writes', () => {
  it('makes a hidden, archived, quick routine with fresh rows, and a quick session on it', async () => {
    const plan = planOf([
      rowOf(BENCH, { sets: 3, repMin: 10, repMax: 15, weightKg: 37.5 }),
      rowOf(CRUNCH, { sets: 2, repMin: 12, repMax: 15, weightKg: null, mode: 'calibrating' }),
    ]);
    const session = await startQuickSession(plan, [], 'light');

    expect(session).toMatchObject({ title: 'Quick session · light', quick: 'light' });
    expect(session.endedAt).toBeUndefined();
    expect(await db.sessions.get(session.id)).toEqual(session);

    const routine = (await db.routines.get(session.routineId))!;
    expect(routine).toEqual({ id: session.routineId, name: 'Quick session', order: -1, isLowerBody: false, archived: true, quick: true });
    // targetMinutes is not merely undefined: the key is absent, or the session clock would redden.
    expect(Object.keys(routine).sort()).toEqual(['archived', 'id', 'isLowerBody', 'name', 'order', 'quick']);

    const rxs = await db.routineExercises.where('routineId').equals(routine.id).sortBy('order');
    expect(rxs).toHaveLength(2);
    // Built field by field: nothing beyond these keys, so no linkProgression, restSecOverride, cue or superset.
    for (const rx of rxs) {
      expect(Object.keys(rx).sort()).toEqual(['currentWeight', 'exerciseId', 'id', 'increment', 'mode', 'optional', 'order', 'repMax', 'repMin', 'routineId', 'targetSets']);
    }
    expect(rxs[0]).toMatchObject({ exerciseId: BENCH.id, order: 0, targetSets: 3, repMin: 10, repMax: 15, currentWeight: 37.5, increment: 2.5, mode: 'normal', optional: false });
    expect(rxs[1]).toMatchObject({ exerciseId: CRUNCH.id, order: 1, targetSets: 2, repMin: 12, repMax: 15, currentWeight: 0, increment: 5, mode: 'calibrating', optional: false });
  });

  it('a normal session is titled and marked normal', async () => {
    const session = await startQuickSession(planOf([rowOf(BENCH)]), [], 'normal');
    expect(session).toMatchObject({ title: 'Quick session · normal', quick: 'normal' });
  });

  it('is hidden from every list of routines, and nothing else is added beside it', async () => {
    const before = await counts();
    const listedBefore = (await listRoutines()).map((r) => r.id);
    const session = await startQuickSession(planOf([rowOf(BENCH), rowOf(CRUNCH)]), [], 'light');

    expect((await listRoutines()).map((r) => r.id)).toEqual(listedBefore);
    expect(await counts()).toEqual({ ...before, routines: before.routines + 1, routineExercises: before.routineExercises + 2, sessions: before.sessions + 1 });
    expect(session.routineId).not.toBe('');
  });

  it('is a lower-body routine only when MORE than half of its rows are lower body', async () => {
    const two = await startQuickSession(planOf([rowOf(LEG_CURL), rowOf(HIP_THRUST), rowOf(BENCH)]), [], 'light');
    expect((await db.routines.get(two.routineId))!.isLowerBody).toBe(true);
    await deleteSession(two.id);

    const half = await startQuickSession(planOf([rowOf(LEG_CURL), rowOf(BENCH)]), [], 'light');
    expect((await db.routines.get(half.routineId))!.isLowerBody).toBe(false);
    await deleteSession(half.id);

    const one = await startQuickSession(planOf([rowOf(LEG_CURL)]), [], 'light');
    expect((await db.routines.get(one.routineId))!.isLowerBody).toBe(true);
  });

  it('a fresh row carries no link, and an unrelated linked routine is neither adopted nor moved', async () => {
    const rdlRx = (await db.routineExercises.where('routineId').equals(HINGE).toArray()).find((r) => r.exerciseId === RDL.id)!;
    // The RDL is linked across two real routines, at a real working weight.
    const squatRx = await addRoutineExercise(SQUAT, RDL.id);
    await updateRoutineExercise(rdlRx.id, { linkProgression: true });
    await updateRoutineExercise(squatRx.id, { linkProgression: true });
    await updateRoutineExercise(rdlRx.id, { currentWeight: 110, mode: 'normal' });
    const realBefore = await db.routineExercises.bulkGet([rdlRx.id, squatRx.id]);
    expect(realBefore.map((r) => r!.currentWeight)).toEqual([110, 110]);

    const session = await startQuickSession(planOf([rowOf(RDL, { weightKg: 71.5 })]), [], 'light');
    const [hidden] = await db.routineExercises.where('routineId').equals(session.routineId).toArray();
    expect(hidden.linkProgression).toBeUndefined();
    expect(hidden.currentWeight).toBe(71.5);
    // Neither real row was touched by starting.
    expect(await db.routineExercises.bulkGet([rdlRx.id, squatRx.id])).toEqual(realBefore);

    // And editing the real link afterwards does not reach the hidden row.
    await updateRoutineExercise(rdlRx.id, { currentWeight: 120 });
    expect((await db.routineExercises.get(squatRx.id))!.currentWeight).toBe(120);
    expect((await db.routineExercises.get(hidden.id))!.currentWeight).toBe(71.5);
  });
});

describe('startQuickSession: one transaction', () => {
  it('returns the live session and creates nothing while one is live', async () => {
    const live = await startSession(HINGE);
    const before = await counts();

    const got = await startQuickSession(planOf([rowOf(BENCH), catalogueRowOf(entryOf('cable-woodchop'))]), [entryOf('cable-woodchop')], 'light');

    expect(got.id).toBe(live.id);
    expect(got.quick).toBeUndefined();
    expect(await counts()).toEqual(before);
  });

  it('two starts at once make one session and one routine', async () => {
    const plan = planOf([rowOf(BENCH)]);
    const before = await counts();
    const [a, b] = await Promise.all([startQuickSession(plan, [], 'light'), startQuickSession(plan, [], 'light')]);

    expect(a.id).toBe(b.id);
    const after = await counts();
    expect(after.sessions).toBe(before.sessions + 1);
    expect(after.routines).toBe(before.routines + 1);
  });

  it('writes nothing when a later row fails, not even the exercise an earlier row created', async () => {
    const before = await counts();
    const good = entryOf('cable-woodchop');
    const plan = planOf([catalogueRowOf(good), catalogueRowOf(entryOf('never-loaded', { name: 'Never Loaded' }))]);

    await expect(startQuickSession(plan, [good], 'light')).rejects.toThrow(/Catalogue entry not found/);
    expect(await counts()).toEqual(before);
  });

  it('refuses an empty plan and writes nothing', async () => {
    const before = await counts();
    await expect(startQuickSession(planOf([]), [], 'light')).rejects.toThrow('Quick session has no exercises');
    expect(await counts()).toEqual(before);
  });

  it('refuses a plan naming an exercise that is gone, and writes nothing', async () => {
    const before = await counts();
    const gone = { ...BENCH, id: 'not-a-row' };
    await expect(startQuickSession(planOf([rowOf(CRUNCH), rowOf(gone)]), [], 'light')).rejects.toThrow('Exercise not found');
    expect(await counts()).toEqual(before);
  });
});

describe('startQuickSession: catalogue rows', () => {
  it('materialises a catalogue exercise from the entry passed in, keyed by its demo', async () => {
    const entry = entryOf('cable-woodchop');
    const before = await counts();
    const session = await startQuickSession(planOf([catalogueRowOf(entry)]), [entry], 'normal');

    expect((await counts()).exercises).toBe(before.exercises + 1);
    const created = (await db.exercises.toArray()).filter((e) => e.demo === 'cat:cable-woodchop');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ ...exerciseFromCatalogue(entry), id: expect.any(String), createdAt: expect.any(String) });
    const [rx] = await db.routineExercises.where('routineId').equals(session.routineId).toArray();
    expect(rx.exerciseId).toBe(created[0].id);
    expect(rx.mode).toBe('calibrating');
  });

  it('reuses the exercise it made the last time, however many sessions use it', async () => {
    const entry = entryOf('cable-woodchop');
    const first = await startQuickSession(planOf([catalogueRowOf(entry)]), [entry], 'normal');
    const [made] = await db.exercises.filter((e) => e.demo === 'cat:cable-woodchop').toArray();
    // Finished, not deleted: deleting a session takes the exercises its Start made, so a delete here
    // would leave the second Start nothing to reuse and this would pass having reused nothing.
    await updateSession(first.id, { endedAt: first.startedAt, durationSec: 60 });
    const second = await startQuickSession(planOf([catalogueRowOf(entry)]), [entry], 'normal');

    expect(second.id).not.toBe(first.id);
    const all = (await db.exercises.toArray()).filter((e) => e.demo === 'cat:cable-woodchop');
    expect(all.map((e) => e.id)).toEqual([made.id]);
    expect((await db.routineExercises.where('routineId').equals(second.routineId).toArray())[0].exerciseId).toBe(made.id);
  });

  it('an exercise the owner already has under that demo key, or that name, wins', async () => {
    const byDemo = await createExercise({ ...exerciseFromCatalogue(entryOf('a-slug', { name: 'Something Else' })), name: 'My own name' });
    const byName = await createExercise({ ...exerciseFromCatalogue(entryOf('b-slug', { name: 'Kneeling Crunch' })), demo: undefined, name: 'kneeling  CRUNCH' });
    const entries = [entryOf('a-slug', { name: 'Something Else' }), entryOf('b-slug', { name: 'Kneeling Crunch' })];
    const before = await counts();

    const session = await startQuickSession(planOf(entries.map((e) => catalogueRowOf(e))), entries, 'normal');

    expect((await counts()).exercises).toBe(before.exercises);
    const rxs = await db.routineExercises.where('routineId').equals(session.routineId).sortBy('order');
    expect(rxs.map((r) => r.exerciseId)).toEqual([byDemo.id, byName.id]);
  });
});

describe('startQuickSession: diagram rows', () => {
  const fly = demoOf('cable-rear-delt-fly');
  const made = async (slug: string) => (await db.exercises.toArray()).filter((e) => e.demo === slug);

  it('materialises a diagram exercise from the diagram passed in, keyed by its slug, in the same transaction as the session', async () => {
    const before = await counts();
    const session = await startQuickSession(planOf([diagramRowOf(fly)]), [], 'normal', [fly]);

    expect((await counts()).exercises).toBe(before.exercises + 1);
    const created = await made('cable-rear-delt-fly');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ ...exerciseFromDemo(fly), id: expect.any(String), createdAt: session.startedAt });
    // Not a catalogue key: the diagram's own slug is the picture key.
    expect(isCatalogueDemo(created[0].demo)).toBe(false);
    const [rx] = await db.routineExercises.where('routineId').equals(session.routineId).toArray();
    expect(rx.exerciseId).toBe(created[0].id);
    expect(rx.mode).toBe('calibrating');
    expect(rx.currentWeight).toBe(0);
  });

  it('a catalogue row and a diagram row in one plan are each made once, and the plan keeps its order', async () => {
    const entry = entryOf('cable-woodchop');
    const before = await counts();
    const session = await startQuickSession(planOf([rowOf(BENCH), diagramRowOf(fly), catalogueRowOf(entry)]), [entry], 'normal', [fly]);

    expect((await counts()).exercises).toBe(before.exercises + 2);
    const names = (await routineItems(session.routineId)).map((i) => i.exercise.name);
    expect(names).toEqual([BENCH.name, 'Cable Rear Delt Fly', 'Cable Woodchop']);
  });

  it('two rows naming one diagram make one exercise', async () => {
    const before = await counts();
    const session = await startQuickSession(planOf([diagramRowOf(fly), diagramRowOf(fly)]), [], 'normal', [fly]);
    expect((await counts()).exercises).toBe(before.exercises + 1);
    const rxs = await db.routineExercises.where('routineId').equals(session.routineId).toArray();
    expect(new Set(rxs.map((r) => r.exerciseId)).size).toBe(1);
  });

  it('reuses the exercise it made the last time, however many sessions use it', async () => {
    const first = await startQuickSession(planOf([diagramRowOf(fly)]), [], 'normal', [fly]);
    const [first1] = await made('cable-rear-delt-fly');
    // Finished, not deleted: deleting a session takes the exercises its Start made.
    await updateSession(first.id, { endedAt: first.startedAt, durationSec: 60 });
    const second = await startQuickSession(planOf([diagramRowOf(fly)]), [], 'normal', [fly]);

    expect(second.id).not.toBe(first.id);
    expect((await made('cable-rear-delt-fly')).map((e) => e.id)).toEqual([first1.id]);
    expect((await db.routineExercises.where('routineId').equals(second.routineId).toArray())[0].exerciseId).toBe(first1.id);
  });

  it("an exercise the owner already has under that picture key, that name or that alias wins: their own row, never a second", async () => {
    const byKey = await createExercise({ ...exerciseFromDemo(demoOf('by-key', { name: 'Something Else' })), name: 'My own name' });
    const byName = await createExercise({ ...exerciseFromDemo(demoOf('by-name', { name: 'Kneeling Crunch' })), demo: undefined, name: 'kneeling  CRUNCH' });
    const byAlias = await createExercise({ ...exerciseFromDemo(demoOf('by-alias', { name: 'Rope Pushdown' })), demo: undefined, name: 'Hevy Name', aliases: ['Rope Pushdown'] });
    const demos = [demoOf('by-key', { name: 'Something Else' }), demoOf('by-name', { name: 'Kneeling Crunch' }), demoOf('by-alias', { name: 'Rope Pushdown' })];
    const before = await counts();

    const session = await startQuickSession(planOf(demos.map((d) => diagramRowOf(d))), [], 'normal', demos);

    expect((await counts()).exercises).toBe(before.exercises);
    const rxs = await db.routineExercises.where('routineId').equals(session.routineId).sortBy('order');
    expect(rxs.map((r) => r.exerciseId)).toEqual([byKey.id, byName.id, byAlias.id]);
  });

  it('an exercise the owner added from the diagrams first, or the seeded one a diagram is the picture of, is theirs and is used', async () => {
    const added = await addDemoExercise(fly);
    const bench = demoOf('bench-press', { name: 'Bench Press', equipment: 'Barbell', muscleGroup: 'chest' });
    const before = await counts();
    const session = await startQuickSession(planOf([diagramRowOf(fly), diagramRowOf(bench)]), [], 'normal', [fly, bench]);
    expect((await counts()).exercises).toBe(before.exercises);
    expect((await routineItems(session.routineId)).map((i) => i.exercise.id)).toEqual([added.id, BENCH.id]);
  });

  it('writes nothing when a diagram is missing from those passed in, not even the exercise an earlier row created', async () => {
    const before = await counts();
    const gone = demoOf('never-loaded', { name: 'Never Loaded' });
    await expect(startQuickSession(planOf([diagramRowOf(fly), diagramRowOf(gone)]), [], 'light', [fly])).rejects.toThrow(/Diagram not found: never-loaded/);
    expect(await counts()).toEqual(before);
    expect(await made('cable-rear-delt-fly')).toEqual([]);
    // And one that was passed but names no diagram at all is refused the same way.
    const nameless = diagramRowOf(fly);
    delete nameless.candidate.demoSlug;
    await expect(startQuickSession(planOf([nameless]), [], 'light', [fly])).rejects.toThrow(/Diagram not found/);
    expect(await counts()).toEqual(before);
  });
});

describe('finishing a quick session decides no weight', () => {
  it('writes only a calibrating decision, leaves every weight and mode alone, and ignores a lock-in or override passed in', async () => {
    const realRows = await db.routineExercises.toArray();
    const session = await startQuickSession(
      planOf([
        rowOf(BENCH, { sets: 2, weightKg: 50 }),
        rowOf(INCLINE, { sets: 2, weightKg: 30 }),
        rowOf(CRUNCH, { sets: 2, weightKg: null, mode: 'calibrating' }),
      ]),
      [],
      'light',
    );
    const [benchRx, , crunchRx] = (await routineItems(session.routineId)).map((i) => i.rx);
    // Every set at the top of the range: a real routine would put the weight up.
    for (const w of [50, 50]) await logSet({ sessionId: session.id, routineExerciseId: benchRx.id, exerciseId: BENCH.id, type: 'working', weight: w, reps: 15 });
    for (const w of [40, 40]) await logSet({ sessionId: session.id, routineExerciseId: crunchRx.id, exerciseId: CRUNCH.id, type: 'working', weight: w, reps: 12 });

    const preview = await buildSummary(session.id);
    const byExercise = (name: string) => preview.items.find((i) => i.exercise.name === name)!;
    expect(byExercise(BENCH.name)).toMatchObject({ status: 'done', decision: null, suggestions: [], lockIn: null });
    expect(byExercise(CRUNCH.name)).toMatchObject({ status: 'done', lockIn: null, suggestions: [] });
    expect(byExercise(CRUNCH.name).decision?.rule).toBe('calibrating');
    expect(byExercise(INCLINE.name)).toMatchObject({ status: 'not_done', decision: null });

    await finishSession(session.id, {
      choices: [
        { routineExerciseId: benchRx.id, overrideTo: 99 },
        { routineExerciseId: crunchRx.id, lockInAt: 40 },
      ],
    });

    expect((await db.sessions.get(session.id))!.endedAt).toBeDefined();
    const after = await routineItems(session.routineId);
    expect(after.map((i) => ({ w: i.rx.currentWeight, m: i.rx.mode }))).toEqual([
      { w: 50, m: 'normal' },
      { w: 30, m: 'normal' },
      { w: 0, m: 'calibrating' },
    ]);
    const decisions = await db.decisions.where('sessionId').equals(session.id).toArray();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ routineExerciseId: crunchRx.id, rule: 'calibrating', fromWeight: 0, toWeight: 0 });
    // Not a single real row moved.
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    const realIds = Object.values(SEED_ROUTINE_IDS) as string[];
    const realAfter = await db.routineExercises.where('routineId').anyOf(realIds).toArray();
    expect(realAfter.sort(byId)).toEqual(realRows.sort(byId));
  });

  it('a real session still decides, so the gate is the quick marker and nothing else', async () => {
    const session = await startSession(PUSH);
    const rx = (await db.routineExercises.where('routineId').equals(PUSH).toArray()).find((r) => r.mode === 'normal')!;
    for (let i = 0; i < rx.targetSets; i++) await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: rx.exerciseId, type: 'working', weight: rx.currentWeight, reps: rx.repMax });
    await finishSession(session.id, { choices: [] });
    expect((await db.decisions.where('sessionId').equals(session.id).toArray()).map((d) => d.rule)).toContain('increase');
    expect((await db.routineExercises.get(rx.id))!.currentWeight).toBe(rx.currentWeight + rx.increment);
  });
});

describe('weights never leak out of a quick session', () => {
  it('previousSets, for a slot with no history of its own, offers the last real session and never a quick one', async () => {
    const real = await realSession(HINGE, '2026-09-01T18:00:00.000Z', [{ exerciseId: RDL.id, weight: 80, reps: 8 }]);
    await quickSession([rowOf(RDL, { weightKg: 52 })], 'light', '2026-09-05T18:00:00.000Z', [{ row: 0, weight: 52, reps: 12 }]);

    const elsewhere = await createRoutine({ name: 'Elsewhere', isLowerBody: false });
    const rx = await addRoutineExercise(elsewhere.id, RDL.id);

    const prev = await previousSets(rx.id, RDL.id, '');
    expect(prev?.sessionId).toBe(real.id);
    expect(prev?.sets.map((s) => s.weight)).toEqual([80]);
  });

  it('previousSets has nothing to offer when the only history is a quick session', async () => {
    await quickSession([rowOf(RDL, { weightKg: 52 })], 'light', '2026-09-05T18:00:00.000Z', [{ row: 0, weight: 52, reps: 12 }]);
    const elsewhere = await createRoutine({ name: 'Elsewhere', isLowerBody: false });
    const rx = await addRoutineExercise(elsewhere.id, RDL.id);
    expect(await previousSets(rx.id, RDL.id, '')).toBeNull();
    expect(await previousSets(null, RDL.id, '')).toBeNull();
  });

  it('reconcileWeights reconciles to the last real session, not a later quick one', async () => {
    const rdlRx = (await db.routineExercises.where('routineId').equals(HINGE).toArray()).find((r) => r.exerciseId === RDL.id)!;
    expect(rdlRx.currentWeight).toBe(110);
    await realSession(HINGE, '2026-09-01T18:00:00.000Z', [
      { exerciseId: RDL.id, weight: 100, reps: 8 },
      { exerciseId: RDL.id, weight: 100, reps: 8 },
    ]);
    await quickSession([rowOf(RDL, { weightKg: 65 })], 'light', '2026-09-05T18:00:00.000Z', [
      { row: 0, weight: 65, reps: 12 },
      { row: 0, weight: 65, reps: 12 },
    ]);

    const rows = await reconcileWeights();
    const row = rows.find((r) => r.exercise.id === RDL.id)!;
    expect(row.latest).toBe(100);
    expect(row.current).toBe(110);
  });

  it('a lock-in sheet is never offered a quick session’s weight', async () => {
    await realSession(HINGE, '2026-09-01T18:00:00.000Z', [{ exerciseId: RDL.id, weight: 100, reps: 8 }]);
    await quickSession([rowOf(RDL, { weightKg: 65 })], 'light', '2026-09-05T18:00:00.000Z', [{ row: 0, weight: 65, reps: 12 }]);
    const history = await exerciseHistory(RDL.id);
    expect(history[0].topWeight).toBe(65);
    expect(lastWorkingTopWeight(history)).toBe(100);
    expect(lastWorkingTopWeight([history[0]])).toBe(0);
  });
});

describe('records and strength figures', () => {
  const REAL_AT = '2026-09-01T18:00:00.000Z';
  const QUICK_AT = '2026-09-03T18:00:00.000Z';

  it('a light session is left out of the e1RM series, the bests, the record list and its own records', async () => {
    await realSession(HINGE, REAL_AT, [{ exerciseId: RDL.id, weight: 80, reps: 4 }]);
    const light = await quickSession([rowOf(RDL, { weightKg: 52 })], 'light', QUICK_AT, [
      // Beats the real lift on e1RM and on set volume, so it WOULD be a record if it counted.
      { row: 0, weight: 70, reps: 10 },
      { row: 0, weight: 70, reps: 10 },
    ]);
    expect(e1rm(70, 10)!).toBeGreaterThan(e1rm(80, 4)!);

    const series = await e1rmSeries(RDL.id);
    expect(series).toHaveLength(1);
    expect(series[0].t).toBe(Date.parse(REAL_AT));

    const bests = await bestsForExercise(RDL.id);
    expect(bests.e1rm).toBe(e1rm(80, 4));
    expect(bests.weight).toBe(80);

    expect(await recentRecords()).toEqual([]);

    const sets = await db.setLogs.where('sessionId').equals(light.id).toArray();
    expect(await recordsForNewSets(RDL.id, light.id, sets)).toEqual([]);
    const summary = await buildSummary(light.id);
    expect(summary.items[0].records).toEqual([]);
  });

  it('a normal quick session counts in full', async () => {
    await realSession(HINGE, REAL_AT, [{ exerciseId: RDL.id, weight: 80, reps: 4 }]);
    const normal = await quickSession([rowOf(RDL, { weightKg: 70 })], 'normal', QUICK_AT, [
      { row: 0, weight: 70, reps: 10 },
      { row: 0, weight: 70, reps: 10 },
    ]);

    expect(await e1rmSeries(RDL.id)).toHaveLength(2);
    expect((await bestsForExercise(RDL.id)).e1rm).toBe(e1rm(70, 10));
    const records = await recentRecords();
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.sessionId === normal.id)).toBe(true);
    expect((await buildSummary(normal.id)).items[0].records.length).toBeGreaterThan(0);
  });

  it('a later real session is not judged against a light session that would have stood as a best', async () => {
    await quickSession([rowOf(RDL, { weightKg: 52 })], 'light', REAL_AT, [{ row: 0, weight: 70, reps: 10 }]);
    const real = await realSession(HINGE, QUICK_AT, [{ exerciseId: RDL.id, weight: 80, reps: 4 }]);
    const sets = await db.setLogs.where('sessionId').equals(real.id).toArray();
    // The first real session of the lift: no earlier real best, so nothing to beat and no record.
    expect(await recordsForNewSets(RDL.id, real.id, sets)).toEqual([]);
  });

  it('still counts for weekly sets, volume and the calendar week, but not for the e1RM series', async () => {
    const at = '2026-09-07T18:00:00.000Z'; // a Monday
    const session = await quickSession([rowOf(RDL, { weightKg: 52 })], 'light', at);
    const [rx] = (await routineItems(session.routineId)).map((i) => i.rx);
    for (let i = 0; i < 3; i++) {
      await db.setLogs.put({
        id: `light-${i}`,
        sessionId: session.id,
        routineExerciseId: rx.id,
        exerciseId: RDL.id,
        index: i,
        type: 'working',
        weight: 52,
        reps: 12,
        completedAt: '2026-09-07T18:10:00.000Z',
      });
    }

    expect(await weeklySetsByMuscle('2026-09-07')).toEqual({ hamstrings: 3 });
    const settings = (await db.settings.get('settings'))!;
    const calendar = await calendarData(2, '2026-09-08', settings);
    expect(calendar.thisWeek).toBe(1);
    expect(calendar.grid.flat().find((d) => d.date === '2026-09-07')!.sessions).toHaveLength(1);
    expect(await volumeSeries(RDL.id)).toEqual([{ t: Date.parse(at), y: 3 * 52 * 12 }]);
    expect(await e1rmSeries(RDL.id)).toEqual([]);
  });
});

describe('the calendar, the streak and the leg day', () => {
  it('a completed quick session raises the weekly count and carries the streak; one still running does not', async () => {
    const settings = { ...(await db.settings.get('settings'))!, weeklySessionTarget: 1 };
    await quickSession([rowOf(BENCH)], 'light', '2026-08-31T18:00:00.000Z'); // a Monday, last week
    const running = await startQuickSession(planOf([rowOf(BENCH)]), [], 'light');
    await updateSession(running.id, { startedAt: '2026-09-07T18:00:00.000Z' });
    expect((await calendarData(3, '2026-09-08', settings)).thisWeek).toBe(0);

    await updateSession(running.id, { endedAt: '2026-09-07T18:30:00.000Z' });
    const data = await calendarData(3, '2026-09-08', settings);
    expect(data.thisWeek).toBe(1);
    expect(data.streak).toBe(2);
  });

  it('a quick session on a lower-body hidden routine makes that day a leg day; an upper one does not', async () => {
    const today = toDateKey();
    await startQuickSession(planOf([rowOf(LEG_CURL), rowOf(HIP_THRUST)]), [], 'light').then((s) => updateSession(s.id, { endedAt: s.startedAt }));
    expect(await wasLegDay(today)).toBe(true);
    expect(await legDayFor(today, today)).toEqual({ legDay: true, basis: 'trained' });
  });

  it('an upper quick session is a trained day but not a leg day', async () => {
    const today = toDateKey();
    await startQuickSession(planOf([rowOf(BENCH), rowOf(CRUNCH)]), [], 'light').then((s) => updateSession(s.id, { endedAt: s.startedAt }));
    expect(await wasLegDay(today)).toBe(false);
    expect(await legDayFor(today, today)).toEqual({ legDay: false, basis: 'trained' });
  });

  it('the planned day after a quick lower session skips the next lower routine, so the protein target follows', async () => {
    const today = toDateKey();
    const days = (n: number) => `${addDays(today, -n)}T12:00:00.000Z`;
    await realSession(PUSH, days(3), []);
    // Next in the week after Push is Lower (Squat). A quick lower session yesterday-ish means two
    // lower days in a row, so the plan moves on to Upper (Pull), which is not a leg day.
    await quickSession([rowOf(LEG_CURL), rowOf(HIP_THRUST)], 'light', days(2));

    const ctx = await nextRoutineContext();
    const routines = await db.routines.toArray();
    const next = suggestNextRoutine(routines, ctx.lastRoutineId, { avoidConsecutiveLower: true, lastWasLower: ctx.lastWasLower })!;
    expect(next.id).toBe(PULL);
    expect(await legDayFor(today, today)).toEqual({ legDay: false, basis: 'planned' });
  });

  it('with no quick session in between, the same week plans a leg day (so the test above turns on the quick one)', async () => {
    const today = toDateKey();
    await realSession(PUSH, `${addDays(today, -3)}T12:00:00.000Z`, []);
    expect(await legDayFor(today, today)).toEqual({ legDay: true, basis: 'planned' });
  });
});

describe('the weekly rotation ignores quick sessions, and the lower-day guard does not', () => {
  const names = async () => new Map((await db.routines.toArray()).map((r) => [r.id, r.name]));

  it('lastCompletedSession can skip quick sessions', async () => {
    const real = await realSession(HINGE, '2026-09-01T18:00:00.000Z', []);
    const quick = await quickSession([rowOf(BENCH)], 'light', '2026-09-02T18:00:00.000Z');
    expect((await lastCompletedSession())!.id).toBe(quick.id);
    expect((await lastCompletedSession({ excludeQuick: true }))!.id).toBe(real.id);
    expect((await lastCompletedSession({}))!.id).toBe(quick.id);
  });

  it('a quick session after Lower (Hinge) leaves Upper (Push) next, not the first routine again', async () => {
    await realSession(HINGE, '2026-09-01T18:00:00.000Z', []);
    await quickSession([rowOf(BENCH)], 'normal', '2026-09-02T18:00:00.000Z');

    const ctx = await nextRoutineContext();
    expect(ctx).toEqual({ lastRoutineId: HINGE, lastWasLower: false });
    const next = suggestNextRoutine(await listRoutines(), ctx.lastRoutineId, { avoidConsecutiveLower: true, lastWasLower: ctx.lastWasLower })!;
    expect((await names()).get(next.id)).toBe('Upper (Push)');
  });

  it('a quick lower session after Upper (Push) still counts as a lower day: Lower (Squat) is skipped and warned about', async () => {
    await realSession(PUSH, '2026-09-01T18:00:00.000Z', []);
    await quickSession([rowOf(LEG_CURL), rowOf(HIP_THRUST)], 'normal', '2026-09-02T18:00:00.000Z');

    const ctx = await nextRoutineContext();
    expect(ctx).toEqual({ lastRoutineId: PUSH, lastWasLower: true });
    const routines = await listRoutines();
    const next = suggestNextRoutine(routines, ctx.lastRoutineId, { avoidConsecutiveLower: true, lastWasLower: ctx.lastWasLower })!;
    expect(next.id).toBe(PULL);
    expect(isConsecutiveLower(routines, ctx.lastRoutineId, SQUAT, { lastWasLower: ctx.lastWasLower })).toBe(true);
    expect(isConsecutiveLower(routines, ctx.lastRoutineId, PULL, { lastWasLower: ctx.lastWasLower })).toBe(false);
  });

  it('with only quick sessions there is no rotation to continue, but the guard still sees them', async () => {
    await quickSession([rowOf(LEG_CURL), rowOf(HIP_THRUST)], 'light', '2026-09-02T18:00:00.000Z');
    const ctx = await nextRoutineContext();
    expect(ctx).toEqual({ lastRoutineId: null, lastWasLower: true });
    const routines = await listRoutines();
    expect(isConsecutiveLower(routines, ctx.lastRoutineId, HINGE, { lastWasLower: ctx.lastWasLower })).toBe(true);
  });

  it('knows nothing when nothing has been done, and treats an imported last session as not lower', async () => {
    expect(await nextRoutineContext()).toEqual({ lastRoutineId: null, lastWasLower: false });
    await db.sessions.put({ id: 'imp', routineId: '', title: 'Imported', startedAt: '2026-09-01T18:00:00.000Z', endedAt: '2026-09-01T19:00:00.000Z', source: 'hevy' });
    expect(await nextRoutineContext()).toEqual({ lastRoutineId: null, lastWasLower: false });
  });
});

describe('deleting a quick session', () => {
  it('takes its hidden routine, rows, sets and decisions with it, and nothing real', async () => {
    const realRoutines = await db.routines.toArray();
    const realRows = await db.routineExercises.toArray();
    const session = await startQuickSession(planOf([rowOf(BENCH, { weightKg: 50 }), rowOf(CRUNCH, { weightKg: null, mode: 'calibrating' })]), [], 'light');
    const items = await routineItems(session.routineId);
    await logSet({ sessionId: session.id, routineExerciseId: items[0].rx.id, exerciseId: BENCH.id, type: 'working', weight: 50, reps: 12 });
    await logSet({ sessionId: session.id, routineExerciseId: items[1].rx.id, exerciseId: CRUNCH.id, type: 'working', weight: 30, reps: 12 });
    await finishSession(session.id, { choices: [] });
    const before = await counts();

    await deleteSession(session.id);

    expect(await db.sessions.get(session.id)).toBeUndefined();
    expect(await db.routines.get(session.routineId)).toBeUndefined();
    expect(await db.routineExercises.where('routineId').equals(session.routineId).count()).toBe(0);
    expect(await db.setLogs.where('sessionId').equals(session.id).count()).toBe(0);
    expect(await db.decisions.where('sessionId').equals(session.id).count()).toBe(0);
    expect(await db.routines.toArray()).toEqual(realRoutines);
    expect(await db.routineExercises.toArray()).toEqual(realRows);
    expect(before.routines).toBe(realRoutines.length + 1);
  });

  it('an abandoned live quick session is deleted the same way', async () => {
    const before = await counts();
    const session = await startQuickSession(planOf([rowOf(BENCH)]), [], 'light');
    await deleteSession(session.id);
    expect(await db.routines.filter((r) => !!r.quick).count()).toBe(0);
    expect(await counts()).toEqual(before);
  });

  it('never removes a real routine, even when a session row claims to be quick', async () => {
    const before = await counts();
    const realRows = await db.routineExercises.where('routineId').equals(HINGE).toArray();
    const s = await startSession(HINGE);
    await updateSession(s.id, { quick: 'light' });
    await deleteSession(s.id);
    expect(await db.routines.get(HINGE)).toBeDefined();
    expect(await db.routineExercises.where('routineId').equals(HINGE).toArray()).toEqual(realRows);
    expect(await counts()).toEqual(before);
  });

  it('a real session deletes as it always did', async () => {
    const s = await realSession(HINGE, '2026-09-01T18:00:00.000Z', [{ exerciseId: RDL.id, weight: 100, reps: 8 }]);
    const routines = await counts().then((c) => c.routines);
    await deleteSession(s.id);
    expect(await db.sessions.get(s.id)).toBeUndefined();
    expect((await counts()).routines).toBe(routines);
    expect(await db.routines.get(HINGE)).toBeDefined();
  });
});

describe('deleting a quick session: the catalogue exercises its Start made', () => {
  const woodchop = entryOf('cable-woodchop');
  const kneeling = entryOf('kneeling-crunch', { name: 'Kneeling Crunch' });
  const exerciseOf = async (session: Session, order: number) => (await routineItems(session.routineId))[order].exercise;
  /** A live session ends. Nothing here is about what finishing decides. */
  const end = (s: Session) => updateSession(s.id, { endedAt: s.startedAt, durationSec: 60 });

  it('a discarded session takes the exercises its Start made, and only those', async () => {
    const before = await counts();
    const session = await startQuickSession(planOf([rowOf(BENCH), catalogueRowOf(woodchop), catalogueRowOf(kneeling)]), [woodchop, kneeling], 'normal');
    // They exist now, so their absence below is the delete's doing.
    expect((await counts()).exercises).toBe(before.exercises + 2);

    await deleteSession(session.id);

    expect(await counts()).toEqual(before);
    expect(await db.exercises.get(BENCH.id)).toBeDefined();
    expect(await db.exercises.filter((e) => isCatalogueDemo(e.demo)).count()).toBe(0);
  });

  it('a finished session deleted from History takes them too, once its own sets are gone', async () => {
    const session = await startQuickSession(planOf([catalogueRowOf(woodchop)]), [woodchop], 'normal');
    const made = await exerciseOf(session, 0);
    const [item] = await routineItems(session.routineId);
    await logSet({ sessionId: session.id, routineExerciseId: item.rx.id, exerciseId: made.id, type: 'working', weight: 0, reps: 12 });
    await finishSession(session.id, { choices: [] });
    expect(await db.exercises.get(made.id)).toBeDefined();

    await deleteSession(session.id);

    expect(await db.exercises.get(made.id)).toBeUndefined();
  });

  it('an exercise the owner added from the library first is theirs, and stays', async () => {
    const added = await addCatalogueExercise(woodchop);
    // A tap on Add is well before Start: state the gap rather than hope two clocks read different milliseconds.
    await db.exercises.update(added.id, { createdAt: '2026-09-01T10:00:00.000Z' });
    const session = await startQuickSession(planOf([catalogueRowOf(woodchop)]), [woodchop], 'normal');
    expect((await exerciseOf(session, 0)).id).toBe(added.id);

    await deleteSession(session.id);

    expect(await db.exercises.get(added.id)).toMatchObject({ demo: 'cat:cable-woodchop' });
  });

  it('one that any session logged a set on stays', async () => {
    const session = await startQuickSession(planOf([catalogueRowOf(woodchop)]), [woodchop], 'normal');
    const made = await exerciseOf(session, 0);
    await end(session);
    // Added to a real session as an extra: a set, and no routine row anywhere.
    const real = await startSession(HINGE);
    await logSet({ sessionId: real.id, routineExerciseId: null, exerciseId: made.id, type: 'working', weight: 0, reps: 10 });

    await deleteSession(session.id);

    expect(await db.exercises.get(made.id)).toBeDefined();
    expect(await db.setLogs.where('exerciseId').equals(made.id).count()).toBe(1);
  });

  it('one that a routine lists stays', async () => {
    const session = await startQuickSession(planOf([catalogueRowOf(woodchop)]), [woodchop], 'normal');
    const made = await exerciseOf(session, 0);
    await addRoutineExercise(PUSH, made.id);

    await deleteSession(session.id);

    expect(await db.exercises.get(made.id)).toBeDefined();
    expect(await db.routineExercises.where('exerciseId').equals(made.id).count()).toBe(1);
  });

  it("one that a later quick session lists stays, with that session's row", async () => {
    const first = await startQuickSession(planOf([catalogueRowOf(woodchop)]), [woodchop], 'normal');
    const made = await exerciseOf(first, 0);
    await end(first);
    const second = await startQuickSession(planOf([catalogueRowOf(woodchop)]), [woodchop], 'normal');
    expect((await exerciseOf(second, 0)).id).toBe(made.id);

    await deleteSession(first.id);

    expect(await db.exercises.get(made.id)).toBeDefined();
    expect(await routineItems(second.routineId)).toHaveLength(1);
  });

  it('a discarded session takes the diagram exercises its Start made, as it takes catalogue ones, and only those', async () => {
    const fly = demoOf('cable-rear-delt-fly');
    const bench = demoOf('bench-press', { name: 'Bench Press', equipment: 'Barbell', muscleGroup: 'chest' });
    const before = await counts();
    const session = await startQuickSession(planOf([rowOf(BENCH), diagramRowOf(fly), diagramRowOf(bench), catalogueRowOf(woodchop)]), [woodchop], 'normal', [fly, bench]);
    expect((await counts()).exercises).toBe(before.exercises + 2);

    await deleteSession(session.id);

    expect(await counts()).toEqual(before);
    expect(await db.exercises.filter((e) => e.demo === 'cable-rear-delt-fly').count()).toBe(0);
    // The seeded Bench Press is the owner's, and was never made by this Start.
    expect(await db.exercises.get(BENCH.id)).toBeDefined();
  });

  it('a diagram exercise the owner added first, one a set was logged on, and one a routine lists all stay', async () => {
    const fly = demoOf('cable-rear-delt-fly');
    const added = await addDemoExercise(fly);
    await db.exercises.update(added.id, { createdAt: '2026-09-01T10:00:00.000Z' });
    const first = await startQuickSession(planOf([diagramRowOf(fly)]), [], 'normal', [fly]);
    await deleteSession(first.id);
    expect(await db.exercises.get(added.id)).toMatchObject({ demo: 'cable-rear-delt-fly' });

    await db.exercises.delete(added.id);
    const logged = demoOf('logged-one', { name: 'Logged One' });
    const listed = demoOf('listed-one', { name: 'Listed One' });
    const session = await startQuickSession(planOf([diagramRowOf(logged), diagramRowOf(listed)]), [], 'normal', [logged, listed]);
    const [loggedEx, listedEx] = (await routineItems(session.routineId)).map((i) => i.exercise);
    await end(session);
    const real = await startSession(HINGE);
    await logSet({ sessionId: real.id, routineExerciseId: null, exerciseId: loggedEx.id, type: 'working', weight: 0, reps: 10 });
    await addRoutineExercise(PUSH, listedEx.id);

    await deleteSession(session.id);

    expect(await db.exercises.get(loggedEx.id)).toBeDefined();
    expect(await db.exercises.get(listedEx.id)).toBeDefined();
  });

  it('an exercise with no catalogue picture key is never taken, even one made at the same instant', async () => {
    const custom = await createExercise({ ...exerciseFromCatalogue(entryOf('q')), demo: undefined, name: 'Custom move five' });
    const session = await startQuickSession(planOf([rowOf(custom, { weightKg: 10 })]), [], 'light');
    await updateSession(session.id, { startedAt: custom.createdAt });

    await deleteSession(session.id);

    expect(await db.exercises.get(custom.id)).toBeDefined();
  });

  it('a session that is not quick never takes an exercise, even a catalogue one made at the same instant', async () => {
    const real = await startSession(HINGE);
    await db.exercises.put({ ...exerciseFromCatalogue(woodchop), id: 'cat-made-for-real', createdAt: real.startedAt });

    await deleteSession(real.id);

    expect(await db.exercises.get('cat-made-for-real')).toBeDefined();
  });
});

describe('exercise usage and the routine editor ignore quick rows', () => {
  it('counts only real routines, and keeps counting sets', async () => {
    const custom = await createExercise({ ...exerciseFromCatalogue(entryOf('x')), demo: undefined, name: 'Custom move' });
    const session = await startQuickSession(planOf([rowOf(custom, { weightKg: 10 })]), [], 'light');
    expect(await exerciseUsage(custom.id)).toEqual({ routines: 0, sets: 0 });

    const routine = await createRoutine({ name: 'Mine', isLowerBody: false });
    await addRoutineExercise(routine.id, custom.id);
    expect(await exerciseUsage(custom.id)).toEqual({ routines: 1, sets: 0 });

    const [rx] = (await routineItems(session.routineId)).map((i) => i.rx);
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: custom.id, type: 'working', weight: 10, reps: 12 });
    expect(await exerciseUsage(custom.id)).toEqual({ routines: 1, sets: 1 });
  });

  it('an exercise only a finished quick session listed can be deleted, and its hidden row goes with it', async () => {
    const custom = await createExercise({ ...exerciseFromCatalogue(entryOf('y')), demo: undefined, name: 'Custom move two' });
    const session = await startQuickSession(planOf([rowOf(custom, { weightKg: 10 }), rowOf(BENCH)]), [], 'light');
    // Finished: a live session is another matter, below.
    await updateSession(session.id, { endedAt: session.startedAt, durationSec: 60 });

    expect(await deleteExercise(custom.id)).toBe(true);
    expect(await db.exercises.get(custom.id)).toBeUndefined();
    expect(await db.routineExercises.where('exerciseId').equals(custom.id).count()).toBe(0);
    // The session's other row is still there.
    expect(await db.routineExercises.where('routineId').equals(session.routineId).count()).toBe(1);
  });

  it('an exercise the LIVE quick session lists cannot be deleted, however few sets it has; finished, it can', async () => {
    const custom = await createExercise({ ...exerciseFromCatalogue(entryOf('v')), demo: undefined, name: 'Custom move six' });
    const session = await startQuickSession(planOf([rowOf(custom, { weightKg: 10 }), rowOf(BENCH)]), [], 'light');
    expect((await getActiveSession())?.id).toBe(session.id);

    expect(await deleteExercise(custom.id)).toBe(false);
    expect(await db.exercises.get(custom.id)).toBeDefined();
    expect(await routineItems(session.routineId)).toHaveLength(2);

    await updateSession(session.id, { endedAt: session.startedAt, durationSec: 60 });
    expect(await deleteExercise(custom.id)).toBe(true);
    expect(await routineItems(session.routineId)).toHaveLength(1);
  });

  it('an exercise only some OTHER quick session listed can be deleted while a quick session is live', async () => {
    const custom = await createExercise({ ...exerciseFromCatalogue(entryOf('u')), demo: undefined, name: 'Custom move seven' });
    await quickSession([rowOf(custom, { weightKg: 10 })], 'light', '2026-09-01T18:00:00.000Z');
    const live = await startQuickSession(planOf([rowOf(BENCH)]), [], 'light');

    expect(await deleteExercise(custom.id)).toBe(true);
    expect(await routineItems(live.routineId)).toHaveLength(1);
  });

  it('an exercise with a set in a quick session cannot be deleted', async () => {
    const custom = await createExercise({ ...exerciseFromCatalogue(entryOf('z')), demo: undefined, name: 'Custom move three' });
    const session = await startQuickSession(planOf([rowOf(custom, { weightKg: 10 })]), [], 'light');
    const [rx] = (await routineItems(session.routineId)).map((i) => i.rx);
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: custom.id, type: 'working', weight: 10, reps: 12 });
    expect(await deleteExercise(custom.id)).toBe(false);
    expect(await db.exercises.get(custom.id)).toBeDefined();
  });

  it('the routine editor’s "other copies" never include a quick row', async () => {
    const session = await startQuickSession(planOf([rowOf(BENCH, { weightKg: 40 })]), [], 'light');
    const all = await db.routineExercises.where('exerciseId').equals(BENCH.id).toArray();
    expect(all.some((r) => r.routineId === session.routineId)).toBe(true);
    const real = await excludeQuickRoutineExercises(all);
    expect(real.length).toBe(all.length - 1);
    expect(real.every((r) => r.routineId !== session.routineId)).toBe(true);
    expect(await excludeQuickRoutineExercises([])).toEqual([]);
  });
});

describe('Ask never quotes a quick prescription', () => {
  const today = '2026-09-08';

  it('an exercise in a real routine is quoted from that routine, even from inside the quick session', async () => {
    const settings = (await db.settings.get('settings'))!;
    // The real row sorts after the hidden one, so a first-by-key lookup would pick the hidden one.
    const realRx = (await db.routineExercises.where('routineId').equals(HINGE).toArray()).find((r) => r.exerciseId === RDL.id)!;
    await db.routineExercises.delete(realRx.id);
    await db.routineExercises.put({ ...realRx, id: 'zzzz-real-rx' });
    const session = await startQuickSession(planOf([rowOf(RDL, { weightKg: 71.5 })]), [], 'light');

    const inside = await gatherContext({ today, settings, exerciseId: RDL.id, routineId: session.routineId, sessionId: session.id });
    expect(inside.exercise!.prescription).toBe('110 kg × 6–8 × 4');
    expect(inside.plan).toBeUndefined();
    const outside = await gatherContext({ today, settings, exerciseId: RDL.id });
    expect(outside.exercise!.prescription).toBe('110 kg × 6–8 × 4');
  });

  it('an exercise only a quick session holds has no prescription to quote', async () => {
    const settings = (await db.settings.get('settings'))!;
    const custom = await createExercise({ ...exerciseFromCatalogue(entryOf('w')), demo: undefined, name: 'Custom move four' });
    const session = await startQuickSession(planOf([rowOf(custom, { weightKg: 12.5 })]), [], 'light');

    const inside = await gatherContext({ today, settings, exerciseId: custom.id, routineId: session.routineId });
    expect(inside.exercise!.prescription).toBeUndefined();
    const outside = await gatherContext({ today, settings, exerciseId: custom.id });
    expect(outside.exercise!.prescription).toBeUndefined();
  });
});

describe('Ask labels a quick session among the last sessions', () => {
  const today = '2026-09-30';

  it('a light and a normal quick session carry their label, and a real session none', async () => {
    const settings = (await db.settings.get('settings'))!;
    await realSession(HINGE, '2026-09-01T18:00:00.000Z', [{ exerciseId: RDL.id, weight: 110, reps: 8 }]);
    await quickSession([rowOf(RDL, { weightKg: 71.5 })], 'light', '2026-09-02T18:00:00.000Z', [{ row: 0, weight: 70, reps: 12 }]);
    await quickSession([rowOf(RDL, { weightKg: 100 })], 'normal', '2026-09-03T18:00:00.000Z', [{ row: 0, weight: 100, reps: 8 }]);

    const ctx = await gatherContext({ today, settings, exerciseId: RDL.id });

    // Newest first.
    expect(ctx.exercise!.lastSessions.map((s) => s.sets)).toEqual(['quick session: 100 × 8', 'quick session (light): 70 × 12', '110 × 8']);
    // And that is what the model is given, beside the real prescription.
    const block = buildContextBlock(ctx);
    expect(block).toContain('Prescription: 110 kg × 6–8 × 4');
    expect(block).toMatch(/Last sessions: .*quick session: 100 × 8; .*quick session \(light\): 70 × 12; .* 110 × 8/);
  });

  it('a light session with nothing counted still says what it was', async () => {
    const settings = (await db.settings.get('settings'))!;
    const s = await quickSession([rowOf(RDL, { weightKg: 70 })], 'light', '2026-09-02T18:00:00.000Z', []);
    await logSet({ sessionId: s.id, routineExerciseId: null, exerciseId: RDL.id, type: 'warmup', weight: 40, reps: 10 });

    const ctx = await gatherContext({ today, settings, exerciseId: RDL.id });

    expect(ctx.exercise!.lastSessions.map((x) => x.sets)).toEqual(['quick session (light): no working sets']);
  });
});

describe('the CSV export says whether a session was quick', () => {
  it('ends on a quick column: light, normal, or empty for a real session, with every earlier column where it was', async () => {
    await realSession(HINGE, '2026-09-01T18:00:00.000Z', [{ exerciseId: RDL.id, weight: 110, reps: 8 }]);
    await quickSession([rowOf(BENCH)], 'light', '2026-09-02T18:00:00.000Z', [{ row: 0, weight: 40, reps: 12 }]);
    await quickSession([rowOf(BENCH)], 'normal', '2026-09-03T18:00:00.000Z', [{ row: 0, weight: 40, reps: 12 }]);

    const csv = await exportCsv();
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });

    expect(parsed.meta.fields).toEqual([
      'session_id', 'session_start', 'session_end', 'session_duration_sec', 'routine', 'exercise', 'exercise_kind', 'set_index', 'set_type',
      'weight_kg', 'reps', 'distance_m', 'seconds', 'rir', 'rep_min', 'rep_max', 'completed_at', 'source', 'quick',
    ]);
    expect(csv.split('\n')[0]).toMatch(/^session_id,session_start,/);
    // By start time: the real session, the light one, the normal one.
    expect(parsed.data.map((r) => [r.session_start.slice(0, 10), r.quick])).toEqual([
      ['2026-09-01', ''],
      ['2026-09-02', 'light'],
      ['2026-09-03', 'normal'],
    ]);
    // Two sets that would otherwise read as the same working set now differ in the file.
    const [, light, normal] = parsed.data;
    expect([light.set_type, light.weight_kg, light.reps]).toEqual([normal.set_type, normal.weight_kg, normal.reps]);
    expect(light.quick).not.toBe(normal.quick);
  });
});

describe('the Archived list and Restore', () => {
  it('lists only routines the owner deleted, never the hidden one', async () => {
    await realSession(SQUAT, '2026-09-01T18:00:00.000Z', []);
    expect(await deleteRoutine(SQUAT)).toBe('archived');
    await quickSession([rowOf(BENCH)], 'light', '2026-09-02T18:00:00.000Z');
    await quickSession([rowOf(CRUNCH)], 'light', '2026-09-03T18:00:00.000Z');

    expect((await listArchivedRoutines()).map((r) => r.name)).toEqual(['Lower (Squat)']);
    expect(await db.routines.filter((r) => !!r.archived).count()).toBe(3);
  });

  it('restoreRoutine refuses the hidden routine and still restores a real one', async () => {
    await realSession(SQUAT, '2026-09-01T18:00:00.000Z', []);
    expect(await deleteRoutine(SQUAT)).toBe('archived');
    const session = await startQuickSession(planOf([rowOf(BENCH)]), [], 'light');

    await restoreRoutine(session.routineId);
    expect(await db.routines.get(session.routineId)).toMatchObject({ archived: true, order: -1, quick: true });
    expect((await listRoutines()).map((r) => r.id)).not.toContain(session.routineId);

    await restoreRoutine(SQUAT);
    expect((await listRoutines()).map((r) => r.id)).toContain(SQUAT);
  });
});

describe('a backup carries a quick session whole', () => {
  it('survives export, JSON and a replace restore, and is still deleted as one piece afterwards', async () => {
    const session = await startQuickSession(planOf([rowOf(BENCH, { weightKg: 50 }), rowOf(CRUNCH, { weightKg: null, mode: 'calibrating' })]), [], 'light');
    const items = await routineItems(session.routineId);
    await logSet({ sessionId: session.id, routineExerciseId: items[0].rx.id, exerciseId: BENCH.id, type: 'working', weight: 50, reps: 12 });
    await finishSession(session.id, { choices: [] });

    const snapshot = {
      routine: await db.routines.get(session.routineId),
      rows: await db.routineExercises.where('routineId').equals(session.routineId).sortBy('order'),
      session: await db.sessions.get(session.id),
      sets: await db.setLogs.where('sessionId').equals(session.id).toArray(),
      decisions: await db.decisions.where('sessionId').equals(session.id).toArray(),
    };
    const file = JSON.parse(JSON.stringify(await exportBackup())) as Backup;

    await wipeAll();
    expect(await db.routines.count()).toBe(0);
    await importBackup(file, 'replace');

    expect(await db.routines.get(session.routineId)).toEqual(snapshot.routine);
    expect(Object.keys((await db.routines.get(session.routineId))!).sort()).toEqual(['archived', 'id', 'isLowerBody', 'name', 'order', 'quick']);
    expect(await db.sessions.get(session.id)).toEqual(snapshot.session);
    expect((await db.sessions.get(session.id))!.quick).toBe('light');
    expect(await db.routineExercises.where('routineId').equals(session.routineId).sortBy('order')).toEqual(snapshot.rows);
    expect(await db.setLogs.where('sessionId').equals(session.id).toArray()).toEqual(snapshot.sets);
    expect(await db.decisions.where('sessionId').equals(session.id).toArray()).toEqual(snapshot.decisions);
    expect((await listArchivedRoutines()).map((r) => r.id)).not.toContain(session.routineId);

    await deleteSession(session.id);
    expect(await db.routines.get(session.routineId)).toBeUndefined();
    expect(await db.routineExercises.where('routineId').equals(session.routineId).count()).toBe(0);
  });
});
