import { expect, test, type Locator, type Page } from '@playwright/test';
import { clickIfPresent, fresh, logOneSet } from './fresh';

/**
 * The Level under an exercise in a session, the level-up and new badges on the summary, and Home's
 * Levels card: real sessions of the seed's squat on the built app, nothing written to the database
 * by the test. The first three set the start; the fourth beats it.
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
  // The badges are worked out after the summary itself: "none" is only read once they are.
  await expect(page.getByTestId('summary-hero')).toHaveAttribute('data-game', 'ready');
}

async function save(page: Page): Promise<void> {
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

test('a Level under the exercise: three sessions set the start, the fourth levels up, and Home adds it up', async ({ page }) => {
  test.setTimeout(150_000);
  await fresh(page);

  // Sessions one and two: Level 1, and how many of the three are done. No bar, nothing to chase yet.
  for (const done of [1, 2]) {
    const card = await startLower(page);
    await logOneSet(page, card, 100, 5);
    await expect(card.getByTestId('level-line')).toHaveText(`Level 1 · your first 3 sessions set the start (${done} done)`);
    await expect(card.getByTestId('level-bar')).toHaveCount(0);
    await toSummary(page);
    await expect(page.getByTestId('summary-level-up')).toHaveCount(0);
    // The first set ever passed 60, 80 and 100 kg on a barbell: one badge, the highest. The second session adds none.
    if (done === 1) await expect(page.getByTestId('summary-badge')).toHaveText(['100 kg Barbell Back Squat']);
    else await expect(page.getByTestId('summary-badge')).toHaveCount(0);
    await save(page);
  }

  // The third sets it: the start is named, the bar is empty, and Level 2 has a set that reaches it
  // (5% over 100 × 5 is a size of 122.5: 100 × 7 is 123.3).
  let card = await startLower(page);
  await expect(card.getByTestId('level-line')).toHaveText('Level 1 · your first 3 sessions set the start (2 done)');
  await logOneSet(page, card, 100, 5);
  await expect(card.getByTestId('level-line')).toHaveText('Level 1 · start 100 kg × 5LV 1LV 2Level 2 at 100 kg × 7');
  await expect(card.getByTestId('level-bar')).toHaveAttribute('aria-valuenow', '0');
  await toSummary(page);
  await expect(page.getByTestId('summary-level-up')).toHaveCount(0);
  await save(page);

  // The fourth: 103 × 5 is 3% over (the bar is 60% of the way to 5%), then 106 × 5 is 6%: Level 2.
  card = await startLower(page);
  await expect(card.getByTestId('level-line')).toHaveText('Level 1 · start 100 kg × 5LV 1LV 2Level 2 at 100 kg × 7');
  await logOneSet(page, card, 103, 5);
  await expect(card.getByTestId('level-line')).toHaveText('Level 1 · best 103 kg × 5, 3% over your start of 100 kg × 5LV 1LV 2Level 2 at 103 kg × 6');
  await expect(card.getByTestId('level-bar')).toHaveAttribute('aria-valuenow', '60');
  // The set that crosses says so. Its words are its own (the 103's said "Record · 103 × 5"), and it is read
  // before anything else is waited for, while it is still on the screen.
  await card.getByTestId('weight-input').fill('106');
  await card.getByTestId('reps-input').fill('5');
  await card.getByTestId('set-done').click();
  await expect(page.getByText('Record · 106 × 5 · Level 2', { exact: true })).toBeVisible();
  await expect(card.getByTestId('logged-row')).toHaveCount(2);
  await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }), 300);
  await expect(card.getByTestId('level-line')).toHaveText('Level 2 · best 106 kg × 5, 6% over your start of 100 kg × 5LV 2LV 3Level 3 at 106 kg × 7');
  await expect(card.getByTestId('level-bar')).toHaveAttribute('aria-valuenow', '20');
  // The panel stands on the card for the rest of the session that earned the level.
  await expect(card.getByTestId('level-up-panel')).toHaveText('LV2Level upLevel 1 → 2 · 106 kg × 5');

  await toSummary(page);
  const up = page.getByTestId('summary-level-up');
  await expect(up).toHaveCount(1);
  await expect(up).toHaveText('LV2Level upBarbell Back Squat · Level 1 → Level 2');
  await expect(page.getByTestId('summary-total-level')).toHaveText('Total level 0 → 1');
  await expect(page.getByTestId('summary-badge')).toHaveCount(0);
  await save(page);

  // Home: the total and the badges. (After the third session these read 0 and Level 1, so they cannot
  // be met by what was there before.)
  await expect(page.getByTestId('total-level')).toHaveText('1');
  // The cabinet: the squat's highest mark, then the next badge nearest (four sessions of ten is
  // further along than 106 kg of the way from 100 to 120), as its mark "10" and "6 to go".
  await page.getByTestId('tab-badges').click();
  await expect(page.getByTestId('badges-row')).toHaveText('100 kgBarbell Back Squat106 to go');
  await page.getByTestId('badges-row').click();
  await expect(page.getByTestId('badge-ladder')).toHaveText([
    'Sessions1010 sessions · 6 to go',
    // 3 × 500 + 515 + 530 kg is 2.545 t: 7.455 short of 10, said as 7.5.
    'Tonnes lifted10 t10 tonnes lifted · 7.5 t to go',
    'Total level5Total level 5 · 4 to go',
    'Barbell Back Squat60 kg80 kg100 kg120 kg120 kg Barbell Back Squat · 14 kg to go',
  ]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('badge-ladders')).toHaveCount(0);

  // A fifth session at the old weight levels nothing up, and the one after still opens on Level 2: the
  // level is the best ever. (Read on the next session's card, where the line can only come from history;
  // on the fifth's own card the words would be the same before the set as after it.)
  card = await startLower(page);
  await logOneSet(page, card, 100, 5);
  await toSummary(page);
  await expect(page.getByTestId('summary-level-up')).toHaveCount(0);
  await save(page);
  card = await startLower(page);
  await expect(card.getByTestId('level-line')).toHaveText('Level 2 · best 106 kg × 5, 6% over your start of 100 kg × 5LV 2LV 3Level 3 at 106 kg × 7');
});
