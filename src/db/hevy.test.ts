import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { applyReconciledWeights, parseHevyCsv, parseHevyDate, planHevyImport, reconcileWeights, runHevyImport } from './hevy';
import { lastCompletedSession, previousSets, resetToSeed } from './repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from './seed';
import { suggestNextRoutine } from '@/domain/schedule';

const WORKOUTS = readFileSync(new URL('../../hevy_export.csv', import.meta.url), 'utf8');
const MEASUREMENTS = readFileSync(new URL('../../hevy_measurements.csv', import.meta.url), 'utf8');

describe('Hevy date parsing', () => {
  it('parses "8 Sep 2026, 20:03" as local time', () => {
    const d = parseHevyDate('8 Sep 2026, 20:03');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(8);
    expect(d?.getHours()).toBe(20);
    expect(d?.getMinutes()).toBe(3);
  });
  it('parses measurement dates and ISO strings', () => {
    expect(parseHevyDate('20 Jul 2026, 00:00')?.getDate()).toBe(20);
    expect(parseHevyDate('2026-09-08 20:03:00')?.getHours()).toBe(20);
    expect(parseHevyDate('')).toBeNull();
    expect(parseHevyDate('nonsense')).toBeNull();
  });
});

describe('parsing the real hevy_export.csv', () => {
  const parsed = parseHevyCsv(WORKOUTS);

  it('detects the workout export and its columns', () => {
    expect(parsed.kind).toBe('workouts');
    expect(parsed.columns).toEqual([
      'title', 'start_time', 'end_time', 'description', 'exercise_title', 'superset_id', 'exercise_notes',
      'set_index', 'set_type', 'weight_kg', 'reps', 'distance_km', 'duration_seconds', 'rpe',
    ]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.skippedRows).toBe(0);
  });

  it('groups 393 rows into 21 sessions across 25 exercises', () => {
    expect(parsed.sessions).toHaveLength(21);
    expect(parsed.sessions.reduce((n, s) => n + s.sets.length, 0)).toBe(393);
    expect(parsed.exercises).toHaveLength(25);
    expect(parsed.sessions[0].title).toBe('Routine 1 - Lower');
    expect(parsed.sessions[parsed.sessions.length - 1].title).toBe('Routine 2 - Upper (Push)');
  });

  it('reads distance in metres, empty weights as bodyweight, and set types', () => {
    const walk = parsed.sessions.flatMap((s) => s.sets).filter((x) => x.exerciseTitle === 'Farmers Walk');
    expect(walk).toHaveLength(3);
    expect(walk[0].distanceM).toBe(40);
    expect(walk[0].weight).toBe(40);
    expect(walk[0].reps).toBeUndefined();
    const be = parsed.exercises.find((e) => e.title === 'Back Extension (Weighted Hyperextension)');
    expect(be?.bodyweightOnly).toBe(true);
    expect(parsed.sessions.flatMap((s) => s.sets).every((x) => x.type === 'working')).toBe(true);
  });

  it('flags dumbbell presses logged as pair totals but not curls or raises', () => {
    const stat = (t: string) => parsed.exercises.find((e) => e.title === t)!;
    expect(stat('Incline Bench Press (Dumbbell)').isDumbbell).toBe(true);
    expect(stat('Incline Bench Press (Dumbbell)').medianWeight).toBeGreaterThanOrEqual(24);
    expect(stat('Bicep Curl (Dumbbell)').medianWeight).toBeLessThan(24);
    expect(stat('Bench Press (Barbell)').isDumbbell).toBe(false);
  });
});

