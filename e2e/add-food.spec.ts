import { expect, test, type Page } from '@playwright/test';
import { denyCamera, fresh } from './fresh';

/**
 * The Add food sheet, end to end through the real UI: search, barcode, natural units, one-tap
 * logging straight to the day, Undo, and the seven-day strip.
 *
 * FAKED, at the system boundary: the camera (denied, so a barcode is typed by hand — the same
 * lookup runs either way) and the Open Food Facts server, via page.route. Everything else is real:
 * the bundled UK table, IndexedDB, food memory, the sheet.
 */

const OFF_ROUTE = '**/world.openfoodfacts.org/**';
const CHICKEN_CODE = '5000000000001';
const UNKNOWN_CODE = '5000000009999';

/** A 400 g pack of chicken: bigger than the old 300 g cap that used to hide "whole pack". */
const OFF_CHICKEN = {
  status: 1,
  product: {
    code: CHICKEN_CODE,
    product_name: 'Chicken Breast Fillets',
    brands: 'Tesco',
    quantity: '400 g',
    product_quantity: 400,
    nutriments: { 'energy-kcal_100g': 165, proteins_100g: 31, carbohydrates_100g: 0, fat_100g: 3.6 },
  },
};
const OFF_NOT_FOUND = { status: 0, status_verbose: 'product not found' };

/** Answer per barcode the way the real service does, counting the requests. */
async function routeOff(page: Page): Promise<{ count: () => number }> {
  let n = 0;
  await page.route(OFF_ROUTE, async (route) => {
    n += 1;
    const code = /\/product\/(\d+)\.json/.exec(route.request().url())?.[1] ?? '';
    if (code === CHICKEN_CODE) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OFF_CHICKEN) });
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify(OFF_NOT_FOUND) });
    }
  });
  return { count: () => n };
}

interface RawItem {
  name: string;
  portion: string;
  source: string;
  nutrition: { basis: string; grams?: number };
}

async function rawItems(page: Page): Promise<RawItem[]> {
  return page.evaluate(async () => {
    const req = indexedDB.open('iron');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('mealItems', 'readonly');
    return new Promise<RawItem[]>((res) => {
      const r = tx.objectStore('mealItems').getAll();
      r.onsuccess = () => res(r.result as RawItem[]);
    });
  });
}

async function rawMeals(page: Page): Promise<Array<{ name: string; slot?: string; date: string }>> {
  return page.evaluate(async () => {
    const req = indexedDB.open('iron');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('meals', 'readonly');
    return new Promise<Array<{ name: string; slot?: string; date: string }>>((res) => {
      const r = tx.objectStore('meals').getAll();
      r.onsuccess = () => res(r.result as Array<{ name: string; slot?: string; date: string }>);
    });
  });
}

/** Open the sheet, choose the slot, and scan by typing the code (camera denied). */
async function scanCode(page: Page, code: string): Promise<void> {
  await page.getByTestId('add-food-scan').click();
  await expect(page.getByText('Camera not available.')).toBeVisible();
  await page.getByTestId('barcode-input').fill(code);
  await page.getByTestId('barcode-submit').click();
}

/** Save Settings once, which is what gives the app a calorie target (as the food spec does). */
async function saveSettings(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.getByTestId('save-targets').click();
  await expect(page.getByText('Saved')).toBeVisible();
}

