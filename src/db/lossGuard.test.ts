/**
 * @vitest-environment jsdom
 *
 * jsdom (not the default `node` environment) so `localStorage` exists — the middleware itself is
 * exercised through every other db test file too (it is installed unconditionally in db.ts), this
 * file is only for asserting its actual effect on the baseline/pending flag against a real Dexie +
 * fake-indexeddb transaction.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { getBaseline, isPendingDeletion, writeBaseline } from './lossGuard';
import { deleteSession, logSet, resetToSeed, startSession, wipeAll } from './repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from './seed';

const RDL = SEED_EXERCISE_IDS['Romanian Deadlift (Barbell)'];
const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];

// The middleware refreshes the baseline via `setTimeout(…, 0)` after the owning transaction
// commits (see lossGuard.ts for why it cannot do this synchronously from the 'complete' event),
// and fake-indexeddb's own 'complete' dispatch adds further hops before that even fires. Poll for
// the refreshed value actually landing rather than sleeping a guessed-at fixed delay.
async function waitForBaseline(predicate: (b: ReturnType<typeof getBaseline>) => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate(getBaseline())) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for the baseline to refresh');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(async () => {
  localStorage.clear();
  await resetToSeed();
});

describe('loss-guard middleware', () => {
  it('refreshes the baseline after an in-app session delete, and clears the pending flag', async () => {
    const session = await startSession(HINGE);
    await logSet({ sessionId: session.id, routineExerciseId: null, exerciseId: RDL, type: 'working', weight: 100, reps: 8 });
    writeBaseline({ sessions: 1, sets: 1, build: 'test', dbVersion: 2, at: new Date().toISOString() });

    await deleteSession(session.id);
    await waitForBaseline((b) => b?.sessions === 0);

    expect(isPendingDeletion()).toBe(false);
    expect(getBaseline()?.sets).toBe(0);
  });

  it('refreshes the baseline after Table.clear() (resetToSeed/wipeAll), not only single deletes', async () => {
    const session = await startSession(HINGE);
    await logSet({ sessionId: session.id, routineExerciseId: null, exerciseId: RDL, type: 'working', weight: 100, reps: 8 });
    writeBaseline({ sessions: 1, sets: 1, build: 'test', dbVersion: 2, at: new Date().toISOString() });

    await wipeAll();
    await waitForBaseline((b) => b?.sessions === 0);

    expect(isPendingDeletion()).toBe(false);
    expect(getBaseline()?.sets).toBe(0);
  });

  it('does not touch the baseline for a table it does not watch', async () => {
    writeBaseline({ sessions: 5, sets: 40, build: 'test', dbVersion: 2, at: new Date().toISOString() });
    const [exercise] = await db.exercises.toArray();
    await db.exercises.delete(exercise.id);
    // Nothing to wait on here (no refresh should ever fire) — give any errant async work a
    // generous window to have landed before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(getBaseline()).toEqual({ sessions: 5, sets: 40, build: 'test', dbVersion: 2, at: expect.any(String) });
  });
});
