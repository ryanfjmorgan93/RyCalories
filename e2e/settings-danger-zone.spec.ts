import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, expectClass, fresh } from './fresh';

/**
 * Settings → Developer → reset/wipe (Phase 1 — history that cannot be lost silently).
 *
 * Both destructive actions live behind a disclosure, state the exact numbers they are about to
 * delete, and require a real hold (not a tap) on the final button. This spec proves all three
 * through the real UI: the counts in the confirm match real logged data, a short press is not
 * enough to trigger the delete, and a full hold does.
 *
 * `hover()` (not a hand-computed `boundingBox()`) is what positions the mouse before each
 * `page.mouse.down()`: Playwright's `hover()` waits for the target to be attached, visible AND
 * STABLE first. The confirm sheet slides in on open, so grabbing coordinates the instant the hold
 * button becomes "visible" can catch it mid-animation, off its final resting position — `hover()`
 * is what avoids racing that.
 */

async function logOneRdlSession(page: Page, reps: number[]) {
  await page.getByTestId('start-session').click();
  await expect(page).toHaveURL(/\/session\//);
  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await expect(card).toBeVisible();
  for (const r of reps) {
    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill(String(r));
    await card.getByTestId('set-done').click();
    // Skip the rest timer so it doesn't cover the next input.
    const skip = page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' });
    await clickIfPresent(skip);
  }
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe('Settings → Developer → reset/wipe', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page);
  });

  test('reset: counts in the confirm match real data; a short hold does nothing; a full hold resets', async ({ page }) => {
    // The seed numbers, captured before anything is logged, so the final assertion does not
    // hardcode the seed's exercise/routine counts. `textContent()` is a one-shot read, so first
    // wait past the "Counting…" placeholder — otherwise this can capture that placeholder instead
    // of the resolved counts.
    await page.goto('/settings');
    const countsLocator = page.getByTestId('data-counts');
    await expect(countsLocator).not.toHaveText('Counting…');
    const seedCounts = (await countsLocator.textContent())!;

    await page.goto('/');
    await logOneRdlSession(page, [8, 8, 8, 8]); // 1 session, 4 sets, 0 meals

    await page.goto('/settings');
    await expect(page.getByTestId('data-counts')).toHaveText(/1 session · 4 sets/);

    // The reset/wipe buttons are collapsed by default.
    await expect(page.getByRole('button', { name: 'Reset to seed data' })).toBeHidden();
    await page.getByTestId('danger-zone-toggle').click();
    await expect(page.getByTestId('danger-zone')).toBeVisible();

    await page.getByRole('button', { name: 'Reset to seed data' }).click();
    await expect(page.getByTestId('reset-confirm-body')).toHaveText(
      'Deletes 1 session, 4 sets and 0 meals. Routines and exercises go back to the seed.',
    );

    const holdButton = page.getByTestId('reset-hold');
    await expectClass(holdButton, 'idle');

    // --- Short press: released almost immediately, nowhere near the hold threshold. ---
    await holdButton.hover();
    await page.mouse.down();
    await page.mouse.up();

    // Positive signal the press was actually processed (not just "nothing happened yet"): the
    // button reports itself back at idle. Releasing before the hold threshold is the only way
    // HoldToConfirm ever returns to idle without having already fired onComplete, so this signal
    // cannot be satisfied by a run that was still going to complete a moment later.
    await expectClass(holdButton, 'idle');
    await expectClass(holdButton, 'holding', false);

    // Now that the press is confirmed handled, prove data is intact through something that would
    // have changed had it reset: the confirm sheet is still open (a reset closes it and reloads).
    await expect(page.getByTestId('reset-confirm-body')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('data-counts')).toHaveText(/1 session · 4 sets/);

    // --- Full hold: held for the whole threshold, and the delete actually happens. ---
    await page.getByRole('button', { name: 'Reset to seed data' }).click();
    const holdButton2 = page.getByTestId('reset-hold');
    await holdButton2.hover();
    await page.mouse.down();
    // Real wall-clock wait via a retrying assertion (no waitForTimeout): resetToSeed() resolving
    // triggers window.location.reload(), so the counts line reading the seed numbers again IS the
    // completion signal, and it can only appear after the real hold duration has actually elapsed.
    await expect(page.getByTestId('data-counts')).toHaveText(seedCounts, { timeout: 10_000 });
    await page.mouse.up();

    // The disclosure is collapsed again after the reload (a fresh mount), and the destructive
    // buttons are gone with it — a second, independent signal that this was a real reload.
    await expect(page.getByRole('button', { name: 'Reset to seed data' })).toBeHidden();
  });

  test('wipe: counts in the confirm match real data; a short hold does nothing; a full hold wipes', async ({ page }) => {
    await page.goto('/');
    await logOneRdlSession(page, [8, 8, 8]); // 1 session, 3 sets

    await page.goto('/settings');
    await expect(page.getByTestId('data-counts')).toHaveText(/1 session · 3 sets/);
    const before = (await page.getByTestId('data-counts').textContent())!;
    const exerciseCount = Number(before.match(/^(\d+) exercise/)![1]);
    const routineCount = Number(before.match(/(\d+) routines?/)![1]);

    await page.getByTestId('danger-zone-toggle').click();
    await page.getByRole('button', { name: 'Wipe all data' }).click();
    await expect(page.getByTestId('wipe-confirm-body')).toHaveText(
      `Deletes 1 session, 3 sets, 0 meals, ${routineCount} ${routineCount === 1 ? 'routine' : 'routines'} and ${exerciseCount} ${exerciseCount === 1 ? 'exercise' : 'exercises'}.`,
    );

    const holdButton = page.getByTestId('wipe-hold');

    // Short press: not enough to wipe.
    await holdButton.hover();
    await page.mouse.down();
    await page.mouse.up();
    await expectClass(holdButton, 'idle');
    await expectClass(holdButton, 'holding', false);
    await expect(page.getByTestId('wipe-confirm-body')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('data-counts')).toHaveText(/1 session · 3 sets/);

    // Full hold: wipes for real. Everything, including the seed routines/exercises, goes to zero.
    await page.getByRole('button', { name: 'Wipe all data' }).click();
    const holdButton2 = page.getByTestId('wipe-hold');
    await holdButton2.hover();
    await page.mouse.down();
    await expect(page.getByTestId('data-counts')).toHaveText('0 exercises · 0 routines · 0 sessions · 0 sets · 0 meals', { timeout: 10_000 });
    await page.mouse.up();
  });
});
