import { expect, test, type Page, type Route } from '@playwright/test';
import { join } from 'node:path';
import { denyCamera, fresh } from './fresh';

/**
 * Claude doing the typing for food, end to end through the real UI: a photo of a meal, a sentence
 * about one, a photo of a label for a barcode the database does not know, the coach's comment on the
 * Food screen, and a photo of an InBody sheet on Progress.
 *
 * FAKED, at the system boundary: the Anthropic API, via page.route (the tests never reach the real
 * one; the key is a fake one set in localStorage), the Open Food Facts server, and the camera
 * (denied, so a barcode is typed by hand; the photo inputs take a file from the test). Everything
 * else is real: the SDK, IndexedDB, the bundled UK table, food memory, the sheets.
 */

const PHOTO = join(process.cwd(), 'e2e/fixtures/meal-photo.jpg');
const FAKE_KEY = 'sk-ant-api03-E2EKEYE2EKEYE2EKEYE2EKEYabcd';
const OFF_ROUTE = '**/world.openfoodfacts.org/**';
const UNKNOWN_CODE = '5000000009999';

type Kind = 'meal' | 'label' | 'inbody' | 'moment' | 'other';

interface SentRequest {
  kind: Kind;
  body: Record<string, any>;
}

interface Replies {
  meal?: unknown;
  label?: unknown;
  inbody?: unknown;
  /** The one-liner the coach says, for any moment. */
  moment?: string;
  /** Hold every answer back this long, so the busy state can be seen and cancelled. */
  delayMs?: number;
}

function kindOf(body: Record<string, any>): Kind {
  const props = body?.output_config?.format?.schema?.properties ?? {};
  if ('items' in props) return 'meal';
  if ('per100' in props) return 'label';
  if ('weight_kg' in props) return 'inbody';
  if (String(body?.model ?? '').includes('haiku')) return 'moment';
  return 'other';
}

/** Answer the Messages API the way it would: a text block holding the JSON (structured outputs) or the one-liner. */
async function mockClaude(page: Page, replies: Replies): Promise<{ requests: SentRequest[]; of: (kind: Kind) => SentRequest[] }> {
  const requests: SentRequest[] = [];
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, any>;
    const kind = kindOf(body);
    requests.push({ kind, body });
    if (replies.delayMs) await new Promise((r) => setTimeout(r, replies.delayMs));
    const answer = kind === 'moment' ? (replies.moment ?? '') : replies[kind as 'meal' | 'label' | 'inbody'];
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'msg_e2e',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer ?? {}) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }),
    });
  });
  return { requests, of: (kind) => requests.filter((r) => r.kind === kind) };
}

const useKey = (page: Page) => page.evaluate((key) => localStorage.setItem('iron.claudeKey', key), FAKE_KEY);

/** What Claude says it saw on the plate: eggs the UK table knows, and toast it does not. */
const PLATE = {
  items: [
    { name: 'Egg', amount: 2, unit: 'eggs', grams: 100, kcal: 150, protein: 12, carbs: 1, fat: 10, confidence: 'high' },
    { name: 'Sourdough toast', amount: 2, unit: 'slices', grams: 80, kcal: 210, protein: 8, carbs: 40, fat: 1, confidence: 'medium' },
  ],
};

/** A 400 g pack of chicken, as the label shows it. */
const LABEL = {
  name: 'Chicken Breast Fillets',
  brand: 'Tesco',
  per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  pack_grams: 400,
};

async function rawAll<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('iron');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(name).objectStore(name).getAll();
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    store,
  ) as Promise<T[]>;
}

interface RawMeal {
  id: string;
  name: string;
  slot?: string;
  enteredText?: string;
  photoPath?: string;
  confidence?: string;
}
interface RawItem {
  name: string;
  portion: string;
  source: string;
  nutrition: { basis: string; grams?: number };
}

/** Open Add food, pick the slot, and tap Camera, handing the file chooser the test photo. */
async function photoTo(page: Page, slot: string): Promise<void> {
  await page.getByTestId('add-food-button').click();
  await page.getByTestId(`slot-${slot}`).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('add-food-photo').click()]);
  await chooser.setFiles(PHOTO);
}

/** Type a barcode by hand (camera denied) in the open Add food sheet. */
async function scanCode(page: Page, code: string): Promise<void> {
  await page.getByTestId('add-food-scan').click();
  await expect(page.getByText('Camera not available.')).toBeVisible();
  await page.getByTestId('barcode-input').fill(code);
  await page.getByTestId('barcode-submit').click();
}

