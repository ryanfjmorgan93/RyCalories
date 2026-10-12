import { expect, test } from '@playwright/test';
import { fresh, openAdvanced } from './fresh';

/**
 * Settings mixes drafted cards (their own Save button — Targets, Rest timer, Progression) with
 * instant-save controls on the very same screen (toggles, plate chips). Every one of those writes goes through the same `saveSettings`, which bumps
 * `settings.savedAt` no matter which field it touched. A card must reseed its drafts only when the
 * SAVED values of the fields it owns have actually changed — never merely because `settings`
 * itself is a new object — or an unrelated instant-save silently reverts whatever the user was
 * midway through typing. See `useOwnedReseed` in SettingsScreen.tsx.
 */
test.describe('settings — draft survives an unrelated instant-save', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page);
    await page.goto('/settings');
    // Rest timer, plates and progression sit under Advanced, closed until it is tapped.
    await openAdvanced(page);
  });

  test('a half-typed deload percent survives flipping the rest-timer vibrate toggle, and still saves', async ({ page }) => {
    // Type a new deload percent into the Progression card. Not saved yet.
    await page.getByTestId('deload-percent').fill('75');

    // Flip an unrelated instant-save elsewhere on the same screen (Rest timer card).
    await page.getByRole('switch', { name: /Vibrate when rest ends/ }).click();

    // The typed value is still there — the toggle's save must not have reseeded this draft.
    await expect(page.getByTestId('deload-percent')).toHaveValue('75');

    // Save it for real, then reload to confirm it actually persisted (not just surviving in memory).
    await page.getByTestId('progression-card').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await page.reload();
    await openAdvanced(page);
    await expect(page.getByTestId('deload-percent')).toHaveValue('75');
  });

  test('toggling a plate chip (an instant save) leaves the Targets card draft untouched', async ({ page }) => {
    // Type a new calorie start into the Targets card. Not saved yet.
    await page.getByTestId('target-calorieStart').fill('2222');

    // Toggle a plate chip — an instant save that has nothing to do with Targets.
    const chip = page.getByTestId('plates-card').getByRole('button', { name: '0.5 kg' });
    await chip.click();

    // Wait until the save has demonstrably landed — the chip's own active styling only flips once
    // the live query has pushed the new `settings.plates` back down, which is the same render the
    // old calorieStartDate-stamping bug rode in on (see saveSettings's CALORIE_TARGET_KEYS). An
    // assertion taken straight after the click can pass before that render ever happens, proving
    // nothing; this one is taken after it, so it cannot pass by a timing accident.
    await expect(chip).toHaveClass(/bg-fg/);

    // The Targets draft is unchanged.
    await expect(page.getByTestId('target-calorieStart')).toHaveValue('2222');
  });
});
