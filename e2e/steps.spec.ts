import { expect, test, type Page } from '@playwright/test';
import { fresh, readRawIron } from './fresh';

/**
 * The steps strip on Home, on the built app. A browser has no Health Connect, so this is the
 * "not here" state and the goal, read back from IndexedDB. Reading real steps happens only on the
 * phone: src/platform/health.test.ts and src/state/steps.test.ts cover the reading with the plugin
 * faked, and nothing here can prove the phone answers.
 */

async function settingsRow(page: Page): Promise<Record<string, any>> {
  return ((await readRawIron(page)).tables.settings as Record<string, any>[])[0]!;
}

test('the steps strip sits on the cover routine, says where steps come from, and keeps the goal', async ({ page }) => {
  await fresh(page);
  const strip = page.getByTestId('routines-list').getByTestId('steps-strip');
  // Starts as loading; only the finished check says unavailable.
  await expect(strip).toHaveAttribute('data-access', 'unavailable');
  await expect(strip.getByTestId('steps-today')).toHaveText('Not available here');

  await strip.click();
  const sheet = page.getByTestId('steps-sheet');
  await expect(sheet.getByTestId('steps-unavailable')).toHaveText('Steps come from Health Connect, on the phone.');
  await expect(sheet.getByTestId('steps-week')).toHaveCount(0);
  await expect(sheet.getByTestId('step-goal')).toHaveValue('8000');
  expect((await settingsRow(page)).stepGoal).toBeUndefined();

  await sheet.getByTestId('step-goal').fill('10250');
  await expect.poll(async () => (await settingsRow(page)).stepGoal).toBe(10250);

  await page.reload();
  await page.getByTestId('routines-list').getByTestId('steps-strip').click();
  await expect(page.getByTestId('steps-sheet').getByTestId('step-goal')).toHaveValue('10250');
});