test.describe('Claude logs food', () => {
  test.beforeEach(async ({ page, browser, context }) => {
    await fresh(page);
    await denyCamera(browser, context, page);
  });

  test('a photo logs the whole meal under the slot, marked as an estimate, and Undo takes it back', async ({ page }) => {
    await useKey(page);
    const claude = await mockClaude(page, { meal: PLATE, delayMs: 400 });
    await page.goto('/food');
    await photoTo(page, 'dinner');

    // The wait is visible, and there is no confirmation step after it.
    await expect(page.getByTestId('reading-sheet')).toBeVisible();
    await expect(page.getByText('Reading your photo…')).toBeVisible();
    await expect(page.getByTestId('logged-bar-text')).toHaveText('Logged 2 items to Dinner · 341 kcal ≈');
    await expect(page.getByTestId('reading-sheet')).toHaveCount(0);

    // The eggs are the UK table's (131 kcal per 100 g, two at 50 g); the toast is Claude's 210.
    await expect(page.getByTestId('calories-bar')).toContainText('341 kcal');
    await expect(page.getByTestId('meal-more-Dinner')).toBeVisible();
    await expect(page.getByText(/^Dinner · .*2 items$/)).toBeVisible();
    await expect(page.getByText('≈ 341 kcal')).toBeVisible();

    const meals = await rawAll<RawMeal>(page, 'meals');
    expect(meals).toHaveLength(1);
    expect(meals[0]).toMatchObject({ name: 'Dinner', slot: 'dinner', enteredText: 'Egg, Sourdough toast', confidence: 'medium' });
    expect(meals[0]!.photoPath).toMatch(/^meals\/.+\.jpg$/);
    const items = (await rawAll<RawItem>(page, 'mealItems')).sort((a, b) => a.name.localeCompare(b.name));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: 'Eggs, chicken, whole, raw', portion: '≈ 2 eggs (100 g)', source: 'table' });
    expect(items[1]).toMatchObject({ name: 'Sourdough toast', portion: '≈ 2 slices (80 g)', source: 'model' });

    // What went to Claude: one scaled JPEG at Sonnet, and the key only in the header.
    expect(claude.of('meal')).toHaveLength(1);
    const sent = claude.of('meal')[0]!.body;
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(sent.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(sent.messages[0].content[0].source.data.length).toBeGreaterThan(100);

    await page.getByTestId('logged-undo').click();
    await expect(page.getByText('Nothing logged today')).toBeVisible();
    await expect(page.getByTestId('logged-bar')).toHaveCount(0);
    expect(await rawAll(page, 'meals')).toHaveLength(0);
    expect(await rawAll(page, 'mealItems')).toHaveLength(0);
  });

  test('Adjust opens the meal, with the estimates marked, to correct an amount in its own units', async ({ page }) => {
    await useKey(page);
    await mockClaude(page, { meal: PLATE });
    await page.goto('/food');
    await photoTo(page, 'lunch');
    await page.getByTestId('logged-adjust').click();

    await expect(page).toHaveURL(/\/food\/[0-9a-f-]+$/);
    await expect(page.getByTestId('meal-total')).toHaveText('≈ 341 kcal');
    await expect(page.getByText('≈ 2 eggs (100 g)')).toBeVisible();
    await expect(page.getByText('≈ 2 slices (80 g)')).toBeVisible();

    // The eggs are the table's, so changing them is an ordinary edit in units: three eggs.
    await page.getByText('Eggs, chicken, whole, raw').click();
    await page.getByTestId('food-grams').fill('150');
    await page.getByTestId('save-food').click();
    await expect(page.getByTestId('meal-total')).toHaveText('≈ 407 kcal');
    // The toast is still Claude's, so the mark stays; the eggs, now the owner's amount, lose theirs.
    await expect(page.getByText('≈ 2 slices (80 g)')).toBeVisible();
    await expect(page.getByText('≈ 2 eggs (100 g)')).toHaveCount(0);
  });

  test('cancelling the read logs nothing and brings the Add food sheet back', async ({ page }) => {
    await useKey(page);
    const claude = await mockClaude(page, { meal: PLATE, delayMs: 1500 });
    await page.goto('/food');
    await photoTo(page, 'snack');
    await expect(page.getByTestId('reading-sheet')).toBeVisible();

    await page.getByTestId('reading-cancel').click();
    await expect(page.getByTestId('reading-sheet')).toHaveCount(0);
    await expect(page.getByTestId('add-food-sheet')).toBeVisible();
    await expect(page.getByTestId('slot-snack')).toHaveAttribute('aria-checked', 'true');

    // The answer arrives anyway, and is ignored.
    await expect.poll(() => claude.of('meal').length).toBe(1);
    await page.waitForTimeout(2000);
    expect(await rawAll(page, 'meals')).toHaveLength(0);
    await expect(page.getByTestId('logged-bar')).toHaveCount(0);
  });

  test('describing a meal logs it the same way, keeping the words', async ({ page }) => {
    await useKey(page);
    const claude = await mockClaude(page, { meal: PLATE });
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-breakfast').click();
    await page.getByTestId('add-food-describe').click();

    await expect(page.getByTestId('describe-sheet')).toBeVisible();
    await expect(page.getByTestId('describe-where')).toContainText('Breakfast');
    await expect(page.getByTestId('describe-log')).toBeDisabled();
    await page.getByTestId('describe-input').fill('two eggs on sourdough toast');
    await page.getByTestId('describe-log').click();

    await expect(page.getByTestId('logged-bar-text')).toHaveText('Logged 2 items to Breakfast · 341 kcal ≈');
    const meals = await rawAll<RawMeal>(page, 'meals');
    expect(meals[0]).toMatchObject({ slot: 'breakfast', enteredText: 'two eggs on sourdough toast' });
    expect(meals[0]!.photoPath).toBeUndefined();
    expect(claude.of('meal')[0]!.body.messages[0].content).toContain('two eggs on sourdough toast');
    expect(claude.of('meal')[0]!.body.messages[0].content).not.toContain('image');
  });

  test('an unknown barcode: snap the label, a whole pack in one tap, and the next scan needs no connection', async ({ page, context }) => {
    await useKey(page);
    let offRequests = 0;
    await page.route(OFF_ROUTE, async (route) => {
      offRequests += 1;
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 0, status_verbose: 'product not found' }) });
    });
    const claude = await mockClaude(page, { label: LABEL });
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-dinner').click();
    await scanCode(page, UNKNOWN_CODE);
    await expect(page.getByTestId('barcode-line')).toHaveText('Not in the database.');

    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('snap-label').click()]);
    await chooser.setFiles(PHOTO);

    // Straight on to the amount step, on the slot already chosen, with the pack the label gave.
    await expect(page.getByTestId('amount-name')).toHaveText('Tesco Chicken Breast Fillets');
    const whole = page.getByTestId('amount-pack-1');
    await expect(whole).toContainText('Whole pack (400 g)');
    await expect(whole).toContainText('660 kcal');
    await expect(page.getByTestId('amount-pack-0.5')).toContainText('Half');
    await expect(page.getByTestId('amount-some')).toBeVisible();
    expect(claude.of('label')).toHaveLength(1);
    expect(claude.of('label')[0]!.body.model).toBe('claude-sonnet-5-5');

    await whole.click();
    await expect(page.getByTestId('calories-bar')).toContainText('660 kcal');
    await expect(page.getByTestId('meal-more-Dinner')).toBeVisible();
    const items = await rawAll<RawItem>(page, 'mealItems');
    expect(items[0]).toMatchObject({ name: 'Tesco Chicken Breast Fillets', portion: '1 pack (400 g)', source: 'label' });

    // The next scan of the same pack: nothing is asked of the database or of Claude, and there is no signal.
    const askedBefore = offRequests;
    await context.setOffline(true);
    await page.getByTestId('add-food-button').click();
    await scanCode(page, UNKNOWN_CODE);
    await expect(page.getByTestId('amount-name')).toHaveText('Tesco Chicken Breast Fillets');
    await expect(page.getByTestId('amount-pack-1')).toContainText('Whole pack (400 g)');
    expect(offRequests).toBe(askedBefore);
    expect(claude.of('label')).toHaveLength(1);
    await context.setOffline(false);
  });

  test('a label that cannot be read says so and comes back to the sheet', async ({ page }) => {
    await useKey(page);
    await page.route(OFF_ROUTE, (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 0, status_verbose: 'product not found' }) }),
    );
    await mockClaude(page, { label: { name: 'Blurry', per100: { kcal: 5000, protein: 1, carbs: 1, fat: 1 } } });
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await scanCode(page, UNKNOWN_CODE);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('snap-label').click()]);
    await chooser.setFiles(PHOTO);

    await expect(page.getByTestId('toast')).toContainText("I couldn't read the numbers on that label. Try a clearer photo.");
    await expect(page.getByTestId('add-food-sheet')).toBeVisible();
  });
});

