import { expect, test, type Page } from '@playwright/test';
import { denyCamera, fresh } from './fresh';
import { FIXTURE_CODE } from './fixtures/ean13';

/**
 * Camera barcode scanning, run under the `camera` Playwright project (playwright.config.ts).
 *
 * FAKED, at the system boundary:
 *   - The phone's camera. Chromium's `--use-fake-device-for-media-stream` and
 *     `--use-file-for-fake-video-capture` flags feed getUserMedia a hand-drawn Y4M video of a
 *     real EAN-13 barcode (e2e/fixtures/ean13.ts, drawn once in e2e/global-setup.ts) instead of a
 *     physical sensor.
 *   - The Open Food Facts server, via page.route — there is no real network dependency here,
 *     deliberately, same as every other lookup test in this repo.
 *
 * REAL, exercised end to end:
 *   getUserMedia → the <video> element decoding actual frames → the zxing-wasm decode loop
 *   (src/ui/BarcodeScanner.tsx) → lookupBarcode → Dexie's productCache → the sheet filling
 *   itself in. If the wasm asset were missing, the module-format table wrong, or the checksum
 *   arithmetic off, these tests fail or hang — they do not mock the decoder.
 *
 * The two manual-entry tests below explicitly block the camera permission first (via CDP), so a
 * real, uncontrollable race against the camera's own decode loop cannot decide which path
 * actually got exercised — see the comment above them.
 */

const OFF_HIT = {
  status: 1,
  product: {
    code: FIXTURE_CODE,
    product_name: 'Protein Flapjack',
    brands: 'Trek',
    serving_size: '50 g',
    nutriments: {
      'energy-kcal_100g': 400,
      proteins_100g: 20,
      carbohydrates_100g: 45,
      fat_100g: 15,
    },
  },
};

const OFF_ROUTE = '**/world.openfoodfacts.org/**';

/** A second, different product: no brand in the database, no serving size. */
const OAT_CODE = '5012345678900';
const OAT_HIT = {
  status: 1,
  product: {
    code: OAT_CODE,
    product_name: 'Oat Bar',
    brands: '',
    nutriments: { 'energy-kcal_100g': 380, proteins_100g: 8, carbohydrates_100g: 60, fat_100g: 12 },
  },
};

/** A well-formed barcode the database does not know. */
const UNKNOWN_CODE = '5099999999994';
/**
 * Exactly what the live Open Food Facts v2 endpoint sends for UNKNOWN_CODE (checked with curl,
 * September 2026): HTTP 404, JSON, status 0. Routing a miss as a 200 here is what hid the bug —
 * the app threw every 404 away and told the user "Lookup unavailable".
 */
const OFF_NOT_FOUND = { status: 0, code: UNKNOWN_CODE, status_verbose: 'product not found' };

/**
 * Answer per barcode, the way the real service does, and count the requests for each code.
 * `hold`, when given, keeps every answer back until it resolves.
 */
async function routeOffByCode(page: Page, hold?: Promise<void>): Promise<Map<string, number>> {
  const hits = new Map<string, number>();
  await page.route(OFF_ROUTE, async (route) => {
    const code = /\/product\/(\d+)\.json/.exec(route.request().url())?.[1] ?? '';
    hits.set(code, (hits.get(code) ?? 0) + 1);
    if (hold) await hold;
    if (code === FIXTURE_CODE) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OFF_HIT) });
    } else if (code === OAT_CODE) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OAT_HIT) });
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify(OFF_NOT_FOUND) });
    }
  });
  return hits;
}

/** Open the scanner (camera denied beforehand) and enter a code by hand. */
async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByTestId('scan-barcode').click();
  await expect(page.getByText('Camera not available.')).toBeVisible();
  await page.getByTestId('barcode-input').fill(code);
  await page.getByTestId('barcode-submit').click();
}

interface RawMealItem {
  name: string;
  brand?: string;
}

