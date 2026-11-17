import { expect, test, type Page, type Route } from '@playwright/test';
import { fresh } from './fresh';

/**
 * The diet check (docs/superpowers/specs/2026-11-17-diet-check-design.md) in the built app. The food
 * is logged through the real Add meal screen and the app's own code builds the request; only
 * api.anthropic.com is answered here (no test may call the real API), so what this proves is
 * everything on the phone's side of the call: what is sent, what is drawn from the answer, and that
 * it is kept. What Claude would really say is not something a test can prove.
 */

const FAKE_KEY = 'sk-ant-api03-DIETSPECDIETSPECDIETSPECDIETSPECabcd';

const ANSWER = {
  headline: 'Calories and protein are sorted.',
  detail: 'The points are in veg and fibre.',
  whole_foods: { points: 19, line: 'Mostly plain meat and rice.' },
  fruit_veg: { points: 9, line: '≈ 2 portions a day. Five is the mark.' },
  fibre: { points: 12, line: '≈ 16 g a day against 30 g.' },
  processed_salt: { points: 14, line: 'Processed meat on every logged day.' },
  working: ['Protein at every meal.'],
  add: [{ what: 'Frozen broccoli, 150 g with dinner', why: 'A portion of veg and ≈ 5 g fibre for ≈ 50 kcal.' }],
  cut: [],
  regulars: [
    {
      name: 'Fridge Raiders',
      verdict: 'fine',
      body_fat: 'It will not put fat round your stomach. No single food does.',
      the_catch: 'It is processed meat and salty.',
      better: 'Keep it to 3 or 4 days a week.',
    },
    { name: 'A food never logged', verdict: 'cut', body_fat: 'Not in the diary.', the_catch: '', better: '' },
  ],
};

async function dayKey(page: Page, daysBack: number): Promise<string> {
  return page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, daysBack);
}

async function logSnack(page: Page, date: string): Promise<void> {
  await page.goto(`/food/new?date=${date}`);
  await page.getByTestId('meal-name').fill('Snack');
  await page.getByTestId('empty-add-food').click();
  await page.getByTestId('food-name').fill('Fridge Raiders');
  await page.getByRole('radio', { name: 'Whole portion' }).click();
  await page.getByTestId('food-portion').fill('1 pack');
  await page.getByTestId('food-kcal').fill('110');
  await page.getByTestId('food-protein').fill('13');
  await page.getByTestId('food-carbs').fill('1');
  await page.getByTestId('food-fat').fill('6');
  await page.getByTestId('save-food').click();
  await page.getByTestId('save-meal').click();
  await page.waitForURL(/\/food\/[0-9a-f-]+$/);
}

/** Answer the Messages API with the diet check's JSON, after a pause so the busy state can be seen. */
async function mockClaude(page: Page): Promise<Record<string, any>[]> {
  const requests: Record<string, any>[] = [];
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
    const isDiet = 'whole_foods' in (body?.output_config?.format?.schema?.properties ?? {});
    if (isDiet) {
      requests.push(body);
      await new Promise((r) => setTimeout(r, 600));
    }
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'msg_e2e',
        type: 'message',
        role: 'assistant',
        model: body.model,
        // Anything else that asks (a coach line) gets silence.
        content: [{ type: 'text', text: isDiet ? JSON.stringify(ANSWER) : '' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 7000, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }),
    });
  });
  return requests;
}

test('the diet check: asked on a tap, scored from the answer, a food opened, and kept', async ({ page }) => {
  await fresh(page);
  const requests = await mockClaude(page);
  for (const back of [1, 2]) await logSnack(page, await dayKey(page, back));

  await page.goto('/food');
  await expect(page.getByTestId('diet-check-row')).toContainText('What your food is doing for your goal');
  await page.getByTestId('diet-check-row').click();
  await expect(page).toHaveURL(/\/food\/diet$/);

  // Two logged days is not a diet to read: it says so and asks nobody.
  const run = page.getByTestId('diet-run');
  await run.click();
  await expect(page.getByTestId('diet-error')).toHaveText('Log food on at least 3 days in the last 4 weeks first.');

  // A third day, but no key yet: it says how to fix that, and still asks nobody.
  await logSnack(page, await dayKey(page, 3));
  await page.goto('/food/diet');
  await run.click();
  await expect(page.getByTestId('diet-error')).toHaveText('Add your Claude key in Settings to use the coach.');
  expect(requests).toHaveLength(0);

  await page.evaluate((key) => localStorage.setItem('iron.claudeKey', key), FAKE_KEY);
  await run.click();
  await expect(run).toHaveText('Reading your last 4 weeks…');
  await expect(run).toBeDisabled();

  // The score is the four parts added up: 19 + 9 + 12 + 14.
  await expect(page.getByTestId('diet-score')).toHaveText('54');
  await expect(page.getByTestId('diet-headline')).toHaveText('Calories and protein are sorted.');
  await expect(page.getByTestId('diet-part-fruit_veg')).toHaveText('Fruit and veg9 of 25≈ 2 portions a day. Five is the mark.');
  await expect(page.getByTestId('diet-working')).toHaveText('Protein at every meal.');
  await expect(page.getByTestId('diet-add')).toContainText('Frozen broccoli, 150 g with dinner');
  await expect(page.getByTestId('diet-cut')).toHaveCount(0);
  await expect(run).toHaveText('Check again');

  // One request, to Sonnet, carrying the diary as the app counted it.
  expect(requests).toHaveLength(1);
  expect(requests[0]!.model).toBe('claude-sonnet-5-5');
  const sent = JSON.stringify(requests[0]!.messages);
  expect(sent).toContain('3 of 28 days logged');
  expect(sent).toContain('- Fridge Raiders: 3 times on 3 days · usually 1 pack · each 110 kcal, P 13 C 1 F 6 · 100% of calories');

  // Only the food that is in the diary gets a verdict, with the diary's count, not the coach's.
  const regulars = page.getByTestId('diet-regular');
  await expect(regulars).toHaveCount(1);
  await expect(regulars).toHaveText('Fridge Raiders3 timesFine');
  await regulars.click();
  const food = page.getByTestId('diet-food');
  await expect(food).toContainText('3 times on 3 days in 4 weeks');
  await expect(food).toContainText('For your body fatIt will not put fat round your stomach. No single food does.');
  await expect(food).toContainText('The catchIt is processed meat and salty.');
  await expect(food).toContainText('Better, if you want itKeep it to 3 or 4 days a week.');

  // Ask the coach hands the food over, in the box, not sent.
  await page.getByTestId('diet-ask').click();
  await expect(page.getByTestId('coach-input')).toHaveValue('Tell me more about Fridge Raiders for my goal.');
  await page.keyboard.press('Escape');

  // Kept: a reload asks nothing and shows the same check; Food carries the score.
  await page.reload();
  await expect(page.getByTestId('diet-score')).toHaveText('54');
  await page.goto('/food');
  await expect(page.getByTestId('diet-check-row')).toContainText('54 of 100 ≈ · checked');
  expect(requests).toHaveLength(1);
});
