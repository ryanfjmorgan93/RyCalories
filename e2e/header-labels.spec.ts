import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * Every TopBar header action must show a visible word — icons stay only for the Back chevron,
 * the Food screen's day chevrons, and row-level ⋯ menus. This guards against a return to
 * icon-only header buttons the owner could not find ("I spent a while trying to find all those
 * options").
 *
 * Each scenario waits on a POSITIVE screen-specific signal before checking the header — an
 * assertion that can pass before the screen has actually finished rendering (e.g. one sampled
 * while the header is still empty, mid-navigation) would prove nothing.
 */

const NARROW = { width: 360, height: 780 };

/** Every button in the page's header, other than Back, must have non-empty visible text. */
async function assertHeaderLabelled(page: Page): Promise<void> {
  const header = page.locator('header');
  await expect(header).toBeVisible();
  await expect(header.locator('button:not([aria-label="Back"])').filter({ hasNotText: /\S/ })).toHaveCount(0);
}

/** Check the header at the default (Pixel 7) viewport, then again at a narrow 360px phone width —
 * the width the owner is actually on, and where a row of worded buttons is most likely to crowd
 * out the title. Resizing an already-loaded page is enough; nothing about the header depends on a
 * fresh navigation to react to the new width. */
async function assertHeaderLabelledAtBothWidths(page: Page): Promise<void> {
  await assertHeaderLabelled(page);
  await page.setViewportSize(NARROW);
  await assertHeaderLabelled(page);
}

async function addFood(
  page: Page,
  food: { name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number },
): Promise<void> {
  await page.getByTestId('food-name').fill(food.name);
  await page.getByTestId('food-grams').fill(String(food.grams));
  await page.getByTestId('food-kcal').fill(String(food.kcal));
  await page.getByTestId('food-protein').fill(String(food.protein));
  await page.getByTestId('food-carbs').fill(String(food.carbs));
  await page.getByTestId('food-fat').fill(String(food.fat));
  await page.getByTestId('save-food').click();
}

/** Logs and finishes a real session against the seeded Lower (Hinge) routine / Romanian Deadlift
 * (the same fixture e2e/history-safety.spec.ts's trainAndFinish uses), then opens its History
 * detail page. Only two of the routine's sets are logged, so the unfinished-work confirm always
 * appears — a real, deterministic path to a finished session's detail screen. */
async function trainFinishAndOpenDetail(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);

  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await expect(card).toBeVisible();
  for (const reps of [8, 8]) {
    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill(String(reps));
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }), 800);
  }

  await page.getByTestId('finish-session').click();
  await expect(page.getByText('Finish session?')).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).last().click();
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/history');
  await page.getByRole('button', { name: /Lower \(Hinge\)/ }).first().click();
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);
}

