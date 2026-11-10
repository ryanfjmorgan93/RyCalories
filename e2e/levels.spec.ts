import { expect, test, type Locator, type Page } from '@playwright/test';
import { clickIfPresent, fresh, logOneSet } from './fresh';

/**
 * The Level under an exercise in a session, and the level-up on the summary: four real sessions of
 * the seed's squat on the built app, nothing written to the database by the test. The first three
 * set the start; the fourth beats it.
 *
 * Each line is asserted whole, and only where the set changes its words (the count of sessions done,
 * the best set, the %), so it cannot be met by the line the screen held before the set.
 */

async function startLower(page: Page): Promise<Locator> {
  await page.goto('/');
  await page.getByTestId('start-Lower (Squat)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
  return page.getByTestId('exercise-card-Barbell Back Squat');
}

/** Finish what is open and stop on its summary, once its figures have settled. */
async function toSummary(page: Page): Promise<void> {
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await expect(page.getByTestId('summary-hero')).toHaveAttribute('data-settled', 'true');
}

async function save(page: Page): Promise<void> {
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

test('a Level under the exercise: three sessions set the start, the fourth levels up', async ({ page }) => {
  test.setTimeout(120_000);
  await fresh(page);

  // Sessions one and two: Level 1, and how many of the three are done. No bar, nothing to chase yet.
  for (const done of [1, 2]) {
    const card = await startLower(page);
    await logOneSet(page, card, 100, 5);
    await expect(card.getByTestId('level-line')).toHaveText(`Level 1 · your first 3 sessions set the start (${done} done)`);
    await expect(card.getByTestId('level-bar')).toHaveCount(0);
    await toSummary(page);
    await expect(page.getByTestId('summary-level-up')).toHaveCount(0);
    await save(page);
  }

  // The third sets it: the start is named, the bar is empty, and Level 2 has a line.
  let card = await startLower(page);
  await expect(card.getByTestId('level-line')).toHaveText('Level 1 · your first 3 sessions set the start (2 done)');
  await logOneSet(page, card, 100, 5);
  await expect(card.getByTestId('level-line')).toHaveText('Level 1 · start 100 kg × 5Level 2 at 5%');
  await expect(card.getByTestId('level-bar')).toHaveAttribute('aria-valuenow', '0');
  await toSummary(page);
  await expect(page.getByTestId('summary-level-up')).toHaveCount(0);
  await save(page);

  // The fourth: 103 × 5 is 3% over (the bar is 60% of the way to 5%), then 106 × 5 is 6%: Level 2.
  card = await startLower(page);
  await expect(card.getByTestId('level-line')).toHaveText('Level 1 · start 100 kg × 5Level 2 at 5%');
  await logOneSet(page, card, 103, 5);
  await expect(card.getByTestId('level-line')).toHaveText('Level 1 · best 103 kg × 5, 3% over your start of 100 kg × 5Level 2 at 5%');
  await expect(card.getByTestId('level-bar')).toHaveAttribute('aria-valuenow', '60');
  // The set that crosses says so. Its words are its own (the 103's said "Record · 103 × 5"), and it is read
  // before anything else is waited for, while it is still on the screen.
  await card.getByTestId('weight-input').fill('106');
  await card.getByTestId('reps-input').fill('5');
  await card.getByTestId('set-done').click();
  await expect(page.getByText('Record · 106 × 5 · Level 2', { exact: true })).toBeVisible();
  await expect(card.getByTestId('logged-row')).toHaveCount(2);
  await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }), 300);
  await expect(card.getByTestId('level-line')).toHaveText('Level 2 · best 106 kg × 5, 6% over your start of 100 kg × 5Level 3 at 10%');
  await expect(card.getByTestId('level-bar')).toHaveAttribute('aria-valuenow', '20');

  await toSummary(page);
  const up = page.getByTestId('summary-level-up');
  await expect(up).toHaveCount(1);
  await expect(up).toHaveText('Barbell Back SquatLevel 1 → Level 2');
  await save(page);

  // A fifth session at the old weight levels nothing up, and the one after still opens on Level 2: the
  // level is the best ever. (Read on the next session's card, where the line can only come from history;
  // on the fifth's own card the words would be the same before the set as after it.)
  card = await startLower(page);
  await logOneSet(page, card, 100, 5);
  await toSummary(page);
  await expect(page.getByTestId('summary-level-up')).toHaveCount(0);
  await save(page);
  card = await startLower(page);
  await expect(card.getByTestId('level-line')).toHaveText('Level 2 · best 106 kg × 5, 6% over your start of 100 kg × 5Level 3 at 10%');
});
