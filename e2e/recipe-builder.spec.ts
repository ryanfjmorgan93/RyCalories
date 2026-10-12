import { expect, test, type Page } from '@playwright/test';
import { denyCamera, fresh, openAdvanced } from './fresh';
import { FIXTURE_CODE } from './fixtures/ean13';

/**
 * Cooked meals: typed or picked ingredients → amounts → a saved recipe.
 *
 * FAKED, at the system boundary: Open Food Facts (`page.route`, with the service's real status codes
 * — see `barcode.spec.ts`'s note on why a miss is HTTP 404, never 200).
 *
 * REAL, exercised end to end: the whole builder UI, `matchIngredient`/`searchFoods` against the
 * real bundled UK food table, and every Dexie write. The start phase offers two ways in, Type it and
 * Add ingredients; the photo and "Estimate a meal out" options went with the on-device model.
 */

/** Click the actual clickable row, scoped to its wrapper — a Review or Recipes row's `right` slot
 * (a kcal figure, or a More button) sits outside the row's own `<button>`, so a raw click on the
 * wrapper's centre is not reliably the row itself. */
async function clickRow(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).getByRole('button').first().click();
}

test.describe('recipe builder', () => {
  test('manual floor: search the table, set an amount by hand, save and log — no model involved', async ({ page }) => {
    await fresh(page);
    await page.goto('/food');
    await page.getByTestId('recipes-button').click();
    await expect(page).toHaveURL(/\/food\/recipes/);
    await page.getByTestId('recipe-new').click();
    await expect(page).toHaveURL(/\/food\/recipes\/new/);

    await page.getByTestId('recipe-add-ingredients').click();
    await page.getByTestId('picker-search').fill('egg');
    await page.getByTestId('picker-result-0').click();

    await expect(page.getByTestId('review-row-0')).toBeVisible();
    await clickRow(page, 'review-row-0');
    await expect(page.getByTestId('question-count')).toBeVisible();
    await page.getByTestId('question-count').fill('3');
    await page.getByTestId('question-next').click();

    // 3 x 50 g x 131 kcal/100g = 196.5, which rounds to 197 (Math.round rounds .5 up) — the app's
    // real rounding, not a hand-typed guess.
    await expect(page.getByTestId('review-total-kcal')).toHaveText('197 kcal');

    await page.getByTestId('recipe-save-log').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);
    await expect(page.getByTestId('meal-total')).toContainText('197 kcal');
  });

  test('scan the bacon pack: the source line and the share kcal both pick up the label', async ({ page, browser, context }) => {
    const BACON_LABEL_KCAL = 240;
    await page.route('**/world.openfoodfacts.org/**', async (route) => {
      const code = /\/product\/(\d+)\.json/.exec(route.request().url())?.[1];
      if (code === FIXTURE_CODE) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 1,
            product: {
              code: FIXTURE_CODE,
              product_name: 'Smoked Back Bacon',
              brands: 'Tesco',
              nutriments: { 'energy-kcal_100g': BACON_LABEL_KCAL, proteins_100g: 20, carbohydrates_100g: 1, fat_100g: 18 },
            },
          }),
        });
      } else {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 0, status_verbose: 'product not found' }) });
      }
    });

    await fresh(page);
    await denyCamera(browser, context, page);
    await page.goto('/food/recipes/new');

    await page.getByTestId('recipe-type-it').click();
    await page.getByTestId('recipe-typed-text').fill('2 rashers bacon');
    await page.getByTestId('recipe-use-typed').click();

    // The typed amount pre-fills the table alias's own figures — the "before" state.
    await expect(page.getByTestId('question-source')).toContainText('UK table');
    await page.getByTestId('question-next').click(); // single ingredient, already answered → review

    // Bacon rashers, back, raw: 215 kcal/100g x 50 g (2 x 25 g) = 107.5 → 108.
    await expect(page.getByTestId('review-total-kcal')).toHaveText('108 kcal');
    await expect(page.getByTestId('share-kcal')).toContainText('108 kcal');

    await clickRow(page, 'review-row-0');
    await expect(page.getByTestId('question-source')).toContainText('UK table');
    await page.getByTestId('question-scan').click();
    await expect(page.getByText('Camera not available.')).toBeVisible();
    await page.getByTestId('barcode-input').fill(FIXTURE_CODE);
    await page.getByTestId('barcode-submit').click();

    await expect(page.getByTestId('question-source')).toHaveText('Label · Tesco Smoked Back Bacon');
    await page.getByTestId('question-next').click();

    // The amount is unchanged (50 g) but the figures are the label's: 50 g @ 240 kcal/100g = 120.
    await expect(page.getByTestId('review-total-kcal')).toHaveText('120 kcal');
    await expect(page.getByTestId('share-kcal')).toContainText('120 kcal');
  });

  test('a pack typed in once comes back in a recipe as your food, not as a label', async ({ page, browser, context }) => {
    const UNKNOWN_CODE = '5099999999994';
    await page.route('**/world.openfoodfacts.org/**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 0, status_verbose: 'product not found' }) }),
    );

    await fresh(page);
    await denyCamera(browser, context, page);

    // Log the pack the long way, once: scanned, not in the database, typed in.
    await page.goto('/food/new');
    await page.getByTestId('meal-name').fill('Snack');
    await page.getByTestId('empty-add-food').click();
    await page.getByTestId('scan-barcode').click();
    await expect(page.getByText('Camera not available.')).toBeVisible();
    await page.getByTestId('barcode-input').fill(UNKNOWN_CODE);
    await page.getByTestId('barcode-submit').click();
    await expect(page.getByTestId('lookup-notfound')).toBeVisible();
    await page.getByTestId('food-name').fill('Chicken fries');
    await page.getByTestId('food-kcal').fill('250');
    await page.getByTestId('food-protein').fill('14');
    await page.getByTestId('food-carbs').fill('20');
    await page.getByTestId('food-fat').fill('12');
    await page.getByTestId('save-food').click();
    await page.getByTestId('save-meal').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);

    await page.goto('/food/recipes/new');
    await page.getByTestId('recipe-type-it').click();
    // A food no table or memory has, so it comes up with no figures — and does not depend on the
    // bundled UK table having finished its lazy load when "Use this" is pressed.
    await page.getByTestId('recipe-typed-text').fill('zzqx sauce');
    await page.getByTestId('recipe-use-typed').click();
    await expect(page.getByTestId('question-source')).toHaveText('Not found');

    await page.getByTestId('question-scan').click();
    await expect(page.getByText('Camera not available.')).toBeVisible();
    await page.getByTestId('barcode-input').fill(UNKNOWN_CODE);
    await page.getByTestId('barcode-submit').click();

    // The figures are the ones typed by hand, so the line says so: it is not a label's.
    await expect(page.getByTestId('question-source')).toHaveText('Your food');
  });

  test('the start phase offers Type it and Add ingredients, and typing works end to end', async ({ page }) => {
    await fresh(page);
    await page.goto('/food/recipes/new');

    await expect(page.getByTestId('recipe-type-it')).toBeVisible();
    await expect(page.getByTestId('recipe-add-ingredients')).toBeVisible();
    // The photo and the meal-out estimate went with the on-device model.
    await expect(page.getByTestId('recipe-take-photo')).toHaveCount(0);
    await expect(page.getByTestId('recipe-start-estimate')).toHaveCount(0);
    await expect(page.getByTestId('recipe-assistant-state')).toHaveCount(0);

    await page.getByTestId('recipe-type-it').click();
    await page.getByTestId('recipe-typed-text').fill('3 eggs, 30g cheddar');
    await page.getByTestId('recipe-use-typed').click();

    await expect(page.getByTestId('question-name')).toHaveText('Eggs');
    await expect(page.getByTestId('question-count')).toHaveValue('3'); // the typed amount pre-filled it
    await page.getByTestId('question-next').click();

    await expect(page.getByTestId('question-name')).toHaveText('Cheddar');
    await expect(page.getByTestId('question-grams')).toHaveValue('30');
    await page.getByTestId('question-next').click(); // last ingredient → review

    await expect(page.getByTestId('review-total-kcal')).toBeVisible();
    await page.getByTestId('recipe-save').click();
    await page.waitForURL(/\/food\/recipes$/);
  });

  test('a saved recipe is logged from Recipes in one tap plus Log', async ({ page }) => {
    await fresh(page);
    await page.goto('/food/recipes/new');
    await page.getByTestId('recipe-add-ingredients').click();
    await page.getByTestId('picker-search').fill('egg');
    await page.getByTestId('picker-result-0').click();
    await clickRow(page, 'review-row-0');
    await page.getByTestId('question-count').fill('2');
    await page.getByTestId('question-next').click();
    await page.getByTestId('recipe-name').fill('Two eggs');
    await expect(page.getByTestId('review-total-kcal')).toBeVisible();
    await page.getByTestId('recipe-save').click();
    await page.waitForURL(/\/food\/recipes$/);

    await expect(page.getByTestId('recipe-row-Two eggs')).toBeVisible();
    await clickRow(page, 'recipe-row-Two eggs');
    await page.getByTestId('recipe-log').click();

    await page.waitForURL(/\/food\/[0-9a-f-]+$/);
    // 2 x 50 g x 131 kcal/100g = 131 kcal exact.
    await expect(page.getByTestId('meal-total')).toContainText('131 kcal');
  });

  test('review totals add up: round each row then sum, never sum then round', async ({ page }) => {
    await fresh(page);
    await page.goto('/food/recipes/new');
    await page.getByTestId('recipe-type-it').click();
    // Three deliberately unrecognisable names, so each becomes a figures-needed ingredient — no
    // table row named "zzqqxx*" exists to accidentally match. Letter suffixes, not digits: a
    // comma directly between two digits is parseMealText's decimal separator ("1,5kg"), not a
    // list separator, so "zzqqxx1, zzqqxx2" would not split the way it looks like it should.
    await page.getByTestId('recipe-typed-text').fill('zzqqxxa, zzqqxxb, zzqqxxc');
    await page.getByTestId('recipe-use-typed').click();

    for (const name of ['Zzqqxxa', 'Zzqqxxb', 'Zzqqxxc']) {
      await expect(page.getByTestId('question-name')).toHaveText(name);
      await page.getByTestId('question-type-figures').click();
      // 10.4 kcal exact, at 100 g — each row rounds to 10 (Math.round), so three of them read 30
      // as a total (10 + 10 + 10), never the naively-wrong 31 a sum-then-round of 31.2 would give.
      await page.getByTestId('question-figure-kcal').fill('10.4');
      await page.getByTestId('question-figure-protein').fill('0');
      await page.getByTestId('question-figure-carbs').fill('0');
      await page.getByTestId('question-figure-fat').fill('0');
      await expect(page.getByTestId('question-grams')).toBeVisible(); // figures now known → the card offers an amount
      await page.getByTestId('question-grams').fill('100');
      await page.getByTestId('question-next').click();
    }

    await expect(page.getByTestId('review-total-kcal')).toHaveText('30 kcal');

    let sum = 0;
    for (const id of ['review-row-0', 'review-row-1', 'review-row-2']) {
      const text = await page.getByTestId(id).innerText();
      const match = /(\d+)\s*kcal/.exec(text);
      expect(match).not.toBeNull();
      sum += Number(match![1]);
    }
    expect(sum).toBe(30);
  });

  test('weigh mode: a third of the dish is a third of the recipe, at display precision', async ({ page }) => {
    await fresh(page);
    await page.goto('/food/recipes/new');
    await page.getByTestId('recipe-add-ingredients').click();
    await page.getByTestId('picker-search').fill('egg');
    await page.getByTestId('picker-result-0').click();
    await clickRow(page, 'review-row-0');
    await page.getByTestId('question-count').fill('3');
    await page.getByTestId('question-next').click();

    await expect(page.getByTestId('review-total-kcal')).toHaveText('197 kcal');

    await page.getByTestId('share-mode').getByRole('radio', { name: 'Weigh it' }).click();
    await page.getByTestId('share-dish').fill('900');
    await page.getByTestId('share-plate').fill('300');

    // 3 eggs = 150 g @ 131 kcal/100g = 196.5, shown as 197; a third of the dish is a third of what
    // the review shows — 65.67, which rounds to 66.
    await expect(page.getByTestId('share-kcal')).toContainText('66 kcal');
  });

  test('From a recipe appends one item to an existing meal — the recipe\'s name, "1 of N portions"', async ({ page }) => {
    await fresh(page);
    await page.goto('/food/recipes/new');
    await page.getByTestId('recipe-add-ingredients').click();
    await page.getByTestId('picker-search').fill('egg');
    await page.getByTestId('picker-result-0').click();
    await clickRow(page, 'review-row-0');
    await page.getByTestId('question-count').fill('4');
    await page.getByTestId('question-next').click();
    await page.getByTestId('recipe-name').fill('Family omelette');
    await expect(page.getByTestId('review-total-kcal')).toBeVisible();
    await page.getByTestId('share-made').fill('4');
    await page.getByTestId('recipe-save').click();
    await page.waitForURL(/\/food\/recipes$/);

    await page.goto('/food/new');
    await page.getByTestId('meal-name').fill('Lunch');
    await page.getByTestId('empty-add-food').click();
    await page.getByTestId('food-name').fill('Toast');
    await page.getByTestId('food-grams').fill('50');
    await page.getByTestId('food-kcal').fill('250');
    await page.getByTestId('food-protein').fill('8');
    await page.getByTestId('food-carbs').fill('45');
    await page.getByTestId('food-fat').fill('4');
    await page.getByTestId('save-food').click();
    await page.getByTestId('save-meal').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);

    await page.getByTestId('from-recipe').click();
    await page.getByTestId('recipe-picker-row-Family omelette').click();
    await page.getByTestId('recipe-picker-add').click();

    const row = page.getByRole('button', { name: /Family omelette/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('1 of 4 portions');
  });

  test('an unmatched ingredient (figures needed) can be removed with "Not in it", unblocking Save', async ({ page }) => {
    await fresh(page);
    await page.goto('/food/recipes/new');
    await page.getByTestId('recipe-type-it').click();
    await page.getByTestId('recipe-typed-text').fill('3 eggs, xyzzy');
    await page.getByTestId('recipe-use-typed').click();

    await expect(page.getByTestId('question-name')).toHaveText('Eggs');
    await expect(page.getByTestId('question-count')).toHaveValue('3'); // the typed amount pre-filled it
    await page.getByTestId('question-next').click();

    // "xyzzy" matched nothing in the table, the aliases or FoodMemory — the figures-needed card.
    await expect(page.getByTestId('question-name')).toHaveText('Xyzzy');
    await expect(page.getByTestId('question-source')).toHaveText('Not found');
    await expect(page.getByTestId('question-remove')).toBeVisible();
    await page.getByTestId('question-remove').click();

    // Removing it (the only unresolved ingredient) lands straight on a complete Review.
    await expect(page.getByTestId('review-row-0')).toContainText('Eggs');
    await expect(page.getByTestId('review-row-1')).toHaveCount(0);
    await expect(page.getByTestId('review-total-kcal')).toBeVisible();

    await page.getByTestId('recipe-name').fill('Just eggs');
    await page.getByTestId('recipe-save-log').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);
    // 3 x 50 g x 131 kcal/100g = 196.5 → 197.
    await expect(page.getByTestId('meal-total')).toContainText('197 kcal');
  });

  test('product lookup switched off: no Scan pack anywhere in the recipe builder, and typing still completes a recipe', async ({ page }) => {
    let asked = 0;
    await page.route('**/*openfoodfacts.org/**', async (route) => {
      asked += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ products: [] }) });
    });

    await fresh(page);
    await page.goto('/settings');
    await openAdvanced(page);
    await page.getByRole('switch', { name: /Look up labels online/ }).click();
    await expect(page.getByText('Off.')).toBeVisible();

    await page.goto('/food/recipes/new');

    // The ingredient picker offers no Scan a pack button at all when lookup is off.
    await page.getByTestId('recipe-add-ingredients').click();
    await expect(page.getByTestId('picker')).toBeVisible();
    await expect(page.getByTestId('picker-scan')).toHaveCount(0);
    await expect(page.getByTestId('picker-type-figures')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picker')).toHaveCount(0);

    // Typing still completes a recipe end to end: one matched ingredient (the amount-known
    // branch) and one unmatched (the figures-needed branch) — neither offers Scan pack.
    await page.getByTestId('recipe-type-it').click();
    await page.getByTestId('recipe-typed-text').fill('2 eggs, xyzzy');
    await page.getByTestId('recipe-use-typed').click();

    await expect(page.getByTestId('question-name')).toHaveText('Eggs');
    await expect(page.getByTestId('question-scan')).toHaveCount(0);
    await page.getByTestId('question-next').click();

    await expect(page.getByTestId('question-name')).toHaveText('Xyzzy');
    await expect(page.getByTestId('question-scan')).toHaveCount(0);
    await page.getByTestId('question-remove').click();

    await page.getByTestId('recipe-name').fill('No lookup omelette');
    // 2 x 50 g x 131 kcal/100g = 131 kcal exact.
    await expect(page.getByTestId('review-total-kcal')).toHaveText('131 kcal');
    await page.getByTestId('recipe-save-log').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);
    await expect(page.getByTestId('meal-total')).toContainText('131 kcal');

    expect(asked).toBe(0);
  });

  test('the ingredient picker\'s own "Type figures" and "Scan a pack" both work, independent of the question card', async ({ page, browser, context }) => {
    const LOOKUP_KCAL = 594;
    await page.route('**/world.openfoodfacts.org/**', async (route) => {
      const code = /\/product\/(\d+)\.json/.exec(route.request().url())?.[1];
      if (code === FIXTURE_CODE) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 1,
            product: {
              code: FIXTURE_CODE,
              product_name: 'Chunky Peanut Butter',
              brands: 'Meridian',
              nutriments: { 'energy-kcal_100g': LOOKUP_KCAL, proteins_100g: 25, carbohydrates_100g: 14, fat_100g: 46 },
            },
          }),
        });
      } else {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 0, status_verbose: 'product not found' }) });
      }
    });

    await fresh(page);
    await denyCamera(browser, context, page);
    await page.goto('/food/recipes/new');

    // The picker's own "Type figures": a manual ingredient with typed per-100g figures, added
    // straight into Review — separate code (IngredientPickerSheet.addManual) from the question
    // card's own question-type-figures (which edits an ingredient already in the recipe).
    await page.getByTestId('recipe-add-ingredients').click();
    await page.getByTestId('picker-type-figures').click();
    await page.getByTestId('picker-manual-name').fill('Homemade pesto');
    await page.getByTestId('picker-manual-kcal').fill('450');
    await page.getByTestId('picker-manual-protein').fill('6');
    await page.getByTestId('picker-manual-carbs').fill('4');
    await page.getByTestId('picker-manual-fat').fill('44');
    await page.getByTestId('picker-manual-add').click();

    await expect(page.getByTestId('review-row-0')).toContainText('Homemade pesto');
    await clickRow(page, 'review-row-0');
    await expect(page.getByTestId('question-source')).toContainText('Your food');
    await page.getByTestId('question-grams').fill('30');
    await page.getByTestId('question-next').click();
    // 30 g @ 450 kcal/100g = 135.
    await expect(page.getByTestId('review-total-kcal')).toHaveText('135 kcal');

    // The picker's own "Scan a pack": a second ingredient added via a real barcode scan — its own
    // onScanCode (IngredientPickerSheet), separate from the question card's.
    await page.getByTestId('recipe-add-ingredient').click();
    await page.getByTestId('picker-scan').click();
    await expect(page.getByText('Camera not available.')).toBeVisible();
    await page.getByTestId('barcode-input').fill(FIXTURE_CODE);
    await page.getByTestId('barcode-submit').click();

    await expect(page.getByTestId('review-row-1')).toContainText('Chunky Peanut Butter');
    await clickRow(page, 'review-row-1');
    await expect(page.getByTestId('question-source')).toHaveText('Label · Meridian Chunky Peanut Butter');
    await page.getByTestId('question-grams').fill('20');
    await page.getByTestId('question-next').click();
    // 135 + (20 g @ 594 kcal/100g = 118.8 → 119) = 254.
    await expect(page.getByTestId('review-total-kcal')).toHaveText('254 kcal');
  });

  test('editing a saved recipe updates the same row (not a duplicate) and the change sticks', async ({ page }) => {
    await fresh(page);
    await page.goto('/food/recipes/new');
    await page.getByTestId('recipe-add-ingredients').click();
    await page.getByTestId('picker-search').fill('egg');
    await page.getByTestId('picker-result-0').click();
    await clickRow(page, 'review-row-0');
    await page.getByTestId('question-count').fill('2');
    await page.getByTestId('question-next').click();
    await page.getByTestId('recipe-name').fill('Omelette');
    await expect(page.getByTestId('review-total-kcal')).toBeVisible();
    await page.getByTestId('recipe-save').click();
    await page.waitForURL(/\/food\/recipes$/);
    await expect(page.getByTestId('recipe-row-Omelette')).toBeVisible();

    await page.getByTestId('recipe-more-Omelette').click();
    await page.getByTestId('recipe-edit').click();
    await expect(page).toHaveURL(/\/food\/recipes\/[0-9a-f-]+\/edit/);

    // Prefilled with the saved name and ingredient.
    await expect(page.getByTestId('recipe-name')).toHaveValue('Omelette');
    await expect(page.getByTestId('review-row-0')).toContainText('Eggs');

    // Change the name and the amount.
    await page.getByTestId('recipe-name').fill('Big omelette');
    await clickRow(page, 'review-row-0');
    await expect(page.getByTestId('question-count')).toHaveValue('2');
    await page.getByTestId('question-count').fill('4');
    await page.getByTestId('question-next').click();
    // 4 x 50 g x 131 kcal/100g = 262 kcal exact.
    await expect(page.getByTestId('review-total-kcal')).toHaveText('262 kcal');

    await page.getByTestId('recipe-save').click();
    await page.waitForURL(/\/food\/recipes$/);

    // Exactly one recipe, under the new name — not a duplicate row from an accidental insert.
    await expect(page.getByTestId('recipe-row-Big omelette')).toBeVisible();
    await expect(page.getByTestId('recipe-row-Omelette')).toHaveCount(0);
    await expect(page.locator('[data-testid^="recipe-row-"]')).toHaveCount(1);

    // And the change really stuck: re-opening it to log shows the new amount's kcal.
    await clickRow(page, 'recipe-row-Big omelette');
    await expect(page.getByTestId('share-kcal')).toContainText('262 kcal');
  });

  test('deleting a saved recipe removes its row, but leaves an item already logged from it untouched', async ({ page }) => {
    await fresh(page);
    await page.goto('/food/recipes/new');
    await page.getByTestId('recipe-add-ingredients').click();
    await page.getByTestId('picker-search').fill('egg');
    await page.getByTestId('picker-result-0').click();
    await clickRow(page, 'review-row-0');
    await page.getByTestId('question-count').fill('2');
    await page.getByTestId('question-next').click();
    await page.getByTestId('recipe-name').fill('Two eggs');
    await expect(page.getByTestId('review-total-kcal')).toBeVisible();
    await page.getByTestId('recipe-save-log').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);
    // 2 x 50 g x 131 kcal/100g = 131 kcal exact.
    await expect(page.getByTestId('meal-total')).toContainText('131 kcal');
    const mealUrl = page.url();

    await page.goto('/food/recipes');
    await expect(page.getByTestId('recipe-row-Two eggs')).toBeVisible();
    await page.getByTestId('recipe-more-Two eggs').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Delete Two eggs?')).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByTestId('recipe-row-Two eggs')).toHaveCount(0);
    await expect(page.getByText('No recipes yet.')).toBeVisible();

    // What was logged from it is a fact about what was eaten, not a reference to the recipe.
    await page.goto(mealUrl);
    await expect(page.getByTestId('meal-total')).toContainText('131 kcal');
  });

  test('"From a recipe" into an unsaved new meal appears immediately and persists after Save meal', async ({ page }) => {
    await fresh(page);
    await page.goto('/food/recipes/new');
    await page.getByTestId('recipe-add-ingredients').click();
    await page.getByTestId('picker-search').fill('egg');
    await page.getByTestId('picker-result-0').click();
    await clickRow(page, 'review-row-0');
    await page.getByTestId('question-count').fill('3');
    await page.getByTestId('question-next').click();
    await page.getByTestId('recipe-name').fill('Three eggs');
    await expect(page.getByTestId('review-total-kcal')).toBeVisible();
    await page.getByTestId('recipe-save').click();
    await page.waitForURL(/\/food\/recipes$/);

    // A brand-new, never-saved meal — "From a recipe" only shows while it still has zero items.
    await page.goto('/food/new');
    await expect(page.getByTestId('from-recipe')).toBeVisible();
    await page.getByTestId('from-recipe').click();
    await page.getByTestId('recipe-picker-row-Three eggs').click();
    await page.getByTestId('recipe-picker-add').click();

    // In local state only so far (shareItem, no database write) — the item and total show it.
    // Made 1, portion singular — see shareLabel, which pluralises on `made`, not `eaten`.
    const row = page.getByRole('button', { name: /Three eggs/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('1 of 1 portion');
    // 3 x 50 g x 131 kcal/100g = 196.5 → 197.
    await expect(page.getByTestId('meal-total')).toContainText('197 kcal');

    await page.getByTestId('meal-name').fill('Brunch');
    await page.getByTestId('save-meal').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);

    // Persisted, not just carried over in React state: a hard reload re-reads it from Dexie.
    await page.reload();
    await expect(page.getByRole('button', { name: /Three eggs/ })).toBeVisible();
    await expect(page.getByTestId('meal-total')).toContainText('197 kcal');
  });
});
