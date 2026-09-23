import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * Acceptance criteria §11, driven through the real UI in Chromium (mobile viewport).
 * Each test starts from a fresh IndexedDB (seed data only).
 *
 * Phase 3C rebuilt the live session around a set table: once a slot's target is met, the
 * completion moment plays and the card collapses into a compact "done" summary — no more open
 * entry row past the target. A bonus set is reachable only through the exercise's ⋯ menu
 * ("Add a set", `data-testid="add-set"`), which reopens the card. The header meta line now reads
 * "N sets of R · W kg" (was "N × R @ W kg"); after that, plain "W kg" substring checks below are
 * deliberately lenient about the separator, since the exact phrasing is asserted once, in #2.
 */

async function startRoutine(page: Page, name: string) {
  // Use the routine list's Start button so the test doesn't depend on the suggestion.
  await page.getByTestId(`start-${name}`).click();
  // §8 soft warning when picking a lower day straight after a lower day: one tap, then let me.
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
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
    await clickIfPresent(skip);
  }
}

/** Waits for the completion moment to actually play, then to collapse into the done card — a
 * positive signal for both halves, never a bare "did it disappear" sampled once. */
async function waitForCompletionCollapse(page: Page) {
  await expect(page.getByTestId('exercise-complete')).toBeVisible();
  await expect(page.getByTestId('exercise-complete')).toHaveCount(0);
}

async function finishToSummary(page: Page) {
  await page.getByTestId('finish-session').click();
  // Some exercises weren't done → confirm sheet.
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
}

test.describe('Phase 1 acceptance', () => {
  test('#2 RDL 110 × 8,8,8,8 → 115 proposed, accepted, prescribed next session', async ({ page }) => {
    await fresh(page);
    await expect(page.getByTestId('next-up')).toContainText('Lower (Hinge)');
    await page.getByTestId('start-session').click();
    await expect(page).toHaveURL(/\/session\//);
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(card).toContainText('4 sets of 6–8 · 110 kg');
    await expect(card).toContainText('Straps. 3-sec lower. Depth over load.');
    await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 8, 8]);

    // Target met — the completion moment plays, then the card collapses into the done summary.
    await waitForCompletionCollapse(page);
    await expect(card).toContainText('110 × 8, 8, 8, 8');

    // A 5th set is reachable only via the ⋯ menu now (§4).
    await card.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('add-set').click();
    await expect(card.getByTestId('weight-input')).toBeVisible();
    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill('8');
    await card.getByTestId('set-done').click();
    await expect(card.locator('button:has(span.num.w-7)')).toHaveCount(5);

    await finishToSummary(page);

    // The decision counts every working set, including the bonus 5th one just added.
    const decision = page.getByTestId('decision-Romanian Deadlift (Barbell)');
    await expect(decision.getByTestId('decision-line')).toHaveText('8/8/8/8/8 at 110 kg → 115 kg next time');
    await expect(decision.getByTestId('accept')).toContainText('115 kg');
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    // Next session prescribes 115.
    await startRoutine(page, 'Lower (Hinge)');
    await expect(page.getByTestId('exercise-card-Romanian Deadlift (Barbell)')).toContainText('115 kg');
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
    await expect(page.getByTestId('exercise-card-Romanian Deadlift (Barbell)')).toContainText('110 kg');
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
    await expect(page.getByTestId('exercise-card-Romanian Deadlift (Barbell)')).toContainText('112.5 kg');

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
    await expect(page.getByTestId('exercise-card-Barbell Back Squat')).toContainText('80 kg');
  });

  test('warm-ups are ignored and a missing set holds', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    // Warm-up ghost rows log themselves directly, at their own suggested weight/reps — there is
    // no separate confirm step (§1).
    await expect(card.getByTestId('warmup-done-0')).toBeVisible();
    await card.getByTestId('warmup-done-0').click();
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
    await page.getByTestId('live-banner').click();
    // The next live row is set 2 — a positive signal that the logged first set actually survived
    // the reload, not just that the card is present.
    await expect(card.getByTestId('set-row-2')).toBeVisible();
  });
});
