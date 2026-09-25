import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh, logOneSet } from './fresh';

/**
 * Option 1 of the coach: Iron hands the owner's data to the Claude app they already use (Copy for
 * Claude), and takes a routine back (Paste a routine). Nothing leaves the device from the app.
 */

const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test('Copy for Claude copies the chosen sections, and only those', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fresh(page);

  // A session with a warm-up and two working sets, a meal, and a weigh-in.
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await logOneSet(page, card, 110, 8);
  await logOneSet(page, card, 110, 7);
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/food/new');
  await page.getByTestId('empty-add-food').click();
  await page.getByTestId('food-name').fill('Porridge oats');
  await page.getByTestId('food-grams').fill('80');
  await page.getByTestId('food-kcal').fill('379');
  await page.getByTestId('food-protein').fill('11');
  await page.getByTestId('food-carbs').fill('60');
  await page.getByTestId('food-fat').fill('8');
  await page.getByTestId('save-food').click();
  await page.getByTestId('save-meal').click();
  await page.waitForURL(/\/food\/[0-9a-f-]+$/);

  await page.goto('/body');
  await page.getByTestId('bw-kg').fill('82.4');
  await page.getByTestId('bw-save').click();
  await expect(page.getByText('82.4 kg').first()).toBeVisible();

  await page.goto('/progress');
  await page.getByTestId('claude-open').click();
  await expect(page.getByTestId('claude-include-training')).toContainText('1 session');
  await expect(page.getByTestId('claude-include-food')).toContainText('1 of 28 days logged');
  await expect(page.getByTestId('claude-include-bodyweight')).toContainText('1 weigh-in');
  await expect(page.getByTestId('claude-words')).toContainText('About');

  // Routines are off by default; turn them on and copy.
  await page.getByTestId('claude-include-routines').getByRole('switch').click();
  await page.getByTestId('claude-copy').click();
  await expect.poll(() => readClipboard(page)).toContain('TRAINING');
  const all = await readClipboard(page);
  expect(all).toContain('Romanian Deadlift (Barbell): 110 × 8, 7');
  expect(all).toContain('FOOD');
  expect(all).toContain('1 of 28 days logged');
  expect(all).toContain('BODYWEIGHT');
  expect(all).toContain('82.4');
  expect(all).toContain('ROUTINES');
  expect(all).toContain('Lower (Hinge)');

  // Food off: the next copy leaves it out. The clipboard held FOOD before, so this waits for the change.
  await page.getByTestId('claude-include-food').getByRole('switch').click();
  await page.getByTestId('claude-copy').click();
  await expect.poll(() => readClipboard(page)).not.toContain('FOOD');
  expect(await readClipboard(page)).toContain('TRAINING');
});

test('Paste a routine matches what it can, asks about the rest, saves, and learns the choice', async ({ page }) => {
  await fresh(page);
  await page.goto('/routines');
  await page.getByTestId('new-routine').click();
  await page.getByTestId('paste-routine').click();

  await page.getByTestId('paste-text').fill(
    [
      'Here is a push day for you, built around what you have been lifting:',
      '',
      '**Push B**',
      '1. Bench press 4x6-8 @ 80kg',
      '2. Seated DB shoulder press 3 x 8–10',
      '3. Chest-supported row 3x10',
      '4. Plank 3x45s',
      '',
      'Rest two minutes between the heavy sets.',
    ].join('\n'),
  );

  const rows = page.getByTestId('paste-row');
  await expect(rows).toHaveCount(4);
  await expect(page.getByTestId('paste-routine-0')).toContainText('Push B');
  await expect(rows.nth(0).getByTestId('paste-row-name')).toHaveText('Bench Press (Barbell)');
  await expect(rows.nth(0)).toContainText('4 × 6–8 · 80 kg');
  await expect(rows.nth(1).getByTestId('paste-row-name')).toHaveText('DB Shoulder Press');
  await expect(page.getByTestId('paste-facts')).toContainText('2 to choose');
  await expect(page.getByTestId('paste-save')).toBeDisabled();

  // Chest-supported row: not confidently in the library, so it waits for a choice.
  await rows.nth(2).getByTestId('paste-choose').click();
  const picker = page.getByRole('dialog').filter({ hasText: 'Choose exercise' });
  await picker.getByRole('button', { name: /Iso-Lateral Row \(Machine\)/ }).click();
  await expect(rows.nth(2).getByTestId('paste-row-name')).toHaveText('Iso-Lateral Row (Machine)');
  // Plank: new to the library.
  await rows.nth(3).getByTestId('paste-add-new').click();
  await expect(rows.nth(3)).toContainText('new exercise');

  await expect(page.getByTestId('paste-save')).toBeEnabled();
  await page.getByTestId('paste-save').click();
  await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/);
  await expect(page.getByTestId('rx-card-Bench Press (Barbell)')).toContainText('4 × 6–8 @ 80 kg');
  await expect(page.getByTestId('rx-card-DB Shoulder Press')).toBeVisible();
  await expect(page.getByTestId('rx-card-Iso-Lateral Row (Machine)')).toBeVisible();
  await expect(page.getByTestId('rx-card-Plank')).toBeVisible();

  // The choice was learned: the same name now matches on its own.
  await page.goto('/routines');
  await page.getByTestId('new-routine').click();
  await page.getByTestId('paste-routine').click();
  await page.getByTestId('paste-text').fill('Push C\nChest-supported row 3x10');
  await expect(page.getByTestId('paste-row').first().getByTestId('paste-row-name')).toHaveText('Iso-Lateral Row (Machine)');
  await expect(page.getByTestId('paste-save')).toBeEnabled();
});

test('Paste a routine reads a superset day as one routine: labels, warm-up and two-to-a-line handled', async ({ page }) => {
  await fresh(page);
  await page.goto('/routines');
  await page.getByTestId('new-routine').click();
  await page.getByTestId('paste-routine').click();

  await page.getByTestId('paste-text').fill(
    [
      '**Day 1 – Upper**',
      'Warm-up:',
      '- Bike 5 min',
      '- Band pull-aparts 2x15',
      'Superset 1:',
      'A1. Bench press 4x6-8 @ 70-80kg',
      'A2. Curl 3x10-12',
      'Superset 2: Lateral raise 3x15, Face pull 3x15',
      'Plank 3x1 min',
    ].join('\n'),
  );

  const rows = page.getByTestId('paste-row');
  await expect(rows).toHaveCount(5);
  await expect(page.getByTestId('paste-routine-0')).toContainText('Day 1 - Upper · 5 exercises');
  await expect(page.getByTestId('paste-routine-1')).toHaveCount(0);
  await expect(rows.nth(0).getByTestId('paste-row-name')).toHaveText('Bench Press (Barbell)');
  await expect(rows.nth(0)).toContainText('4 × 6–8 · 70 kg');
  // "Curl" is as much DB Curl as Hammer Curl, and never Neck: it waits for the owner.
  await expect(rows.nth(1).getByTestId('paste-row-name')).toHaveText('Curl');
  await expect(rows.nth(1).getByTestId('paste-choose')).toBeVisible();
  await expect(rows.nth(2).getByTestId('paste-row-name')).toHaveText('Lateral Raise');
  await expect(rows.nth(3).getByTestId('paste-row-name')).toHaveText('Face Pull');
  await expect(rows.nth(4)).toContainText('3 × 60');
  await expect(page.getByTestId('paste-facts')).toContainText('3 lines not used');
});
