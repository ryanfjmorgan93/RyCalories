import { expect, test } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * §1/§3/§4/§5 of the Phase 3 brief, driven through the real UI: the completion moment's verdict
 * (mid-exercise preview text is gone — the verdict now shows only once, at completion, on the
 * checkable moment itself and again on the collapsed done card), locking a calibrating lift in as
 * a pending choice that survives to the next session, and the collapse/expand behaviour of cards
 * that aren't the one currently being logged.
 *
 * Uses "Romanian Deadlift (Barbell)" (Lower (Hinge), targetSets 4, repMax 8, currentWeight 110,
 * increment 5 — the same fixture acceptance.spec.ts's progression tests use) and "Barbell Back
 * Squat" (Lower (Squat), calibrating out of the box, targetSets 4).
 */

async function skipRest(page: import('@playwright/test').Page) {
  await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
}

async function waitForCompletionCollapse(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('exercise-complete')).toBeVisible();
  await expect(page.getByTestId('exercise-complete')).toHaveCount(0);
}

test.describe('the completion verdict', () => {
  test('every set at the top of the range collapses into the ok increase line, on the moment and the done card alike', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(card).toBeVisible();

    for (const _ of [0, 1, 2, 3]) {
      await card.getByTestId('weight-input').fill('110');
      await card.getByTestId('reps-input').fill('8');
      await card.getByTestId('set-done').click();
      await skipRest(page);
    }

    // All 4 logged, all at repMax: the engine really would give the increase — the completion
    // moment shows the real decision, never a "N more to go" preview.
    await waitForCompletionCollapse(page);
    await expect(card.getByTestId('verdict-line')).toHaveText('→ 115 kg next time');
  });

  test('a set below the top of the range collapses into "Holding", never a promise of an increase', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(card).toBeVisible();

    for (const _ of [0, 1, 2, 3]) {
      await card.getByTestId('weight-input').fill('110');
      await card.getByTestId('reps-input').fill('6'); // below repMax (8)
      await card.getByTestId('set-done').click();
      await skipRest(page);
    }

    await waitForCompletionCollapse(page);
    await expect(card.getByTestId('verdict-line')).toHaveText('Holding 110 kg');
    await expect(card).not.toContainText('→ 115');
  });
});

test.describe('locking in from the done card', () => {
  test('a calibrating lift offers a lock-in once its target is met; it survives as a pending choice to the next session', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Lower (Squat)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    const card = page.getByTestId('exercise-card-Barbell Back Squat');
    await expect(card).toContainText('calibrating');
    await expect(card.getByTestId('session-lock-in')).toHaveCount(0); // not yet — nothing logged

    for (const _ of [0, 1, 2, 3]) {
      await card.getByTestId('weight-input').fill('60');
      await card.getByTestId('reps-input').fill('8');
      await card.getByTestId('set-done').click();
      await skipRest(page);
    }
    await waitForCompletionCollapse(page);

    await expect(card.getByTestId('session-lock-in')).toHaveText('Lock in 60 kg');
    await card.getByTestId('session-lock-in').click();
    await expect(card.getByTestId('session-lock-in-pending')).toHaveText('60 kg locked in');
    await expect(card).not.toContainText('calibrating');
    await expect(card.getByTestId('session-lock-in')).toHaveCount(0);

    await page.getByTestId('finish-session').click();
    const finish = page.getByRole('button', { name: 'Finish', exact: true }).last();
    if (await page.getByText('Finish session?').isVisible().catch(() => false)) await finish.click();
    await expect(page).toHaveURL(/\/summary$/);
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    // The very thing the calibrating trap broke: the next session must actually prescribe it.
    await page.getByTestId('start-Lower (Squat)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await expect(page.getByTestId('exercise-card-Barbell Back Squat')).toContainText('60 kg');
  });
});

test.describe('collapsed cards', () => {
  test('a non-current card is collapsed and expands on tap; a finished card collapses into its done summary and can still be reopened', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    // Lower (Hinge): Romanian Deadlift (order 0) is current; Hip Thrust (order 1) is not.
    const rdl = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    const hipThrust = page.getByTestId('exercise-card-Hip Thrust (Barbell)');
    await expect(rdl.getByTestId('weight-input')).toBeVisible();

    await expect(hipThrust).toContainText('Hip Thrust (Barbell)');
    await expect(hipThrust).toContainText('4 sets of 6–8 · 95 kg');
    await expect(hipThrust).toContainText('0 of 4');
    await expect(hipThrust.getByTestId('weight-input')).toHaveCount(0);

    // Tap it open — a not-yet-current card can still be logged into.
    await hipThrust.click();
    await expect(hipThrust.getByTestId('weight-input')).toBeVisible();

    // Finish Romanian Deadlift (the actual current exercise). Its completion moment plays, then
    // the card collapses into the done summary — no live input left in it (§4).
    for (const reps of [8, 8, 8, 8]) {
      await rdl.getByTestId('weight-input').fill('110');
      await rdl.getByTestId('reps-input').fill(String(reps));
      await rdl.getByTestId('set-done').click();
      await skipRest(page);
    }
    await waitForCompletionCollapse(page);
    await expect(rdl.getByTestId('weight-input')).toHaveCount(0);
    await expect(rdl).toContainText('110 × 8, 8, 8, 8');

    // A finished card can still be reopened to review its sets, but a live row only comes back
    // through the ⋯ menu's "Add a set".
    await rdl.click();
    await expect(rdl.getByTestId('weight-input')).toHaveCount(0);
    await rdl.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('add-set').click();
    await expect(rdl.getByTestId('weight-input')).toBeVisible();
    await rdl.getByTestId('weight-input').fill('110');
    await rdl.getByTestId('reps-input').fill('8');
    await rdl.getByTestId('set-done').click();
    await expect(rdl.locator('button:has(span.num.w-7)')).toHaveCount(5);
  });
});
