import { expect, test, type Locator, type Page } from '@playwright/test';
import { clickIfPresent, fresh, logOneSet, readRawIron } from './fresh';
import { e1rm } from '../src/domain/strength';

/**
 * A finished session's sets can be corrected from its History page: each row opens the same editor
 * the live session uses (src/ui/EditSetSheet.tsx). The stored decision is left as it was — it
 * records what was decided at the time — and records are worked out on read, so the exercise's
 * bests follow the edit.
 */

const RDL = 'Romanian Deadlift (Barbell)';

/** RDL sets as given, then the session finished and saved. */
async function trainRdl(page: Page, sets: [number, number][]): Promise<void> {
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
  const card = page.getByTestId(`exercise-card-${RDL}`);
  for (const [w, r] of sets) await logOneSet(page, card, w, r);
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

async function openSessionFromHistory(page: Page): Promise<Locator> {
  await page.goto('/history');
  await page.getByRole('button', { name: /Lower \(Hinge\)/ }).click();
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);
  return page.getByTestId(`detail-card-${RDL}`);
}

const setLabel = (card: Locator, index: number) => card.getByTestId(`detail-set-${index}`).getByTestId('detail-set-label');

/** One row of the exercise page's records card, by its label. */
const recordRow = (page: Page, label: string) =>
  page.getByTestId('exercise-records').locator('div.flex', { has: page.getByText(label, { exact: true }) });

test('changing the reps of a finished set updates the row, and the exercise bests follow', async ({ page }) => {
  await fresh(page);
  await trainRdl(page, [
    [110, 8],
    [110, 7],
  ]);

  // The figures the exercise page shows for 110 x 8, computed from the app's own Epley function.
  const before = e1rm(110, 8)!;
  const after = e1rm(110, 9)!;
  expect(after).not.toBe(before);

  const card = await openSessionFromHistory(page);
  await expect(setLabel(card, 0)).toHaveText('110 × 8');
  await expect(setLabel(card, 1)).toHaveText('110 × 7');

  // The exercise page before the edit: the bests are those of 110 x 8.
  await card.getByRole('button', { name: new RegExp(RDL.replace(/[()]/g, '\\$&')) }).first().click();
  await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]+$/);
  await expect(recordRow(page, 'Best e1RM')).toContainText(`${before} kg`);
  await expect(recordRow(page, 'Best set volume')).toContainText('880 kg');
  await expect(recordRow(page, 'At 110 kg')).toContainText('8 reps');
  await page.goBack();

  // The decision as it stood when the session was saved: on screen, and as stored.
  await expect(card).toContainText('hold 110 kg');
  const decisionsBefore = (await readRawIron(page)).tables.decisions;
  expect(decisionsBefore).toHaveLength(1);

  // Edit the second set: 7 reps becomes 9.
  await card.getByTestId('detail-set-1').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Edit set', { exact: true })).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Reps', exact: true }).fill('9');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  // The row changed, and only that row.
  await expect(setLabel(card, 1)).toHaveText('110 × 9');
  await expect(setLabel(card, 0)).toHaveText('110 × 8');
  // The stored decision was not recomputed. The sheet only closes once the save has finished, so
  // the database is settled here; the screen is checked as well.
  expect((await readRawIron(page)).tables.decisions).toEqual(decisionsBefore);
  await expect(card).toContainText('hold 110 kg');
  await expect(card).not.toContainText('next time');

  // The exercise page now shows the bests of 110 x 9: the estimate, the set volume, the reps at 110.
  await card.getByRole('button', { name: new RegExp(RDL.replace(/[()]/g, '\\$&')) }).first().click();
  await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]+$/);
  await expect(recordRow(page, 'Best e1RM')).toContainText(`${after} kg`);
  await expect(recordRow(page, 'Best set volume')).toContainText('990 kg');
  await expect(recordRow(page, 'At 110 kg')).toContainText('9 reps');
  await expect(recordRow(page, 'Best e1RM')).not.toContainText(`${before} kg`);
});

test('deleting a set of a finished session closes the gap', async ({ page }) => {
  await fresh(page);
  await trainRdl(page, [
    [110, 8],
    [105, 7],
  ]);

  const card = await openSessionFromHistory(page);
  await expect(setLabel(card, 0)).toHaveText('110 × 8');
  await expect(setLabel(card, 1)).toHaveText('105 × 7');

  await card.getByTestId('detail-set-0').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Edit set', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  // The second set is now the first, and there is no second.
  await expect(setLabel(card, 0)).toHaveText('105 × 7');
  await expect(card.getByTestId('detail-set-1')).toHaveCount(0);
});

test('each set row of a finished session is a full-size tap target', async ({ page }) => {
  await fresh(page);
  await trainRdl(page, [[110, 8]]);

  const card = await openSessionFromHistory(page);
  const row = card.getByTestId('detail-set-0');
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(56);
});