test.describe('header labels', () => {
  test('Food', async ({ page }) => {
    await fresh(page);
    await page.goto('/food');
    // Positive signal: the body's own labelled "Add meal" button, not anything in the header.
    await expect(page.getByTestId('add-meal-button')).toBeVisible();
    await assertHeaderLabelledAtBothWidths(page);
  });

  test('Routines', async ({ page }) => {
    await fresh(page);
    await page.goto('/routines');
    await expect(page.getByText('Exercise library')).toBeVisible();
    await assertHeaderLabelledAtBothWidths(page);
  });

  test('Exercises', async ({ page }) => {
    await fresh(page);
    await page.goto('/exercises');
    await expect(page.getByTestId('exercise-search')).toBeVisible();
    await assertHeaderLabelledAtBothWidths(page);
  });

  test("a routine's edit screen", async ({ page }) => {
    await fresh(page);
    await page.goto('/routines');
    await page.getByTestId('new-routine').click();
    await page.getByTestId('routine-name').fill('Header check routine');
    await page.getByTestId('create-routine').click();
    await expect(page).toHaveURL(/\/routines\//);
    await expect(page.getByTestId('start-routine')).toBeVisible();
    await assertHeaderLabelledAtBothWidths(page);
  });

  test("a finished session's detail", async ({ page }) => {
    await trainFinishAndOpenDetail(page);
    await expect(page.getByTestId('save-as-routine')).toBeVisible();
    await assertHeaderLabelledAtBothWidths(page);
  });

  test('an exercise detail', async ({ page }) => {
    await fresh(page);
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill('Back Squat');
    await page.getByRole('button', { name: /Barbell Back Squat/ }).click();
    await expect(page.getByRole('heading', { name: 'Barbell Back Squat' })).toBeVisible();
    await assertHeaderLabelledAtBothWidths(page);
  });

  test('a new meal', async ({ page }) => {
    await fresh(page);
    await page.goto('/food/new');
    await expect(page.getByTestId('save-meal')).toBeVisible();
    await assertHeaderLabelledAtBothWidths(page);
  });

  test('a saved meal', async ({ page }) => {
    await fresh(page);
    await page.goto('/food/new');
    await page.getByTestId('meal-name').fill('Snack');
    await page.getByTestId('empty-add-food').click();
    await addFood(page, { name: 'Toast', grams: 50, kcal: 250, protein: 8, carbs: 45, fat: 4 });
    await page.getByTestId('save-meal').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);
    // Positive signal: the body's own "Add food" button (a saved meal always has one).
    await expect(page.getByTestId('add-food')).toBeVisible();
    await assertHeaderLabelledAtBothWidths(page);
  });

  test('a live session', async ({ page }) => {
    await fresh(page);
    await page.goto('/');
    await page.getByTestId('start-Lower (Hinge)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await expect(page).toHaveURL(/\/session\//);
    await expect(page.getByTestId('exercise-card-Romanian Deadlift (Barbell)')).toBeVisible();

    await assertHeaderLabelled(page);
    await page.setViewportSize(NARROW);
    await assertHeaderLabelled(page);

    // Ask, More and Finish are now all worded buttons crowding the same header as the day's
    // longest routine title — confirm the title itself still gets real room rather than being
    // squeezed to nothing.
    await expect
      .poll(async () => (await page.locator('header h1').boundingBox())?.width ?? 0)
      .toBeGreaterThan(40);
  });
});

test.describe('meal body actions (not the header)', () => {
  test('a new, empty meal offers "From a recipe" and "Estimate" in the body, and each opens its destination', async ({ page }) => {
    // The estimate flow's text box only opens once the on-device model reports `ready` — fake it
    // the same way e2e/recipe-builder.spec.ts does, registered before the app boots so the same
    // window object carries it through the client-side navigation the Estimate button performs.
    await page.addInitScript(() => {
      (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
        status: { state: 'ready', detail: 'ready' },
        generate: async () => ({ text: JSON.stringify({ parts: [{ name: 'egg' }] }) }),
        analyzeMeal: async () => ({ text: '{"ingredients":[]}' }),
      };
    });
    await fresh(page);
    await page.goto('/food/new');
    await expect(page.getByTestId('meal-name')).toBeVisible();

    const fromRecipe = page.getByRole('button', { name: 'From a recipe', exact: true });
    const estimate = page.getByRole('button', { name: 'Estimate', exact: true });
    await expect(fromRecipe).toBeVisible();
    await expect(estimate).toBeVisible();
    // Not the header: the redesign moved these into the body, not just renamed an icon in place.
    await expect(page.locator('header').getByRole('button', { name: 'From a recipe', exact: true })).toHaveCount(0);
    await expect(page.locator('header').getByRole('button', { name: 'Estimate', exact: true })).toHaveCount(0);

    await fromRecipe.click();
    await expect(page.getByTestId('recipe-picker-search')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await estimate.click();
    await expect(page).toHaveURL(/\/food\/recipes\/new\?start=estimate&date=/);
    // Same positive signal e2e/recipe-builder.spec.ts uses for this exact flow: the text box opens
    // directly, with no need to tap "Estimate a meal out" first.
    await expect(page.getByTestId('recipe-estimate-text')).toBeVisible();
  });
});
