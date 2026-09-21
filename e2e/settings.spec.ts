import { expect, test } from '@playwright/test';
import { fresh } from './fresh';

/**
 * Settings mixes drafted cards (their own Save button — Targets, Rest timer, Progression) with
 * instant-save controls on the very same screen (toggles, plate chips, the theme and effort-scale
 * segmented controls). Every one of those writes goes through the same `saveSettings`, which bumps
 * `settings.savedAt` no matter which field it touched. A card must reseed its drafts only when the
 * SAVED values of the fields it owns have actually changed — never merely because `settings`
 * itself is a new object — or an unrelated instant-save silently reverts whatever the user was
 * midway through typing. See `useOwnedReseed` in SettingsScreen.tsx.
 */
test.describe('settings — draft survives an unrelated instant-save', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page);
    await page.goto('/settings');
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
    await expect(page.getByText('Saved')).toBeVisible();

    await page.reload();
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

test('the assistant Download button re-enables even though the web fake emits no progress events', async ({ page }) => {
  // window.__ironNanoFake (src/state/nano.ts) stands in for the native Gemini Nano plugin on the
  // web build — see e2e/design-shots.spec.ts for the same shape. It must be set before the app's
  // first script runs, so this goes in before `fresh()` navigates at all.
  await page.addInitScript((cfg: { state: string; detail: string }) => {
    (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
      status: { state: cfg.state, detail: cfg.detail },
      generate: async () => ({ text: 'unused' }),
    };
  }, { state: 'downloadable', detail: 'fake, not downloaded' });

  await fresh(page);
  await page.goto('/settings');

  const downloadButton = page.getByRole('button', { name: 'Download' });
  await expect(downloadButton).toBeVisible();
  await expect(page.getByText('Download (about 2 GB)')).toBeVisible();

  await downloadButton.click();

  // The web fake's own `download()` (src/state/nano.ts NanoWeb) always resolves `{ started: false }`
  // and never fires a `nanoDownload` event, so the in-progress "Downloading n %" label and the
  // button's re-entrancy guard — driven by AssistantSettingsCard's local `downloading` flag — can
  // only actually be exercised on the phone, where the native plugin emits those events. What this
  // proves in the sandbox is only that the click does not wedge the button or crash the row: it
  // comes back enabled, and the status row still reads its plain fact.
  await expect(downloadButton).toBeEnabled();
  await expect(downloadButton).toHaveText('Download');
  await expect(page.getByText('Download (about 2 GB)')).toBeVisible();
});
