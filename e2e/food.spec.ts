import { expect, test, type Page } from '@playwright/test';
import { fresh } from './fresh';

/**
 * Manual nutrition logging through the real UI. This is the path that has to work before the
 * app can take daily food logging at all — no camera, no model, no network.
 *
 * Every save is followed by waiting for the navigation the save performs. A click resolves when
 * the DOM event dispatches, not when the write commits, so navigating away first aborts the
 * IndexedDB transaction and the meal is silently lost — which is what made two of these tests
 * fail roughly one run in three.
 */

/** Fill the food sheet and save. Nutrition figures are per 100 g when `grams` is given. */
async function addFood(
  page: Page,
  food: { name: string; grams?: number; portion?: string; kcal: number; protein: number; carbs: number; fat: number },
) {
  await page.getByTestId('food-name').fill(food.name);
  if (food.grams === undefined) {
    await page.getByRole('radio', { name: 'Whole portion' }).click();
    if (food.portion) await page.getByTestId('food-portion').fill(food.portion);
  } else {
    await page.getByTestId('food-grams').fill(String(food.grams));
  }
  await page.getByTestId('food-kcal').fill(String(food.kcal));
  await page.getByTestId('food-protein').fill(String(food.protein));
  await page.getByTestId('food-carbs').fill(String(food.carbs));
  await page.getByTestId('food-fat').fill(String(food.fat));
  await page.getByTestId('save-food').click();
}

