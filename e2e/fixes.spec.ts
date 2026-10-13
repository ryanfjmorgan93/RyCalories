import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, expectClass, fresh, readRawIron } from './fresh';

/**
 * Small faults: a deload on the session detail page, the Summary without its retired niggles and
 * leg-day checklist, and a routine with no exercises that must not start. Each drives the real screens against the
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

  test('a lower-body Summary asks for no niggles and no leg-day checklist, and the saved session carries neither', async ({ page }) => {
    // Both were removed at the owner's request (October 2026).
    await fresh(page);
    await trainToSummary(page);
    // The Summary has rendered its decisions before anything is said to be missing from it.
    await expect(page.getByTestId('decision-Romanian Deadlift (Barbell)').getByTestId('decision-line')).toBeVisible();
    await expect(page.getByTestId('save-session')).toBeVisible();
    await expect(page.getByText('Niggles', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Leg day', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /Electrolytes|Protein/ })).toHaveCount(0);

    await saveAndOpenDetail(page);
    const saved = ((await readRawIron(page)).tables.sessions as { title: string; endedAt?: string; checklist?: unknown; niggles?: unknown }[]).filter((s) => s.endedAt);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.checklist).toBeUndefined();
    expect(saved[0]!.niggles).toBeUndefined();
    await expect(page.getByTestId('decision-line').first()).toBeVisible();
    await expect(page.getByText('Leg-day checklist')).toHaveCount(0);
  });
});

test.describe('a routine with no exercises', () => {
  test('cannot be started from its own page or the routine list on Home', async ({ page }) => {
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
    // Its row says so in place of "0 exercises".
    await expect(page.getByText('No exercises', { exact: true })).toHaveCount(1);
  });
});