describe('importing into a seeded database', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  it('auto-maps exercises via seed names and aliases, and routines via titles', async () => {
    const parsed = parseHevyCsv(WORKOUTS);
    const plan = await planHevyImport(parsed);
    const ex = (t: string) => plan.exercises.find((e) => e.title === t)!;
    expect(ex('Romanian Deadlift (Barbell)').matched).toBe('name');
    expect(ex('Incline Bench Press (Dumbbell)').exerciseName).toBe('Incline DB Press');
    expect(ex('Incline Bench Press (Dumbbell)').matched).toBe('alias');
    expect(ex('Incline Bench Press (Dumbbell)').halve).toBe(true);
    expect(ex('Overhead Press (Dumbbell)').exerciseName).toBe('DB Shoulder Press');
    expect(ex('Bicep Curl (Dumbbell)').exerciseName).toBe('DB Curl');
    expect(ex('Bicep Curl (Dumbbell)').halve).toBe(false);
    expect(ex('Farmers Walk').exerciseName).toBe("Farmer's Carry");
    expect(ex('Lying Neck Curls (Weighted)').exerciseName).toBe('Neck');
    expect(ex('Bench Press (Cable)').matched).toBe('none');
    expect(ex('Leg Press (Machine)').matched).toBe('none');
    expect(ex('Squat (Smith Machine)').matched).toBe('none');

    const r = (t: string) => plan.routines.find((x) => x.title === t)!;
    expect(r('Routine 1 - Lower').routineName).toBe('Lower (Hinge)');
    expect(r('Routine 2 - Upper (Push)').routineName).toBe('Upper (Push)');
    expect(r('Routine 3 - Lower (Squat)').routineName).toBe('Lower (Squat)');
    expect(r('Routine 4 - Upper (Pull)').routineName).toBe('Upper (Pull)');
  });

  it('imports every session and set, creating only the unknown exercises', async () => {
    const parsed = parseHevyCsv(WORKOUTS);
    const plan = await planHevyImport(parsed);
    const result = await runHevyImport(parsed, plan);
    expect(result.sessionsNew).toBe(21);
    expect(result.sessionsUpdated).toBe(0);
    expect(result.setsWritten).toBe(393);
    expect(result.exercisesCreated.sort()).toEqual(['Bench Press (Cable)', 'Leg Press (Machine)', 'Squat (Smith Machine)']);
    expect(await db.sessions.count()).toBe(21);
    expect(await db.setLogs.count()).toBe(393);
    expect(await db.exercises.count()).toBe(27 + 3);

    // Sets land on the seed routine-exercise so "previous session" works from day one.
    const rdlSets = await db.setLogs.where('exerciseId').equals(SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)']).toArray();
    expect(rdlSets).toHaveLength(16);
    expect(new Set(rdlSets.map((s) => s.routineExerciseId)).size).toBe(1);
    expect(rdlSets[0].routineExerciseId).not.toBeNull();

    // Pair totals halved to per-hand.
    const incline = await db.setLogs.where('exerciseId').equals(SEED_EXERCISE_IDS['Incline DB Press']).toArray();
    expect(Math.max(...incline.map((s) => s.weight))).toBe(26);
    // Bodyweight back extensions import as 0 added kg.
    const be = await db.setLogs.where('exerciseId').equals(SEED_EXERCISE_IDS['Back Extension']).toArray();
    expect(be.every((s) => s.weight === 0)).toBe(true);
    // Sessions carry routine ids, titles, durations and the hevy source.
    const push = (await db.sessions.toArray()).filter((s) => s.title === 'Routine 2 - Upper (Push)');
    expect(push).toHaveLength(7);
    expect(push.every((s) => s.routineId === SEED_ROUTINE_IDS['Upper (Push)'])).toBe(true);
    expect(push.every((s) => s.source === 'hevy' && !!s.endedAt && (s.durationSec ?? 0) > 0)).toBe(true);
  });

  it('is idempotent: importing the same file twice creates no duplicates', async () => {
    const parsed = parseHevyCsv(WORKOUTS);
    await runHevyImport(parsed, await planHevyImport(parsed));
    const before = {
      sessions: await db.sessions.count(),
      sets: await db.setLogs.count(),
      exercises: await db.exercises.count(),
      ids: (await db.setLogs.toCollection().primaryKeys()).sort(),
    };
    const again = await runHevyImport(parsed, await planHevyImport(parsed));
    expect(again.sessionsNew).toBe(0);
    expect(again.sessionsUpdated).toBe(21);
    expect(again.exercisesCreated).toEqual([]);
    expect(await db.sessions.count()).toBe(before.sessions);
    expect(await db.setLogs.count()).toBe(before.sets);
    expect(await db.exercises.count()).toBe(before.exercises);
    expect((await db.setLogs.toCollection().primaryKeys()).sort()).toEqual(before.ids);
  });

  it('remembers Hevy titles as aliases so a second import auto-matches created exercises', async () => {
    const parsed = parseHevyCsv(WORKOUTS);
    await runHevyImport(parsed, await planHevyImport(parsed));
    const plan2 = await planHevyImport(parsed);
    expect(plan2.exercises.every((e) => e.matched !== 'none')).toBe(true);
  });

  it('feeds "previous session" and "next up" from imported history', async () => {
    const parsed = parseHevyCsv(WORKOUTS);
    await runHevyImport(parsed, await planHevyImport(parsed));
    const rdlRx = (await db.routineExercises.where('exerciseId').equals(SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)']).first())!;
    const prev = await previousSets(rdlRx.id, rdlRx.exerciseId, 'none');
    expect(prev?.sets.map((s) => `${s.weight}x${s.reps}`)).toEqual(['90x8', '90x8', '90x8', '90x8']);
    expect(prev?.startedAt.startsWith('2026-08-31')).toBe(true);

    const last = await lastCompletedSession();
    expect(last?.title).toBe('Routine 2 - Upper (Push)');
    const routines = await db.routines.toArray();
    expect(suggestNextRoutine(routines, last?.routineId)?.name).toBe('Lower (Squat)');
  });

  it('offers to reconcile prescribed weights with the latest imported session', async () => {
    const parsed = parseHevyCsv(WORKOUTS);
    await runHevyImport(parsed, await planHevyImport(parsed));
    const rows = await reconcileWeights();
    const row = (name: string) => rows.find((r) => r.exercise.name === name);
    expect(row('Romanian Deadlift (Barbell)')).toMatchObject({ current: 110, latest: 90 });
    expect(row('Bench Press (Barbell)')).toMatchObject({ current: 65, latest: 75, reps: [6, 6, 6, 6] });
    expect(row('Hip Thrust (Barbell)')).toBeUndefined(); // already 95
    expect(row('Incline DB Press')).toMatchObject({ latest: 26 });
    expect(row('Incline DB Press')?.rx.mode).toBe('calibrating');

    await applyReconciledWeights([row('Bench Press (Barbell)')!, row('Incline DB Press')!]);
    const bench = await db.routineExercises.get(row('Bench Press (Barbell)')!.rx.id);
    expect(bench?.currentWeight).toBe(75);
    const incline = await db.routineExercises.get(row('Incline DB Press')!.rx.id);
    expect(incline).toMatchObject({ mode: 'normal', currentWeight: 26 });
    const lockDecision = await db.decisions.where('routineExerciseId').equals(incline!.id).first();
    expect(lockDecision?.rule).toBe('lock_in');
  });

  it('imports the measurements file as bodyweight, idempotently', async () => {
    const parsed = parseHevyCsv(MEASUREMENTS);
    expect(parsed.kind).toBe('measurements');
    expect(parsed.measurements).toEqual([{ date: '2026-07-20', kg: 74.5 }]);
    const r1 = await runHevyImport(parsed, await planHevyImport(parsed));
    expect(r1.bodyweightWritten).toBe(1);
    const r2 = await runHevyImport(parsed, await planHevyImport(parsed));
    expect(r2.bodyweightWritten).toBe(1);
    const entries = await db.bodyweight.where('date').equals('2026-07-20').toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].kg).toBe(74.5);
  });

  it('rejects files that are not Hevy exports', () => {
    const parsed = parseHevyCsv('a,b,c\n1,2,3\n');
    expect(parsed.kind).toBe('unknown');
    expect(parsed.warnings[0]).toMatch(/Not a Hevy export/);
  });
});
