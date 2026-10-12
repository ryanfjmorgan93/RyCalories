import { expect, test, type Locator, type Page } from '@playwright/test';
import { fresh } from './fresh';

/**
 * The Short session sheet's "Not read" line (src/ui/QuickSessionSheet.tsx): the words of the typed
 * request that the rules could not read, said as a fact and with no button beside it. The rules'
 * reading stands as typed; there is no model to ask about the rest.
 *
 * Every wait is on a signal only its event produces: a chip's `aria-pressed` or presence, the line's
 * text. An absence is asserted only after the thing that would have ended it.
 */

const TYPED = 'four light exercises for my fancy bits';
const RESIDUE = 'Not read: fancy, bits';

async function openSheet(page: Page): Promise<void> {
  await page.getByTestId('short-session').click();
  await expect(page.getByTestId('quick-preview')).toBeVisible();
}

const notRead = (page: Page): Locator => page.getByTestId('quick-not-read');

async function expectPressed(page: Page, testId: string, pressed = true): Promise<void> {
  await expect(page.getByTestId(testId)).toHaveAttribute('aria-pressed', String(pressed));
}

test('words the rules read leave no Not read line', async ({ page }) => {
  await fresh(page);
  await openSheet(page);

  // One input event, so one render: the chips and the line below them are drawn from the same state,
  // and once the chips read the typed words the line is what those words leave, which is nothing.
  await page.getByTestId('quick-request').fill('four light exercises');
  await expectPressed(page, 'quick-count-4');
  await expectPressed(page, 'quick-effort-light');
  await expect(notRead(page)).toHaveCount(0);

  // Words the rules cannot read bring the line. The line being present first is what makes its
  // later absence, below, a change and not a wait.
  await page.getByTestId('quick-request').fill(TYPED);
  await expect(notRead(page)).toHaveText(RESIDUE);

  // And taking them away takes the line away again.
  await page.getByTestId('quick-request').fill('four light exercises');
  await expect(notRead(page)).toHaveCount(0);
});

test("words the rules cannot read show as Not read, the rules' reading stands as typed, and nothing offers to ask a model", async ({ page }) => {
  await fresh(page);
  await openSheet(page);

  await page.getByTestId('quick-request').pressSequentially(TYPED);
  await expect(notRead(page)).toHaveText(RESIDUE);
  // The rules' reading stands as typed.
  await expectPressed(page, 'quick-count-4');
  await expectPressed(page, 'quick-effort-light');
  // One more word, once the line is known to be drawn: it joins the line, and still there is no button.
  await page.getByTestId('quick-request').pressSequentially(' zonk');
  await expect(notRead(page)).toHaveText(`${RESIDUE}, zonk`);
  await expect(page.getByRole('dialog').getByRole('button', { name: /assistant|read with/i })).toHaveCount(0);
  await expect(page.getByRole('dialog')).not.toContainText(/assistant|model|download|unavailable|samsung/i);
});
