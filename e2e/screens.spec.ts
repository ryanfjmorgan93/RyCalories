import { expect, test } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';
import { fileURLToPath } from 'node:url';

const HEVY_CSV = fileURLToPath(new URL('../hevy_export.csv', import.meta.url));
const HEVY_MEASUREMENTS = fileURLToPath(new URL('../hevy_measurements.csv', import.meta.url));

test.describe('Routines', () => {
  test('create a routine, add an exercise, set its weight, and it shows in a session', async ({ page }) => {
    await fresh(page);
    await page.goto('/routines');
    await expect(page.getByRole('heading', { name: 'Routines' })).toBeVisible();
    await page.getByTestId('new-routine').click();
    await page.getByTestId('routine-name').fill('Test day');
    await page.getByTestId('create-routine').click();
    await expect(page).toHaveURL(/\/routines\//);

    await page.getByTestId('add-exercise').click();
    await page.getByPlaceholder('Search').fill('Face Pull');
    await page.getByRole('button', { name: /Face Pull/ }).first().click();
    // Editor opens for the new routine-exercise: make it normal at 50 kg, 3 × 12–15.
    await page.getByRole('radio', { name: 'Normal' }).click();
    await page.getByTestId('rx-weight').fill('50');
    await page.getByTestId('rx-repmin').fill('12');
    await page.getByTestId('rx-repmax').fill('15');
    await page.getByTestId('rx-save').click();
    await expect(page.getByTestId('rx-card-Face Pull')).toContainText('3 × 12–15 @ 50 kg');

    await page.getByTestId('start-routine').click();
    await expect(page).toHaveURL(/\/session\//);
    await expect(page.getByTestId('exercise-card-Face Pull')).toContainText('3 × 12–15 @ 50 kg');
    await expect(page.getByTestId('exercise-card-Face Pull').getByTestId('weight-input')).toHaveValue('50');
  });

  test('unlimited routines: six routines exist after adding one', async ({ page }) => {
    await fresh(page);
    await page.goto('/routines');
    await page.getByTestId('new-routine').click();
    await page.getByTestId('routine-name').fill('Sixth');
    await page.getByTestId('create-routine').click();
    // The sheet closing is the signal the write finished. A click resolves when the event
    // dispatches, not when the transaction commits, and navigating away first can abort it.
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.goto('/');
    for (const name of ['Lower (Hinge)', 'Upper (Push)', 'Lower (Squat)', 'Upper (Pull)', 'Arms (Day 5)', 'Sixth']) {
      await expect(page.getByTestId(`start-${name}`)).toBeVisible();
    }
  });
});

test.describe('Exercise library', () => {
  test('add a custom exercise and open its detail page', async ({ page }) => {
    await fresh(page);
    await page.goto('/exercises');
    await page.getByTestId('add-exercise').click();
    await page.getByTestId('exercise-name').fill('Cable Row (Seated)');
    await page.getByRole('switch', { name: /Compound/ }).click();
    await page.getByTestId('save-exercise').click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: 'Cable Row (Seated)' })).toBeVisible();
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill('cable row');
    await expect(page.getByText('Cable Row (Seated)')).toBeVisible();
  });

  test('exercise detail shows history and lock-in for a calibrating lift', async ({ page }) => {
    await fresh(page);
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill('Back Squat');
    await page.getByRole('button', { name: /Barbell Back Squat/ }).click();
    await expect(page.getByRole('heading', { name: 'Barbell Back Squat' })).toBeVisible();
    await page.getByTestId('lock-in-Lower (Squat)').click();
    await page.getByTestId('lock-in-weight').fill('82.5');
    await page.getByTestId('lock-in-save').click();
    await expect(page.getByText('4 × 6–8 @ 82.5 kg')).toBeVisible();
  });
});

test.describe('Bodyweight', () => {
  test('log a reading from the Body tab and see it on Home', async ({ page }) => {
    await fresh(page);
    await page.goto('/body');
    await page.getByTestId('bw-kg').fill('74.6');
    await page.getByTestId('bw-save').click();
    await expect(page.getByText('74.6 kg').first()).toBeVisible();
    await page.goto('/');
    await expect(page.getByText('74.6 kg').first()).toBeVisible();
  });
});

test.describe('Data', () => {
  test('Hevy import through Settings is idempotent and feeds previous-session sets', async ({ page }) => {
    await fresh(page);
    await page.goto('/settings');
    await page.locator('input[type="file"][accept*="csv"]').setInputFiles(HEVY_CSV);
    await expect(page.getByRole('dialog')).toContainText('21 sessions');
    // Pair-total halving is pre-ticked for the dumbbell presses, not curls.
    await page.getByRole('button', { name: /Import 21 sessions/ }).click();
    // Reconcile step: keep the brief's numbers.
    await page.getByRole('button', { name: 'Keep mine' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.goto('/history');
    await expect(page.getByText('Routine 2 - Upper (Push)').first()).toBeVisible();
    const rows = page.getByRole('button', { name: /Routine \d - / });
    await expect(rows).toHaveCount(21);

    // Import again: still 21.
    await page.goto('/settings');
    await page.locator('input[type="file"][accept*="csv"]').setInputFiles(HEVY_CSV);
    await page.getByRole('button', { name: /Import 21 sessions/ }).click();
    // The reconcile step appears again on a re-import, once the import has actually run.
    await page.getByRole('button', { name: 'Keep mine' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.goto('/history');
    await expect(page.getByRole('button', { name: /Routine \d - / })).toHaveCount(21);

    // Next up follows the last Hevy session (Push on 8 Sep → Squat), and previous sets show in-session.
    await page.goto('/');
    await expect(page.getByTestId('next-up')).toContainText('Lower (Squat)');
    await page.getByTestId('start-Lower (Hinge)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(card).toContainText('31 Aug');
    await expect(card.getByRole('button', { name: '90 × 8' }).first()).toBeVisible();

    // Measurements file adds one bodyweight reading.
    await page.goto('/settings');
    await page.locator('input[type="file"][accept*="csv"]').setInputFiles(HEVY_MEASUREMENTS);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.goto('/body');
    await expect(page.getByText('74.5 kg').first()).toBeVisible();
  });

  test('JSON backup export produces a file', async ({ page }) => {
    await fresh(page);
    await page.goto('/settings');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON backup' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^iron-backup-.*\.json$/);
    const text = await (await file.createReadStream()).toArray();
    const json = JSON.parse(Buffer.concat(text as Buffer[]).toString('utf8'));
    expect(json.app).toBe('iron');
    expect(json.tables.routineExercises).toHaveLength(29);
  });

  test('CSV export produces a file', async ({ page }) => {
    await fresh(page);
    await page.goto('/settings');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export sets CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  });

  test('check-in copies plain text', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await fresh(page);
    await page.goto('/checkin');
    await expect(page.getByTestId('checkin-text')).toContainText('Romanian Deadlift (Barbell): 110 kg');
    await page.getByTestId('copy-checkin').click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('Lifts');
    expect(clip).toContain('Barbell Back Squat: calibrating');
  });
});
