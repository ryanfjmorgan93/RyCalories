import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh, logOneSet } from './fresh';

/**
 * A weight and reps typed into the live row but not yet logged used to live only in React state, so
 * a reload — or the phone killing the app mid-set — put the ghost values back. They are now mirrored
 * into localStorage ('iron-session-draft', src/state/sessionDraft.ts) and read back on mount.
 */

const RDL = 'exercise-card-Romanian Deadlift (Barbell)';

async function startLowerHinge(page: Page): Promise<void> {
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
}

/** Every stored slot draft across every session, as the app wrote it to localStorage. */
async function storedDrafts(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('iron-session-draft');
    if (!raw) return [];
    const sessions = (JSON.parse(raw) as { state?: { sessions?: Record<string, Record<string, Record<string, unknown>>> } }).state?.sessions ?? {};
    return Object.values(sessions).flatMap((slots) => Object.values(slots));
  });
}

test('a typed but unlogged weight and reps come back after a reload', async ({ page }) => {
  await fresh(page);
  await startLowerHinge(page);

  const card = page.getByTestId(RDL);
  const weight = card.getByTestId('weight-input');
  const reps = card.getByTestId('reps-input');

  // The ghost first: the row starts on the prescription, and it is neither of the values typed
  // below (the seed prescribes 6 reps, so reps are typed as 7), so seeing 82.5 and 7 after the
  // reload can only mean they were restored.
  await expect(weight).toHaveValue(/^\d/);
  await expect(reps).toHaveValue(/^\d/);
  const ghostWeight = await weight.inputValue();
  const ghostReps = await reps.inputValue();
  expect(ghostWeight).not.toBe('82.5');
  expect(ghostReps).not.toBe('7');

  await weight.fill('82.5');
  await reps.fill('7');

  // The positive signal that the store has it: the draft itself, in localStorage.
  await expect.poll(() => storedDrafts(page)).toEqual([expect.objectContaining({ weight: 82.5, reps: 7 })]);

  await page.reload({ waitUntil: 'load' });
  await expect(page).toHaveURL(/\/session\//);
  await expect(card).toBeVisible();
  await expect(weight).toHaveValue('82.5');
  await expect(reps).toHaveValue('7');
});

test('an open Add a set row and what was typed in it come back after a reload', async ({ page }) => {
  await fresh(page);
  await startLowerHinge(page);

  const card = page.getByTestId(RDL);
  // Four target sets, so the card finishes and folds away; "Add a set" is the only way back in.
  for (let i = 0; i < 4; i++) await logOneSet(page, card, 110, 8);
  await expect(page.getByTestId('exercise-complete')).toBeVisible();
  await expect(page.getByTestId('exercise-complete')).toHaveCount(0);
  await expect(card.getByTestId('weight-input')).toHaveCount(0);

  await card.getByRole('button', { name: 'More' }).click();
  await page.getByTestId('add-set').click();
  const weight = card.getByTestId('weight-input');
  await expect(weight).toBeVisible();
  expect(await weight.inputValue()).not.toBe('82.5');
  await weight.fill('82.5');
  await expect.poll(() => storedDrafts(page)).toEqual([expect.objectContaining({ weight: 82.5, extraRows: 1 })]);

  await page.reload({ waitUntil: 'load' });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('logged-row')).toHaveCount(4);
  await expect(weight).toHaveValue('82.5');
});

test('a logged set does not come back as a draft', async ({ page }) => {
  await fresh(page);
  await startLowerHinge(page);

  const card = page.getByTestId(RDL);
  await card.getByTestId('weight-input').fill('82.5');
  await card.getByTestId('reps-input').fill('6');
  await expect.poll(() => storedDrafts(page)).toEqual([expect.objectContaining({ weight: 82.5, reps: 6 })]);

  await card.getByTestId('set-done').click();
  await expect(card.getByTestId('logged-row')).toHaveCount(1);
  // The typed values are a set now: nothing is left in the store to restore.
  await expect.poll(() => storedDrafts(page)).toEqual([]);

  await page.reload({ waitUntil: 'load' });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('logged-row')).toHaveCount(1);
  await expect(card.getByTestId('weight-input')).not.toHaveValue('');
  expect(await storedDrafts(page)).toEqual([]);
});

test('finishing a session leaves no draft behind', async ({ page }) => {
  await fresh(page);
  await startLowerHinge(page);

  const card = page.getByTestId(RDL);
  // One logged set so the session can be finished, then a typed value left in the live row.
  await card.getByTestId('weight-input').fill('110');
  await card.getByTestId('reps-input').fill('8');
  await card.getByTestId('set-done').click();
  await expect(card.getByTestId('logged-row')).toHaveCount(1);
  await card.getByTestId('weight-input').fill('82.5');
  await expect.poll(() => storedDrafts(page)).toEqual([expect.objectContaining({ weight: 82.5 })]);

  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  // Still there while the summary is open: leaving without saving keeps the session live.
  expect(await storedDrafts(page)).toHaveLength(1);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => storedDrafts(page)).toEqual([]);
});

test('discarding from the session screen leaves no draft behind', async ({ page }) => {
  await fresh(page);
  await startLowerHinge(page);

  const card = page.getByTestId(RDL);
  await card.getByTestId('weight-input').fill('82.5');
  await expect.poll(() => storedDrafts(page)).toEqual([expect.objectContaining({ weight: 82.5 })]);

  await page.getByRole('button', { name: 'Discard session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => storedDrafts(page)).toEqual([]);
});

test('discarding from the finish sheet of an empty session leaves no draft behind', async ({ page }) => {
  await fresh(page);
  await startLowerHinge(page);

  const card = page.getByTestId(RDL);
  await card.getByTestId('weight-input').fill('82.5');
  await expect.poll(() => storedDrafts(page)).toEqual([expect.objectContaining({ weight: 82.5 })]);

  // Nothing is logged, so Finish offers to discard instead.
  await page.getByTestId('finish-session').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Nothing logged yet.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Discard session' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => storedDrafts(page)).toEqual([]);
});

test('discarding from the summary leaves no draft behind', async ({ page }) => {
  await fresh(page);
  await startLowerHinge(page);

  const card = page.getByTestId(RDL);
  await card.getByTestId('weight-input').fill('110');
  await card.getByTestId('reps-input').fill('8');
  await card.getByTestId('set-done').click();
  await expect(card.getByTestId('logged-row')).toHaveCount(1);
  await card.getByTestId('weight-input').fill('82.5');
  await expect.poll(() => storedDrafts(page)).toEqual([expect.objectContaining({ weight: 82.5 })]);

  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByRole('button', { name: 'Discard session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => storedDrafts(page)).toEqual([]);
});
