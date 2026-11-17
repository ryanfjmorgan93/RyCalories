import { expect, test, type Page } from '@playwright/test';
import { fresh, openAdvanced } from './fresh';

/**
 * The weekly shop (docs/superpowers/specs/2026-11-17-weekly-shop-design.md) in the built app, from
 * food logged through the real Add meal screen: the row on Food, the list built per logged day,
 * − and + moving the totals, a tick kept across a reload, and the Settings switch hiding it.
 */

async function dayKey(page: Page, daysBack: number): Promise<string> {
  return page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, daysBack);
}

/** One protein shake, logged by the portion on a past day. */
async function logShake(page: Page, date: string): Promise<void> {
  await page.goto(`/food/new?date=${date}`);
  await page.getByTestId('meal-name').fill('Snack');
  await page.getByTestId('empty-add-food').click();
  await page.getByTestId('food-name').fill('Protein shake');
  await page.getByRole('radio', { name: 'Whole portion' }).click();
  await page.getByTestId('food-portion').fill('1 shake');
  await page.getByTestId('food-kcal').fill('200');
  await page.getByTestId('food-protein').fill('30');
  await page.getByTestId('food-carbs').fill('10');
  await page.getByTestId('food-fat').fill('5');
  await page.getByTestId('save-food').click();
  await page.getByTestId('save-meal').click();
  await page.waitForURL(/\/food\/[0-9a-f-]+$/);
}

test('the weekly shop is built from what was eaten, changed with − and +, ticked in the shop, and switched off', async ({ page }) => {
  await fresh(page);
  // One shake on each of two logged days: one a logged day, seven a week.
  for (const back of [1, 2]) await logShake(page, await dayKey(page, back));

  await page.goto('/food');
  const row = page.getByTestId('weekly-shop-row');
  await expect(row).toContainText('1 to buy.');
  await row.click();
  await expect(page).toHaveURL(/\/food\/shop$/);

  const line = page.getByTestId('shop-line').filter({ hasText: 'Protein shake' });
  await expect(line).toContainText('7 portions · 210 g protein');
  await expect(line.getByTestId('shop-packs')).toHaveText('7 portions');
  await expect(page.getByTestId('shop-protein')).toContainText('210 g');

  // + buys one more, and from then on the week is what is bought: the totals move with it.
  await line.getByRole('button', { name: 'More Protein shake' }).click();
  await expect(line.getByTestId('shop-packs')).toHaveText('8 portions');
  await expect(line).toContainText('8 portions · 240 g protein');
  await expect(page.getByTestId('shop-protein')).toContainText('240 g');

  // In the shop: by aisle (not in the UK table, so Other), one tick, kept across a reload.
  await page.getByTestId('shop-tab-shop').click();
  await expect(page.getByTestId('aisle-Other')).toContainText('Protein shake8 portions');
  await expect(page.getByTestId('shop-trolley')).toHaveText('0 of 1 in the trolley');
  await page.getByTestId('shop-item').click();
  await expect(page.getByTestId('shop-trolley')).toHaveText('1 of 1 in the trolley');
  await page.reload();
  await page.getByTestId('shop-tab-shop').click();
  await expect(page.getByTestId('shop-item')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('shop-trolley')).toHaveText('1 of 1 in the trolley');

  // Settings → Advanced → off: Food has no row. With the switch off the row draws nothing as soon as
  // the settings are read, and the day's protein line needs those same settings, so once it is up
  // the row's absence is settled, not merely not arrived yet.
  await page.goto('/settings');
  await openAdvanced(page);
  await page.getByTestId('weekly-shop-switch').click();
  await expect(page.getByTestId('weekly-shop-switch')).toHaveAttribute('aria-checked', 'false');
  await page.goto('/food');
  await expect(page.getByTestId('protein-left')).toBeVisible();
  await expect(row).toHaveCount(0);
});
