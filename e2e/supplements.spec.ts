import { expect, test, type Page } from '@playwright/test';
import { messageBody, text, toolUse, type FakeReply } from '../src/test/fakeClaude';
import { fresh, readRawIron } from './fresh';

/**
 * The supplement checklist on Home and the coach's offers, on the built app. The ticks and the
 * targets are read back from IndexedDB itself, not from the screen alone. The Anthropic API is
 * never reached: requests to it are answered here with canned Messages API JSON.
 */

const KEY = 'sk-ant-test-0123456789abcdefGHIJKLmnop';

async function settingsRow(page: Page): Promise<Record<string, any>> {
  return ((await readRawIron(page)).tables.settings as Record<string, any>[])[0]!;
}

test('add supplements, tick one, and it is still ticked after a reload', async ({ page }) => {
  await fresh(page);
  const card = page.getByTestId('supplements-card');
  await expect(card).toContainText('Nothing on the list.');
  // Below the training, not the first thing on Home: under the routines and Short session.
  await expect
    .poll(async () => {
      const [c, short] = await Promise.all([card.boundingBox(), page.getByTestId('short-session').boundingBox()]);
      return !!c && !!short && c.y > short.y + short.height;
    })
    .toBe(true);

  await page.getByTestId('supplements-edit').click();
  const sheet = page.getByTestId('supplements-sheet');
  await sheet.getByTestId('supplement-name').fill('Creatine');
  await sheet.getByTestId('supplement-dose').fill('5 g');
  await sheet.getByTestId('supplement-time-any').click();
  await sheet.getByTestId('supplement-add').click();
  await expect(sheet).toContainText('Creatine');
  await sheet.getByTestId('supplement-name').fill('Vitamin D');
  await sheet.getByTestId('supplement-time-morning').click();
  await sheet.getByTestId('supplement-add').click();
  await expect(sheet).toContainText('Vitamin D');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // Morning before any time; the time of day is in each pill's accessible name.
  await expect(card.getByRole('checkbox')).toHaveText([/Vitamin D/, /Creatine.*5 g/]);
  await expect(card.getByRole('checkbox', { name: 'Vitamin D, morning' })).toBeVisible();
  await expect(card.getByRole('checkbox', { name: 'Creatine 5 g, any time' })).toBeVisible();
  await expect(page.getByTestId('supplements-count')).toHaveText(' · 0 of 2');

  const creatine = page.getByTestId('supplement-Creatine');
  await creatine.click();
  await expect(creatine).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('supplements-count')).toHaveText(' · 1 of 2');
  await expect.poll(async () => ((await readRawIron(page)).tables.supplementLogs as unknown[]).length).toBe(1);

  await page.reload();
  await expect(page.getByTestId('supplement-Creatine')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('supplement-Vitamin D')).toHaveAttribute('aria-checked', 'false');

  // The same tap undoes a mis-tap.
  await page.getByTestId('supplement-Creatine').click();
  await expect(page.getByTestId('supplement-Creatine')).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => ((await readRawIron(page)).tables.supplementLogs as unknown[]).length).toBe(0);
});

test('the coach offers targets and a supplement; nothing changes until each is tapped', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('iron.claudeKey', key), KEY);
  await page.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = request.postDataJSON() as Record<string, any>;
    let reply: FakeReply;
    if (String(body.model).includes('haiku')) reply = { content: [text('')] };
    else if ((body.output_config as { format?: unknown } | undefined)?.format) reply = { content: [text('{"review":"A steady week."}')] };
    else {
      const last = (body.messages as { content: unknown }[]).at(-1)!;
      const afterTool = Array.isArray(last.content) && (last.content as { type: string }[]).some((b) => b.type === 'tool_result');
      reply = afterTool
        ? { content: [text('Offered 2,500 kcal and 180 g protein, and creatine. Tap what you want.')] }
        : {
            content: [
              toolUse('toolu_1', 'propose_targets', { calories: 2500, protein: 180 }),
              toolUse('toolu_2', 'suggest_supplement', { name: 'Creatine monohydrate', dose: '5 g', time: 'any', why: 'Well evidenced for strength.' }),
            ],
            stop_reason: 'tool_use',
          };
    }
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(messageBody(reply, String(body.model))) });
  });
  await fresh(page);
  const before = await settingsRow(page);

  await page.getByTestId('coach-fab').click();
  await page.getByTestId('coach-input').fill('bump my calories to 2500 and protein to 180, and should I take creatine?');
  await page.getByTestId('coach-send').click();

  const offer = page.getByTestId('coach-offer');
  await expect(offer.getByTestId('coach-offer-calories')).toHaveText('Use 2,500 kcal');
  await expect(offer.getByTestId('coach-offer-protein')).toHaveText('Use 180 g protein');
  await expect(offer.getByTestId('coach-offer-supplement')).toContainText('Creatine monohydrate 5 g');
  // The tools have run (the offer is on screen) and the stored row is as it was.
  const held = await settingsRow(page);
  expect([held.proteinTarget, held.calorieStart, held.calorieCeiling]).toEqual([before.proteinTarget, before.calorieStart, before.calorieCeiling]);
  expect((await readRawIron(page)).tables.supplements).toEqual([]);

  await offer.getByTestId('coach-offer-protein').click();
  await expect.poll(async () => (await settingsRow(page)).proteinTarget).toBe(180);
  expect((await settingsRow(page)).proteinTargetLegDay).toBe(180 + (before.proteinTargetLegDay - before.proteinTarget));
  await expect(offer.getByTestId('coach-offer-protein')).toHaveCount(0);

  await offer.getByTestId('coach-offer-calories').click();
  await expect.poll(async () => (await settingsRow(page)).calorieCeiling).toBe(2500);
  expect((await settingsRow(page)).calorieStart).toBe(2500);

  await page.getByTestId('coach-offer-add-Creatine monohydrate').click();
  await expect.poll(async () => ((await readRawIron(page)).tables.supplements as { name: string; source: string }[]).map((s) => [s.name, s.source])).toEqual([
    ['Creatine monohydrate', 'coach'],
  ]);
  await expect(page.getByTestId('coach-offer')).toHaveCount(0);

  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('supplement-Creatine monohydrate')).toBeVisible();
});

test('five supplements all show at once on Home, none cut off', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('supplements-edit').click();
  const sheet = page.getByTestId('supplements-sheet');
  for (const [name, dose] of [['Glutathione', '2 caps'], ['Magnesium', '3 caps'], ['Creatine', '5 g'], ['Vitamin D', '1 tab'], ['Omega-3', '2 caps']]) {
    await sheet.getByTestId('supplement-name').fill(name);
    await sheet.getByTestId('supplement-dose').fill(dose);
    await sheet.getByTestId('supplement-add').click();
    await expect(sheet).toContainText(name);
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  const card = page.getByTestId('supplements-card');
  await expect(card.getByRole('checkbox')).toHaveCount(5);
  // Every pill inside the card's box: nothing scrolled off to the side or clipped.
  await expect
    .poll(async () => {
      const c = await card.boundingBox();
      const pills = await Promise.all((await card.getByRole('checkbox').all()).map((p) => p.boundingBox()));
      return !!c && pills.every((p) => !!p && p.x >= c.x && p.x + p.width <= c.x + c.width && p.y + p.height <= c.y + c.height);
    })
    .toBe(true);
});
