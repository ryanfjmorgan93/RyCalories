import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { deleteRoutine, finishSession, logSet, resetToSeed, routineItems, startSession } from './repo';
import { loadRoutinesByRest } from './routineRestQueries';
import { SEED_ROUTINE_IDS } from './seed';
import { toDateKey } from '@/domain/dates';

const PUSH = SEED_ROUTINE_IDS['Upper (Push)'];
const PULL = SEED_ROUTINE_IDS['Upper (Pull)'];
const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];

/** A finished session on `routineId` whose sets all read as trained `daysAgo` days ago. */
async function trained(routineId: string, daysAgo: number) {
  const session = await startSession(routineId);
  for (const { rx, exercise } of await routineItems(routineId)) {
    await logSet({ sessionId: session.id, routineExerciseId: rx.id, exerciseId: exercise.id, type: 'working', weight: 20, reps: 10 });
  }
  await finishSession(session.id, { choices: [] });
  const when = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  for (const s of await db.setLogs.where('sessionId').equals(session.id).toArray()) await db.setLogs.update(s.id, { completedAt: when });
}

describe('loadRoutinesByRest', () => {
  beforeEach(async () => {
    await resetToSeed();
  });

  it('offers the routines most rested first, with a label naming the region', async () => {
    await trained(PUSH, 1);
    await trained(PULL, 5);
    // The lower-body routines have never been trained.
    const out = await loadRoutinesByRest(toDateKey());
    const ids = out.map((r) => r.routine.id);
    expect(ids.indexOf(HINGE)).toBeLessThan(ids.indexOf(PULL));
    expect(ids.indexOf(PULL)).toBeLessThan(ids.indexOf(PUSH));
    expect(out.find((r) => r.routine.id === HINGE)?.label).toMatch(/not trained yet$/);
    const pull = out.find((r) => r.routine.id === PULL)!;
    expect(pull.daysSince).toBe(5);
    expect(pull.label).toBe(`${pull.regions[0]} last trained 5 days ago`);
    expect(out.find((r) => r.routine.id === PUSH)?.daysSince).toBe(1);
  });

  it('leaves out archived routines', async () => {
    await trained(PULL, 3); // history, so deleting it archives rather than removes
    expect(await deleteRoutine(PULL)).toBe('archived');
    const out = await loadRoutinesByRest(toDateKey());
    expect(out.map((r) => r.routine.id)).not.toContain(PULL);
    expect(out).toHaveLength(4);
  });

  it('works on a fresh database: every routine, none trained', async () => {
    const out = await loadRoutinesByRest(toDateKey());
    expect(out).toHaveLength(5);
    expect(out.every((r) => r.daysSince === null)).toBe(true);
    expect(out.map((r) => r.routine.order)).toEqual([...out.map((r) => r.routine.order)].sort((a, b) => a - b));
  });
});