test.describe('without Claude', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page);
  });

  test('with no key the photo button explains, with a way to Settings, instead of opening a camera', async ({ page }) => {
    const claude = await mockClaude(page, { meal: PLATE });
    let chooserOpened = false;
    page.on('filechooser', () => (chooserOpened = true));
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('add-food-photo').click();

    await expect(page.getByTestId('toast')).toContainText('Add your Claude key in Settings to log from a photo.');
    // The sheet stays, so searching or scanning instead is right there.
    await expect(page.getByTestId('add-food-sheet')).toBeVisible();
    await page.getByTestId('add-food-describe').click();
    await expect(page.getByTestId('toast')).toContainText('Add your Claude key in Settings to log by describing it.');
    expect(chooserOpened).toBe(false);
    expect(claude.requests).toHaveLength(0);

    await page.getByTestId('toast-action').click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('with no signal it says photos need signal, and sends nothing', async ({ page, context }) => {
    await useKey(page);
    const claude = await mockClaude(page, { meal: PLATE });
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await context.setOffline(true);
    await page.getByTestId('add-food-photo').click();

    await expect(page.getByTestId('toast')).toContainText('Photos need signal. Search or scan instead.');
    await expect(page.getByTestId('add-food-sheet')).toBeVisible();
    expect(claude.requests).toHaveLength(0);
    await context.setOffline(false);
  });

  test('logging by hand still works with no key at all', async ({ page }) => {
    await page.goto('/food');
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-lunch').click();
    await page.getByTestId('add-food-search').fill('egg');
    await page.getByTestId('result-Eggs, chicken, whole, raw').click();
    await page.getByTestId('amount-egg-2').click();
    await expect(page.getByTestId('calories-bar')).toContainText('131 kcal');
    // An exact amount of a table food is not marked as an estimate.
    await expect(page.getByText('≈ 131 kcal')).toHaveCount(0);
  });
});

