import { expect, test, type Locator, type Page } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * HomeScreen.tsx's "Next up" plan card now leads with the weight change instead of burying it in
 * the muted reason line: a +N kg / −N kg chip sits with the flag chips, in `ok` tone for a rise
 * and `warn` tone for a drop (a deload never hidden). See `weightDelta` in `src/domain/prescription.ts`.
 *
 * The Home card only ever previews the *suggested* routine, so both tests below delete every seed
 * routine except "Lower (Hinge)" first — through the real Routines screen, not IndexedDB — so the
 * schedule always suggests it again regardless of session history, with no need to cycle through
 * every other routine first.
 */

async function keepOnlyLowerHinge(page: Page): Promise<void> {
  await page.goto('/routines');
  for (const name of ['Upper (Push)', 'Lower (Squat)', 'Upper (Pull)', 'Arms (Day 5)']) {
    await page.getByTestId(`routine-more-${name}`).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(/Routine (deleted|archived)/)).toBeVisible();
  }
  await page.goto('/');
  await expect(page.getByTestId('next-up')).toContainText('Lower (Hinge)');
}

async function logSets(page: Page, exercise: string, weight: number, reps: number[]): Promise<void> {
  const card = page.getByTestId(`exercise-card-${exercise}`);
  await expect(card).toBeVisible();
  for (const r of reps) {
    await card.getByTestId('weight-input').fill(String(weight));
    await card.getByTestId('reps-input').fill(String(r));
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
  }
}

async function finishAndSave(page: Page): Promise<void> {
  await page.getByTestId('finish-session').click();
  const finish = page.getByRole('button', { name: 'Finish', exact: true }).last();
  if (await page.getByText('Finish session?').isVisible().catch(() => false)) await finish.click();
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

/** Class-list membership, not a substring match — "text-warn" must not match "text-warn/10". */
async function hasClass(locator: Locator, cls: string): Promise<boolean> {
  const attr = await locator.getAttribute('class');
  return (attr ?? '').split(/\s+/).includes(cls);
}

test('a lift whose weight went up last time shows a +N kg chip in ok tone', async ({ page }) => {
  await fresh(page);
  await keepOnlyLowerHinge(page);

  await page.getByTestId('start-session').click();
  await expect(page).toHaveURL(/\/session\//);
  // Romanian Deadlift: 4 × 6–8 @ 110 kg, 5 kg increment — all sets at repMax triggers an increase.
  await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 8, 8]);
  await finishAndSave(page);

  const item = page.getByTestId('plan-item-Romanian Deadlift (Barbell)');
  await expect(item).toBeVisible();
  await expect(item).toContainText('115 kg'); // the accepted increase is what's prescribed next

  const chip = item.getByTestId('weight-delta-Romanian Deadlift (Barbell)');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('+5 kg');
  expect(await hasClass(chip.locator('span').first(), 'text-ok')).toBe(true);

  // The numeric chip stands alongside the existing prose reason, not in place of it.
  await expect(item).toContainText('up 5 kg last time');
});

test('a deload shows the drop honestly, in warn tone — never hidden', async ({ page }) => {
  await fresh(page);
  await keepOnlyLowerHinge(page);

  await page.getByTestId('start-deload').click();
  await expect(page).toHaveURL(/\/session\//);

  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await expect(card).toContainText('deload');
  const deloadWeight = Number(await card.getByTestId('weight-input').inputValue());
  expect(deloadWeight).toBeLessThan(110);

  await logSets(page, 'Romanian Deadlift (Barbell)', deloadWeight, [8, 8, 8, 8]);
  await finishAndSave(page);

  const item = page.getByTestId('plan-item-Romanian Deadlift (Barbell)');
  await expect(item).toBeVisible();
  // Progression itself did not move — the stored weight is still 110, not the deload's 90-odd.
  await expect(item).toContainText('110 kg');

  const chip = item.getByTestId('weight-delta-Romanian Deadlift (Barbell)');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(`${deloadWeight - 110} kg`);
  await expect(chip).not.toContainText('+');
  expect(await hasClass(chip.locator('span').first(), 'text-warn')).toBe(true);
});
