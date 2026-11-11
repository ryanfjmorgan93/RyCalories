import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { fresh } from './fresh';

/**
 * InBody import through the real file input on Progress: preview, save, the Body card's figures and
 * deltas, a second import of the same file, and the bodyweight log. The two CSVs are synthetic
 * (e2e/fixtures/inbody); the Android share sheet and the camera route cannot be driven from here.
 */

const FULL = join(process.cwd(), 'e2e/fixtures/inbody/inbody-44-column.csv');
const PHONE = join(process.cwd(), 'e2e/fixtures/inbody/inbody-phone.csv');

/** How many rows a table of the app's IndexedDB holds, read raw so it cannot depend on app code. */
async function rowCount(page: Page, store: string): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('iron');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(name).objectStore(name).count();
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    store,
  );
}

async function chooseFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByTestId('inbody-file').setInputFiles(file);
  await expect(page.getByTestId('inbody-preview')).toBeVisible();
}

async function save(page: Page) {
  await page.getByTestId('inbody-save').click();
  await expect(page.getByTestId('inbody-preview')).toHaveCount(0);
}

test.describe('InBody import', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page, 'today-food');
    await page.goto('/progress');
  });

  test('the 44-column file: preview, save, then the latest figures and what moved', async ({ page }) => {
    await expect(page.getByTestId('body-empty')).toHaveText('No InBody scans yet.');
    // Progress passes the card Claude's reader for the printed sheet, so the photo route is offered
    // beside the file one (the photo flow itself is in claude-food.spec.ts).
    await expect(page.getByTestId('inbody-photo')).toHaveText('Photo of the sheet');
    await expect(page.getByTestId('inbody-import')).toHaveText('Import InBody file');

    await chooseFile(page, FULL);
    await expect(page.getByTestId('inbody-summary')).toHaveText('4 scans · 5 May 2026 to 4 Aug 2026');
    const newest = page.getByTestId('inbody-row-2026-08-04');
    await expect(newest).toContainText('4 Aug 2026');
    await expect(newest).toContainText('81.5 kg');
    await expect(newest).toContainText('36.4 kg');
    await expect(newest).toContainText('17.3 %');
    await expect(page.getByTestId('inbody-skipped')).toHaveCount(0);
    await expect(page.getByTestId('inbody-save')).toHaveText('Save 4 scans');

    await save(page);

    await expect(page.getByTestId('body-latest-date')).toHaveText('4 Aug 2026');
    await expect(page.getByTestId('body-latest-skeletal-muscle')).toHaveText('36.4 kg');
    await expect(page.getByTestId('body-latest-body-fat-kg')).toHaveText('14.1 kg');
    await expect(page.getByTestId('body-latest-body-fat-pct')).toHaveText('17.3 %');
    await expect(page.getByTestId('body-latest-weight')).toHaveText('81.5 kg');
    // Against the scan before it (7 Jul), and the one about eight weeks back (2 Jun).
    await expect(page.getByTestId('body-heading-previous')).toHaveText('Since 7 Jul');
    await expect(page.getByTestId('body-heading-eight')).toHaveText('Since 2 Jun');
    await expect(page.getByTestId('body-previous-skeletal-muscle')).toHaveText('+0.4');
    await expect(page.getByTestId('body-eight-skeletal-muscle')).toHaveText('+0.7');
    await expect(page.getByTestId('body-previous-body-fat-kg')).toHaveText('−0.3');
    await expect(page.getByTestId('body-eight-body-fat-kg')).toHaveText('0');
    await expect(page.getByTestId('body-previous-body-fat-pct')).toHaveText('−0.5');
    await expect(page.getByTestId('body-previous-weight')).toHaveText('+0.4');
    await expect(page.getByTestId('body-extras')).toContainText('InBody score');
    await expect(page.getByTestId('body-chart-skeletal-muscle')).toBeVisible();
    await expect(page.getByTestId('body-chart-fat-mass')).toBeVisible();
    expect(await rowCount(page, 'bodyScans')).toBe(4);
  });

  test('more of the scan: lean mass, body water, each limb, body fat over time, and targets from it to use', async ({ page }) => {
    await chooseFile(page, FULL);
    await save(page);
    await expect(page.getByTestId('body-latest-lean-mass')).toHaveText('67.4 kg');
    await expect(page.getByTestId('body-previous-lean-mass')).toHaveText('+0.7');
    await expect(page.getByTestId('body-latest-body-water')).toHaveText('49.1 L');
    await expect(page.getByTestId('body-previous-body-water')).toHaveText('+0.3');
    const limbs = page.getByTestId('body-segments');
    await expect(limbs).toContainText('Right arm3.6 kg0.6 kg');
    await expect(limbs).toContainText('Trunk29.6 kg6.2 kg');
    await expect(page.getByTestId('body-chart-fat-pct')).toBeVisible();

  });

  test('with a goal, the targets come from the scan: worked out with their sums, held, and on Food as bars', async ({ page }) => {
    await chooseFile(page, FULL);
    await save(page);
    await page.goto('/settings');
    await page.getByTestId('goal-recomp').click();
    const basis = page.getByTestId('goal-basis');
    // Seed: 74 kg today and no sessions logged; the file: BMR 1,840 and 67.4 kg lean mass; no steps
    // in a browser. 2,484 + 6,000 × 74 × 0.5/1,330 (167) + 0 lifting = 2,651 → 2,650 kcal; fat 25% =
    // 74 g → 75. No food logged and one weigh-in: the measured figure says what it still needs.
    await expect(basis).toContainText('Maintenance ≈2,651 kcal, estimated: 1,840 resting (your InBody BMR) × 1.35 for everyday living and digestion = 2,484');
    await expect(basis).toContainText('+ 167 for 6,000 steps a day (assumed: steps not read), + 0 for no sessions logged in the last 4 weeks.');
    await expect(basis).toContainText('Calories 2,650: maintenance, for a recomp.');
    await expect(basis).toContainText('Protein 175 g: 2.6 g per kg of lean mass (67.4 kg; 2.6 to 3.5 for a recomp in trained lifters).');
    await expect(basis).toContainText('Fat 75 g: 25% of calories');
    await expect(basis).toContainText('The exact figure is measured: average food eaten − weight change × 7,700 kcal ÷ days');
    await expect(basis).toContainText('Still needs food logged on 22 of the last 27 days (0 so far), and a weigh-in in the first of the 4 weeks.');
    await expect(page.getByTestId('goal-targets')).toContainText('2,650 kcal');

    await page.goto('/food');
    await expect(page.getByTestId('calories-bar')).toContainText('2,650 kcal');
    await expect(page.getByTestId('carbs-bar')).toBeVisible();
    await expect(page.getByTestId('fat-bar')).toContainText('75');
    await page.goto('/');
    await expect(page.getByTestId('today-food')).toContainText('Recomp');
  });

  test('importing the same file again replaces the scans rather than adding to them', async ({ page }) => {
    await chooseFile(page, FULL);
    await save(page);
    await expect(page.getByTestId('body-latest-date')).toHaveText('4 Aug 2026');
    expect(await rowCount(page, 'bodyScans')).toBe(4);
    const weighIns = await rowCount(page, 'bodyweight');

    await chooseFile(page, FULL);
    await expect(page.getByTestId('inbody-replacing')).toHaveText('Already saved for 4 of 4 dates; saving replaces them.');
    await save(page);

    await expect(page.getByTestId('body-latest-date')).toHaveText('4 Aug 2026');
    expect(await rowCount(page, 'bodyScans')).toBe(4);
    // Nor does a second import add bodyweight readings.
    expect(await rowCount(page, 'bodyweight')).toBe(weighIns);
  });

  test('a scan date with no bodyweight reading gets one; a reading the owner logged is kept', async ({ page }) => {
    // The owner's own weigh-in on the day of the 7 July scan, logged on the bodyweight screen.
    await page.goto('/body');
    await page.getByTestId('bw-date').fill('2026-07-07');
    await page.getByTestId('bw-kg').fill('90');
    await page.getByTestId('bw-save').click();
    await expect(page.getByRole('button').filter({ hasText: /7 Jul 2026/ })).toContainText('90');

    await page.goto('/progress');
    await chooseFile(page, FULL);
    await save(page);
    await expect(page.getByTestId('body-latest-date')).toHaveText('4 Aug 2026');

    await page.getByTestId('body-weight-link').click();
    await expect(page).toHaveURL(/\/body$/);
    const fromScan = page.getByRole('button').filter({ hasText: /4 Aug 2026/ });
    await expect(fromScan).toContainText('81.5');
    await expect(fromScan).toContainText('InBody scan');
    const kept = page.getByRole('button').filter({ hasText: /7 Jul 2026/ });
    await expect(kept).toContainText('90');
    await expect(kept).not.toContainText('81.1');
    await expect(kept).not.toContainText('InBody scan');
  });

  test('a short phone-style export with day-first dates says how it read them', async ({ page }) => {
    await chooseFile(page, PHONE);
    await expect(page.getByTestId('inbody-notes')).toContainText('Dates like 04/08/2026 were read day first.');
    await expect(page.getByTestId('inbody-row-2026-08-04')).toContainText('4 Aug 2026');
    await save(page);
    // The phone file carries none of BMR, visceral level, score or ECW, so the extras line is absent.
    await expect(page.getByTestId('body-latest-date')).toHaveText('4 Aug 2026');
    await expect(page.getByTestId('body-latest-skeletal-muscle')).toHaveText('36.4 kg');
    await expect(page.getByTestId('body-extras')).toHaveCount(0);
  });

  test('a file that is not an InBody export shows why, and saves nothing', async ({ page }) => {
    await chooseFile(page, { name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Colour\nA,blue\n') });
    await expect(page.getByTestId('inbody-none')).toHaveText('No scans found in this file.');
    await expect(page.getByTestId('inbody-skipped')).toContainText('First line: Name, Colour');
    await expect(page.getByTestId('inbody-save')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('inbody-preview')).toHaveCount(0);
    await expect(page.getByTestId('body-empty')).toBeVisible();
    expect(await rowCount(page, 'bodyScans')).toBe(0);
  });
});
