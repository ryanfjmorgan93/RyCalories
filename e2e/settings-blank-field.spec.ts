import { expect, test } from '@playwright/test';
import { fresh } from './fresh';

/**
 * SettingsScreen.tsx's drafted cards (Targets, Rest timer, Progression) build their save patch by
 * skipping any owned field that is currently blank — so a field left empty at Save time keeps
 * whatever the DB already had, but the toast still says "Saved" while the box itself sits empty,
 * which is a lie about what state the field is actually in. Worse, ProgressionCard's weekly-set-
 * targets patch rebuilds the *whole* map from the draft every time (no per-key merge on save), so
 * a blanked group there is not just cosmetic — the group's saved target is deleted outright.
 *
 * The fix refills a blanked owned field from its saved value on blur, so the box can never sit
 * blank while Save silently keeps (or, for the per-muscle map, silently drops) the old number.
 */

test('blanking a Settings target field and saving keeps the intended value, honestly', async ({ page }) => {
  await fresh(page);
  await page.goto('/settings');

  const field = page.getByTestId('target-calorieStart');
  await expect(field).toBeVisible();
  const before = await field.inputValue();
  expect(before).not.toBe('');

  // Save once for real first. A brand-new settings row sets its reverse-diet start date on its
  // very first save, which alone changes an owned field and triggers useOwnedReseed's full
  // reseed — masking the bug below by accident. Saving once first rules that out, so the second
  // save below exercises the ordinary steady-state case.
  await page.getByRole('button', { name: 'Save targets' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await field.fill('');
  await expect(field).toHaveValue('');

  // Clicking Save moves focus off the field — the real blur a person triggers by tapping Save.
  await page.getByRole('button', { name: 'Save targets' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // The box shows its real value again instead of sitting blank while claiming success — Save
  // cannot have quietly dropped it, because the field was never blank at Save time.
  await expect(field).toHaveValue(before);

  // And it really did persist — not just surviving in memory.
  await page.reload();
  await expect(page.getByTestId('target-calorieStart')).toHaveValue(before);
});

test('blanking a rest-timer field and saving does not revert it to some other value', async ({ page }) => {
  await fresh(page);
  await page.goto('/settings');

  const isolation = page.getByTestId('rest-isolation');
  await expect(isolation).toBeVisible();
  const before = await isolation.inputValue();
  expect(before).not.toBe('');

  await isolation.fill('');
  await page.getByTestId('rest-card').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(isolation).toHaveValue(before);

  await page.reload();
  await expect(page.getByTestId('rest-isolation')).toHaveValue(before);
});

test("blanking one weekly set target does not delete another group's saved target", async ({ page }) => {
  await fresh(page);
  await page.goto('/settings');

  // Give two muscle groups a target and save for real, so both exist in the saved settings.
  await page.getByTestId('set-target-chest').fill('12');
  await page.getByTestId('set-target-lats').fill('10');
  await page.getByTestId('progression-card').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('set-target-chest')).toHaveValue('12');
  await expect(page.getByTestId('set-target-lats')).toHaveValue('10');

  // Blank just one of them and save.
  await page.getByTestId('set-target-lats').fill('');
  await page.getByTestId('progression-card').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // Neither group's target was wiped out by the blank one — the blanked one kept its old number,
  // and the untouched one was never at risk from the same save's whole-map replace.
  await page.reload();
  await expect(page.getByTestId('set-target-chest')).toHaveValue('12');
  await expect(page.getByTestId('set-target-lats')).toHaveValue('10');
});
