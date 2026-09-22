import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { nextSessionPlan } from './planQueries';
import { finishSession, logSet, resetToSeed, startSession, updateSession } from './repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from './seed';
import type { RoutineExercise } from '@/domain/types';

const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];
const RDL = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'];

async function rxFor(routineId: string, exerciseId: string): Promise<RoutineExercise> {
  const rxs = await db.routineExercises.where('routineId').equals(routineId).toArray();
  return rxs.find((r) => r.exerciseId === exerciseId)!;
}

beforeEach(async () => {
  await resetToSeed();
});

describe('nextSessionPlan', () => {
  it('returns null for a routine that does not exist', async () => {
    const settings = (await db.settings.get('settings'))!;
    expect(await nextSessionPlan('missing-routine', settings)).toBeNull();
  });

  it('carries the prescription and last-time line for an exercise', async () => {
    const rx = await rxFor(HINGE, RDL);
    const session = await startSession(HINGE);
    for (const r of [8, 8, 7]) await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: r });
    await updateSession(session.id, { endedAt: '2026-09-01T19:00:00.000Z' });

    const settings = (await db.settings.get('settings'))!;
    const plan = await nextSessionPlan(HINGE, settings);
    expect(plan).not.toBeNull();
    const item = plan!.items.find((i) => i.exercise.id === RDL)!;

    // Seeded RDL is normal mode at 110 kg, so the prescription is a plain weight × reps × sets line.
    expect(item.prescription.line).toBe('110 kg × 6–8 × 4');
    expect(item.lastTime).not.toBeNull();
    expect(item.lastTime!.line).toBe('110 × 8, 8, 7');
  });

  it('shows last time\'s feel word, read from the last logged set\'s RIR', async () => {
    const rx = await rxFor(HINGE, RDL);
    const session = await startSession(HINGE);
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: 8, rir: 0 });
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: 7, rir: 2 });
    await updateSession(session.id, { endedAt: '2026-09-01T19:00:00.000Z' });

    const settings = (await db.settings.get('settings'))!;
    const plan = await nextSessionPlan(HINGE, settings);
    const item = plan!.items.find((i) => i.exercise.id === RDL)!;
    // The last set carried RIR 2 ("Good"), not the first set's RIR 0 ("Maxed").
    expect(item.lastTime!.feel).toBe('Good');
  });

  it('leaves out the feel word when the last set carries no RIR', async () => {
    const rx = await rxFor(HINGE, RDL);
    const session = await startSession(HINGE);
    for (const r of [8, 8, 7]) await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: r });
    await updateSession(session.id, { endedAt: '2026-09-01T19:00:00.000Z' });

    const settings = (await db.settings.get('settings'))!;
    const plan = await nextSessionPlan(HINGE, settings);
    const item = plan!.items.find((i) => i.exercise.id === RDL)!;
    expect(item.lastTime!.feel).toBeUndefined();
  });

  it('counts stalled exercises and suggests a deload at 2 or more', async () => {
    const rx = await rxFor(HINGE, RDL);
    // Three sessions at the same weight = stalled.
    for (const startedAt of ['2026-09-01T18:00:00.000Z', '2026-09-04T18:00:00.000Z', '2026-09-07T18:00:00.000Z']) {
      const session = await startSession(HINGE);
      await updateSession(session.id, { startedAt });
      for (const r of [6, 6, 6, 6]) await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: r });
      await finishSession(session.id, { choices: [] });
    }

    const settings = (await db.settings.get('settings'))!;
    const plan = await nextSessionPlan(HINGE, settings);
    const item = plan!.items.find((i) => i.exercise.id === RDL)!;
    expect(item.stall).toEqual({ kind: 'stalled', sessions: 3, weight: 110 });
    expect(plan!.stalledCount).toBeGreaterThanOrEqual(1);
  });

  it('applies the deload option to the prescription line', async () => {
    const settings = (await db.settings.get('settings'))!;
    const plan = await nextSessionPlan(HINGE, settings, { deload: true });
    const item = plan!.items.find((i) => i.exercise.id === RDL)!;
    expect(item.prescription.flags).toContain('deload');
    // 110 kg × 0.9 deloadPercent, rounded to the increment grid then to plates.
    expect(item.prescription.weight).toBeLessThan(110);
  });
});
