import { expect, test } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * §1/§3/§4/§5 of this round's brief, driven through the real UI: the live verdict line and the
 * set-counter's "N to go up" suffix, locking a calibrating lift in from the card in one tap, and
 * the collapse/expand behaviour of cards that aren't the one currently being logged.
 *
 * Uses "Romanian Deadlift (Barbell)" (Lower (Hinge), targetSets 4, repMax 8, currentWeight 110,
 * increment 5 — the same fixture acceptance.spec.ts's progression tests use) and "Barbell Back
 * Squat" (Lower (Squat), calibrating out of the box).
 */

async function skipRest(page: import('@playwright/test').Page) {
  await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
}

test.describe('the live verdict', () => {
  test('the accent preview becomes the ok increase line once the target is met, from the same verdict as the set counter', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(card).toBeVisible();

    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill('8');
    await card.getByTestId('set-done').click();
    await skipRest(page);
    // 1 of 4 logged, at the top of the range: 3 more sets at repMax(8) would earn 115 kg.
    await expect(card).toContainText('3 more at 8 → 115 kg');
    await expect(card).toContainText('Set 2 of 4 · 8 to go up');

    for (const _ of [0, 0, 0]) {
      await card.getByTestId('weight-input').fill('110');
      await card.getByTestId('reps-input').fill('8');
      await card.getByTestId('set-done').click();
      await skipRest(page);
    }
    // Target met — Romanian Deadlift is no longer the current exercise (it's the only slot in
    // this routine-independent check, but the app has moved on to whatever is next) and the card
    // collapses (§4); reopen it to see the entry block's own verdict line and counter.
    await expect(card).toContainText('4/4 sets');
    await card.click();
    // All 4 logged, all at repMax: the engine would actually give the increase right now.
    await expect(card).toContainText('→ 115 kg next time');
    await expect(card).toContainText('Set 5 (target 4)');
  });

  test('a set below the top of the range shows "Holding", never a promise of an increase', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(card).toBeVisible();

    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill('6'); // below repMax (8)
    await card.getByTestId('set-done').click();
    await expect(card).toContainText('Holding 110 kg');
    await expect(card).not.toContainText('to go up');
    await expect(card).not.toContainText('→ 115');
  });
});

test.describe('locking in from the card', () => {
  test('a calibrating lift offers a one-tap lock-in named on the button; the next session prescribes it', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Lower (Squat)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    const card = page.getByTestId('exercise-card-Barbell Back Squat');
    await expect(card).toContainText('calibrating');
    await expect(card.getByTestId('lock-in')).toHaveCount(0); // not yet — no counted set logged

    await card.getByTestId('weight-input').fill('60');
    await card.getByTestId('reps-input').fill('8');
    await card.getByTestId('set-done').click();
    await skipRest(page);

    await expect(card.getByTestId('lock-in')).toHaveText('Lock in 60 kg');
    await card.getByTestId('lock-in').click();
    await expect(card).not.toContainText('calibrating');
    await expect(card.getByTestId('lock-in')).toHaveCount(0);
    await expect(card).toContainText('4 × 6–8 @ 60 kg');

    await page.getByTestId('finish-session').click();
    const finish = page.getByRole('button', { name: 'Finish', exact: true }).last();
    if (await page.getByText('Finish session?').isVisible().catch(() => false)) await finish.click();
    await expect(page).toHaveURL(/\/summary$/);
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    // The very thing the calibrating trap broke: the next session must actually prescribe it.
    await page.getByTestId('start-Lower (Squat)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await expect(page.getByTestId('exercise-card-Barbell Back Squat')).toContainText('4 × 6–8 @ 60 kg');
  });
});

test.describe('collapsed cards', () => {
  test('a non-current card is collapsed and expands on tap; a finished card can be reopened and logged into', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    // Lower (Hinge): Romanian Deadlift (order 0) is current; Hip Thrust (order 1) is not.
    const rdl = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    const hipThrust = page.getByTestId('exercise-card-Hip Thrust (Barbell)');
    await expect(rdl.getByTestId('weight-input')).toBeVisible();

    await expect(hipThrust).toContainText('Hip Thrust (Barbell)');
    await expect(hipThrust).toContainText('4 × 6–8 @ 95 kg');
    await expect(hipThrust).toContainText('0/4 sets');
    await expect(hipThrust.getByTestId('weight-input')).toHaveCount(0);

    // Tap it open — a not-yet-current card can still be logged into.
    await hipThrust.click();
    await expect(hipThrust.getByTestId('weight-input')).toBeVisible();

    // Finish Romanian Deadlift (the actual current exercise). Once its target is met it stops
    // being current and — having never been given an explicit expand/collapse choice — collapses.
    for (const reps of [8, 8, 8, 8]) {
      await rdl.getByTestId('weight-input').fill('110');
      await rdl.getByTestId('reps-input').fill(String(reps));
      await rdl.getByTestId('set-done').click();
      await skipRest(page);
    }
    await expect(rdl.getByTestId('weight-input')).toHaveCount(0);
    await expect(rdl).toContainText('4/4 sets');

    // A finished card can still be reopened and logged into.
    await rdl.click();
    await expect(rdl.getByTestId('weight-input')).toBeVisible();
    await rdl.getByTestId('weight-input').fill('110');
    await rdl.getByTestId('reps-input').fill('8');
    await rdl.getByTestId('set-done').click();
    await expect(rdl).toContainText('Set 6 (target 4)');
  });
});
