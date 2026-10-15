import { expect, test } from '@playwright/test';
import { messageBody, text, toolUse, type FakeReply } from '../src/test/fakeClaude';
import { fresh, readRawIron } from './fresh';

/**
 * Problem reports on the built app: the coach files one with report_problem (the Anthropic API is
 * never reached; its replies are canned here), Settings lists it, Copy puts the text on the
 * clipboard, and Clear empties the list. Uncaught errors are captured in the APK only, so a
 * browser cannot show that half: src/platform/errorReports.test.ts covers it.
 */

const KEY = 'sk-ant-test-0123456789abcdefGHIJKLmnop';

test('the coach files a report; Settings lists it, copies it without the key, and clears it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
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
    if (body.thinking?.type === 'between_tools') reply = { content: [text('')] };
    else if ((body.output_config as { format?: unknown } | undefined)?.format) reply = { content: [text('{"review":"A steady week."}')] };
    else {
      const last = (body.messages as { content: unknown }[]).at(-1)!;
      const afterTool = Array.isArray(last.content) && (last.content as { type: string }[]).some((b) => b.type === 'tool_result');
      reply = afterTool
        ? { content: [text("Logged it. Share it from Settings → Problem reports.")] }
        : {
            content: [
              toolUse('toolu_1', 'report_problem', {
                summary: 'Routine builder gave barbell squats for an easy day',
                detail: `Asked for a CBA routine; the draft was Barbell Back Squat 4x6-8. key ${KEY}`,
              }),
            ],
            stop_reason: 'tool_use',
          };
    }
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(messageBody(reply, String(body.model))) });
  });
  await fresh(page);

  await page.getByTestId('coach-fab').click();
  await page.getByTestId('coach-input').fill('the builder is broken, it keeps giving me heavy lifts');
  await page.getByTestId('coach-send').click();
  await expect(page.getByText('Logged it. Share it from Settings → Problem reports.')).toBeVisible();

  const stored = (await readRawIron(page)).tables.problemReports as { source: string; summary: string; detail: string }[];
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ source: 'coach', summary: 'Routine builder gave barbell squats for an easy day' });
  expect(JSON.stringify(stored)).not.toContain(KEY);

  await page.goto('/settings');
  const card = page.getByTestId('problem-reports');
  await expect(card.getByTestId('problem-count')).toHaveText('1 on this phone');
  await expect(card.getByTestId('problem-row')).toContainText('Routine builder gave barbell squats for an easy day');
  await expect(card.getByTestId('problem-row')).toContainText('Coach');

  await card.getByTestId('problem-share').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Routine builder gave barbell squats for an easy day');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^Iron problem reports · Iron /);
  expect(copied).toContain('Asked for a CBA routine');
  expect(copied).not.toContain(KEY);

  await card.getByTestId('problem-clear').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(card.getByTestId('problem-count')).toHaveText('None recorded.');
  await expect.poll(async () => ((await readRawIron(page)).tables.problemReports as unknown[]).length).toBe(0);
});

test('Health Connect weight says where it lives in a browser, and a reading read from it is marked', async ({ page }) => {
  await fresh(page);
  await page.goto('/settings');
  const card = page.getByTestId('health-connect');
  await expect(card).toContainText('Weight into the bodyweight log');
  await expect(card).toContainText('Health Connect is on the phone.');
  await expect(card.getByTestId('health-weight')).toHaveAttribute('aria-checked', 'false');

  // A reading the phone read in, written as the import writes it, then shown where weights are shown.
  await page.evaluate(async () => {
    const idb = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open('iron');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = idb.transaction('bodyweight', 'readwrite');
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    tx.objectStore('bodyweight').put({ id: 'hc-1', date: day, kg: 74.3, source: 'health-connect' });
    await new Promise((res) => (tx.oncomplete = () => res(undefined)));
    idb.close();
  });
  // A raw write is not seen by the live queries: reload to read it back.
  await page.goto('/body');
  await expect(page.getByText('From Health Connect')).toBeVisible();
});
