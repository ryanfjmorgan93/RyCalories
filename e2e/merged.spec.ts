import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * The claim the merged app rests on: that training and eating are one record, not two apps
 * sharing a bottom bar. Nothing else tests the two halves together, so this drives a whole day
 * through the real UI — train, eat, and read both back off the same screens.
 */

async function trainLowerBody(page: Page) {
  await page.goto('/');
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);

  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await expect(card).toBeVisible();
  for (const reps of [8, 8, 8]) {
    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill(String(reps));
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }), 800);
  }

  await page.getByTestId('finish-session').click();
  if (await page.getByText('Finish session?').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Finish', exact: true }).last().click();
  }
  await expect(page).toHaveURL(/\/summary$/);

  // The summary is where the progression decisions are accepted; the session is not finished —
  // and does not count as trained — until it is saved.
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

async function eat(page: Page, name: string, kcal: number, protein: number) {
  await page.goto('/food/new');
  await page.getByTestId('meal-name').fill(name);
  await page.getByTestId('empty-add-food').click();
  await page.getByTestId('food-name').fill(name);
  await page.getByRole('radio', { name: 'Whole portion' }).click();
  await page.getByTestId('food-kcal').fill(String(kcal));
  await page.getByTestId('food-protein').fill(String(protein));
  await page.getByTestId('food-carbs').fill('100');
  await page.getByTestId('food-fat').fill('30');
  await page.getByTestId('save-food').click();
  await page.getByTestId('save-meal').click();
  await page.waitForURL(/\/food\/[0-9a-f-]+$/);
}

test('a day of training and eating reads back as one record', async ({ page }) => {
  await fresh(page);

  // A target has to exist before anything can be measured against it.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Saved')).toBeVisible();

  await trainLowerBody(page);
  await eat(page, 'Lunch', 1400, 120);
  await eat(page, 'Dinner', 1100, 90);

  // The Food screen knows a lower-body session happened, and raises the protein target for it.
  await page.goto('/food');
  await expect(page.getByText('Leg day', { exact: true })).toBeVisible();
  await expect(page.getByTestId('calories-bar')).toContainText('2500 kcal');
  await expect(page.getByTestId('protein-bar')).toContainText('210 g / 200 g');
  await expect(page.getByTestId('remaining')).toHaveText('600 kcal over');

  // Home shows the same day from the training side, against the same targets.
  await page.goto('/');
  await expect(page.getByTestId('today-food')).toContainText('2,500 / 1,900');
  await expect(page.getByTestId('today-food')).toContainText('210 / 200 g');
  await expect(page.getByTestId('today-food')).toContainText('lower-body day');

  // Progress puts both halves in one window, over the days that were logged.
  await page.goto('/progress');
  await expect(page.getByTestId('avg-kcal')).toHaveText('2500 kcal');
  await expect(page.getByTestId('avg-protein')).toHaveText('210 g');
  await expect(page.getByTestId('sessions')).toHaveText('1');
  await expect(page.getByTestId('days-logged')).toHaveText('1 of 28');
  // One day out of twenty-eight is not a month, and the screen says so rather than implying it.
  await expect(page.getByTestId('thin-coverage')).toBeVisible();

  // The training half is unchanged by any of it: the lift still progresses on its own terms.
  await page.goto('/history');
  await expect(page.getByRole('button', { name: /Lower \(Hinge\)/ }).first()).toBeVisible();
});
