import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { logSet, resetToSeed, saveSettings, startSession } from './repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from './seed';
import { muscleRecency, weeklySetsByMuscle, weeklySetsTable } from './volumeQueries';
import { mondayOf } from '@/domain/dates';
import type { RoutineExercise } from '@/domain/types';

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