test.describe('add food', () => {
  test.beforeEach(async ({ page, browser, context }) => {
    await fresh(page);
    await denyCamera(browser, context, page);
  });

  test('"egg" in the UK table, "2 eggs", logged under the chosen slot with the right calories', async ({ page }) => {
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-lunch').click();
    await page.getByTestId('add-food-search').fill('egg');

    // The bundled table loads lazily; the row appears when it has.
    await page.getByTestId('result-Eggs, chicken, whole, raw').click();
    await expect(page.getByTestId('amount-name')).toHaveText('Eggs, chicken, whole, raw');
    await expect(page.getByTestId('amount-egg-1')).toContainText('1 egg');
    await page.getByTestId('amount-egg-2').click();

    // Two eggs at 50 g, at the table's 131 kcal per 100 g.
    await expect(page.getByTestId('calories-bar')).toContainText('131 kcal');
    await expect(page.getByTestId('meal-more-Lunch')).toBeVisible();
    await expect(page.getByText(/^Lunch · .*1 item$/)).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('Logged to Lunch · 131 kcal');

    const meals = await rawMeals(page);
    expect(meals).toHaveLength(1);
    expect(meals[0]).toMatchObject({ name: 'Lunch', slot: 'lunch' });
    const items = await rawItems(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Eggs, chicken, whole, raw', portion: '2 eggs (100 g)', source: 'table' });
    expect(items[0]!.nutrition).toMatchObject({ basis: 'weighed', grams: 100 });
  });

  test('a barcode for a 400 g pack offers "Whole pack (400 g)" and logs it in one tap', async ({ page }) => {
    const off = await routeOff(page);
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-dinner').click();
    await scanCode(page, CHICKEN_CODE);

    await expect(page.getByTestId('amount-name')).toHaveText('Tesco Chicken Breast Fillets');
    const whole = page.getByTestId('amount-pack-1');
    await expect(whole).toContainText('Whole pack (400 g)');
    await expect(whole).toContainText('660 kcal');
    await expect(page.getByTestId('amount-pack-0.5')).toContainText('Half');
    await expect(page.getByTestId('amount-some')).toBeVisible();

    await whole.click();

    await expect(page.getByTestId('calories-bar')).toContainText('660 kcal');
    await expect(page.getByTestId('meal-more-Dinner')).toBeVisible();
    expect(off.count()).toBe(1);
    const items = await rawItems(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Tesco Chicken Breast Fillets', portion: '1 pack (400 g)', source: 'label' });
    expect(items[0]!.nutrition).toMatchObject({ grams: 400 });
  });

  test('"Half" logs 200 g, and a second food joins the same meal', async ({ page }) => {
    await routeOff(page);
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-dinner').click();
    await scanCode(page, CHICKEN_CODE);
    await page.getByTestId('amount-pack-0.5').click();
    await expect(page.getByTestId('calories-bar')).toContainText('330 kcal');

    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-dinner').click();
    await page.getByTestId('add-food-search').fill('egg');
    await page.getByTestId('result-Eggs, chicken, whole, raw').click();
    await page.getByTestId('amount-egg-1').click();
    await expect(page.getByTestId('calories-bar')).toContainText('396 kcal');

    // One meal, two foods — not a meal each.
    await expect(page.getByText(/^Dinner · .*2 items$/)).toBeVisible();
    expect(await rawMeals(page)).toHaveLength(1);
  });

  test('Undo takes it back out, and the meal it created with it', async ({ page }) => {
    await routeOff(page);
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-dinner').click();
    await scanCode(page, CHICKEN_CODE);
    await page.getByTestId('amount-pack-1').click();
    await expect(page.getByTestId('calories-bar')).toContainText('660 kcal');

    await page.getByTestId('toast-action').click();

    await expect(page.getByTestId('calories-bar')).toContainText('0 kcal');
    await expect(page.getByText('Nothing logged today')).toBeVisible();
    expect(await rawMeals(page)).toHaveLength(0);
    expect(await rawItems(page)).toHaveLength(0);
  });

  test('a pack that was logged once still offers its pack with no connection', async ({ page, context }) => {
    await routeOff(page);
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-dinner').click();
    await scanCode(page, CHICKEN_CODE);
    await page.getByTestId('amount-pack-1').click();
    await expect(page.getByTestId('calories-bar')).toContainText('660 kcal');

    await context.setOffline(true);
    // By name, from memory alone: nothing to read a label from.
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('add-food-search').fill('chicken');
    await page.getByTestId('result-Tesco Chicken Breast Fillets').click();
    await expect(page.getByTestId('amount-pack-1')).toContainText('Whole pack (400 g)');
    await expect(page.getByTestId('amount-pack-0.5')).toContainText('Half');
    await context.setOffline(false);
  });

  test('an unknown barcode says so plainly and offers to type the label', async ({ page }) => {
    await routeOff(page);
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-snack').click();
    await scanCode(page, UNKNOWN_CODE);

    await expect(page.getByTestId('barcode-line')).toHaveText('Not in the database.');
    // Snapping the label is offered beside typing it (the snap itself is in claude-food.spec.ts).
    await expect(page.getByTestId('snap-label')).toBeVisible();
    await page.getByTestId('type-label').click();

    await page.getByTestId('food-name').fill('Mystery bar');
    await page.getByTestId('food-grams').fill('45');
    await page.getByTestId('food-kcal').fill('400');
    await page.getByTestId('food-protein').fill('20');
    await page.getByTestId('food-carbs').fill('40');
    await page.getByTestId('food-fat').fill('15');
    await page.getByTestId('save-food').click();

    await expect(page.getByTestId('meal-more-Snack')).toBeVisible();
    await expect(page.getByTestId('calories-bar')).toContainText('180 kcal');

    // The pack is remembered against its barcode: the next scan fills from here, no label needed.
    await page.getByTestId('add-food-button').click();
    await scanCode(page, UNKNOWN_CODE);
    await expect(page.getByTestId('amount-name')).toHaveText('Mystery bar');
  });

  test('a pack the database knows by name only brings the name along and leaves the figures to type', async ({ page }) => {
    await page.route(OFF_ROUTE, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 1, product: { code: UNKNOWN_CODE, product_name: 'Oat Bar', brands: 'Nairn', nutriments: {} } }),
      }),
    );
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-snack').click();
    await scanCode(page, UNKNOWN_CODE);

    await expect(page.getByTestId('barcode-line')).toHaveText('In the database, but with no figures.');
    await page.getByTestId('type-label').click();
    await expect(page.getByTestId('food-name')).toHaveValue('Nairn Oat Bar');
    await page.getByTestId('food-grams').fill('40');
    await page.getByTestId('food-kcal').fill('420');
    await page.getByTestId('save-food').click();
    await expect(page.getByTestId('calories-bar')).toContainText('168 kcal');
    const items = await rawItems(page);
    expect(items[0]).toMatchObject({ name: 'Nairn Oat Bar', source: 'user' });
  });

  test('the Food screen puts Camera and Describe beside Barcode, each a full-size tap target', async ({ page }) => {
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    for (const id of ['add-food-scan', 'add-food-photo', 'add-food-describe']) {
      await expect(page.getByTestId(id)).toBeVisible();
      expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // Beside one another, in a row.
    const [a, b, c] = await Promise.all(['add-food-scan', 'add-food-photo', 'add-food-describe'].map((id) => page.getByTestId(id).boundingBox()));
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    expect(Math.abs(b!.y - c!.y)).toBeLessThan(2);
  });

  test('"Some" of an item is a count to step to: four eggs', async ({ page }) => {
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-breakfast').click();
    await page.getByTestId('add-food-search').fill('egg');
    await page.getByTestId('result-Eggs, chicken, whole, raw').click();
    await page.getByTestId('amount-some').click();
    await expect(page.getByTestId('some-count')).toHaveValue('4');
    await expect(page.getByTestId('amount-preview')).toContainText('4 eggs');
    await expect(page.getByTestId('amount-preview')).toContainText('262 kcal');
    await page.getByRole('button', { name: 'Eggs plus 1' }).click();
    await expect(page.getByTestId('amount-preview')).toContainText('5 eggs');
    await page.getByTestId('amount-log').click();

    await expect(page.getByTestId('calories-bar')).toContainText('328 kcal');
    const items = await rawItems(page);
    expect(items[0]).toMatchObject({ portion: '5 eggs (250 g)', source: 'table' });
  });

  test('"Some" of a pack, on a slider, and a typed weight', async ({ page }) => {
    await routeOff(page);
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-dinner').click();
    await scanCode(page, CHICKEN_CODE);

    await page.getByTestId('amount-some').click();
    // A quarter of the pack to start with: 100 g, 165 kcal.
    await expect(page.getByTestId('amount-preview')).toContainText('25% of the pack');
    await expect(page.getByTestId('amount-preview')).toContainText('165 kcal');
    await page.getByTestId('some-slider').fill('50');
    await expect(page.getByTestId('amount-preview')).toContainText('330 kcal');

    await page.getByTestId('amount-grams').click();
    await page.getByTestId('amount-grams-field').fill('150');
    await expect(page.getByTestId('amount-preview')).toContainText('248 kcal');
    await page.getByTestId('amount-log').click();

    await expect(page.getByTestId('calories-bar')).toContainText('248 kcal');
    const items = await rawItems(page);
    expect(items[0]).toMatchObject({ portion: '150 g', source: 'label' });
  });
});

