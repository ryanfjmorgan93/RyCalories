import { beforeEach, describe, expect, it } from 'vitest';
import { gatherContext } from './assistantQueries';
import { db } from './db';
import { finishSession, logSet, resetToSeed, startSession } from './repo';
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

describe('gatherContext', () => {
  it('fills the exercise block with the prescription line, when an exerciseId is given', async () => {
    const settings = (await db.settings.get('settings'))!;
    const ctx = await gatherContext({ today: '2026-09-08', settings, exerciseId: RDL });
    expect(ctx.exercise).toBeDefined();
    expect(ctx.exercise!.name).toBe('Romanian Deadlift (Barbell)');
    expect(ctx.exercise!.muscleGroup).toBe('hamstrings');
    expect(ctx.exercise!.prescription).toBe('110 kg × 6–8 × 4');
    expect(ctx.exercise!.cue).toBe('Straps. 3-sec lower. Depth over load.');
  });

  it('omits the exercise block when no exerciseId is given', async () => {
    const settings = (await db.settings.get('settings'))!;
    const ctx = await gatherContext({ today: '2026-09-08', settings });
    expect(ctx.exercise).toBeUndefined();
  });

  it('fills the session block for a live session with what has been logged', async () => {
    const rx = await rxFor(HINGE, RDL);
    const session = await startSession(HINGE);
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: 8 });

    const settings = (await db.settings.get('settings'))!;
    const ctx = await gatherContext({ today: '2026-09-08', settings, sessionId: session.id });
    expect(ctx.session).toBeDefined();
    expect(ctx.session!.title).toBe('Lower (Hinge)');
    expect(ctx.session!.logged).toEqual(['Romanian Deadlift (Barbell) 110 × 8']);
  });

  it('fills the plan block from the routine’s next session plan', async () => {
    const settings = (await db.settings.get('settings'))!;
    const ctx = await gatherContext({ today: '2026-09-08', settings, routineId: HINGE });
    expect(ctx.plan).toBeDefined();
    expect(ctx.plan!.routine).toBe('Lower (Hinge)');
    expect(ctx.plan!.exercises[0]).toContain('Romanian Deadlift (Barbell)');
    expect(ctx.plan!.exercises[0]).toContain('110 kg × 6–8 × 4');
  });

  it('omits bodyweight when none has ever been logged, and fills nutrition unconditionally', async () => {
    await db.bodyweight.clear();
    const settings = (await db.settings.get('settings'))!;
    const ctx = await gatherContext({ today: '2026-09-08', settings });
    expect(ctx.bodyweight).toBeUndefined();
    expect(ctx.nutrition).toBeDefined();
    expect(ctx.nutrition!.kcal).toBe(0);
  });

  it('shows the stall line once a routine-exercise has stalled', async () => {
    const rx = await rxFor(HINGE, RDL);
    for (const startedAt of ['2026-09-01T18:00:00.000Z', '2026-09-04T18:00:00.000Z', '2026-09-07T18:00:00.000Z']) {
      const session = await startSession(HINGE);
      await db.sessions.update(session.id, { startedAt });
      for (const r of [6, 6, 6, 6]) await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: RDL, type: 'working', weight: 110, reps: r });
      await finishSession(session.id, { choices: [] });
    }
    const settings = (await db.settings.get('settings'))!;
    const ctx = await gatherContext({ today: '2026-09-08', settings, exerciseId: RDL, routineId: HINGE });
    expect(ctx.exercise!.stall).toBe('stalled 3 sessions at 110 kg');
  });
});
