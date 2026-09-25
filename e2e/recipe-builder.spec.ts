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
 * file at `opts.path` (exactly the string the app passed, whatever that is) really exists in the
 * Filesystem store, and records the answer on `window` for the test to read afterwards.
 * `dish`/`ingredients` are fixed to the omelette the tests below answer.
 *
 * This looks the file up the way native actually resolves it, not by scanning for "any file under
 * meal-photos": @capacitor/filesystem's web plugin (node_modules/@capacitor/filesystem/dist/esm/web.js)
 * keys its `FileStorage` object store on `path` (`keyPath: 'path'`), and `writeFile` returns
 * `{ uri: pathObj.path }` — the SAME string as that key (`getPath(Directory.Cache, "meal-photos/x.jpg")`
 * = "/CACHE/meal-photos/x.jpg"). So `store.get(opts.path)` is a direct key lookup: it only finds the
 * file when `opts.path` is that exact resolved uri/key. `preparePhoto`'s OTHER value, the
 * Directory.Cache-relative `path` ("meal-photos/x.jpg"), is not a key in the store at all, so
 * `store.get` on it comes back `undefined` — exactly the on-device failure mode (`Uri.parse(path)
 * .getPath()` in NanoPlugin.java resolves a relative string to itself, not the app's cache dir, so
 * `BitmapFactory.decodeFile` can't find the file either). A test that instead scanned every entry
 * under "meal-photos/" would find the file under either value and never catch this.
 */
async function installPhotoFake(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
      status: { state: 'ready', detail: 'ready' },
      generate: async () => ({ text: '' }),
      analyzeMeal: async (opts: { path: string }) => {
        let existed = false;
        try {
          const dbs = (await indexedDB.databases?.()) ?? [];
          if (dbs.some((d) => d.name === 'Disc')) {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const req = indexedDB.open('Disc');
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            const entry = await new Promise<{ type: string; path: string } | undefined>((resolve, reject) => {
              const r = db.transaction('FileStorage', 'readonly').objectStore('FileStorage').get(opts.path);
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            });
            db.close();
            existed = entry !== undefined && entry.type === 'file';
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

/**
 * Install a fake Nano whose `generate` answers "Estimate a meal out" with a fixed JSON estimate —
 * the `window.__ironNanoFake` seam `Nano.generate` reads, same as `installPhotoFake` does for
 * `analyzeMeal`. Every `part` name here is one this repo's REAL bundled UK table/alias data
 * actually resolves (via a curated alias, exact word match), so the review that follows is exercising
 * real `matchIngredient` against real data, not a name chosen to merely look plausible.
 */
async function installEstimateFake(page: Page, parts: { name: string; grams?: number }[], dish?: string): Promise<void> {
  await page.addInitScript(
    ({ parts, dish }) => {
      (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
        status: { state: 'ready', detail: 'ready' },
        generate: async () => ({ text: JSON.stringify({ ...(dish ? { dish } : {}), parts }) }),
        analyzeMeal: async () => ({ text: '{"ingredients":[]}' }),
      };
    },
    { parts, dish },
  );
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
    // Eating the whole recipe logs the total the review showed — 430, not the unrounded 428.8
    // (which would read 429 beside a review that said 430).
    await expect(page.getByTestId('meal-total')).toContainText('430 kcal');

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
    // "Estimate a meal out" is gated on the exact same Nano status as "Take a photo".
    await expect(page.getByTestId('recipe-start-estimate')).toBeDisabled();

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

  test('Cancel during photo recognition returns to the start phase, and the temp photo is still cleaned up once the stale call resolves', async ({ page }) => {
    await page.addInitScript(() => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      (window as unknown as { __releaseAnalyze?: () => void }).__releaseAnalyze = () => release?.();
      (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
        status: { state: 'ready', detail: 'ready' },
        generate: async () => ({ text: '' }),
        analyzeMeal: async () => {
          await gate; // holds its answer until the test releases it
          return { text: '{"dish":"Omelette","ingredients":["egg"]}' };
        },
      };
    });
    await fresh(page);
    await page.goto('/food/recipes/new');
    await expect(page.getByTestId('recipe-take-photo')).toBeEnabled();

    const buffer = await makeJpegBuffer(page);
    await page.getByTestId('recipe-photo-input').setInputFiles({ name: 'meal.jpg', mimeType: 'image/jpeg', buffer });
    await expect(page.getByTestId('recipe-recognising')).toBeVisible();

    // The photo really is on disk before Cancel — so waiting for it to disappear, later, is
    // actually waiting on something, not vacuously already true.
    await expect.poll(async () => (await readMealPhotoFiles(page)).length, { timeout: 10_000 }).toBe(1);

    await page.getByTestId('recipe-recognise-cancel').click();
    // Positive signal: back on the start phase (not merely "recognising is no longer shown").
    await expect(page.getByTestId('recipe-take-photo')).toBeVisible();

    // Release the stale in-flight call, then wait for a positive signal that its `finally` ran —
    // the temp photo actually being deleted — before checking anything about the resulting state.
    // Never asserted on a bare "nothing changed": a toast repeats verbatim and a poll can pass on
    // its first sample before the real work is done.
    await page.evaluate(() => (window as unknown as { __releaseAnalyze?: () => void }).__releaseAnalyze?.());
    await expect.poll(async () => (await readMealPhotoFiles(page)).length, { timeout: 10_000 }).toBe(0);

    await expect(page.getByTestId('question-card')).toHaveCount(0);
    await expect(page.getByTestId('recipe-take-photo')).toBeVisible();
  });
});

test.describe('estimate a meal out', () => {
  test('typed description → five estimated parts straight to Review, rows sum to the total, save and log', async ({ page }) => {
    await installEstimateFake(
      page,
      [
        { name: 'beef mince', grams: 300 }, // "patties" — one entry for the whole dish, not two
        { name: 'bread', grams: 90 }, // "bun"
        { name: 'cheddar', grams: 40 },
        { name: 'bacon', grams: 50 }, // has a unit (rasher, 25 g) — still shown as "≈ 50 g · est."
        { name: 'mayonnaise', grams: 20 },
      ],
      'Five Guys double bacon cheeseburger',
    );
    await fresh(page);
    await page.goto('/food/recipes/new');
    await expect(page.getByTestId('recipe-start-estimate')).toBeEnabled();
    await page.getByTestId('recipe-start-estimate').click();
    await page.getByTestId('recipe-estimate-text').fill('Five Guys double bacon cheeseburger');
    await page.getByTestId('recipe-estimate-submit').click();

    // Straight to Review — no one-at-a-time question-card walk in between.
    await expect(page.getByTestId('question-card')).toHaveCount(0);
    await expect(page.getByTestId('recipe-name')).toHaveValue('Five Guys double bacon cheeseburger');
    for (let i = 0; i < 5; i++) {
      await expect(page.getByTestId(`review-row-${i}`)).toBeVisible();
      await expect(page.getByTestId(`review-estimated-${i}`)).toContainText('est.');
    }
    await expect(page.getByTestId('review-estimate')).toBeVisible();

    // Beef mince 300g @ 225 = 675; bread 90g @ 219 = 197.1 → 197; cheddar 40g @ 416 = 166.4 → 166;
    // bacon 50g @ 215 = 107.5 → 108; mayonnaise 20g @ 686 = 137.2 → 137. Round each row then sum:
    // 675 + 197 + 166 + 108 + 137 = 1283 — the real bundled CoFID figures, not hand-picked ones.
    await expect(page.getByTestId('review-total-kcal')).toHaveText('1283 kcal');

    await page.getByTestId('recipe-save-log').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);
    await expect(page.getByTestId('meal-total')).toContainText('1283 kcal');
  });

  test('editing an amount clears its "est." marker; the Estimate label stays until every amount is edited', async ({ page }) => {
    await installEstimateFake(
      page,
      [
        { name: 'beef mince', grams: 300 },
        { name: 'bread', grams: 90 },
        { name: 'cheddar', grams: 40 },
        { name: 'bacon', grams: 50 },
        { name: 'mayonnaise', grams: 20 },
      ],
      'Five Guys double bacon cheeseburger',
    );
    await fresh(page);
    await page.goto('/food/recipes/new');
    await page.getByTestId('recipe-start-estimate').click();
    await page.getByTestId('recipe-estimate-text').fill('Five Guys double bacon cheeseburger');
    await page.getByTestId('recipe-estimate-submit').click();
    await expect(page.getByTestId('review-estimate')).toBeVisible();

    // Edit only the first row's amount.
    await clickRow(page, 'review-row-0');
    await expect(page.getByTestId('question-grams')).toHaveValue('300');
    await page.getByTestId('question-grams').fill('350');
    await page.getByTestId('question-next').click();

    await expect(page.getByTestId('review-estimated-0')).toHaveCount(0);
    // The other four rows are still estimated, so the label stays.
    await expect(page.getByTestId('review-estimate')).toBeVisible();

    // Edit the remaining four amounts, one at a time.
    await clickRow(page, 'review-row-1'); // bread: also a count-style unit ("slice")
    await expect(page.getByTestId('question-count')).toBeVisible();
    await page.getByTestId('question-count').fill('2');
    await page.getByTestId('question-next').click();

    await clickRow(page, 'review-row-2');
    await page.getByTestId('question-grams').fill('45');
    await page.getByTestId('question-next').click();

    await clickRow(page, 'review-row-3'); // bacon: a count-style unit, not a plain grams field
    await expect(page.getByTestId('question-count')).toBeVisible();
    await page.getByTestId('question-count').fill('3');
    await page.getByTestId('question-next').click();
    await expect(page.getByTestId('review-estimated-3')).toHaveCount(0);
    // Three of five edited so far — the label is still up.
    await expect(page.getByTestId('review-estimate')).toBeVisible();

    await clickRow(page, 'review-row-4');
    await page.getByTestId('question-grams').fill('25');
    await page.getByTestId('question-next').click();

    // Every amount has now been edited — the factual "Estimate" label is gone.
    await expect(page.getByTestId('review-estimate')).toHaveCount(0);
    await expect(page.locator('[data-testid^="review-estimated-"]')).toHaveCount(0);
  });

  test('Nano unavailable: Estimate a meal out is disabled with the state shown, and the other start options still work', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
        status: { state: 'unavailable', detail: 'UNAVAILABLE · test fixture' },
        generate: async () => ({ text: '' }),
      };
    });
    await fresh(page);
    await page.goto('/food/recipes/new');

    await expect(page.getByTestId('recipe-start-estimate')).toBeDisabled();
    await expect(page.getByTestId('recipe-assistant-state')).toContainText('unavailable');

    // The other, non-Nano start option still completes a recipe end to end.
    await page.getByTestId('recipe-add-ingredients').click();
    await page.getByTestId('picker-search').fill('egg');
    await page.getByTestId('picker-result-0').click();
    await expect(page.getByTestId('review-row-0')).toBeVisible();
  });

  test('unparseable model output lands on recognise-none, never a stuck empty review with no explanation', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
        status: { state: 'ready', detail: 'ready' },
        generate: async () => ({ text: 'Sorry, I cannot help with that.' }),
      };
    });
    await fresh(page);
    await page.goto('/food/recipes/new');
    await page.getByTestId('recipe-start-estimate').click();
    await page.getByTestId('recipe-estimate-text').fill('something unrecognisable');
    await page.getByTestId('recipe-estimate-submit').click();

    await expect(page.getByTestId('recognise-none')).toBeVisible();
    await expect(page.getByTestId('question-card')).toHaveCount(0);
    await expect(page.getByTestId('recipe-add-ingredient')).toBeVisible();
  });

  test('from an existing meal, Estimate opens the text box directly and the logged item is appended to that meal', async ({ page }) => {
    await installEstimateFake(page, [{ name: 'cheddar', grams: 40 }], 'Cheese snack');
    await fresh(page);

    // Build an ordinary existing meal with one food item first, so there is a real meal id to
    // navigate `estimate-meal` to.
    await page.goto('/food/new');
    await page.getByTestId('meal-name').fill('Snack');
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
    const mealUrl = page.url();

    await page.getByTestId('estimate-meal').click();
    await expect(page).toHaveURL(/\/food\/recipes\/new\?start=estimate&meal=/);
    // The text box opens directly — no need to tap "Estimate a meal out" first.
    await expect(page.getByTestId('recipe-estimate-text')).toBeVisible();
    await page.getByTestId('recipe-estimate-text').fill('a bit of cheese');
    await page.getByTestId('recipe-estimate-submit').click();

    await expect(page.getByTestId('review-row-0')).toContainText('Cheddar');
    // 40 g @ 416 kcal/100g = 166.4 → 166, the real bundled CoFID figure.
    await expect(page.getByTestId('review-total-kcal')).toHaveText('166 kcal');

    await page.getByTestId('recipe-save-log').click();
    // Back on the SAME meal, not a new one.
    await page.waitForURL(mealUrl);
    // The logged item takes the recipe/dish name ("Cheese snack"), the same as any other saved
    // recipe's share — not the ingredient's own name. (Its kcal sits in the row's `right` slot,
    // outside the row's own `<button>` — see `clickRow`'s doc comment above.)
    const row = page.getByRole('button', { name: /Cheese snack/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('1 of 1 portion');
    await expect(page.getByText('166 kcal')).toBeVisible();
  });
});
