import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { fresh } from './fresh';
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

/**
 * Actually deny the camera, rather than merely un-granting it: `context.clearPermissions()`
 * leaves a site's camera permission in the "ask" state, which under browser automation (nothing
 * can answer a real prompt) leaves getUserMedia's promise pending forever rather than rejecting
 * it — so the fake camera would still end up live, racing the manual path exactly as before.
 * `Browser.setPermission` with `denied`, scoped to this test's own browser context, is the one
 * thing that makes getUserMedia reject outright, the same as it would for a user who has actually
 * blocked the camera for this site.
 */
async function denyCamera(browser: Browser, context: BrowserContext, page: Page): Promise<void> {
  const pageSession = await context.newCDPSession(page);
  const { targetInfo } = await pageSession.send('Target.getTargetInfo');

  const browserSession = await browser.newBrowserCDPSession();
  await browserSession.send('Browser.setPermission', {
    permission: { name: 'camera' },
    setting: 'denied',
    origin: new URL(page.url()).origin,
    browserContextId: targetInfo.browserContextId,
  });
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
});
