import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * Home's streak line above the routines list: this week's count against the target, driven through
 * the real UI, reusing the acceptance-flow steps from acceptance.spec.ts. Sessions are started from
 * the routines list.
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
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
}

test.describe('Home streak', () => {
  test('the streak line counts this week, sits above the routines list, and ignores an abandoned session', async ({ page }) => {
    await fresh(page);

    // Down to a single routine (Lower (Hinge)), so the list is short and the order of sessions is plain.
    for (const name of ['Upper (Push)', 'Lower (Squat)', 'Upper (Pull)', 'Arms (Day 5)']) {
      await deleteRoutine(page, name);
    }

    await page.goto('/');
    await expect(page.getByTestId('routines-list')).toContainText('Lower (Hinge)');
    await expect(page.getByTestId('streak-line')).toHaveText('This week 0 of 3');
    // The streak line is above the routines list, and Short session is below it.
    const streak = await page.getByTestId('streak-line').boundingBox();
    const list = await page.getByTestId('routines-list').boundingBox();
    const short = await page.getByTestId('short-session').boundingBox();
    expect(streak!.y).toBeLessThan(list!.y);
    expect(short!.y).toBeGreaterThan(list!.y + list!.height - 1);

    await page.getByTestId('start-Lower (Hinge)').click();
    await expect(page).toHaveURL(/\/session\//);
    await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 8, 8]);
    await finishToSummary(page);
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    // This week's count moved to 1; not yet enough to start a streak (target is 3).
    await expect(page.getByTestId('streak-line')).toHaveText('This week 1 of 3');

    // Starting another session and abandoning it: the streak line reads exactly as it did before.
    // An active-but-abandoned session must not count towards the week. Home has no in-progress
    // card — Discard lives on the session screen itself.
    await page.getByTestId('start-Lower (Hinge)').click();
    // Two lower-body days in a row asks first.
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await expect(page).toHaveURL(/\/session\//);
    await page.getByRole('button', { name: 'Discard session', exact: true }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('routines-list')).toBeVisible();
    await expect(page.getByTestId('streak-line')).toHaveText('This week 1 of 3');
  });
});
