import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * Summary's finish moment (§1 of this round's brief): the three honest hero figures (time, sets,
 * kg lifted) counting up once on arrival, records in gold (only real ones — first-session and
 * calibrating slots are withheld by the domain), CSS confetti once on arrival (absent under
 * reduced motion), and a lock-in seeded from `session.lockIns` reading "N kg locked in".
 *
 * "Lower (Hinge)" / Romanian Deadlift (Barbell) is the same fixture acceptance.spec.ts and
 * verdict.spec.ts use: targetSets 4, repMin 6, repMax 8, currentWeight 110, increment 5.
 * "Lower (Squat)" / Barbell Back Squat is calibrating out of the box, targetSets 4, repMin 6,
 * repMax 8, increment 5 — the same fixture verdict.spec.ts's lock-in test uses.
 */

async function finishToSummary(page: Page) {
  await page.getByTestId('finish-session').click();
  // The unfinished-work confirm sheet only appears when a required exercise is untouched; wait
  // for it rather than sampling once, scoped to the dialog so the header's own Finish never matches.
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
}

async function logSets(page: Page, exercise: string, weight: number, reps: number[]) {
  const card = page.getByTestId(`exercise-card-${exercise}`);
  await expect(card).toBeVisible();
  for (const r of reps) {
    await card.getByTestId('weight-input').fill(String(weight));
    await card.getByTestId('reps-input').fill(String(r));
    await card.getByTestId('set-done').click();
    const skip = page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
  }
}

/** This session's id, from `/session/<id>`. */
function sessionIdFromUrl(page: Page): string {
  const m = /\/session\/([^/]+)/.exec(page.url());
  if (!m) throw new Error(`not on a session URL: ${page.url()}`);
  return m[1];
}

/**
 * Writes a pending lock-in straight into IndexedDB — the same shape `setSessionLockIn` (repo.ts,
 * already unit-tested) would write — since this slice's UI has no in-session lock-in control yet
 * (that lands with the LiveSessionScreen rebuild, built in parallel). Looks the routine-exercise
 * id up from the live session's own routineId + the exercise's name rather than a hardcoded seed
 * id, so it never drifts from src/db/seed.ts.
 */
async function seedPendingLockIn(page: Page, sessionId: string, exerciseName: string, kg: number): Promise<void> {
  await page.evaluate(
    async ({ sessionId, exerciseName, kg }) => {
      const req = indexedDB.open('iron');
      const idb = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = idb.transaction(['sessions', 'exercises', 'routineExercises'], 'readwrite');
      const getAll = <T,>(name: string) =>
        new Promise<T[]>((res, rej) => {
          const r = tx.objectStore(name).getAll();
          r.onsuccess = () => res(r.result as T[]);
          r.onerror = () => rej(r.error);
        });
      const get = <T,>(name: string, key: string) =>
        new Promise<T | undefined>((res, rej) => {
          const r = tx.objectStore(name).get(key);
          r.onsuccess = () => res(r.result as T | undefined);
          r.onerror = () => rej(r.error);
        });
      const session = await get<{ id: string; routineId: string; lockIns?: Record<string, number> }>('sessions', sessionId);
      if (!session) throw new Error('session not found');
      const exercises = await getAll<{ id: string; name: string }>('exercises');
      const exercise = exercises.find((e) => e.name === exerciseName);
      if (!exercise) throw new Error(`exercise not found: ${exerciseName}`);
      const rxs = await getAll<{ id: string; routineId: string; exerciseId: string }>('routineExercises');
      const rx = rxs.find((r) => r.routineId === session.routineId && r.exerciseId === exercise.id);
      if (!rx) throw new Error(`routine-exercise not found for ${exerciseName}`);
      tx.objectStore('sessions').put({ ...session, lockIns: { ...(session.lockIns ?? {}), [rx.id]: kg } });
      await new Promise((res, rej) => {
        tx.oncomplete = () => res(undefined);
        tx.onerror = () => rej(tx.error);
      });
    },
    { sessionId, exerciseName, kg },
  );
}

test.describe('the finish moment', () => {
  test('the three hero figures equal the logged session exactly, and confetti plays once on arrival', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    // 4 sets × 110 kg × 8 reps, all counted (working): kg lifted 3,520, sets 4.
    await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 8, 8]);
    await finishToSummary(page);

    // Confetti mounts on arrival — checked before the count-up settles, while it's still playing.
    await expect(page.getByTestId('summary-confetti')).toBeVisible();

    // The count-up animates; retry until it settles on the exact figures the test logged.
    await expect(page.getByTestId('summary-sets')).toHaveText('4');
    await expect(page.getByTestId('summary-kg')).toHaveText('3,520');
    // Real elapsed wall time can't be asserted exactly, but it must render as a plausible clock.
    await expect(page.getByTestId('summary-time')).toHaveText(/^\d+:\d{2}$/);

    // First-ever session: the domain withholds every record regardless of performance.
    await expect(page.getByTestId('summary-record')).toHaveCount(0);
  });

  test('confetti is absent under prefers-reduced-motion, and the figures show their final values immediately', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fresh(page);
    await page.getByTestId('start-session').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 8, 8]);
    await finishToSummary(page);

    // Positive signal the screen actually rendered its final state before asserting confetti's
    // absence — never sample "nothing there" before confirming the render happened at all.
    await expect(page.getByTestId('summary-sets')).toHaveText('4');
    await expect(page.getByTestId('summary-kg')).toHaveText('3,520');
    await expect(page.getByTestId('summary-confetti')).toHaveCount(0);
  });

  test('a record appears only once there is prior history to beat', async ({ page }) => {
    await fresh(page);

    // Session 1 — the first-ever session for this exercise: no record, whatever the numbers.
    await page.getByTestId('start-session').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 8, 8]);
    await finishToSummary(page);
    await expect(page.getByTestId('summary-sets')).toHaveText('4');
    await expect(page.getByTestId('summary-record')).toHaveCount(0);
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    // Session 2 — heavier than session 1's best: now there is history to beat.
    await page.getByTestId('start-Lower (Hinge)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await logSets(page, 'Romanian Deadlift (Barbell)', 115, [8, 8, 8, 8]);
    await finishToSummary(page);
    await expect(page.getByTestId('summary-sets')).toHaveText('4');
    const record = page.getByTestId('summary-record').first();
    await expect(record).toBeVisible();
    await expect(record).toContainText('Romanian Deadlift (Barbell)');
    await expect(record).toContainText('PR weight 115 kg');
  });
});

test.describe('a lock-in seeded from session.lockIns', () => {
  test('reads "N kg locked in" on Summary, and saving commits it', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Lower (Squat)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await logSets(page, 'Barbell Back Squat', 60, [8]);

    await seedPendingLockIn(page, sessionIdFromUrl(page), 'Barbell Back Squat', 60);
    await finishToSummary(page);

    const decision = page.getByTestId('decision-Barbell Back Squat');
    await expect(decision).toBeVisible();
    await expect(decision.getByTestId('lock-in')).toHaveText('60 kg locked in');
    // The choice to back out is still offered right alongside the read-out.
    await expect(decision.getByRole('button', { name: 'Keep calibrating' })).toBeVisible();

    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    // The thing the pending lock-in exists to fix: the next session actually prescribes it.
    await page.getByTestId('start-Lower (Squat)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await expect(page.getByTestId('exercise-card-Barbell Back Squat')).toContainText('4 sets of 6–8 · 60 kg');
  });
});
