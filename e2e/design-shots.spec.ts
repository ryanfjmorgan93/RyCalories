import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { clickIfPresent, fresh } from './fresh';

/**
 * A full set of screens for a design session, seeded with realistic data: the owner's real Hevy
 * export for training history, four days of food, and bodyweight readings.
 *
 * Not a test of anything — it asserts only enough to be sure each screen has rendered its content
 * before the shutter, because a screenshot of a loading state is worse than useless to a designer.
 */
const OUT = process.env.SHOT_DIR ?? 'test-results/design';
const HEVY_CSV = fileURLToPath(new URL('../hevy_export.csv', import.meta.url));
const HEVY_MEASUREMENTS = fileURLToPath(new URL('../hevy_measurements.csv', import.meta.url));

let n = 0;

/**
 * In a full-page capture the browser stretches the viewport, so the bottom navigation — which is
 * `position: fixed` — lands in the middle of the image sitting on top of the content.
 *
 * `absolute` does not fix it: with no positioned ancestor the containing block is the initial one,
 * which is viewport-sized, so `bottom: 0` still lands mid-page. Letting the bar flow in the
 * document puts it after the content, where it reads correctly and hides nothing.
 */
const PIN_NAV = 'nav.fixed{position:static!important}';

async function shot(page: Page, name: string, opts: { full?: boolean } = {}) {
  n += 1;
  const full = opts.full ?? false;
  const handle = full ? await page.addStyleTag({ content: PIN_NAV }) : null;
  await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png`, fullPage: full });
  if (handle) await handle.evaluate((el) => (el as HTMLElement).remove());
}

async function addFood(
  page: Page,
  f: { name: string; grams?: number; kcal: number; protein: number; carbs: number; fat: number },
) {
  await page.getByTestId('food-name').fill(f.name);
  if (f.grams === undefined) await page.getByRole('radio', { name: 'Whole portion' }).click();
  else await page.getByTestId('food-grams').fill(String(f.grams));
  await page.getByTestId('food-kcal').fill(String(f.kcal));
  await page.getByTestId('food-protein').fill(String(f.protein));
  await page.getByTestId('food-carbs').fill(String(f.carbs));
  await page.getByTestId('food-fat').fill(String(f.fat));
}

const BREAKFAST = [
  { name: 'Porridge oats', grams: 80, kcal: 379, protein: 11, carbs: 60, fat: 8 },
  { name: 'Whey protein', grams: 30, kcal: 400, protein: 80, carbs: 8, fat: 5 },
  { name: 'Banana', grams: 120, kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 },
];
const LUNCH = [
  { name: 'Chicken thigh', grams: 250, kcal: 209, protein: 26, carbs: 0, fat: 11 },
  { name: 'Basmati rice, cooked', grams: 300, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { name: 'Olive oil', grams: 12, kcal: 884, protein: 0, carbs: 0, fat: 100 },
];
const DINNER = [
  { name: 'Beef mince 5%', grams: 200, kcal: 176, protein: 21, carbs: 0, fat: 10 },
  { name: 'Pasta, cooked', grams: 250, kcal: 158, protein: 5.8, carbs: 31, fat: 0.9 },
];

async function logMeal(page: Page, name: string, slot: string, foods: typeof BREAKFAST, daysBack: number) {
  await page.goto('/food');
  for (let i = 0; i < daysBack; i++) await page.getByTestId('prev-day').click();
  await page.getByTestId('add-meal-button').click();
  await page.getByTestId('meal-name').fill(name);
  await page.getByRole('button', { name: slot, exact: true }).click();
  await page.getByTestId('empty-add-food').click();
  for (const [i, f] of foods.entries()) {
    if (i > 0) await page.getByTestId('add-food').click();
    await addFood(page, f);
    await page.getByTestId('save-food').click();
  }
  await page.getByTestId('save-meal').click();
  await page.waitForURL(/\/food\/[0-9a-f-]+$/);
}

test('capture every screen for a design session', async ({ page }) => {
  test.setTimeout(180_000);
  await fresh(page);

  // ---- Seed -------------------------------------------------------------------------------
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Saved')).toBeVisible();

  // Real training history, so History and the exercise charts have something in them.
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles(HEVY_CSV);
  await expect(page.getByRole('dialog')).toContainText('21 sessions');
  await page.getByRole('button', { name: /Import 21 sessions/ }).click();
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.goto('/settings');
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles(HEVY_MEASUREMENTS);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  for (const [back, kg] of [[0, 80.4], [2, 80.1], [4, 79.8], [6, 79.9]] as const) {
    await page.goto('/body');
    await page.getByTestId('bw-kg').fill(String(kg));
    if (back > 0) {
      // The quick-add writes to today, so shift the older ones by editing the date field.
      await page.getByTestId('bw-date').fill(new Date(Date.now() - back * 86400000).toISOString().slice(0, 10));
    }
    await page.getByTestId('bw-save').click();
    await expect(page.getByText(`${kg} kg`).first()).toBeVisible();
  }

  await logMeal(page, 'Breakfast', 'Breakfast', BREAKFAST, 0);
  await logMeal(page, 'Lunch', 'Lunch', LUNCH, 0);
  await logMeal(page, 'Breakfast', 'Breakfast', BREAKFAST, 1);
  await logMeal(page, 'Dinner', 'Dinner', DINNER, 1);
  await logMeal(page, 'Lunch', 'Lunch', LUNCH, 2);

  // ---- Capture ----------------------------------------------------------------------------

  // 01 Home
  await page.goto('/');
  await expect(page.getByTestId('next-up')).toBeVisible();
  await expect(page.getByTestId('today-food')).toBeVisible();
  await shot(page, 'home', { full: true });

  // 02 Food — a logged day
  await page.goto('/food');
  await expect(page.getByTestId('calories-bar')).toContainText('kcal');
  await shot(page, 'food-day');

  // 03 Repeat a meal
  await page.getByTestId('repeat-meal').click();
  await expect(page.getByRole('button', { name: /^Dinner/ })).toBeVisible();
  await shot(page, 'food-repeat-meal');
  await page.keyboard.press('Escape');

  // 04 Meal detail
  await page.getByRole('button', { name: /^Breakfast/ }).first().click();
  await expect(page.getByTestId('meal-total')).toBeVisible();
  await shot(page, 'meal-detail');

  // 05 Add food — remembered foods offered before anything is typed
  await page.goto('/food/new');
  await page.getByTestId('meal-name').fill('Snack');
  await page.getByTestId('empty-add-food').click();
  await expect(page.getByTestId('food-suggestions')).toBeVisible();
  await shot(page, 'add-food-suggestions');

  // 06 Add food — the form itself, filled
  await addFood(page, { name: 'Greek yoghurt', grams: 200, kcal: 97, protein: 9, carbs: 4, fat: 5 });
  await expect(page.getByTestId('food-eaten')).toContainText('kcal');
  await shot(page, 'add-food-form');

  // 07 The calorie cross-check offering a correction
  await page.getByTestId('food-kcal').fill('200');
  await page.getByTestId('food-fat').fill('30');
  await expect(page.getByTestId('atwater-warning')).toBeVisible();
  await shot(page, 'add-food-cross-check');

  // 08 Progress
  await page.goto('/progress');
  await expect(page.getByTestId('avg-kcal')).toBeVisible();
  await shot(page, 'progress', { full: true });

  // 09 Live session
  await page.goto('/');
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await expect(card).toBeVisible();
  await shot(page, 'session-live');

  // 10 Rest timer running, after a set
  await card.getByTestId('weight-input').fill('110');
  await card.getByTestId('reps-input').fill('8');
  await card.getByTestId('set-done').click();
  await expect(page.getByTestId('rest-timer')).toBeVisible();
  await shot(page, 'session-rest-timer');
  await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }), 1500);

  // 11 Session summary — the progression decisions
  for (const reps of [8, 8]) {
    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill(String(reps));
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }), 1500);
  }
  await page.getByTestId('finish-session').click();
  if (await page.getByText('Finish session?').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Finish', exact: true }).last().click();
  }
  await expect(page).toHaveURL(/\/summary$/);
  await expect(page.getByTestId('decision-line').first()).toBeVisible();
  await shot(page, 'session-summary', { full: true });
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);

  // 12 Routines
  await page.goto('/routines');
  await expect(page.getByRole('button', { name: /Lower \(Hinge\)/ }).first()).toBeVisible();
  await shot(page, 'routines');

  // 13 Routine edit
  await page.getByRole('button', { name: /Lower \(Hinge\)/ }).first().click();
  await expect(page).toHaveURL(/\/routines\//);
  await shot(page, 'routine-edit', { full: true });

  // 14 Exercise library
  await page.goto('/exercises');
  await expect(page.getByRole('button', { name: /Romanian Deadlift/ }).first()).toBeVisible();
  await shot(page, 'exercises');

  // 15 Exercise detail — history and chart
  await page.getByRole('button', { name: /Romanian Deadlift/ }).first().click();
  await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]+$/);
  await shot(page, 'exercise-detail', { full: true });

  // 16 History
  await page.goto('/history');
  await expect(page.getByRole('button', { name: /Routine \d - / }).first()).toBeVisible();
  await shot(page, 'history');

  // 17 Session detail
  await page.getByRole('button', { name: /Routine \d - / }).first().click();
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);
  await shot(page, 'session-detail', { full: true });

  // 18 Bodyweight
  await page.goto('/body');
  await expect(page.getByTestId('bw-kg')).toBeVisible();
  await shot(page, 'bodyweight', { full: true });

  // 19 Check-in
  await page.goto('/checkin');
  await page.waitForTimeout(300);
  await shot(page, 'checkin', { full: true });

  // 20 Settings
  await page.goto('/settings');
  await expect(page.getByTestId('data-counts')).toBeVisible();
  await shot(page, 'settings', { full: true });
});
