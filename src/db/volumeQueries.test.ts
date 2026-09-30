import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { logSet, resetToSeed, saveSettings, startSession } from './repo';
import { SEED_EXERCISE_IDS, SEED_EXERCISES, SEED_ROUTINE_IDS } from './seed';
import { muscleRecency, muscleSetRowsFrom, weeklySetsByMuscle, weeklySetsTable } from './volumeQueries';
import { mondayOf } from '@/domain/dates';
import type { Exercise, RoutineExercise, Session, SetLog } from '@/domain/types';
import { muscleRecency as muscleRecencyFromRows, weeklySetsByMuscle as weeklySetsFromRows } from '@/domain/volume';

const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];
const RDL = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)']; // hamstrings

async function rxFor(routineId: string, exerciseId: string): Promise<RoutineExercise> {
  const rxs = await db.routineExercises.where('routineId').equals(routineId).toArray();
  return rxs.find((r) => r.exerciseId === exerciseId)!;
}

/** Backdate a session's own sets (`logSet` always stamps `completedAt` with the real clock). */
async function backdateSets(sessionId: string, iso: string): Promise<void> {
  const sets = await db.setLogs.where('sessionId').equals(sessionId).toArray();
  for (const s of sets) await db.setLogs.update(s.id, { completedAt: iso });
}

beforeEach(async () => {
  await resetToSeed();
});

describe('weeklySetsByMuscle', () => {
  it('counts sets for completed sessions in the given week, joined through to the muscle group', async () => {
    const rx = await rxFor(HINGE, RDL);
    const session = await startSession(HINGE);
    for (const r of [8, 8, 8]) await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: r });
    await backdateSets(session.id, '2026-09-08T18:30:00.000Z');
    await db.sessions.update(session.id, { startedAt: '2026-09-08T18:00:00.000Z', endedAt: '2026-09-08T19:00:00.000Z' });

    const week = mondayOf('2026-09-08');
    const byMuscle = await weeklySetsByMuscle(week);
    expect(byMuscle.hamstrings).toBe(3);
  });

  it('ignores sets from a session that never finished', async () => {
    const rx = await rxFor(HINGE, RDL);
    const session = await startSession(HINGE);
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: 8 });
    await backdateSets(session.id, '2026-09-08T18:30:00.000Z');
    await db.sessions.update(session.id, { startedAt: '2026-09-08T18:00:00.000Z' }); // never ended

    const byMuscle = await weeklySetsByMuscle(mondayOf('2026-09-08'));
    expect(byMuscle.hamstrings ?? 0).toBe(0);
  });
});

describe('muscleRecency', () => {
  it('gives days since the most recent counted set', async () => {
    const rx = await rxFor(HINGE, RDL);
    const session = await startSession(HINGE);
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: 8 });
    await backdateSets(session.id, '2026-09-01T18:30:00.000Z');
    await db.sessions.update(session.id, { startedAt: '2026-09-01T18:00:00.000Z', endedAt: '2026-09-01T19:00:00.000Z' });

    const recency = await muscleRecency('2026-09-05');
    expect(recency.hamstrings).toBe(4);
  });
});

describe('weeklySetsTable', () => {
  it('includes groups with sets or a target, sorted by sets desc', async () => {
    await saveSettings({ weeklySetTargets: { hamstrings: 10, biceps: 8 } });
    const rx = await rxFor(HINGE, RDL);
    const session = await startSession(HINGE);
    for (const r of [8, 8]) await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: r });
    await backdateSets(session.id, '2026-09-08T18:30:00.000Z');
    await db.sessions.update(session.id, { startedAt: '2026-09-08T18:00:00.000Z', endedAt: '2026-09-08T19:00:00.000Z' });

    const settings = (await db.settings.get('settings'))!;
    const table = await weeklySetsTable(mondayOf('2026-09-08'), settings);
    const hamstrings = table.find((r) => r.muscleGroup === 'hamstrings')!;
    expect(hamstrings).toMatchObject({ sets: 2, target: 10 });
    // biceps has a target but no sets this week — still present, with 0 sets.
    const biceps = table.find((r) => r.muscleGroup === 'biceps')!;
    expect(biceps).toMatchObject({ sets: 0, target: 8 });
    // Sorted by sets desc.
    expect(table[0].muscleGroup).toBe('hamstrings');
  });
});

describe('muscleSetRowsFrom', () => {
  const exercise = (id: string, muscleGroup: Exercise['muscleGroup']): Exercise => ({ ...SEED_EXERCISES[0], id, muscleGroup, createdAt: '' });
  const set = (id: string, sessionId: string, exerciseId: string, type: SetLog['type'] = 'working'): SetLog => ({
    id,
    sessionId,
    routineExerciseId: null,
    exerciseId,
    index: 0,
    type,
    weight: 50,
    reps: 8,
    completedAt: `2026-09-08T18:${id.padStart(2, '0')}:00.000Z`,
  });
  const session = (id: string, endedAt?: string): Session => ({ id, routineId: HINGE, title: id, startedAt: '2026-09-08T18:00:00.000Z', ...(endedAt ? { endedAt } : {}) });

  it('joins each set of a finished session to its exercise’s muscle group, and drops the rest', () => {
    const rows = muscleSetRowsFrom(
      [set('1', 'done', 'chest-ex'), set('2', 'done', 'legs-ex', 'warmup'), set('3', 'live', 'chest-ex'), set('4', 'done', 'deleted-ex'), set('5', 'gone', 'chest-ex')],
      [session('done', '2026-09-08T19:00:00.000Z'), session('live')],
      [exercise('chest-ex', 'chest'), exercise('legs-ex', 'quads')],
    );

    // A set of an unfinished session, of an exercise since deleted, or of a session no longer there is not a row.
    expect(rows).toEqual([
      { muscleGroup: 'chest', type: 'working', completedAt: '2026-09-08T18:01:00.000Z' },
      { muscleGroup: 'quads', type: 'warmup', completedAt: '2026-09-08T18:02:00.000Z' },
    ]);
  });

  it('gives the rows the table readers are built on', async () => {
    const rx = await rxFor(HINGE, RDL);
    const s = await startSession(HINGE);
    await logSet({ sessionId: s.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 100, reps: 8 });
    await backdateSets(s.id, '2026-09-08T18:30:00.000Z');
    await db.sessions.update(s.id, { startedAt: '2026-09-08T18:00:00.000Z', endedAt: '2026-09-08T19:00:00.000Z' });

    const rows = muscleSetRowsFrom(await db.setLogs.toArray(), await db.sessions.toArray(), await db.exercises.toArray());

    expect(rows).toHaveLength(1);
    expect(weeklySetsFromRows(rows, mondayOf('2026-09-08'))).toEqual(await weeklySetsByMuscle(mondayOf('2026-09-08')));
    expect(muscleRecencyFromRows(rows, '2026-09-10')).toEqual(await muscleRecency('2026-09-10'));
  });
});
