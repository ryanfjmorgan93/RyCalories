import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { loadHomeRoutines } from './homeQueries';
import { deleteRoutine, finishSession, logSet, resetToSeed, routineItems, startSession } from './repo';
import { SEED_ROUTINE_IDS } from './seed';
import { toDateKey } from '@/domain/dates';

const PULL = SEED_ROUTINE_IDS['Upper (Pull)'];
const PUSH = SEED_ROUTINE_IDS['Upper (Push)'];
const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];

/** A finished session on `routineId` with one set per exercise, `weights[i]` × `reps` on the i-th, all trained `daysAgo` days ago. */
async function trained(routineId: string, daysAgo: number, weights: number[], reps = 8) {
  const session = await startSession(routineId);
  const items = await routineItems(routineId);
  for (const [i, { rx, exercise }] of items.entries()) {
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: exercise.id, type: 'working', weight: weights[i] ?? 10, reps });
  }
  await finishSession(session.id, { choices: [] });
  const when = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  await db.sessions.update(session.id, { startedAt: when, endedAt: when });
  for (const s of await db.setLogs.where('sessionId').equals(session.id).toArray()) await db.setLogs.update(s.id, { completedAt: when });
  return session;
}

describe('loadHomeRoutines', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  it('keeps the rest order and adds each routine\'s exercise count', async () => {
    const out = await loadHomeRoutines(toDateKey());
    expect(out).toHaveLength(5);
    expect(out.find((r) => r.routine.id === PULL)?.exerciseCount).toBe(4);
    expect(out.find((r) => r.routine.id === PUSH)?.exerciseCount).toBe(4);
  });

  it('has no top set for a routine that has not been done', async () => {
    const out = await loadHomeRoutines(toDateKey());
    expect(out.every((r) => r.lastTop === null)).toBe(true);
  });

  it('gives the heaviest set of the lead lift from the routine\'s last session', async () => {
    // Pull's lead lift is the lat pulldown.
    await trained(PULL, 9, [70]);
    await trained(PULL, 3, [85]);
    const out = await loadHomeRoutines(toDateKey());
    expect(out.find((r) => r.routine.id === PULL)?.lastTop).toBe('Lat Pulldown (Machine) 85 kg × 8');
    // Another routine's session does not leak into it.
    expect(out.find((r) => r.routine.id === PUSH)?.lastTop).toBeNull();
  });

  it('takes the next lift when the lead lift has no counted set', async () => {
    const session = await startSession(HINGE);
    const items = await routineItems(HINGE);
    // Only the second exercise is logged.
    const { rx, exercise } = items[1];
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: exercise.id, type: 'working', weight: 100, reps: 5 });
    await finishSession(session.id, { choices: [] });
    const out = await loadHomeRoutines(toDateKey());
    expect(out.find((r) => r.routine.id === HINGE)?.lastTop).toBe('Hip Thrust (Barbell) 100 kg × 5');
  });

  it('leaves out an archived routine', async () => {
    await trained(PULL, 3, [60]);
    await deleteRoutine(PULL);
    const out = await loadHomeRoutines(toDateKey());
    expect(out.map((r) => r.routine.id)).not.toContain(PULL);
  });
});