test.describe('looking a food up by name', () => {
  const OFF_SEARCH = '**/search.openfoodfacts.org/**';
  const HITS = {
    hits: [
      {
        code: '5000000000777',
        product_name: 'Chicken Fillets',
        brands: 'Tesco',
        quantity: '650 g',
        product_quantity: 650,
        nutriments: { 'energy-kcal_100g': 120, proteins_100g: 24, carbohydrates_100g: 0, fat_100g: 2.5 },
      },
    ],
  };

  test.beforeEach(async ({ page, browser, context }) => {
    await fresh(page);
    await denyCamera(browser, context, page);
  });

  test('is a button, not a request on every keystroke, and it goes straight to the amount', async ({ page }) => {
    let asked = 0;
    await page.route(OFF_SEARCH, async (route) => {
      asked += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HITS) });
    });
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-lunch').click();
    await page.getByTestId('add-food-search').fill('chicken fillets');
    await expect(page.getByTestId('add-food-online')).toBeVisible();
    expect(asked).toBe(0);

    await page.getByTestId('add-food-online').click();
    await expect(page.getByTestId('amount-name')).toHaveText('Tesco Chicken Fillets');
    await expect(page.getByTestId('amount-pack-1')).toContainText('Whole pack (650 g)');
    await page.getByTestId('amount-pack-0.5').click();
    // Half of 650 g at 120 kcal per 100 g.
    await expect(page.getByTestId('calories-bar')).toContainText('390 kcal');
    expect(asked).toBe(1);
  });

  test('says so when there is no match', async ({ page }) => {
    await page.route(OFF_SEARCH, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits: [] }) }));
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('add-food-search').fill('chicken fillets');
    await page.getByTestId('add-food-online').click();
    await expect(page.getByTestId('add-food-online-none')).toHaveText('No matching product.');
  });

  test('is not offered offline', async ({ page, context }) => {
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('add-food-search').fill('chicken fillets');
    await expect(page.getByTestId('add-food-online')).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByTestId('add-food-online')).toHaveCount(0);
    // The table and what has been eaten before still search.
    await page.getByTestId('add-food-search').fill('egg');
    await expect(page.getByTestId('result-Eggs, chicken, whole, raw')).toBeVisible();
    await context.setOffline(false);
  });

  test('is not offered, nor is the barcode, when the lookup is switched off', async ({ page }) => {
    await page.evaluate(async () => {
      const req = indexedDB.open('iron');
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const row = await new Promise<Record<string, unknown>>((res) => {
        const r = store.get('settings');
        r.onsuccess = () => res(r.result as Record<string, unknown>);
      });
      store.put({ ...row, productLookup: false });
      await new Promise<void>((res) => {
        tx.oncomplete = () => res();
      });
      db.close();
    });
    await page.reload();
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('add-food-search').fill('chicken fillets');
    await expect(page.getByTestId('add-food-scan')).toHaveCount(0);
    await expect(page.getByTestId('add-food-online')).toHaveCount(0);
    // Typing it in is always there.
    await expect(page.getByTestId('add-by-hand')).toBeVisible();
  });
});

