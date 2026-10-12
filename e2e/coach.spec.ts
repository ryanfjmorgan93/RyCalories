import { expect, test } from '@playwright/test';
import { fresh } from './fresh';

/**
 * The coach, and the ways into it: the sheet (src/ui/CoachSheet.tsx, opened from Progress, Routines
 * and the session) and the same conversation full screen (src/screens/CoachScreen.tsx, /coach).
 * There is one box. With Claude out of reach (no key here) a request for a routine is built by the
 * app with no model, and so is a change to the routine on screen; a question gets the reason, in one
 * plain line, and what was typed stays in the box. The conversation across both (the routine, why,
 * a new routine) is coach-conversation.spec.ts; Claude's own side is coach-claude.spec.ts. This
 * file is the way in.
 */

const NO_KEY = 'Add your Claude key in Settings to use the coach.';

test('Coach on Progress opens the sheet, and a question gets the reason in one plain line while there is no key', async ({ page }) => {
  await fresh(page);
  await page.goto('/progress');
  await page.getByTestId('coach-open').click();
  await expect(page).toHaveURL(/\/progress$/);
  const sheet = page.getByRole('dialog').filter({ has: page.getByTestId('coach-thread') });
  await expect(sheet).toBeVisible();
  // Why it is quiet is said before a word is typed.
  await expect(page.getByTestId('coach-unavailable')).toContainText(NO_KEY);

  await page.getByTestId('coach-input').fill('Why has my RDL stalled?');
  await expect(page.getByTestId('coach-send')).toBeEnabled();
  await page.getByTestId('coach-send').click();

  await expect(page.getByTestId('coach-error')).toHaveText(NO_KEY);
  // Nothing was sent or kept: the words are still in the box to send later.
  await expect(page.getByTestId('coach-input')).toHaveValue('Why has my RDL stalled?');
  await expect(page.getByTestId('coach-bubble')).toHaveCount(0);
  await expect(page.getByTestId('coach-user-bubble')).toHaveCount(0);
  // Nothing about a model, a download or an assistant is on the screen.
  await expect(page.getByTestId('coach-status')).toHaveCount(0);
  await expect(page.getByTestId('coach-download')).toHaveCount(0);
});

test('Draft with coach opens the sheet on a build: its first message is built by the app with no model, opens in the review, matched, and saves as a routine', async ({ page }) => {
  // "Draft with coach" makes the first message a build, whatever it says.
  await fresh(page);
  await page.goto('/routines');
  await page.getByTestId('new-routine').click();
  await page.getByTestId('draft-with-coach').click();
  await expect(page).toHaveURL(/\/routines$/);
  await expect(page.getByTestId('coach-input')).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);

  // Worded as a request for nothing in particular, so only the opening makes it a build.
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

test('the sheet opens the same conversation full screen, and a routine built in one is on the other', async ({ page }) => {
  await fresh(page);
  await page.goto('/progress');
  await page.getByTestId('coach-open').click();
  await page.getByTestId('coach-input').fill('Give me a chest routine');
  await page.getByTestId('coach-send').click();
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await expect(page.getByTestId('coach-send')).toHaveText('Send');

  await page.getByTestId('coach-fullscreen').click();
  await expect(page).toHaveURL(/\/coach$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The routine built in the sheet is here, not rebuilt: it is the same conversation.
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await expect(page.getByTestId('coach-read')).toHaveText(/^Read: chest · \d+ exercises$/);
  await expect(page.getByTestId('coach-input')).toBeVisible();
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
  await expect(page.getByTestId('coach-error')).toHaveText(NO_KEY);
  await expect(page.getByTestId('coach-input')).toHaveValue('How was last week?');
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
