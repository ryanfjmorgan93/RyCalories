import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, expectClass, fresh, readRawIron } from './fresh';

/**
 * Small faults: a deload on the session detail page, the leg-day protein figure on the checklist,
 * and a routine with no exercises that must not start. Each drives the real screens against the
 * built app.
 */

/** Start Lower (Hinge) from Home, log two RDL sets, finish to the summary. */
async function trainToSummary(page: Page, opts: { deload?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);

  if (opts.deload) {
    await page.getByTestId('session-options').click();
    await page.getByRole('switch', { name: 'Deload session' }).click();
    await page.keyboard.press('Escape');
  }

  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await expect(card).toBeVisible();
  const weight = opts.deload ? Number(await card.getByTestId('weight-input').inputValue()) : 110;
  for (const reps of [8, 8]) {
    await card.getByTestId('weight-input').fill(String(weight));
    await card.getByTestId('reps-input').fill(String(reps));
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }), 800);
  }

  await page.getByTestId('finish-session').click();
  // The unfinished-work sheet appears only when a required exercise is untouched; scope to the dialog
  // so the header's own Finish never matches.
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
}

async function saveAndOpenDetail(page: Page): Promise<void> {
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/history');
  await page.getByRole('button', { name: /Lower \(Hinge\)/ }).first().click();
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);
}

test.describe('session detail', () => {
  test('a deload session says so on its detail page, as the summary did', async ({ page }) => {
    await fresh(page);
    await trainToSummary(page, { deload: true });
    await expect(page.getByTestId('decision-Romanian Deadlift (Barbell)').getByTestId('decision-line')).toContainText('stays');
    await saveAndOpenDetail(page);

    const line = page.getByTestId('decision-line').filter({ hasText: 'deload · stays' });
    await expect(line.first()).toBeVisible();
    await expectClass(line.first(), 'text-info');
    // Not the blank "no weight decision" a rule the switch does not know falls through to.
    await expect(page.getByText('no weight decision')).toHaveCount(0);
  });

  test('the leg-day protein line carries the saved target on the summary and on the detail page', async ({ page }) => {
    await fresh(page);
    await page.goto('/settings');
    await page.getByTestId('target-proteinTargetLegDay').fill('185');
    await page.getByRole('button', { name: 'Save targets' }).click();
    // The row itself, not the toast (which reads "Saved" for every save on this screen).
    await expect.poll(async () => (await readRawIron(page)).tables.settings[0]?.proteinTargetLegDay, { timeout: 10_000 }).toBe(185);

    await trainToSummary(page);
    await expect(page.getByRole('checkbox', { name: 'Protein 185 g today' })).toBeVisible();
    await expect(page.getByText('Protein 200 g')).toHaveCount(0);

    await saveAndOpenDetail(page);
    await expect(page.getByText('Protein 185 g', { exact: true })).toBeVisible();
    await expect(page.getByText('Protein 200 g')).toHaveCount(0);
  });
});

test.describe('a routine with no exercises', () => {
  test('cannot be started from its own page, the routine list on Home or the Next-up card', async ({ page }) => {
    await fresh(page);

    // Created through the New routine sheet, which lands on the routine's own page.
    await page.goto('/routines');
    await page.getByTestId('new-routine').click();
    await page.getByTestId('routine-name').fill('Empty day');
    await page.getByTestId('create-routine').click();
    await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/);
    await expect(page.getByText('No exercises yet.')).toBeVisible();
    await expect(page.getByTestId('start-routine')).toBeDisabled();

    // Home lists it with Start off, and the seeded routines beside it are unaffected.
    await page.goto('/');
    await expect(page.getByTestId('start-Empty day')).toBeDisabled();
    await expect(page.getByTestId('start-Lower (Hinge)')).toBeEnabled();
    // Its row says so in place of "0 exercises"; the Next-up card is not showing it yet.
    await expect(page.getByText('No exercises', { exact: true })).toHaveCount(1);
    await expect(page.getByTestId('next-up-empty')).toHaveCount(0);

    // Move it to the top of the week so it is the Next-up routine, one real tap at a time.
    await page.goto('/routines');
    const orderOf = async () => (await readRawIron(page)).tables.routines.find((r) => r.name === 'Empty day')?.order;
    await expect.poll(orderOf).toBe(5);
    for (let from = 5; from > 0; from--) {
      await page.getByRole('button', { name: 'Move up' }).nth(from).click();
      await expect.poll(orderOf).toBe(from - 1);
    }

    await page.goto('/');
    const nextUp = page.getByTestId('next-up');
    await expect(nextUp).toContainText('Empty day');
    await expect(page.getByTestId('next-up-empty')).toHaveText('No exercises');
    await expect(page.getByTestId('start-session')).toBeDisabled();
    await expect(page.getByTestId('start-deload')).toBeDisabled();
    await expect(page.getByTestId('start-Empty day')).toBeDisabled();
  });
});
