import { expect, test } from '@playwright/test';
import { fresh } from './fresh';

/**
 * The coach (src/screens/CoachScreen.tsx) and the way into it. There is one box: a request for a
 * routine is built by the app with no model, and so is a change to the routine on screen; anything
 * else is a question for Claude, which is not set up yet, so it is answered with one plain line.
 * The conversation across both (the routine, why, a new routine) is coach-conversation.spec.ts;
 * this file is the way into the screen.
 */

const NO_CLAUDE = "Questions go to Claude, which isn't set up yet.";

test('a question is answered with one plain line while Claude is not set up', async ({ page }) => {
  await fresh(page);
  await page.goto('/progress');
  await page.getByTestId('coach-open').click();
  await expect(page).toHaveURL(/\/coach$/);
  await page.getByTestId('coach-input').fill('Why has my RDL stalled?');
  await expect(page.getByTestId('coach-send')).toBeEnabled();
  await page.getByTestId('coach-send').click();

  await expect(page.getByTestId('coach-answer')).toHaveText(NO_CLAUDE);
  await expect(page.getByTestId('coach-partial')).toHaveCount(0);
  await expect(page.getByTestId('coach-error')).toHaveCount(0);
  await expect(page.getByTestId('coach-input')).toHaveValue('');
  // Nothing about a model, a download or an assistant is on the screen.
  await expect(page.getByTestId('coach-status')).toHaveCount(0);
  await expect(page.getByTestId('coach-download')).toHaveCount(0);
});

test('Draft with coach opens the box on a build: its first message is built by the app with no model, opens in the review, matched, and saves as a routine', async ({ page }) => {
  // "Draft with coach" makes the first message a build, whatever it says.
  await fresh(page);
  await page.goto('/routines');
  await page.getByTestId('new-routine').click();
  await page.getByTestId('draft-with-coach').click();
  await expect(page).toHaveURL(/\/coach\?mode=routine$/);
  await expect(page.getByTestId('coach-input')).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);

  // Worded as a request for nothing in particular, so only the deep link makes it a build.
  await page.getByTestId('coach-input').fill('One upper day, 45 minutes');
  await page.getByTestId('coach-send').click();
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await expect(page.getByTestId('coach-read')).toHaveText(/^Read: upper · \d+ exercises · 45 min$/);
  await expect(page.getByTestId('coach-send')).toHaveText('Send');
  const built = await page.getByTestId('coach-row-name').allTextContents();
  expect(built.length).toBeGreaterThan(0);

  await page.getByTestId('coach-review').click();
  const review = page.getByRole('dialog').filter({ hasText: 'Review routine' });
  const rows = review.getByTestId('paste-row');
  await expect(rows).toHaveCount(built.length);
  await expect(review.getByTestId('paste-row-name')).toHaveText(built);
  // The text is the coach's, not the owner's to edit: there is no box to paste into.
  await expect(review.getByTestId('paste-text')).toHaveCount(0);
  // The owner's own exercises are matched to their rows; a library one waits for its choice.
  await expect(review.getByTestId('paste-change').first()).toBeVisible();
  while ((await review.getByTestId('paste-add-new').count()) > 0) await review.getByTestId('paste-add-new').first().click();
  await review.getByTestId('paste-save').click();
  await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/);
  for (const name of built) await expect(page.getByTestId(`rx-card-${name}`)).toBeVisible();
});

test('a routine can be built and a question can be sent, with no model on the phone to download or wait for', async ({ page }) => {
  await fresh(page);
  await page.goto('/coach');
  await expect(page.getByTestId('coach-status')).toHaveCount(0);

  await page.getByTestId('coach-input').fill('Give me a chest routine');
  await expect(page.getByTestId('coach-send')).toBeEnabled();
  await page.getByTestId('coach-send').click();
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await expect(page.getByTestId('coach-read')).toHaveText(/^Read: chest · \d+ exercises$/);

  await page.getByTestId('coach-input').fill('How was last week?');
  await expect(page.getByTestId('coach-send')).toBeEnabled();
  await page.getByTestId('coach-send').click();
  await expect(page.getByTestId('coach-answer')).toHaveText(NO_CLAUDE);
});

test('the Progress header shows Coach as a word, and the title keeps its room at 360 px', async ({ page }) => {
  await fresh(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/progress');
  const header = page.locator('header');
  await expect(header.getByTestId('coach-open')).toHaveText('Coach');
  // Copy for Claude is gone from the header.
  await expect(header.getByTestId('claude-open')).toHaveCount(0);
  const title = header.getByText('Progress', { exact: true });
  await expect(title).toBeVisible();
  await expect.poll(async () => (await title.boundingBox())?.width ?? 0).toBeGreaterThan(40);
});
