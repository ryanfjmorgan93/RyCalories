import { expect, test, type Page } from '@playwright/test';
import { createRawIronDb, IRON_SCHEMA_V3 } from './fresh';

/**
 * The Maintenance card on Progress, against a database seeded as raw IndexedDB and read back through
 * the real app: meals summed by foodRepo, bodyweight rows read by trendWindow, the estimate worked
 * out by src/domain/energy.ts and worded by energyText.ts.
 *
 * The expected figures below are worked out by hand and written down as literals, deliberately NOT
 * computed by importing estimateMaintenance: an expectation derived from the code under test moves
 * with it, so a flipped sign would flip the expected value too and the test would still pass.
 *
 * The window is the 28 days ending today. With offsets counted from its first day (0 to 27):
 *   - Today (offset 27) is not over, so it has only a 400 kcal breakfast, and the estimate reads
 *     intake over the 27 finished days. Of those, 24 have one meal of one item; offsets 6, 7 and 13
 *     have none. The logged days alternate 2,300 and 2,500 kcal, twelve of each, so the mean over
 *     logged days is 2,400. (Counting the blank days as zero would give 2,133; counting today's
 *     breakfast as a day would give 2,320 and a figure of 2,500.)
 *   - weigh-ins at offsets 0, 2, 4 (80.2, 80.0, 79.8: mean 80.0, centre offset 2) and at offsets
 *     23, 25, 27 (79.6, 79.5, 79.4: mean 79.5, centre offset 25). 23 days between the centres.
 *   - -0.5 kg over 23 days is -0.5 * 7700 / 23 = -167.39 kcal a day, so maintenance is
 *     2,400 + 167.39 = 2,567.39, which is 2,550 to the nearest 50.
 *   - at 2,400 against 2,550: (2,400 - 2,550) * 7 / 7,700 = -0.136 kg a week, shown as -0.1.
 */

const WEIGH_INS_FIRST_AND_LAST: [offset: number, kg: number][] = [
  [0, 80.2],
  [2, 80.0],
  [4, 79.8],
  [23, 79.6],
  [25, 79.5],
  [27, 79.4],
];

const FIGURE = '≈ 2,550 kcal a day';
const RATE = 'At your logged 2,400 a day, about −0.1 kg a week';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A YYYY-MM-DD key `n` days on from `key`, by calendar arithmetic that no clock or time zone touches. */
function plusDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "1–5 Sep" within a month, "28 Aug–1 Sep" across two. Written out here rather than imported. */
function span(from: string, to: string): string {
  const [, fm, fd] = from.split('-').map(Number);
  const [, tm, td] = to.split('-').map(Number);
  return fm === tm ? `${fd}–${td} ${MONTHS[tm - 1]}` : `${fd} ${MONTHS[fm - 1]}–${td} ${MONTHS[tm - 1]}`;
}

async function localToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
}

/** Seeds the `iron` database, before the app has ever booted, with the 28 days ending `today`. */
async function seed(page: Page, today: string, opts: { unlogged: number[]; weighIns: [offset: number, kg: number][] }): Promise<string> {
  const from = plusDays(today, -27);
  const now = new Date().toISOString();

  const meals: unknown[] = [];
  const mealItems: unknown[] = [];
  let k = 0;
  for (let offset = 0; offset < 28; offset++) {
    if (opts.unlogged.includes(offset)) continue;
    const date = plusDays(from, offset);
    const kcal = offset === 27 ? 400 : k++ % 2 === 0 ? 2300 : 2500;
    meals.push({ id: `meal-${offset}`, date, loggedAt: `${date}T12:00:00.000Z`, name: 'Lunch', slot: 'lunch' });
    mealItems.push({
      id: `item-${offset}`,
      mealId: `meal-${offset}`,
      index: 0,
      name: 'Dinner plate',
      portion: '1 plate',
      source: 'user',
      nutrition: { basis: 'portion', macros: { kcal, protein: 150, carbs: 250, fat: 70 } },
    });
  }

  await createRawIronDb(page, 30, IRON_SCHEMA_V3, {
    exercises: [],
    routines: [],
    routineExercises: [],
    sessions: [],
    setLogs: [],
    decisions: [],
    bodyweight: opts.weighIns.map(([offset, kg]) => ({ id: `bw-${offset}`, date: plusDays(from, offset), kg })),
    settings: [
      {
        id: 'settings',
        units: 'kg',
        theme: 'dark',
        calorieStart: 1900,
        calorieStep: 200,
        calorieStepDays: 14,
        calorieCeiling: 3000,
        proteinTarget: 170,
        proteinTargetLegDay: 200,
        weeklyGainTargetMin: 0.25,
        weeklyGainTargetMax: 0.5,
        bodyweightTargetMin: 80,
        bodyweightTargetMax: 82,
        restCompoundSec: 150,
        restIsolationSec: 75,
        restCarrySec: 90,
        restVibrate: true,
        restNotify: true,
        productLookup: true,
        seedVersion: 3, // current: the app must not treat this as a fresh install and reseed over it
        barKg: 20,
        plates: [25, 20, 15, 10, 5, 2.5, 1.25],
        deloadPercent: 0.9,
        weeklySessionTarget: 3,
        createdAt: now,
      },
    ],
    meals,
    mealItems,
    foods: [],
    productCache: [],
    phases: [],
    recipes: [],
  });
  return from;
}

