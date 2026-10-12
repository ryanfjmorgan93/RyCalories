import { expect, test } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

test.describe('Exercise Detail — lock-in floor (lockInBlocked, shared with Summary)', () => {
  test('Save is blocked at 0 kg for a lift that has never been logged', async ({ page }) => {
    await fresh(page);
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill('Back Squat');
    await page.getByRole('button', { name: /Barbell Back Squat/ }).click();
    await expect(page.getByRole('heading', { name: 'Barbell Back Squat' })).toBeVisible();

    await page.getByTestId('lock-in-Lower (Squat)').click();
    // No history yet, so the suggested/default weight is 0 kg — the exact case that used to save.
    await expect(page.getByTestId('lock-in-weight')).toHaveValue('0');
    await expect(page.getByTestId('lock-in-save')).toBeDisabled();
  });

  test('Save is blocked at 0 kg even once the lift has history — 0 kg is only ever meaningful for bodyweight_plus', async ({ page }) => {
    await fresh(page);

    // Bench Press (Barbell) starts in normal (not calibrating) mode with a prescribed weight, so
    // logging and saving a session gives it real history without needing to lock in first.
    await page.getByTestId('start-Upper (Push)').click();
    await expect(page).toHaveURL(/\/session\//);
    const card = page.getByTestId('exercise-card-Bench Press (Barbell)');
    await expect(card).toBeVisible();
    await card.getByTestId('weight-input').fill('60');
    await card.getByTestId('reps-input').fill('8');
    await card.getByTestId('set-done').click();
    const skip = page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' });
    await clickIfPresent(skip);

    await page.getByTestId('finish-session').click();
    await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
    await expect(page).toHaveURL(/\/summary$/);
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    // Put the routine-exercise back into calibrating mode — the only way to reach the lock-in
    // sheet again — while its exercise-level history (from the session just saved) stays intact.
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill('Bench Press');
    await page.getByRole('button', { name: /Bench Press \(Barbell\)/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Bench Press (Barbell)' })).toBeVisible();
    await expect(page.getByText('60', { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Set calibrating' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Set calibrating', exact: true }).click();
    await expect(page.getByText('Set calibrating?')).toBeHidden();

    await page.getByTestId('lock-in-Upper (Push)').click();
    await page.getByTestId('lock-in-weight').fill('0');
    await expect(page.getByTestId('lock-in-weight')).toHaveValue('0');
    // History used to be enough to allow 0 kg here — but 0 kg for a barbell lift would silently
    // prescribe nothing for ever, whether or not history exists, so the shared floor blocks it
    // regardless. Only a positive weight (or bodyweight_plus's 0 added kg — see the next test)
    // unblocks Save.
    await expect(page.getByTestId('lock-in-save')).toBeDisabled();
    await page.getByTestId('lock-in-weight').fill('62.5');
    await expect(page.getByTestId('lock-in-save')).toBeEnabled();
  });

  test('Save is allowed at 0 kg for bodyweight_plus — 0 added kg is bodyweight alone, a real working weight', async ({ page }) => {
    await fresh(page);
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill('Back Extension');
    await page.getByRole('button', { name: /Back Extension/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Back Extension' })).toBeVisible();

    // Back Extension starts in normal mode with no history — Set calibrating to reach the sheet.
    await page.getByRole('button', { name: 'Set calibrating' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Set calibrating', exact: true }).click();
    await expect(page.getByText('Set calibrating?')).toBeHidden();

    await page.getByTestId('lock-in-Lower (Hinge)').click();
    await expect(page.getByTestId('lock-in-weight')).toHaveValue('0');
    await expect(page.getByTestId('lock-in-save')).toBeEnabled();
    await page.getByTestId('lock-in-save').click();
    await expect(page.getByText('Locked in at', { exact: false })).toBeVisible();
  });
});