async function readMealItems(page: Page): Promise<RawMealItem[]> {
  return page.evaluate(async () => {
    const req = indexedDB.open('iron');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('mealItems', 'readonly');
    return new Promise<RawMealItem[]>((res) => {
      const r = tx.objectStore('mealItems').getAll();
      r.onsuccess = () => res(r.result as RawMealItem[]);
    });
  });
}

// A cold zxing-wasm module has to be fetched and instantiated before it can decode a single
// frame, and the fake video's first frame is not even ready for a tick or two after getUserMedia
// resolves — both real costs. Manual entry has neither, so it reliably beats the camera to
// filling the sheet, but the margin is not infinite, hence the generous timeout on assertions
// that follow a scan.
const DECODE_TIMEOUT = 20_000;

async function routeOffHit(page: Page): Promise<void> {
  await page.route(OFF_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OFF_HIT) }),
  );
}

/** A brand-new "Add food" sheet, from a brand-new meal, ready for its first field. */
async function openNewFoodSheet(page: Page): Promise<void> {
  await page.goto('/food/new');
  await page.getByTestId('meal-name').fill('Snack');
  await page.getByTestId('empty-add-food').click();
}

test.describe('barcode scanning', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page);
  });

  test('scanning with the camera fills name, brand and kcal', async ({ page }) => {
    await routeOffHit(page);
    await openNewFoodSheet(page);

    await page.getByTestId('scan-barcode').click();
    // Nothing here touches barcode-input: this is the camera-only path, start to finish.
    await expect(page.getByTestId('food-name')).toHaveValue(/Flapjack/, { timeout: DECODE_TIMEOUT });
    await expect(page.getByTestId('food-kcal')).toHaveValue('400');
  });

  test('a barcode looked up once still resolves offline, from cache', async ({ page, context }) => {
    await routeOffHit(page);
    await openNewFoodSheet(page);

    await page.getByTestId('scan-barcode').click();
    await expect(page.getByTestId('food-name')).toHaveValue(/Flapjack/, { timeout: DECODE_TIMEOUT });

    // Close this item without saving it, then take away the only way it could reach the network.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.unroute(OFF_ROUTE);
    await context.setOffline(true);

    await page.getByTestId('empty-add-food').click();
    await page.getByTestId('scan-barcode').click();
    await expect(page.getByTestId('food-name')).toHaveValue(/Flapjack/, { timeout: DECODE_TIMEOUT });
    await expect(page.getByTestId('lookup-offline')).toBeHidden();

    await context.setOffline(false);
  });

  // The next two tests are about the manual-entry path specifically, so camera permission is
  // withdrawn first: with the camera live, its decode loop reliably beats manual typing to
  // onCode (a few hundred ms of fake-device + first-decode latency against a UI still winning
  // by whole seconds is not the interesting race), which made these flake against whichever
  // path happened to finish first rather than testing the one named in the title. Denying the
  // permission is itself a real path — camera unavailable, or refused — and BarcodeScanner is
  // required to still work from the manual field when it happens.
  test('typing the code in by hand fills the sheet the same way', async ({ page, browser, context }) => {
    await routeOffHit(page);
    await openNewFoodSheet(page);
    await denyCamera(browser, context, page);

    await page.getByTestId('scan-barcode').click();
    await expect(page.getByText('Camera not available.')).toBeVisible();
    await page.getByTestId('barcode-input').fill(FIXTURE_CODE);
    await page.getByTestId('barcode-submit').click();

    await expect(page.getByTestId('food-name')).toHaveValue(/Flapjack/, { timeout: DECODE_TIMEOUT });
    await expect(page.getByTestId('food-kcal')).toHaveValue('400');
  });

  test('an invalid-length code typed by hand says so, not "no connection"', async ({ page, browser, context }) => {
    await routeOffHit(page);
    await openNewFoodSheet(page);
    await denyCamera(browser, context, page);

    await page.getByTestId('scan-barcode').click();
    await expect(page.getByText('Camera not available.')).toBeVisible();
    await page.getByTestId('barcode-input').fill('123');
    await page.getByTestId('barcode-submit').click();

    await expect(page.getByTestId('lookup-invalid')).toBeVisible();
    await expect(page.getByTestId('lookup-offline')).toBeHidden();
  });

  // A second scan in the same sheet. Camera denied so each code is exactly the one typed — the
  // fake camera only ever shows the fixture, and would otherwise race the second code.
  test('a second scan replaces the first product, brand included', async ({ page, browser, context }) => {
    await routeOffByCode(page);
    await openNewFoodSheet(page);
    await denyCamera(browser, context, page);

    await enterCode(page, FIXTURE_CODE);
    await expect(page.getByTestId('food-name')).toHaveValue(/Flapjack/, { timeout: DECODE_TIMEOUT });

    await enterCode(page, OAT_CODE);
    await expect(page.getByTestId('food-name')).toHaveValue('Oat Bar');
    await expect(page.getByTestId('food-kcal')).toHaveValue('380');

    await page.getByTestId('save-food').click();
    await page.getByTestId('save-meal').click();
    // 'missing' until the meal is written, so this cannot pass before the save lands. The Oat Bar
    // has no brand; the flapjack's "Trek" used to be carried across onto it.
    await expect
      .poll(async () => {
        const row = (await readMealItems(page)).find((i) => i.name === 'Oat Bar');
        return row ? (row.brand ?? null) : 'missing';
      })
      .toBeNull();
  });

  test('an unknown second barcode clears the first product instead of leaving it on screen', async ({ page, browser, context }) => {
    await routeOffByCode(page);
    await openNewFoodSheet(page);
    await denyCamera(browser, context, page);

    await enterCode(page, FIXTURE_CODE);
    await expect(page.getByTestId('food-name')).toHaveValue(/Flapjack/, { timeout: DECODE_TIMEOUT });
    await expect(page.getByTestId('food-kcal')).toHaveValue('400');

    await enterCode(page, UNKNOWN_CODE);
    // Never shown before in this sheet, so it marks this scan's answer and nothing earlier.
    await expect(page.getByTestId('lookup-notfound')).toBeVisible();
    // Both were filled a moment ago, so neither can pass until the flapjack has actually gone.
    await expect(page.getByTestId('food-name')).toHaveValue('');
    await expect(page.getByTestId('food-kcal')).toHaveValue('');
    await expect(page.getByTestId('save-food')).toBeDisabled();
    await expect(page.getByTestId('lookup-unavailable')).toBeHidden();
  });

  test('an unknown barcode says "Not in the database" and is not asked about twice', async ({ page, browser, context }) => {
    const hits = await routeOffByCode(page);
    await openNewFoodSheet(page);
    await denyCamera(browser, context, page);

    await enterCode(page, UNKNOWN_CODE);
    await expect(page.getByTestId('lookup-notfound')).toBeVisible({ timeout: DECODE_TIMEOUT });
    await expect(page.getByTestId('lookup-unavailable')).toBeHidden();
    expect(hits.get(UNKNOWN_CODE)).toBe(1);

    // A fresh sheet, so the message below is this lookup's and not the last one's.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByTestId('empty-add-food').click();
    await expect(page.getByTestId('lookup-notfound')).toBeHidden();
    await enterCode(page, UNKNOWN_CODE);
    await expect(page.getByTestId('lookup-notfound')).toBeVisible();
    // The answer above is only rendered once the lookup has returned, so any request it made has
    // already been counted.
    expect(hits.get(UNKNOWN_CODE)).toBe(1);
  });

  test('the Scan button says it is looking up while the answer is on its way', async ({ page, browser, context }) => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    await routeOffByCode(page, hold);
    await openNewFoodSheet(page);
    await denyCamera(browser, context, page);

    await enterCode(page, FIXTURE_CODE);
    // The answer is being held back, so this state cannot have come and gone already.
    await expect(page.getByTestId('scan-barcode')).toHaveText('Looking up…');
    await expect(page.getByTestId('scan-barcode')).toBeDisabled();

    release();
    await expect(page.getByTestId('food-name')).toHaveValue(/Flapjack/);
    await expect(page.getByTestId('scan-barcode')).toHaveText('Scan barcode');
    await expect(page.getByTestId('scan-barcode')).toBeEnabled();
  });
});
