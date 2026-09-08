import { expect, test, type Page } from '@playwright/test';

/**
 * Acceptance criteria §11, driven through the real UI in Chromium (mobile viewport).
 * Each test starts from a fresh IndexedDB (seed data only).
 */

async function fresh(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise<void>((resolve) => {
            if (!d.name) return resolve();
            const req = indexedDB.deleteDatabase(d.name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          }),
      ),
    );
    localStorage.clear();
  });
  await page.reload();
  await expect(page.getByTestId('next-up')).toBeVisible();
}

async function startRoutine(page: Page, name: string) {
  // Use the routine list's Start button so the test doesn't depend on the suggestion.
  await page.getByTestId(`start-${name}`).click();
  // §8 soft warning when picking a lower day straight after a lower day: one tap, then let me.
  const anyway = page.getByRole('button', { name: 'Start anyway' });
  if (await anyway.isVisible({ timeout: 800 }).catch(() => false)) await anyway.click();
  await expect(page).toHaveURL(/\/session\//);
}

async function logSets(page: Page, exercise: string, weight: number, reps: number[]) {
  const card = page.getByTestId(`exercise-card-${exercise}`);
  await expect(card).toBeVisible();
  for (const r of reps) {
    await card.getByTestId('weight-input').fill(String(weight));
    await card.getByTestId('reps-input').fill(String(r));
    await card.getByTestId('set-done').click();
    // Skip the rest timer so it doesn't cover the next button.
    const skip = page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
  }
}

async function finishToSummary(page: Page) {
  await page.getByTestId('finish-session').click();
  // Some exercises weren't done → confirm sheet.
  const finish = page.getByRole('button', { name: 'Finish', exact: true }).last();
  if (await page.getByText('Finish session?').isVisible().catch(() => false)) await finish.click();
  await expect(page).toHaveURL(/\/summary$/);
}

test.describe('Phase 1 acceptance', () => {
  test('#2 RDL 110 × 8,8,8,8 → 115 proposed, accepted, prescribed next session', async ({ page }) => {
    await fresh(page);
    await expect(page.getByTestId('next-up')).toContainText('Lower (Hinge)');
    await page.getByTestId('start-session').click();
    await expect(page).toHaveURL(/\/session\//);
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(card).toContainText('4 × 6–8 @ 110 kg');
    await expect(card).toContainText('Straps. 3-sec lower. Depth over load.');
    await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 8, 8]);
    await expect(card).toContainText('Extra set 5');
    await finishToSummary(page);

    const decision = page.getByTestId('decision-Romanian Deadlift (Barbell)');
    await expect(decision.getByTestId('decision-line')).toHaveText('8/8/8/8 at 110 kg → 115 kg next time');
    await expect(decision.getByTestId('accept')).toContainText('115 kg');
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    // Next session prescribes 115.
    await startRoutine(page, 'Lower (Hinge)');
    await expect(page.getByTestId('exercise-card-Romanian Deadlift (Barbell)')).toContainText('4 × 6–8 @ 115 kg');
  });

  test('#3 RDL 110 × 8,8,7,6 → hold 110', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 7, 6]);
    await finishToSummary(page);
    const decision = page.getByTestId('decision-Romanian Deadlift (Barbell)');
    await expect(decision.getByTestId('decision-line')).toHaveText('8/8/7/6 at 110 kg → hold 110 kg');
    await page.getByTestId('save-session').click();
    await startRoutine(page, 'Lower (Hinge)');
    await expect(page.getByTestId('exercise-card-Romanian Deadlift (Barbell)')).toContainText('@ 110 kg');
  });

  test('#4 override 115 → 112.5 is prescribed and logged as an override', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 8, 8]);
    await finishToSummary(page);
    const decision = page.getByTestId('decision-Romanian Deadlift (Barbell)');
    await decision.getByTestId('override').click();
    await decision.getByTestId('override-input').fill('112.5');
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);
    await startRoutine(page, 'Lower (Hinge)');
    await expect(page.getByTestId('exercise-card-Romanian Deadlift (Barbell)')).toContainText('@ 112.5 kg');

    // The decision log shows the override.
    const log = await page.evaluate(async () => {
      const req = indexedDB.open('iron');
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = db.transaction('decisions', 'readonly');
      const all = await new Promise<unknown[]>((res) => {
        const r = tx.objectStore('decisions').getAll();
        r.onsuccess = () => res(r.result);
      });
      return all as { fromWeight: number; toWeight: number; accepted: boolean; overrideTo?: number; rule: string }[];
    });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ fromWeight: 110, toWeight: 115, accepted: false, overrideTo: 112.5, rule: 'increase' });
  });

  test('#5 Back Squat starts calibrating, logs anything, locks in, then progresses', async ({ page }) => {
    await fresh(page);
    await startRoutine(page, 'Lower (Squat)');
    const card = page.getByTestId('exercise-card-Barbell Back Squat');
    await expect(card).toContainText('calibrating');
    await expect(card).toContainText('Brace hard before every rep.');
    await card.getByTestId('weight-input').fill('60');
    await card.getByTestId('reps-input').fill('8');
    await card.getByTestId('set-done').click();
    await page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }).click();
    await card.getByTestId('weight-input').fill('80');
    await card.getByTestId('reps-input').fill('6');
    await card.getByTestId('set-done').click();
    await page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }).click();
    await finishToSummary(page);

    const decision = page.getByTestId('decision-Barbell Back Squat');
    await expect(decision.getByTestId('decision-line')).toHaveText('calibrating — no decision');
    await decision.getByTestId('lock-in').click();
    await expect(decision.getByTestId('lock-in-input')).toHaveValue('80');
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    await startRoutine(page, 'Lower (Squat)');
    await expect(page.getByTestId('exercise-card-Barbell Back Squat')).toContainText('4 × 6–8 @ 80 kg');
  });

  test('warm-ups are ignored and a missing set holds', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await card.getByRole('button', { name: 'Warm-up' }).click();
    await card.getByTestId('weight-input').fill('60');
    await card.getByTestId('reps-input').fill('5');
    await card.getByTestId('set-done').click();
    await page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }).click();
    await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 8]);
    await finishToSummary(page);
    const decision = page.getByTestId('decision-Romanian Deadlift (Barbell)');
    await expect(decision.getByTestId('decision-line')).toHaveText('3/4 sets (8/8/8) at 110 kg → hold 110 kg');
  });

  test('session survives a reload and the rest timer runs from a deadline', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill('8');
    await card.getByTestId('set-done').click();
    await expect(page.getByTestId('rest-timer')).toContainText('Romanian Deadlift');
    await page.reload();
    await expect(page.getByTestId('rest-timer')).toBeVisible();
    await expect(card).toContainText('110 × 8');
    await page.goto('/');
    await page.getByTestId('resume-session').click();
    await expect(card).toContainText('Set 2 of 4');
  });
});
