import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  applyReconciledWeights,
  classifySessionImport,
  importFingerprint,
  parseHevyCsv,
  parseHevyDate,
  planHevyImport,
  reconcileWeights,
  runHevyImport,
} from './hevy';
import { lastCompletedSession, previousSets, resetToSeed, setSlotFeel, updateSet } from './repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from './seed';
import { suggestNextRoutine } from '@/domain/schedule';
import type { Session, SetLog } from '@/domain/types';

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

describe('set_type mapping', () => {
  const header = 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';
  const row = (setIndex: number, setType: string) =>
    `"Routine 1 - Lower","12 Aug 2026, 19:31","12 Aug 2026, 21:03","","Romanian Deadlift (Barbell)",,"",${setIndex},"${setType}",110,8,,,`;
  const SET_TYPES_CSV = [header, row(0, 'normal'), row(1, 'warmup'), row(2, 'failure'), row(3, 'dropset')].join('\n');

  it('maps Hevy set_type onto our four set types: normal→working, warmup→warmup, failure→failure, dropset→drop', () => {
    const parsed = parseHevyCsv(SET_TYPES_CSV);
    const sets = parsed.sessions.flatMap((s) => s.sets).sort((a, b) => a.ordinal - b.ordinal);
    expect(sets.map((s) => s.type)).toEqual(['working', 'warmup', 'failure', 'drop']);
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

  it('is idempotent: importing the same untouched file twice creates no duplicates and writes nothing the second time', async () => {
    const parsed = parseHevyCsv(WORKOUTS);
    await runHevyImport(parsed, await planHevyImport(parsed));
    const before = {
      sessions: await db.sessions.count(),
      sets: await db.setLogs.count(),
      exercises: await db.exercises.count(),
      ids: (await db.setLogs.toCollection().primaryKeys()).sort(),
    };
    // Stamp a sentinel field on one row. bulkPut always replaces the whole record, so this
    // sentinel surviving the second import is a positive, checkable signal that the row was never
    // rewritten — not merely that its visible fields happen to look the same afterwards.
    const sentinelId = before.ids[0] as string;
    await db.setLogs.update(sentinelId, { __untouched: true } as unknown as Partial<SetLog>);

    const again = await runHevyImport(parsed, await planHevyImport(parsed));
    expect(again.sessionsNew).toBe(0);
    expect(again.sessionsUpdated).toBe(0);
    expect(again.sessionsUnchanged).toBe(21);
    expect(again.sessionsEditedKept).toBe(0);
    expect(again.setsWritten).toBe(0);
    expect(again.exercisesCreated).toEqual([]);
    expect(await db.sessions.count()).toBe(before.sessions);
    expect(await db.setLogs.count()).toBe(before.sets);
    expect(await db.exercises.count()).toBe(before.exercises);
    expect((await db.setLogs.toCollection().primaryKeys()).sort()).toEqual(before.ids);

    const sentinelRow = (await db.setLogs.get(sentinelId)) as unknown as Record<string, unknown>;
    expect(sentinelRow.__untouched).toBe(true);
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

// ---------------------------------------------------------------------------
// classifySessionImport / importFingerprint — pure decision logic (WP1b)

describe('classifySessionImport / importFingerprint (pure)', () => {
  const row = (over: Partial<SetLog> = {}): SetLog => ({
    id: 'set-1',
    sessionId: 's1',
    routineExerciseId: null,
    exerciseId: 'ex1',
    index: 0,
    type: 'working',
    weight: 100,
    reps: 8,
    completedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
  const existingSession = (importHash?: string): Session => ({
    id: 's1',
    routineId: '',
    title: 'Workout',
    startedAt: '2026-01-01T00:00:00.000Z',
    source: 'hevy',
    importHash,
  });

  it('a session Iron has never imported is new', () => {
    expect(classifySessionImport(undefined, [], importFingerprint([row()]))).toBe('new');
  });

  it('a session with no importHash (imported before fingerprints existed) that differs from the CSV is kept, as unknown', () => {
    const stored = [row()];
    expect(classifySessionImport(existingSession(undefined), stored, importFingerprint([row({ weight: 105 })]))).toBe('editedKept');
  });

  it('a session with no importHash that already matches the CSV exactly is unchanged, not counted as an edit', () => {
    const stored = [row()];
    expect(classifySessionImport(existingSession(undefined), stored, importFingerprint(stored))).toBe('unchanged');
  });

  it('a session whose stored sets still match the recorded fingerprint, and the CSV has not changed, is unchanged', () => {
    const stored = [row()];
    const fp = importFingerprint(stored);
    expect(classifySessionImport(existingSession(fp), stored, fp)).toBe('unchanged');
  });

  it('a session whose stored sets still match the recorded fingerprint, and the CSV changed, is updated', () => {
    const stored = [row()];
    const fp = importFingerprint(stored);
    const newFp = importFingerprint([row({ weight: 105 })]);
    expect(classifySessionImport(existingSession(fp), stored, newFp)).toBe('updated');
  });

  it('a session whose stored sets no longer match the recorded fingerprint (edited in Iron) is kept, even if the CSV also changed', () => {
    const original = [row()];
    const fp = importFingerprint(original);
    const editedInApp = [row({ weight: 999 })];
    const newFp = importFingerprint([row({ weight: 105 })]);
    expect(classifySessionImport(existingSession(fp), editedInApp, newFp)).toBe('editedKept');
  });

  it('the fingerprint is order-independent', () => {
    const a = [row({ id: 'a', index: 0 }), row({ id: 'b', index: 1, weight: 105 })];
    const b = [a[1], a[0]];
    expect(importFingerprint(a)).toBe(importFingerprint(b));
  });

  it('the fingerprint changes when an import-controlled field changes', () => {
    expect(importFingerprint([row()])).not.toBe(importFingerprint([row({ reps: 9 })]));
    expect(importFingerprint([row()])).not.toBe(importFingerprint([row({ type: 'drop' })]));
  });
});

// ---------------------------------------------------------------------------
// Edit-safe re-import against fake-indexeddb (WP1b)

describe('re-import does not silently discard edits made in Iron', () => {
  const header =
    'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';
  const csv = (weight: number) =>
    [
      header,
      `"Lower (Hinge)","1 Sep 2026, 18:00","1 Sep 2026, 19:00","","Romanian Deadlift (Barbell)",,"",0,"normal",${weight},8,,,`,
      `"Lower (Hinge)","1 Sep 2026, 18:00","1 Sep 2026, 19:00","","Romanian Deadlift (Barbell)",,"",1,"normal",${weight},8,,,`,
    ].join('\n');

  async function importedSession() {
    return (await db.sessions.toArray()).find((s) => s.source === 'hevy')!;
  }

  beforeEach(async () => {
    await resetToSeed();
  });

  it('a fresh import is all new, with no editedKept/unchanged sessions', async () => {
    const parsed = parseHevyCsv(csv(100));
    const plan = await planHevyImport(parsed);
    expect(plan.counts).toEqual({ sessionsNew: 1, sessionsUpdated: 0, sessionsUnchanged: 0, sessionsEditedKept: 0, sessionsEditedOverwritten: 0 });
    const result = await runHevyImport(parsed, plan);
    expect(result.sessionsNew).toBe(1);
    expect(result.setsWritten).toBe(2);
  });

  it('an edit made in Iron survives a re-import and is counted as kept', async () => {
    const parsed = parseHevyCsv(csv(100));
    await runHevyImport(parsed, await planHevyImport(parsed));
    const session = await importedSession();
    const sets = await db.setLogs.where('sessionId').equals(session.id).sortBy('index');
    expect(sets.map((s) => s.weight)).toEqual([100, 100]);

    // Edit made in Iron: bump the first set's weight.
    await updateSet(sets[0].id, { weight: 110 });

    // Re-import the exact same (unchanged) CSV.
    const parsed2 = parseHevyCsv(csv(100));
    const plan2 = await planHevyImport(parsed2);
    expect(plan2.counts.sessionsEditedKept).toBe(1);
    expect(plan2.counts.sessionsUpdated).toBe(0);
    expect(plan2.counts.sessionsUnchanged).toBe(0);

    const result2 = await runHevyImport(parsed2, plan2);
    expect(result2.sessionsEditedKept).toBe(1);
    expect(result2.sessionsUpdated).toBe(0);
    expect(result2.setsWritten).toBe(0);

    const setsAfter = await db.setLogs.where('sessionId').equals(session.id).sortBy('index');
    expect(setsAfter.map((s) => s.weight)).toEqual([110, 100]); // the edit survives
  });

  it('answering the feel question on an imported session survives a re-import too — rir is part of the fingerprint', async () => {
    const parsed = parseHevyCsv(csv(100));
    await runHevyImport(parsed, await planHevyImport(parsed));
    const session = await importedSession();
    const sets = await db.setLogs.where('sessionId').equals(session.id).sortBy('index');
    expect(sets.every((s) => s.rir === undefined)).toBe(true);

    // Answer "Easy" on the imported slot in Iron — no weight/reps/type change, only rir.
    await setSlotFeel(session.id, sets[0].routineExerciseId, sets[0].exerciseId, 3);
    const answered = await db.setLogs.where('sessionId').equals(session.id).sortBy('index');
    expect(answered.every((s) => s.rir === 3)).toBe(true);

    // Re-import the exact same (unchanged) CSV: the fingerprint no longer matches, so the
    // session is classed as edited and Iron's version (with the feel answer) is kept.
    const parsed2 = parseHevyCsv(csv(100));
    const plan2 = await planHevyImport(parsed2);
    expect(plan2.counts.sessionsEditedKept).toBe(1);
    expect(plan2.counts.sessionsUpdated).toBe(0);
    expect(plan2.counts.sessionsUnchanged).toBe(0);

    const result2 = await runHevyImport(parsed2, plan2);
    expect(result2.sessionsEditedKept).toBe(1);
    expect(result2.setsWritten).toBe(0);

    const setsAfter = await db.setLogs.where('sessionId').equals(session.id).sortBy('index');
    expect(setsAfter.every((s) => s.rir === 3)).toBe(true); // the feel answer survives
  });

  it('the overwrite opt-in replaces an edited session with the current Hevy version', async () => {
    const parsed = parseHevyCsv(csv(100));
    await runHevyImport(parsed, await planHevyImport(parsed));
    const session = await importedSession();
    const sets = await db.setLogs.where('sessionId').equals(session.id).sortBy('index');
    await updateSet(sets[0].id, { weight: 110 }); // edit in Iron

    const parsed2 = parseHevyCsv(csv(100));
    const plan2 = await planHevyImport(parsed2);
    const result2 = await runHevyImport(parsed2, plan2, { overwriteEdited: true });
    expect(result2.sessionsEditedOverwritten).toBe(1);
    expect(result2.sessionsEditedKept).toBe(0);
    expect(result2.setsWritten).toBe(2);

    const setsAfter = await db.setLogs.where('sessionId').equals(session.id).sortBy('index');
    expect(setsAfter.map((s) => s.weight)).toEqual([100, 100]); // Hevy's version wins
  });

  it('an untouched session is updated when the Hevy CSV changes', async () => {
    const parsed = parseHevyCsv(csv(100));
    await runHevyImport(parsed, await planHevyImport(parsed));
    const session = await importedSession();

    const parsed2 = parseHevyCsv(csv(105)); // weight changed on the Hevy side
    const plan2 = await planHevyImport(parsed2);
    expect(plan2.counts.sessionsUpdated).toBe(1);
    expect(plan2.counts.sessionsUnchanged).toBe(0);
    expect(plan2.counts.sessionsEditedKept).toBe(0);

    const result2 = await runHevyImport(parsed2, plan2);
    expect(result2.sessionsUpdated).toBe(1);
    expect(result2.setsWritten).toBe(2);
    const sets = await db.setLogs.where('sessionId').equals(session.id).sortBy('index');
    expect(sets.every((s) => s.weight === 105)).toBe(true);
  });

  it('an identical re-import of an untouched session is unchanged and writes nothing', async () => {
    const parsed = parseHevyCsv(csv(100));
    await runHevyImport(parsed, await planHevyImport(parsed));
    const session = await importedSession();
    const before = await db.setLogs.where('sessionId').equals(session.id).sortBy('index');

    // A sentinel field bulkPut would always wipe, so it surviving proves the row was never rewritten.
    await db.setLogs.update(before[0].id, { __untouched: true } as unknown as Partial<SetLog>);

    const parsed2 = parseHevyCsv(csv(100));
    const plan2 = await planHevyImport(parsed2);
    expect(plan2.counts.sessionsUnchanged).toBe(1);

    const result2 = await runHevyImport(parsed2, plan2);
    expect(result2.sessionsUnchanged).toBe(1);
    expect(result2.sessionsUpdated).toBe(0);
    expect(result2.setsWritten).toBe(0);

    const after = (await db.setLogs.get(before[0].id)) as unknown as Record<string, unknown>;
    expect(after.__untouched).toBe(true);
    expect(after.completedAt).toBe(before[0].completedAt);
  });

  it('a session imported before fingerprints existed is unchanged on an identical re-import, then protected from then on', async () => {
    // The owner's phone holds sessions imported by an earlier build: same rows, no importHash.
    const parsed = parseHevyCsv(csv(100));
    await runHevyImport(parsed, await planHevyImport(parsed));
    const session = await importedSession();
    await db.sessions.update(session.id, { importHash: undefined });
    expect((await db.sessions.get(session.id))!.importHash).toBeUndefined();

    const plan2 = await planHevyImport(parseHevyCsv(csv(100)));
    expect(plan2.counts).toMatchObject({ sessionsUnchanged: 1, sessionsEditedKept: 0 });
    const result2 = await runHevyImport(parseHevyCsv(csv(100)), plan2);
    expect(result2).toMatchObject({ sessionsUnchanged: 1, sessionsEditedKept: 0, setsWritten: 0 });
    // It adopted the fingerprint, so an edit made in Iron from now on is recognised as one.
    expect((await db.sessions.get(session.id))!.importHash).toBeDefined();

    const sets = await db.setLogs.where('sessionId').equals(session.id).sortBy('index');
    await updateSet(sets[0].id, { weight: 110 });
    const result3 = await runHevyImport(parseHevyCsv(csv(105)), await planHevyImport(parseHevyCsv(csv(105))));
    expect(result3).toMatchObject({ sessionsEditedKept: 1, sessionsUpdated: 0, setsWritten: 0 });
    const setsAfter = await db.setLogs.where('sessionId').equals(session.id).sortBy('index');
    expect(setsAfter.map((s) => s.weight)).toEqual([110, 100]);
  });
});