test.describe('the seven-day strip', () => {
  test.beforeEach(async ({ page, browser, context }) => {
    await fresh(page);
    await denyCamera(browser, context, page);
  });

  test('shows what was logged, what was not, and what went over', async ({ page }) => {
    await routeOff(page);
    await saveSettings(page);
    await page.goto('/food');
    const days = page.locator('[data-testid^="week-day-"]');
    await expect(days).toHaveCount(7);
    // Nothing logged anywhere yet: seven days of "not logged", not seven zeros.
    for (let i = 0; i < 7; i++) await expect(days.nth(i)).toHaveAttribute('data-state', 'unlogged');

    // Today: a whole pack, 660 kcal, comfortably inside the 1,900 target.
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-dinner').click();
    await scanCode(page, CHICKEN_CODE);
    await page.getByTestId('amount-pack-1').click();
    await expect(days.nth(6)).toHaveAttribute('data-state', 'within');
    await expect(days.nth(6)).toContainText('660');

    // Yesterday: 1.5 kg of the same chicken, which is over.
    await days.nth(5).click();
    await expect(page.getByTestId('day-label')).toHaveText('Yesterday');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-dinner').click();
    await scanCode(page, CHICKEN_CODE);
    await page.getByTestId('amount-grams').click();
    await page.getByTestId('amount-grams-field').fill('1500');
    await page.getByTestId('amount-log').click();

    await expect(days.nth(5)).toHaveAttribute('data-state', 'over');
    await expect(days.nth(5)).toContainText('2,475');
    await expect(page.getByTestId('remaining')).toHaveText('575 kcal over');
    // The other five are still honest about not being logged.
    for (const i of [0, 1, 2, 3, 4]) await expect(days.nth(i)).toHaveAttribute('data-state', 'unlogged');
    // Today did not change.
    await expect(days.nth(6)).toHaveAttribute('data-state', 'within');
  });
});