/** Opens Progress on a freshly seeded database and waits for the data the seed describes to be on screen. */
async function openProgress(page: Page, unlogged: number[], weighIns: [offset: number, kg: number][]): Promise<string> {
  await page.goto('/icons/icon-192.png'); // a static asset: no app JS runs, so nothing opens `iron` before the seed does
  const today = await localToday(page);
  const from = await seed(page, today, { unlogged, weighIns });
  await page.goto('/progress');
  await expect(page.getByTestId('maintenance-card')).toBeVisible();
  // The Eating card is read from the same seeded meals through the app's own day totals. Its figures
  // are the positive signal that the seed is what these tests think it is.
  await expect(page.getByTestId('days-logged')).toHaveText(`${28 - unlogged.length} of 28`);
  return from;
}

test.describe('Progress: maintenance calories', () => {
  test('shows the figure, the days and weigh-ins it stands on, and the rate at the logged intake', async ({ page }) => {
    const from = await openProgress(page, [6, 7, 13], WEIGH_INS_FIRST_AND_LAST);
    // Eating counts today's breakfast as a logged day: (24 * 2,400 + 400) / 25.
    await expect(page.getByTestId('avg-kcal')).toHaveText('2320 kcal');

    await expect(page.getByTestId('maintenance-kcal')).toHaveText(FIGURE);
    await expect(page.getByTestId('maintenance-basis')).toHaveText(
      `24 of 27 days logged · weigh-ins ${span(plusDays(from, 0), plusDays(from, 4))} (3) and ${span(plusDays(from, 23), plusDays(from, 27))} (3)`,
    );
    // Losing weight on 2,400 means 2,400 is below maintenance: the rate is negative.
    await expect(page.getByTestId('maintenance-rate')).toHaveText(RATE);
    await expect(page.getByTestId('maintenance-gate')).toHaveCount(0);
  });

  test('with no weigh-ins it says so and shows no figure', async ({ page }) => {
    await openProgress(page, [6, 7, 13, 20], []);

    await expect(page.getByTestId('maintenance-gate')).toHaveText('No weigh-ins in the first and last weeks');
    await expect(page.getByTestId('maintenance-kcal')).toHaveCount(0);
    await expect(page.getByTestId('maintenance-basis')).toHaveCount(0);
    await expect(page.getByTestId('maintenance-rate')).toHaveCount(0);
  });

  test('with too few days logged it says how many are needed and how many there are', async ({ page }) => {
    // Ten finished days unlogged leaves 17 of 27; 22 are needed.
    await openProgress(page, [1, 3, 6, 7, 9, 11, 13, 16, 18, 20], WEIGH_INS_FIRST_AND_LAST);

    await expect(page.getByTestId('maintenance-gate')).toHaveText('Needs 22 of 27 days logged (17 of 27)');
    await expect(page.getByTestId('maintenance-kcal')).toHaveCount(0);
  });

  test('over 2 weeks the window is too short to estimate on; back over 4 weeks the figure returns', async ({ page }) => {
    // A reading at offset 15 gives the last fortnight a first-week weigh-in. It sits in neither end
    // of the 28-day window (offsets 0-6 and 21-27), so the 4-week figure is the same as above.
    await openProgress(page, [6, 7, 13], [...WEIGH_INS_FIRST_AND_LAST, [15, 79.8]]);
    await expect(page.getByTestId('maintenance-kcal')).toHaveText(FIGURE);

    await page.getByRole('radio', { name: '2 weeks' }).click();
    // The 14-day window is offsets 14-27. Its week-groups' centres can sit at most 13 days apart, so
    // however the weigh-ins fall it can never meet the 14-day span: it says so rather than "(10)".
    await expect(page.getByTestId('maintenance-gate')).toHaveText('Needs the 4 or 8 week window');
    await expect(page.getByTestId('maintenance-kcal')).toHaveCount(0);

    await page.getByRole('radio', { name: '4 weeks' }).click();
    await expect(page.getByTestId('maintenance-kcal')).toHaveText(FIGURE);
    await expect(page.getByTestId('maintenance-basis')).toContainText('24 of 27 days logged');
    await expect(page.getByTestId('maintenance-gate')).toHaveCount(0);
  });
});
