import { expect, test } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * The four set types (warm-up, working, failure, drop) driven through the real UI.
 * Uses "Back Extension" (Lower (Hinge), targetSets 3, bodyweight_plus) so hitting only two
 * counted sets against a target of three exercises the hold_missing_sets path.
 */

async function finishToSummary(page: import('@playwright/test').Page) {
  await page.getByTestId('finish-session').click();
  const finish = page.getByRole('button', { name: 'Finish', exact: true }).last();
  if (await page.getByText('Finish session?').isVisible().catch(() => false)) await finish.click();
  await expect(page).toHaveURL(/\/summary$/);
}

test.describe('set types', () => {
  test('warm-up, working, failure and drop badges; only working/failure count toward the decision', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Back Extension');
    await expect(card).toBeVisible();

    // Warm-up — ignored entirely.
    await card.getByRole('button', { name: 'Warm-up' }).click();
    await card.getByTestId('weight-input').fill('5');
    await card.getByTestId('reps-input').fill('12');
    await expect(card.getByTestId('set-done')).toHaveText(/Warm-up done/);
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));

    // Working — counts.
    await card.getByRole('button', { name: 'Working' }).click();
    await card.getByTestId('weight-input').fill('5');
    await card.getByTestId('reps-input').fill('12');
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));

    // Failure — counts, reads as RIR 0 with none logged.
    await card.getByRole('button', { name: 'Failure' }).click();
    await card.getByTestId('weight-input').fill('5');
    await card.getByTestId('reps-input').fill('12');
    await expect(card.getByTestId('set-done')).toHaveText(/Set done/);
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));

    // Drop — never gets its own rest timer; it follows the set right before it.
    await card.getByRole('button', { name: 'Drop' }).click();
    await card.getByTestId('weight-input').fill('2');
    await card.getByTestId('reps-input').fill('15');
    await expect(card.getByTestId('set-done')).toHaveText(/Drop set done/);
    await card.getByTestId('set-done').click();
    await expect(page.getByTestId('rest-timer')).toHaveCount(0);

    const badges = await card.locator('button span.num.w-7').allTextContents();
    expect(badges).toEqual(['W', '1', '2', 'D']);

    await finishToSummary(page);
    const decision = page.getByTestId('decision-Back Extension');
    // Target is 3 sets; only the working + failure set count, so it holds for a missing set.
    // The exercise prescribes bodyweight (0); lifting at +5 kg is a deviation, so it is named.
    await expect(decision.getByTestId('decision-line')).toHaveText('2/3 sets (12/12) at +5 kg → hold +5 kg (was bodyweight)');
  });

  test('switching the effort scale to RPE shows the converted chips and label', async ({ page }) => {
    await fresh(page);
    await page.goto('/settings');
    const rpeOption = page.getByRole('radio', { name: 'RPE', exact: true });
    await expect(rpeOption).toBeVisible();
    await rpeOption.click();
    // Wait for the write to land — the control only shows checked once the live query re-fires.
    await expect(rpeOption).toHaveAttribute('aria-checked', 'true');

    await page.goto('/');
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(card).toBeVisible();
    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill('8');
    await card.getByRole('button', { name: 'RPE', exact: true }).click();

    const options = card.getByTestId('effort-options');
    await expect(options).toBeVisible();
    expect(await options.locator('button').allTextContents()).toEqual(['10', '9.5', '9', '8.5', '8', '7.5', '7', '6.5', '6']);

    // RIR 2 == RPE 8.
    await options.getByRole('button', { name: '8', exact: true }).click();
    await card.getByTestId('set-done').click();
    await expect(card).toContainText('RPE 8');
  });
});
