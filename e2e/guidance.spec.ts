import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * Home's guidance card: the next session's prescribed weight, the plain-English reason for it,
 * last time's numbers, the deload start button and the streak line — all driven through the
 * real UI, reusing the acceptance-flow steps from acceptance.spec.ts.
 */

async function deleteRoutine(page: Page, name: string) {
  await page.goto('/routines');
  await page.getByTestId(`routine-more-${name}`).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId(`routine-more-${name}`)).toBeHidden();
}

async function logSets(page: Page, exercise: string, weight: number, reps: number[]) {
  const card = page.getByTestId(`exercise-card-${exercise}`);
  await expect(card).toBeVisible();
  for (const r of reps) {
    await card.getByTestId('weight-input').fill(String(weight));
    await card.getByTestId('reps-input').fill(String(r));
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
  }
}

async function finishToSummary(page: Page) {
  await page.getByTestId('finish-session').click();
  const finish = page.getByRole('button', { name: 'Finish', exact: true }).last();
  if (await page.getByText('Finish session?').isVisible().catch(() => false)) await finish.click();
  await expect(page).toHaveURL(/\/summary$/);
}

test.describe('Home guidance', () => {
  test('prescribes the increased weight with a reason, shows last time, deload starts, streak is stable', async ({ page }) => {
    await fresh(page);

    // Down to a single routine (Lower (Hinge)) so it stays "Next up" after it is completed —
    // suggestNextRoutine always moves to the next routine in weekly order otherwise.
    for (const name of ['Upper (Push)', 'Lower (Squat)', 'Upper (Pull)', 'Arms (Day 5)']) {
      await deleteRoutine(page, name);
    }

    await page.goto('/');
    await expect(page.getByTestId('next-up')).toContainText('Lower (Hinge)');
    await expect(page.getByTestId('streak-line')).toHaveText('This week 0 of 3');

    await page.getByTestId('start-session').click();
    await expect(page).toHaveURL(/\/session\//);
    await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 8, 8]);
    await finishToSummary(page);
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    // This week's count moved to 1; not yet enough to start a streak (target is 3).
    await expect(page.getByTestId('streak-line')).toHaveText('This week 1 of 3');

    const item = page.getByTestId('plan-item-Romanian Deadlift (Barbell)');
    await expect(item).toContainText('115 kg');
    await expect(item).toContainText('up 5 kg last time');
    await expect(item).toContainText('Last time 110 × 8, 8, 8, 8');

    // Starting a deload does not touch the weight decision and says so on the session itself.
    await page.getByTestId('start-deload').click();
    await expect(page).toHaveURL(/\/session\//);
    await expect(page.locator('body')).toContainText(/deload/i);

    // Discard it (never finished) and the streak line reads exactly as it did before: an
    // active-but-abandoned session must not count towards the week.
    await page.goto('/');
    await page.getByRole('button', { name: 'Discard', exact: true }).first().click();
    await page.getByRole('button', { name: 'Discard', exact: true }).last().click();
    await expect(page.getByTestId('next-up')).toBeVisible();
    await expect(page.getByTestId('streak-line')).toHaveText('This week 1 of 3');
  });
});