test.describe('the coach on the Food screen', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page);
    await useKey(page);
  });

  /** One egg, from the search: a meal logged without Claude's help. */
  async function logAnEgg(page: Page): Promise<void> {
    await page.getByTestId('add-food-button').click();
    await page.getByTestId('slot-dinner').click();
    await page.getByTestId('add-food-search').fill('egg');
    await page.getByTestId('result-Eggs, chicken, whole, raw').click();
    await page.getByTestId('amount-egg-2').click();
    await expect(page.getByTestId('calories-bar')).toContainText('131 kcal');
  }

  test('a meal logged any way gets a comment under the summary, from the meal and the day so far', async ({ page }) => {
    const claude = await mockClaude(page, { moment: 'Two eggs is a good start. Add a green next time to round out the plate.' });
    await page.goto('/food');
    await logAnEgg(page);

    // The comment waits out the Undo window, then arrives.
    await expect(page.getByTestId('coach-line-meal')).toHaveText('Two eggs is a good start. Add a green next time to round out the plate.', { timeout: 25_000 });
    expect(claude.of('moment')).toHaveLength(1);
    const asked = claude.of('moment')[0]!.body;
    expect(asked.model).toBe('claude-haiku-5-5');
    const prompt = String(asked.messages[0].content);
    expect(prompt).toContain('just logged a meal');
    expect(prompt).toContain('Eggs, chicken, whole, raw: 2 eggs (100 g), 131 kcal');
    expect(prompt).toContain('meal kcal: 131');
    expect(prompt).toContain('day so far kcal: 131');
    // It sits between the summary and the week strip.
    const summary = await page.getByTestId('calories-bar').boundingBox();
    const line = await page.getByTestId('coach-line-meal').boundingBox();
    const strip = await page.getByTestId('week-strip').boundingBox();
    expect(line!.y).toBeGreaterThan(summary!.y);
    expect(line!.y).toBeLessThan(strip!.y);
  });

  test('food taken back out inside the window gets no comment, and the coach is not even asked', async ({ page }) => {
    const claude = await mockClaude(page, { moment: 'Nice.' });
    await page.goto('/food');
    await logAnEgg(page);
    await page.getByTestId('toast-action').click();
    await expect(page.getByText('Nothing logged today')).toBeVisible();

    await page.waitForTimeout(10_000);
    await expect(page.getByTestId('coach-line-meal')).toHaveCount(0);
    expect(claude.of('moment')).toHaveLength(0);
  });

  test('a silent coach leaves no gap', async ({ page }) => {
    const claude = await mockClaude(page, { moment: '' });
    await page.goto('/food');
    await logAnEgg(page);
    await expect.poll(() => claude.of('moment').length, { timeout: 25_000 }).toBe(1);
    await expect(page.getByTestId('coach-line-meal')).toHaveCount(0);
  });

  test('late in the evening, with food logged, the coach comments on the day; earlier it does not', async ({ page }) => {
    const claude = await mockClaude(page, { moment: 'Protein is short today. Greek yoghurt before bed would help.' });
    await page.goto('/food');
    await logAnEgg(page);
    // Nothing from the meal moment: start afresh, as a later visit to the screen.
    const eight = new Date();
    eight.setHours(14, 0, 0, 0);
    await page.reload();
    await page.clock.setFixedTime(eight);
    await page.goto('/food');
    await expect(page.getByTestId('calories-bar')).toContainText('131 kcal');
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('coach-line-day')).toHaveCount(0);
    expect(claude.of('moment')).toHaveLength(0);

    const evening = new Date();
    evening.setHours(20, 30, 0, 0);
    await page.clock.setFixedTime(evening);
    await page.reload();
    await expect(page.getByTestId('coach-line-day')).toHaveText('Protein is short today. Greek yoghurt before bed would help.');
    const prompt = String(claude.of('moment')[0]!.body.messages[0].content);
    expect(prompt).toContain('The day is nearly over');
    expect(prompt).toContain('eaten kcal: 131');
    expect(prompt).toContain('dinner: 131 kcal (Eggs, chicken, whole, raw)');
  });
});

