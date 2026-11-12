import { expect, test, type Locator, type Page } from '@playwright/test';
import { fmtDateKey, toDateKey } from '../src/domain/dates';
import { clickIfPresent, fresh, logOneSet } from './fresh';

/**
 * The weekly boss on Home: real sessions of the seed's squat on the built app, nothing written to
 * the database by the test. Three sessions set the squat's start, so its best set becomes the boss;
 * Fight starts its routine, and a bigger set beats it at the set, on the summary and on Home.
 */

async function lowerCard(page: Page): Promise<Locator> {
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
  return page.getByTestId('exercise-card-Barbell Back Squat');
}

async function finish(page: Page): Promise<void> {
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await expect(page.getByTestId('summary-hero')).toHaveAttribute('data-settled', 'true');
  await expect(page.getByTestId('summary-hero')).toHaveAttribute('data-game', 'ready');
}

async function save(page: Page): Promise<void> {
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

test('a weekly boss: the squat\'s best set after three sessions, Fight starts it, a bigger set beats it', async ({ page }) => {
  test.setTimeout(150_000);
  await fresh(page);
  for (let i = 0; i < 3; i++) {
    await page.goto('/');
    await page.getByTestId('start-Lower (Squat)').click();
    await logOneSet(page, await lowerCard(page), 100, 5);
    await finish(page);
    await save(page);
  }

  // 100 × 5 is a size of 116.67; the plan's 100 kg × 6 is 120, the fewest reps that beat it.
  const boss = page.getByTestId('boss');
  await expect(boss.getByTestId('boss-name')).toHaveText('Barbell Back Squat');
  await expect(boss.getByTestId('boss-best')).toHaveText(`Best 100 kg × 5 · ${fmtDateKey(toDateKey(new Date()))}`);
  await expect(boss.getByTestId('boss-health')).toHaveAttribute('aria-valuenow', '100');
  await expect(boss.getByTestId('boss-attack')).toHaveText('Your attack100 kg × 6Lower (Squat)');

  await boss.getByTestId('boss-fight').click();
  const card = await lowerCard(page);
  await logOneSet(page, card, 100, 6);
  // A record, no level (2.9% over the start), and the boss falls.
  await expect(page.getByText('Record · 100 × 6 · Boss beaten', { exact: true })).toBeVisible();
  await finish(page);
  await expect(page.getByTestId('summary-boss')).toHaveText('Boss beatenBarbell Back Squat · 100 kg × 6');
  await save(page);

  // No other lift has its start, so the beaten boss stays up, marked, without Fight.
  await expect(boss.getByTestId('boss-beaten')).toHaveText('Beaten');
  await expect(boss.getByTestId('boss-health')).toHaveAttribute('aria-valuenow', '0');
  await expect(boss.getByTestId('boss-fight')).toHaveCount(0);
  await expect(page.getByTestId('bosses-beaten')).toHaveText('100 × 5Barbell Back Squat');
});
