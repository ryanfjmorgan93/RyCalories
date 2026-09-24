import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { clickIfPresent, fresh } from './fresh';
import { FIXTURE_CODE } from './fixtures/ean13';

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

/**
 * Actually deny the camera, rather than merely un-granting it (see barcode.spec.ts, whose
 * `denyCamera` this mirrors): under automation nothing can answer a real permission prompt, so a
 * merely-ungranted permission leaves getUserMedia pending forever instead of rejecting it. This
 * app project runs with no fake video device at all, so an explicit denial is the only reliable
 * way to land the barcode sheet in its manual-entry state on the first try, every time.
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

/**
 * `animations: 'disabled'` is not a nicety. A sheet slides up over 180ms (`.sheet-in`), and
 * `toBeVisible()` resolves while it is still part-way through — so a shot taken right after it
 * caught the sheet mid-slide, with its lower content hanging off the bottom of the frame. That
 * read exactly like a layout bug and sent me trimming a diagram that was never too big. Playwright
 * finishes and freezes CSS animations for the capture, so the shot is of the settled screen.
 */
async function shot(page: Page, name: string, opts: { full?: boolean } = {}) {
  n += 1;
  const full = opts.full ?? false;
  const handle = full ? await page.addStyleTag({ content: PIN_NAV }) : null;
  await page.screenshot({
    path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png`,
    fullPage: full,
    animations: 'disabled',
  });
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

async function logSets(page: Page, exercise: string, weight: number, reps: number[]) {
  const card = page.getByTestId(`exercise-card-${exercise}`);
  await expect(card).toBeVisible();
  for (const r of reps) {
    await card.getByTestId('weight-input').fill(String(weight));
    await card.getByTestId('reps-input').fill(String(r));
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
  }
}

async function finishToSummary(page: Page) {
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
}

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

test('capture every screen for a design session', async ({ page, browser, context }) => {
  test.setTimeout(420_000);
  await fresh(page);

  // ---- Seed -------------------------------------------------------------------------------
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Saved')).toBeVisible();

  // Real training history, so History and the exercise charts have something in them.
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles(HEVY_CSV);
  await expect(page.getByRole('dialog')).toContainText('21 sessions');
  await page.getByRole('button', { name: /Import 21 sessions/ }).click();
  await page.getByTestId('hevy-result-continue').click(); // result step: "Continue" into the reconcile step
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.goto('/settings');
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles(HEVY_MEASUREMENTS);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByTestId('hevy-result-continue').click(); // result step: "Done"
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
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await expect(page.getByTestId('decision-line').first()).toBeVisible();
  // The hero figures count up in script, which animations: 'disabled' does not freeze.
  await expect(page.getByTestId('summary-hero')).toHaveAttribute('data-settled', 'true');
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

  // 15 Exercise detail — demo, e1RM chart mode and the records card
  await page.getByRole('button', { name: /Romanian Deadlift/ }).first().click();
  await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]+$/);
  await page.getByTestId('chart-mode').getByRole('radio', { name: 'e1RM' }).click();
  await expect(page.getByTestId('chart-mode').getByRole('radio', { name: 'e1RM' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('exercise-records')).toBeVisible();
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

  // ---- Superset, warm-up pills, plates, PRs (Upper (Push): Bench Press + Incline DB Press) -----

  // There is no UI yet to link a superset (routine editor's own toggle is exercised in
  // overload.spec.ts) — linked directly in IndexedDB, the same shape `toggleSupersetWithNext`
  // writes, exactly as overload.spec.ts does.
  await page.evaluate(async () => {
    const req = indexedDB.open('iron');
    const idb = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = idb.transaction('routineExercises', 'readwrite');
    const store = tx.objectStore('routineExercises');
    const ids = ['06e6d774-dded-5317-a459-3c24a575f9a5', '23809c40-32bd-5fe4-8f71-eb2efdb47cc6'];
    for (const id of ids) {
      const row = await new Promise<{ supersetId?: string }>((res) => {
        const r = store.get(id);
        r.onsuccess = () => res(r.result);
      });
      store.put({ ...row, id, supersetId: 'superset-test-1' });
    }
    await new Promise((res) => {
      tx.oncomplete = () => res(undefined);
    });
  });

  // 21 Routine editor showing a superset
  await page.goto('/routines/144fdfb0-e94c-5661-a373-bf8085237abf');
  await expect(page.getByTestId('superset-Bench Press (Barbell)')).toContainText('Remove superset');
  await shot(page, 'routine-edit-superset', { full: true });

  // 22 Live session: superset bracket, warm-up pills and the plate line on a barbell lift —
  // captured before any set is logged, since the pills only show while nothing is counted yet.
  await page.getByTestId('start-routine').click();
  await expect(page).toHaveURL(/\/session\//);
  await expect(page.getByText('Superset', { exact: true })).toBeVisible();
  const benchCard = page.getByTestId('exercise-card-Bench Press (Barbell)');
  await expect(benchCard).toBeVisible();
  await expect(benchCard.getByTestId('warmup-row-0')).toBeVisible();
  await expect(benchCard.getByTestId('plate-line')).toBeVisible();
  await shot(page, 'session-live-superset', { full: true });

  // 23 Plate sheet open — Bench Press's prescribed 65 kg (bar 20 kg + 20 kg and 2.5 kg per side)
  // is a genuine multi-plate load, so the shot shows the loaded-bar diagram with more than one
  // plate on it, not just the bar.
  await benchCard.getByTestId('plate-line').click();
  await expect(page.getByText('Plates', { exact: true })).toBeVisible();
  const plateSheet = page.getByRole('dialog');
  await expect(plateSheet.getByTestId('plate-diagram')).toBeVisible();
  await expect(plateSheet.getByTestId('plate-block')).toHaveCount(2);
  await shot(page, 'plate-sheet');
  await page.keyboard.press('Escape');

  // 24 The "More" sheet's How to, with the demo image visible
  await benchCard.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'How to' }).click();
  await expect(page.getByRole('img', { name: 'Bench Press (Barbell)' })).toBeVisible();
  await shot(page, 'session-how-to');
  await page.keyboard.press('Escape');

  // Log a clear PR on Bench Press (its all-time best in the seeded history is 75 kg) — Bench is
  // the first member of the superset group, so logging on it alone never starts the rest timer
  // (that only happens once the last member, Incline DB Press, gets a set).
  for (let i = 0; i < 4; i++) {
    await benchCard.getByTestId('weight-input').fill('90');
    await benchCard.getByTestId('reps-input').fill('8');
    await benchCard.getByTestId('set-done').click();
  }

  // 25 Summary with a PR chip
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await expect(page.getByTestId('decision-Bench Press (Barbell)')).toContainText('PR');
  await expect(page.getByTestId('summary-hero')).toHaveAttribute('data-settled', 'true');
  await shot(page, 'session-summary-pr', { full: true });
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);

  // 26 Finished session detail with PR chips and "Save as routine"
  await page.goto('/history');
  await page.getByRole('button', { name: /^Upper \(Push\)/ }).first().click();
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);
  await expect(page.getByTestId('pr-chip').first()).toBeVisible();
  await expect(page.getByTestId('save-as-routine')).toBeVisible();
  await shot(page, 'session-detail-pr', { full: true });

  // A second, minimal Lower (Hinge) session — not captured — purely so "Next up" cycles back
  // round to Upper (Push), which now carries a real in-app decision for Bench Press: the plan
  // card's "reason" and "Last time" line only ever come from a decision made in-app, never from
  // raw history, so this is the only way to see them on the currently-suggested routine.
  await page.goto('/');
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
  await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8]);
  await finishToSummary(page);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);

  // 27 Home with the plan card populated: "Last time", a reason, and the streak line
  await expect(page.getByTestId('next-up')).toContainText('Upper (Push)');
  const planItem = page.getByTestId('plan-item-Bench Press (Barbell)');
  await expect(planItem).toContainText(/up .* kg last time/i);
  await expect(planItem).toContainText(/Last time/);
  await expect(page.getByTestId('streak-line')).toBeVisible();
  await shot(page, 'home-plan', { full: true });

  // 28 Exercise editor — the diagram picker open
  await page.goto('/exercises');
  await page.getByTestId('exercise-search').fill('Bench Press');
  await page.getByRole('button', { name: /Bench Press/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Bench Press (Barbell)' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]+\/edit$/);
  await page.getByTestId('pick-diagram').click();
  await page.getByTestId('diagram-search').fill('press');
  await expect(page.locator('[data-testid^="diagram-"]').first()).toBeVisible();
  await shot(page, 'exercise-editor-diagram');
  await page.keyboard.press('Escape');

  // 29 The library picker's "From library" search open
  await page.goto('/routines/144fdfb0-e94c-5661-a373-bf8085237abf');
  await page.getByTestId('add-exercise').click();
  await page.getByTestId('from-library').click();
  await expect(page.getByTestId('library-search')).toBeVisible();
  await page.getByTestId('library-search').fill('curl');
  await expect(page.locator('[data-testid^="library-"]').first()).toBeVisible();
  await shot(page, 'library-picker');

  // 30 Settings scrolled to Plates / Progression / Assistant / About — the four sections together
  // run well over one phone screen, so the viewport is grown for this one capture (a design
  // reference, not a device-accurate shot) rather than showing only one or two of them.
  await page.goto('/settings');
  await expect(page.getByTestId('plates-card')).toBeVisible();
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: originalViewport!.width, height: 2000 });
  const platesTitle = page.getByRole('heading', { name: 'Plates', level: 2 });
  await platesTitle.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 30 }));
  await expect(page.getByText('About', { exact: true })).toBeInViewport();
  await shot(page, 'settings-scrolled');
  if (originalViewport) await page.setViewportSize(originalViewport);

  // 31 Food sheet with the barcode scanner open, in its manual-entry state (app project — no
  // fake camera device; the camera project's own coverage is barcode.spec.ts).
  await denyCamera(browser, context, page);
  await page.goto('/food/new');
  await page.getByTestId('meal-name').fill('Snack');
  await page.getByTestId('empty-add-food').click();
  await page.getByTestId('scan-barcode').click();
  await expect(page.getByText('Camera not available.')).toBeVisible();
  await page.getByTestId('barcode-input').fill(FIXTURE_CODE);
  await shot(page, 'food-barcode-manual');
  await page.keyboard.press('Escape');

  // 32 Assistant box open with a fake reply
  await page.addInitScript(
    (cfg: { state: string; detail: string; reply: string }) => {
      (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
        status: { state: cfg.state, detail: cfg.detail },
        generate: async () => ({ text: cfg.reply }),
      };
    },
    { state: 'ready', detail: 'fake', reply: 'Romanian Deadlift (Barbell): 110 kg × 8 last time.' },
  );
  await page.goto('/exercises');
  await page.getByTestId('exercise-search').fill('Romanian Deadlift');
  await page.getByRole('button', { name: /Romanian Deadlift/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Romanian Deadlift (Barbell)' })).toBeVisible();
  await page.getByTestId('ask-assistant').click();
  await expect(page.getByText('Romanian Deadlift (Barbell)', { exact: true }).last()).toBeVisible();
  await page.getByTestId('assistant-input').fill('What did I lift last time?');
  await page.getByTestId('assistant-send').click();
  await expect(page.getByText('Romanian Deadlift (Barbell): 110 kg × 8 last time.')).toBeVisible();
  await shot(page, 'assistant-reply');
  await page.keyboard.press('Escape');

  // 33/34 Progress — body map in "Sets this week" and "Last trained" modes
  await page.goto('/progress');
  await expect(page.getByTestId('calendar-heatmap')).toBeVisible();
  const hamstrings = page.locator('[data-muscle="hamstrings"]').first();
  const hsBox = await hamstrings.boundingBox();
  if (!hsBox) throw new Error('hamstrings region not found');
  await hamstrings.click({ position: { x: hsBox.width * 0.2, y: hsBox.height * 0.5 } });
  await expect(page.getByTestId('body-map-readout')).toContainText('hamstrings');
  await expect(page.getByTestId('body-map-readout')).toContainText('sets this week');
  await shot(page, 'progress-body-map-sets', { full: true });

  await page.getByRole('radio', { name: 'Last trained' }).click();
  await hamstrings.click({ position: { x: hsBox.width * 0.2, y: hsBox.height * 0.5 } });
  await expect(page.getByTestId('body-map-readout')).toContainText('hamstrings');
  await shot(page, 'progress-body-map-recency', { full: true });

  // ---- Cooked meals: a recipe built from typed text, one ingredient at a time -----------------

  // 35 Recipe builder — the question card
  await page.goto('/food/recipes/new');
  await page.getByTestId('recipe-type-it').click();
  await page.getByTestId('recipe-typed-text').fill('3 eggs, 30g cheddar, 2 rashers bacon');
  await page.getByTestId('recipe-use-typed').click();
  await expect(page.getByTestId('question-name')).toHaveText('Eggs');
  await shot(page, 'recipe-question-card');

  // 36 Recipe builder — review + share, once every ingredient has an amount
  await page.getByTestId('question-next').click(); // Eggs → Cheddar
  await page.getByTestId('question-next').click(); // Cheddar → Bacon
  await page.getByTestId('question-next').click(); // Bacon (last) → review
  await page.getByTestId('recipe-name').fill('Omelette');
  await expect(page.getByTestId('review-total-kcal')).toBeVisible();
  await shot(page, 'recipe-review-share', { full: true });

  // 37 Recipes list
  await page.getByTestId('recipe-save').click();
  await page.waitForURL(/\/food\/recipes$/);
  await expect(page.getByTestId('recipe-row-Omelette')).toBeVisible();
  await shot(page, 'recipes-list');
});