test.describe('nutrition', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page);
  });

  test('log a meal by hand and see it in the day total', async ({ page }) => {
    await page.goto('/food');
    await expect(page.getByText('Nothing logged today')).toBeVisible();

    await page.getByTestId('add-meal-button').click();
    await page.getByTestId('meal-name').fill('Breakfast');
    await page.getByTestId('empty-add-food').click();
    // 100 g of oats at label values.
    await addFood(page, { name: 'Oats', grams: 100, kcal: 379, protein: 11, carbs: 60, fat: 8 });
    await expect(page.getByTestId('meal-total')).toContainText('379 kcal');

    await page.getByTestId('add-food').click();
    await addFood(page, { name: 'Whey', portion: '1 scoop', kcal: 120, protein: 24, carbs: 3, fat: 1.5 });
    await expect(page.getByTestId('meal-total')).toContainText('499 kcal');

    await page.getByTestId('save-meal').click();
    await expect(page).toHaveURL(/\/food\/[0-9a-f-]+$/);

    await page.goto('/food');
    await expect(page.getByTestId('calories-bar')).toContainText('499 kcal');
    await expect(page.getByTestId('protein-bar')).toContainText('35 g');
  });

  test('editing a weight moves the calories with it', async ({ page }) => {
    await page.goto('/food/new');
    await page.getByTestId('meal-name').fill('Lunch');
    await page.getByTestId('empty-add-food').click();
    await addFood(page, { name: 'Rice', grams: 200, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 });
    await expect(page.getByTestId('meal-total')).toContainText('260 kcal');
    await page.getByTestId('save-meal').click();
    await expect(page).toHaveURL(/\/food\/[0-9a-f-]+$/);

    // Reopen the saved food and halve the weight.
    await page.getByRole('button', { name: /Rice/ }).click();
    await page.getByTestId('food-grams').fill('100');
    await expect(page.getByTestId('food-eaten')).toContainText('130 kcal');
    await page.getByTestId('save-food').click();

    await expect(page.getByTestId('meal-total')).toContainText('130 kcal');
    await page.goto('/food');
    await expect(page.getByTestId('calories-bar')).toContainText('130 kcal');
  });

  test('macros that contradict the calorie figure are offered as a correction', async ({ page }) => {
    await page.goto('/food/new');
    await page.getByTestId('empty-add-food').click();
    await page.getByTestId('food-name').fill('Suspect');
    await page.getByTestId('food-grams').fill('100');
    // 30 g of fat alone is 270 kcal, so 200 is impossible.
    await page.getByTestId('food-kcal').fill('200');
    await page.getByTestId('food-fat').fill('30');
    const warning = page.getByTestId('atwater-warning');
    await expect(warning).toContainText('270 kcal');
    await warning.click();
    await expect(warning).toBeHidden();
    await expect(page.getByTestId('food-eaten')).toContainText('270 kcal');
  });

  test('log to a past day without touching today', async ({ page }) => {
    await page.goto('/food');
    await page.getByTestId('prev-day').click();
    await expect(page.getByTestId('day-label')).toHaveText('Yesterday');

    await page.getByTestId('add-meal-button').click();
    await page.getByTestId('meal-name').fill('Dinner');
    await page.getByTestId('empty-add-food').click();
    await addFood(page, { name: 'Curry', portion: '1 plate', kcal: 700, protein: 40, carbs: 60, fat: 30 });
    await page.getByTestId('save-meal').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);

    await page.goto('/food');
    await expect(page.getByTestId('day-label')).toHaveText('Today');
    await expect(page.getByTestId('calories-bar')).toContainText('0 kcal');

    await page.getByTestId('prev-day').click();
    await expect(page.getByTestId('calories-bar')).toContainText('700 kcal');
  });

  test('a meal survives a reload, offline', async ({ page, context }) => {
    await page.goto('/food/new');
    await page.getByTestId('meal-name').fill('Snack');
    await page.getByTestId('empty-add-food').click();
    await addFood(page, { name: 'Flapjack', portion: '1 bar', kcal: 250, protein: 10, carbs: 30, fat: 9 });
    await page.getByTestId('save-meal').click();
    await expect(page).toHaveURL(/\/food\/[0-9a-f-]+$/);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('meal-total')).toContainText('250 kcal');
    await context.setOffline(false);
  });

  test('going over the target says so rather than showing zero left', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Save' }).first().click();

    await page.goto('/food/new');
    await page.getByTestId('meal-name').fill('Big one');
    await page.getByTestId('empty-add-food').click();
    // Comfortably past the 1900 kcal starting target.
    await addFood(page, { name: 'Takeaway', portion: '1', kcal: 2400, protein: 90, carbs: 250, fat: 100 });
    await page.getByTestId('save-meal').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);

    await page.goto('/food');
    await expect(page.getByTestId('remaining')).toHaveText('500 kcal over');
  });

  test('the home screen shows what has been eaten against the target', async ({ page }) => {
    // A target only exists once Settings has been saved once.
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Save' }).first().click();

    await page.goto('/food/new');
    await page.getByTestId('meal-name').fill('Breakfast');
    await page.getByTestId('empty-add-food').click();
    await addFood(page, { name: 'Eggs', portion: '3 eggs', kcal: 240, protein: 20, carbs: 1, fat: 18 });
    await page.getByTestId('save-meal').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);

    await page.goto('/');
    await expect(page.getByTestId('today-food')).toContainText('240 / 1,900');
    // The seed's next routine is a lower day, so the higher protein target applies from the
    // morning — and the Food screen must show the same number for the same day.
    await expect(page.getByTestId('today-food')).toContainText('20 / 200 g');
    await page.goto('/food');
    await expect(page.getByTestId('protein-bar')).toContainText('20 g / 200 g');
  });

  test('Settings reports the live schema version and the meal count', async ({ page }) => {
    await page.goto('/food/new');
    await page.getByTestId('meal-name').fill('Snack');
    await page.getByTestId('empty-add-food').click();
    await addFood(page, { name: 'Yoghurt', grams: 150, kcal: 60, protein: 10, carbs: 4, fat: 0.2 });
    await page.getByTestId('save-meal').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);

    await page.goto('/settings');
    // The line to check on the phone after a schema bump: history intact, version current.
    await expect(page.getByTestId('data-counts')).toContainText('1 meals');
    await expect(page.getByTestId('db-version')).toHaveText('Database v2');
  });

  test('a back-filled day reads in meal order, without a misleading time', async ({ page }) => {
    await page.goto('/food');
    await page.getByTestId('prev-day').click();
    await expect(page.getByTestId('day-label')).toHaveText('Yesterday');

    // Catch up on yesterday out of order, which is how catching up actually goes.
    for (const [name, slot, kcal] of [
      ['Dinner', 'Dinner', 900],
      ['Breakfast', 'Breakfast', 400],
      ['Lunch', 'Lunch', 600],
    ] as const) {
      await page.getByTestId('add-meal-button').click();
      await page.getByTestId('meal-name').fill(name);
      await page.getByRole('button', { name: slot, exact: true }).click();
      await page.getByTestId('empty-add-food').click();
      await addFood(page, { name, portion: '1', kcal, protein: 10, carbs: 10, fat: 10 });
      await page.getByTestId('save-meal').click();
      await page.waitForURL(/\/food\/[0-9a-f-]+$/);
      await page.goto('/food');
      await page.getByTestId('prev-day').click();
    }

    // Ordered by the slot, not by the order they were typed.
    const names = page.getByRole('button', { name: /^(Breakfast|Lunch|Dinner)/ });
    await expect(names).toHaveCount(3);
    const order = await names.allInnerTexts();
    expect(order.map((t) => t.split('\n')[0])).toEqual(['Breakfast', 'Lunch', 'Dinner']);

    // And no clock time, because the only time on record is when the row was typed — today.
    for (const t of order) expect(t).not.toMatch(/\d{2}:\d{2}/);

    await expect(page.getByTestId('calories-bar')).toContainText('1900 kcal');
  });
});