test.describe('a photo of an InBody sheet', () => {
  const SHEET = {
    date: '2026-09-30',
    weight_kg: 81.5,
    skeletal_muscle_kg: 36.4,
    body_fat_kg: 14.1,
    body_fat_pct: 17.3,
    bmr_kcal: 1850,
    inbody_score: 82,
  };

  test.beforeEach(async ({ page }) => {
    await fresh(page, 'today-food');
  });

  test('is read into one scan, shown for the owner to confirm, and kept on Save', async ({ page }) => {
    await useKey(page);
    const claude = await mockClaude(page, { inbody: SHEET, delayMs: 200 });
    await page.goto('/progress');
    await expect(page.getByTestId('inbody-photo')).toHaveText('Photo of the sheet');

    await page.getByTestId('inbody-photo-file').setInputFiles(PHOTO);
    await expect(page.getByTestId('inbody-preview')).toBeVisible();
    await expect(page.getByTestId('inbody-summary')).toHaveText(/^1 scan · 30 Sept? 2026$/);
    const row = page.getByTestId('inbody-row-2026-09-30');
    await expect(row).toContainText('81.5 kg');
    await expect(row).toContainText('36.4 kg');
    await expect(row).toContainText('17.3 %');
    // Nothing is kept until the owner says so.
    expect(await rawAll(page, 'bodyScans')).toHaveLength(0);
    expect(claude.of('inbody')).toHaveLength(1);

    await page.getByTestId('inbody-save').click();
    await expect(page.getByTestId('inbody-preview')).toHaveCount(0);
    await expect(page.getByTestId('body-latest-date')).toHaveText(/^30 Sept? 2026$/);
    await expect(page.getByTestId('body-latest-skeletal-muscle')).toHaveText('36.4 kg');
    const scans = await rawAll<{ date: string; source: string; weightKg: number }>(page, 'bodyScans');
    expect(scans).toHaveLength(1);
    expect(scans[0]).toMatchObject({ date: '2026-09-30', source: 'photo', weightKg: 81.5 });
  });

  test('a sheet with no date is dated today, and says so', async ({ page }) => {
    await useKey(page);
    await mockClaude(page, { inbody: { weight_kg: 80.2, skeletal_muscle_kg: 36 } });
    await page.goto('/progress');
    await page.getByTestId('inbody-photo-file').setInputFiles(PHOTO);
    await expect(page.getByTestId('inbody-notes')).toContainText("The sheet shows no date, so today's date is used.");
  });

  test('with no key it says how to fix it, not just that it failed', async ({ page }) => {
    const claude = await mockClaude(page, { inbody: SHEET });
    await page.goto('/progress');
    await page.getByTestId('inbody-photo-file').setInputFiles(PHOTO);
    await expect(page.getByTestId('toast')).toContainText('Add your Claude key in Settings to read a photo of the sheet.');
    await expect(page.getByTestId('inbody-preview')).toHaveCount(0);
    expect(claude.requests).toHaveLength(0);
  });
});
