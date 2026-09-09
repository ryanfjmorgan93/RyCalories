import { test, type Page } from '@playwright/test';
import { fresh } from './fresh';

// Screenshots for design work. SHOT_DIR points them anywhere; the default keeps them out of
// the repository.
const OUT = process.env.SHOT_DIR ?? 'test-results/shots';

async function food(
  page: Page,
  f: { name: string; grams?: number; portion?: string; kcal: number; protein: number; carbs: number; fat: number },
) {
  await page.getByTestId('food-name').fill(f.name);
  if (f.grams === undefined) {
    await page.getByRole('radio', { name: 'Whole portion' }).click();
    if (f.portion) await page.getByTestId('food-portion').fill(f.portion);
  } else {
    await page.getByTestId('food-grams').fill(String(f.grams));
  }
  await page.getByTestId('food-kcal').fill(String(f.kcal));
  await page.getByTestId('food-protein').fill(String(f.protein));
  await page.getByTestId('food-carbs').fill(String(f.carbs));
  await page.getByTestId('food-fat').fill(String(f.fat));
}

test('capture the nutrition screens', async ({ page }) => {
  await fresh(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Save' }).first().click();

  await page.goto('/food');
  await page.screenshot({ path: `${OUT}/01-food-empty.png` });

  // Breakfast
  await page.getByTestId('add-meal-button').click();
  await page.getByTestId('meal-name').fill('Breakfast');
  await page.getByTestId('empty-add-food').click();
  await food(page, { name: 'Porridge oats', grams: 80, kcal: 379, protein: 11, carbs: 60, fat: 8 });
  await page.screenshot({ path: `${OUT}/02-add-food-weighed.png` });
  await page.getByTestId('save-food').click();
  await page.getByTestId('add-food').click();
  await food(page, { name: 'Whey shake', portion: '1 scoop', kcal: 120, protein: 24, carbs: 3, fat: 1.5 });
  await page.getByTestId('save-food').click();
  await page.getByTestId('add-food').click();
  await food(page, { name: 'Banana', grams: 120, kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 });
  await page.getByTestId('save-food').click();
  await page.screenshot({ path: `${OUT}/03-meal-composed.png` });
  await page.getByTestId('save-meal').click();
  await page.waitForURL(/\/food\/[0-9a-f-]+$/);

  // Lunch and dinner, for a fuller day
  await page.goto('/food/new');
  await page.getByTestId('meal-name').fill('Lunch');
  await page.getByTestId('empty-add-food').click();
  await food(page, { name: 'Chicken thigh', grams: 250, kcal: 209, protein: 26, carbs: 0, fat: 11 });
  await page.getByTestId('save-food').click();
  await page.getByTestId('add-food').click();
  await food(page, { name: 'Basmati rice, cooked', grams: 300, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 });
  await page.getByTestId('save-food').click();
  await page.getByTestId('save-meal').click();
  await page.waitForURL(/\/food\/[0-9a-f-]+$/);

  await page.goto('/food/new');
  await page.getByTestId('meal-name').fill('Dinner');
  await page.getByTestId('empty-add-food').click();
  await food(page, { name: 'Beef mince 5%', grams: 200, kcal: 176, protein: 21, carbs: 0, fat: 10 });
  await page.getByTestId('save-food').click();
  await page.getByTestId('add-food').click();
  await food(page, { name: 'Pasta, cooked', grams: 250, kcal: 158, protein: 5.8, carbs: 31, fat: 0.9 });
  await page.getByTestId('save-food').click();
  await page.getByTestId('save-meal').click();
  await page.waitForURL(/\/food\/[0-9a-f-]+$/);
  await page.screenshot({ path: `${OUT}/04-meal-saved.png` });

  await page.goto('/food');
  await page.screenshot({ path: `${OUT}/05-food-day.png`, fullPage: true });

  // The Atwater correction
  await page.goto('/food/new');
  await page.getByTestId('empty-add-food').click();
  await page.getByTestId('food-name').fill('Peanut butter');
  await page.getByTestId('food-grams').fill('30');
  await page.getByTestId('food-kcal').fill('400');
  await page.getByTestId('food-protein').fill('25');
  await page.getByTestId('food-carbs').fill('20');
  await page.getByTestId('food-fat').fill('50');
  await page.screenshot({ path: `${OUT}/06-atwater-correction.png` });

  await page.goto('/');
  await page.screenshot({ path: `${OUT}/07-home.png`, fullPage: true });

  await page.goto('/routines');
  await page.screenshot({ path: `${OUT}/08-routines.png`, fullPage: true });
});
