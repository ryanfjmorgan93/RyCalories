import { expect, test, type Page } from '@playwright/test';
import { fresh } from './fresh';

/**
 * "Copy yesterday": an empty day whose previous day has food offers to copy it whole.
 *
 * The day keys come from the browser, with the same local-calendar arithmetic the app uses, so the
 * test and the app can never disagree about which day "yesterday" is (the runner's timezone is not
 * the page's).
 */

async function dayKey(page: Page, daysBack: number): Promise<string> {
  return page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, daysBack);
}

/** Log a one-food meal on `date` through the real Add meal screen and wait for the save to land. */
async function logMeal(page: Page, date: string, meal: { name: string; food: string; kcal: number; protein: number }): Promise<void> {
  await page.goto(`/food/new?date=${date}`);
  await page.getByTestId('meal-name').fill(meal.name);
  await page.getByTestId('empty-add-food').click();
  await page.getByTestId('food-name').fill(meal.food);
  await page.getByRole('radio', { name: 'Whole portion' }).click();
  await page.getByTestId('food-portion').fill('1 portion');
  await page.getByTestId('food-kcal').fill(String(meal.kcal));
  await page.getByTestId('food-protein').fill(String(meal.protein));
  await page.getByTestId('food-carbs').fill('10');
  await page.getByTestId('food-fat').fill('5');
  await page.getByTestId('save-food').click();
  await page.getByTestId('save-meal').click();
  // The save navigates to the saved meal; leaving before then aborts the write.
  await page.waitForURL(/\/food\/[0-9a-f-]+$/);
}

/** The meal's row on the Food screen, found through its own "more" button. */
const mealRow = (page: Page, name: string) => page.locator('div.min-h-14', { has: page.getByTestId(`meal-more-${name}`) });

test.describe('copy yesterday', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page);
  });

  test('copies both of yesterday\'s meals onto an empty today, then the button goes', async ({ page }) => {
    const yesterday = await dayKey(page, 1);
    await logMeal(page, yesterday, { name: 'Porridge', food: 'Oats', kcal: 379, protein: 11 });
    await logMeal(page, yesterday, { name: 'Wrap', food: 'Chicken wrap', kcal: 520, protein: 32 });

    await page.goto('/food');
    await expect(page.getByTestId('day-label')).toHaveText('Today');
    const copy = page.getByTestId('copy-yesterday');
    await expect(copy).toHaveText('Copy yesterday · 2 meals');
    await expect(page.getByText('Nothing logged today')).toBeVisible();

    await copy.click();

    // Positive signals of the copy landing: both meals, each with its own calories.
    await expect(mealRow(page, 'Porridge')).toContainText('379 kcal');
    await expect(mealRow(page, 'Wrap')).toContainText('520 kcal');
    await expect(page.getByTestId('calories-bar')).toContainText('899 kcal');
    // The button was on screen before the tap, so this cannot pass before the copy has happened.
    await expect(copy).toHaveCount(0);

    // Yesterday is untouched: copied, not moved.
    await page.getByTestId('prev-day').click();
    await expect(page.getByTestId('day-label')).toHaveText('Yesterday');
    await expect(mealRow(page, 'Porridge')).toContainText('379 kcal');
    await expect(mealRow(page, 'Wrap')).toContainText('520 kcal');
    await expect(page.getByTestId('calories-bar')).toContainText('899 kcal');
  });

  test('one meal reads "1 meal", in the button and in the toast', async ({ page }) => {
    await logMeal(page, await dayKey(page, 1), { name: 'Porridge', food: 'Oats', kcal: 379, protein: 11 });

    await page.goto('/food');
    const copy = page.getByTestId('copy-yesterday');
    await expect(copy).toHaveText('Copy yesterday · 1 meal');
    await copy.click();
    await expect(mealRow(page, 'Porridge')).toContainText('379 kcal');
    await expect(page.getByText('Copied 1 meal', { exact: true })).toBeVisible();
  });

  test('on an earlier empty day it copies the day before onto the day being viewed, not onto today', async ({ page }) => {
    // Meal two days ago; yesterday empty. Looking at yesterday, the day before is that meal.
    await logMeal(page, await dayKey(page, 2), { name: 'Porridge', food: 'Oats', kcal: 379, protein: 11 });

    await page.goto('/food');
    await page.getByTestId('prev-day').click();
    await expect(page.getByTestId('day-label')).toHaveText('Yesterday');
    const copy = page.getByTestId('copy-yesterday');
    await expect(copy).toHaveText('Copy day before · 1 meal');
    await copy.click();

    await expect(mealRow(page, 'Porridge')).toContainText('379 kcal');
    await expect(page.getByTestId('day-label')).toHaveText('Yesterday');
    await expect(copy).toHaveCount(0);

    // And today has been left empty: the button only shows on an empty day, and it is offering
    // yesterday's meal, which is now the copy.
    await page.getByTestId('next-day').click();
    await expect(page.getByTestId('day-label')).toHaveText('Today');
    await expect(page.getByTestId('copy-yesterday')).toHaveText('Copy yesterday · 1 meal');
  });
});