test.describe('the food sheet used to edit an amount', () => {
  test.beforeEach(async ({ page, browser, context }) => {
    await fresh(page);
    await denyCamera(browser, context, page);
  });

  test('offers the pack in chips, and changing the amount keeps a scanned label a label', async ({ page }) => {
    await routeOff(page);
    await page.goto('/food/new');
    await page.getByTestId('empty-add-food').click();
    await page.getByTestId('scan-barcode').click();
    await expect(page.getByText('Camera not available.')).toBeVisible();
    await page.getByTestId('barcode-input').fill(CHICKEN_CODE);
    await page.getByTestId('barcode-submit').click();

    // The label fills the sheet. Its pack is 400 g — the weight field starts on a plausible
    // single portion, but the chips offer the whole pack.
    await expect(page.getByTestId('food-name')).toHaveValue('Tesco Chicken Breast Fillets');
    await expect(page.getByTestId('amount-pack-1')).toContainText('Whole pack (400 g)');
    await page.getByTestId('amount-pack-0.5').click();
    await expect(page.getByTestId('food-grams')).toHaveValue('200');
    await expect(page.getByTestId('food-eaten')).toContainText('330 kcal');
    await page.getByTestId('save-food').click();
    await page.getByTestId('save-meal').click();
    await page.waitForURL(/\/food\/[0-9a-f-]+$/);

    const items = await rawItems(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ portion: '½ pack (200 g)', source: 'label' });
    // The meal row speaks in the pack's terms, not just grams.
    await expect(page.getByText('½ pack (200 g)')).toBeVisible();
  });
});
