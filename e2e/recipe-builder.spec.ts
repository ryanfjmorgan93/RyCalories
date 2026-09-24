import { expect, test, type Page } from '@playwright/test';
import { denyCamera, fresh } from './fresh';
import { FIXTURE_CODE } from './fixtures/ean13';

/**
 * Cooked meals: photo → ingredients → amounts → a saved recipe.
 *
 * FAKED, at the system boundary: the on-device model (`window.__ironNanoFake`, the same seam
 * `assistant-diagnostics.spec.ts` uses) and Open Food Facts (`page.route`, with the service's real
 * status codes — see `barcode.spec.ts`'s note on why a miss is HTTP 404, never 200).
 *
 * REAL, exercised end to end: the whole builder UI, `matchIngredient`/`searchFoods` against the
 * real bundled UK food table, `preparePhoto`'s downscale-and-write through the real Capacitor
 * Filesystem web plugin (IndexedDB `Disc`), and every Dexie write.
 */

/** A JPEG built at runtime in the page, so no binary fixture is needed. */
async function makeJpegBuffer(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#4488ff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg');
  });
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

/**
 * Every file the Capacitor Filesystem web plugin has under `meal-photos/` in any directory —
 * `preparePhoto`/`sweepMealPhotos` write to `Directory.Cache`, which the plugin's web
 * implementation namespaces as `/CACHE/…`, but this matches on the folder name alone so it does
 * not have to reproduce that mapping. Reads the plugin's OWN IndexedDB store ('Disc'), the same
 * technique `e2e/fresh.ts`'s `readBackupFiles` uses for `Directory.Documents`.
 */
async function readMealPhotoFiles(page: Page): Promise<{ path: string }[]> {
  return page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    if (!dbs.some((d) => d.name === 'Disc')) return [];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('Disc');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const entries = await new Promise<Array<{ type: string; path: string }>>((resolve, reject) => {
      const r = db.transaction('FileStorage', 'readonly').objectStore('FileStorage').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return entries.filter((e) => e.type === 'file' && typeof e.path === 'string' && e.path.includes('/meal-photos/'));
  });
}

/**
 * Install a fake Nano whose `analyzeMeal` confirms — INSIDE THE PAGE, before returning — that the
 * downscaled photo really landed in the Filesystem store, and records the answer on `window` for
 * the test to read afterwards. `dish`/`ingredients` are fixed to the omelette the tests below
 * answer.
 */
async function installPhotoFake(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
      status: { state: 'ready', detail: 'ready' },
      generate: async () => ({ text: '' }),
      analyzeMeal: async () => {
        let existed = false;
        try {
          const dbs = (await indexedDB.databases?.()) ?? [];
          if (dbs.some((d) => d.name === 'Disc')) {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const req = indexedDB.open('Disc');
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            const entries = await new Promise<Array<{ type: string; path: string }>>((resolve, reject) => {
              const r = db.transaction('FileStorage', 'readonly').objectStore('FileStorage').getAll();
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            });
            db.close();
            existed = entries.some((e) => e.type === 'file' && typeof e.path === 'string' && e.path.includes('/meal-photos/'));
          }
        } catch {
          existed = false;
        }
        (window as unknown as { __recipePhotoExisted?: boolean }).__recipePhotoExisted = existed;
        return { text: '{"dish":"Omelette","ingredients":["egg","cheddar","bacon"]}' };
      },
    };
  });
}

/** Click the actual clickable row, scoped to its wrapper — a Review or Recipes row's `right` slot
 * (a kcal figure, or a More button) sits outside the row's own `<button>`, so a raw click on the
 * wrapper's centre is not reliably the row itself. */
async function clickRow(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).getByRole('button').first().click();
}

test.describe('recipe builder', () => {
  test('manual floor: search the table, set an amount by hand, save and log — no Nano involved', async ({ page }) => {
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

  test('photo path: recognise, answer one ingredient at a time, save and log — the temp photo is gone after', async ({ page }) => {
    // Install the fake BEFORE fresh() navigates, so it is already on `window` the moment the app
    // boots and calls Nano.status() on mount.
    await installPhotoFake(page);
    await fresh(page);
    await page.goto('/food/recipes/new');
    await expect(page.getByTestId('recipe-take-photo')).toBeEnabled();

    const buffer = await makeJpegBuffer(page);
    await page.getByTestId('recipe-photo-input').setInputFiles({ name: 'meal.jpg', mimeType: 'image/jpeg', buffer });

    await expect(page.getByTestId('question-name')).toHaveText('Egg');
    await page.getByTestId('question-count').fill('3');
    await page.getByTestId('question-next').click();

    await expect(page.getByTestId('question-name')).toHaveText('Cheddar');
    await page.getByTestId('question-grams').fill('30');
    await page.getByTestId('question-next').click();

    await expect(page.getByTestId('question-name')).toHaveText('Bacon');
    await page.getByTestId('question-count').fill('2');
    await page.getByTestId('question-next').click(); // last ingredient: "Done" → review

    await expect(page.getByTestId('recipe-name')).toHaveValue('Omelette');

    const existed = await page.evaluate(() => (window as unknown as { __recipePhotoExisted?: boolean }).__recipePhotoExisted);
    expect(existed).toBe(true);

    // Egg 150 g @ 131 kcal/100g = 196.5 → 197; cheddar 30 g @ 416 = 124.8 → 125; bacon 50 g @ 215
    // = 107.5 → 108. Round each row then sum (197 + 125 + 108 = 430) — never sum then round.
    await expect(page.getByTestId('review-total-kcal')).toHaveText('430 kcal');

    await page.getByTestId('recipe-save-log').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);
    // The logged item is the exact share of the recipe (196.5 + 124.8 + 107.5 = 428.8 kcal
    // exact), rounded once as a single item — 429, deliberately not the review's own 430.
    await expect(page.getByTestId('meal-total')).toContainText('429 kcal');

    await expect.poll(async () => (await readMealPhotoFiles(page)).length, { timeout: 10_000 }).toBe(0);
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

  test('Nano unavailable: Take a photo is disabled with the state shown, but typing still works end to end', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
        status: { state: 'unavailable', detail: 'UNAVAILABLE · test fixture' },
        generate: async () => ({ text: '' }),
      };
    });
    await fresh(page);
    await page.goto('/food/recipes/new');

    await expect(page.getByTestId('recipe-take-photo')).toBeDisabled();
    await expect(page.getByTestId('recipe-assistant-state')).toContainText('unavailable');

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

  test('unparseable model output lands on recognise-none, never a stuck zero-ingredient card', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
        status: { state: 'ready', detail: 'ready' },
        generate: async () => ({ text: '' }),
        analyzeMeal: async () => ({ text: 'Sorry.' }),
      };
    });
    await fresh(page);
    await page.goto('/food/recipes/new');
    await expect(page.getByTestId('recipe-take-photo')).toBeEnabled();

    const buffer = await makeJpegBuffer(page);
    await page.getByTestId('recipe-photo-input').setInputFiles({ name: 'meal.jpg', mimeType: 'image/jpeg', buffer });

    // Lands on the review, with a factual line — not a question card frozen on 0 of 0.
    await expect(page.getByTestId('recognise-none')).toBeVisible();
    await expect(page.getByTestId('question-card')).toHaveCount(0);
    await expect(page.getByTestId('recipe-add-ingredient')).toBeVisible();
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

    // 3 eggs = 150 g @ 131 kcal/100g = 196.5 kcal exact; a third of the dish is a third of that —
    // 65.5, which rounds to 66.
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
});
