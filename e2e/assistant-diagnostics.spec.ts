import { expect, test, type Page } from '@playwright/test';
import { fresh } from './fresh';

/**
 * The owner's report was "the AI assistant isn't working. Says model unavailable." with no more
 * detail — because the app was throwing the real diagnostic away. These specs drive the real UI
 * (ExerciseDetailScreen, AssistantBox, AssistantSettingsCard) against `window.__ironNanoFake`
 * (src/state/nano.ts), the documented test seam that stands in for the native Gemini Nano plugin
 * on the web build used by these tests. Everything from that seam inward — the zustand store, the
 * React components, real IndexedDB — is the genuine code path. What cannot be exercised here at
 * all is android/.../NanoPlugin.java itself (it only compiles under CI and needs a real device);
 * these tests say nothing about what buildDetail() actually returns on a Z Fold 8, only that
 * whatever string it returns now survives all the way to the screen instead of being replaced.
 */
async function setFakeNano(page: Page, status: { state: string; detail: string }, reply = 'unused'): Promise<void> {
  await page.addInitScript(
    (cfg: { state: string; detail: string; reply: string }) => {
      (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
        status: { state: cfg.state, detail: cfg.detail },
        generate: async () => ({ text: cfg.reply }),
      };
    },
    { ...status, reply },
  );
}

test.describe('Settings — assistant diagnostics', () => {
  test('the diagnostic string is visible on the card directly, with no disclosure to open', async ({ page }) => {
    const detail = 'UNAVAILABLE · samsung SM-F968B · SDK 36 · AICore 2026.9.4';
    await setFakeNano(page, { state: 'unavailable', detail });
    await fresh(page);
    await page.goto('/settings');

    const card = page.getByTestId('assistant-card');
    await expect(card).toContainText('Unavailable');
    // The old UI hid this behind a collapsed <details>/<summary> that had to be opened first.
    await expect(card.locator('details')).toHaveCount(0);
    await expect(page.getByTestId('assistant-detail')).toHaveText(detail);
  });

  test('Re-check re-runs the status check and the card reflects the new result', async ({ page }) => {
    await setFakeNano(page, { state: 'unavailable', detail: 'first check: binder not ready' });
    await fresh(page);
    await page.goto('/settings');

    await expect(page.getByTestId('assistant-detail')).toHaveText('first check: binder not ready');
    await expect(page.getByTestId('assistant-card')).toContainText('UNAVAILABLE');

    // Nothing in the UI changed this — it stands in for AICore finishing its own download in the
    // background, which is exactly the situation Google's docs say Re-check should be offered for.
    await page.evaluate(() => {
      (window as unknown as { __ironNanoFake: { status: { state: string; detail: string } } }).__ironNanoFake.status = {
        state: 'ready',
        detail: 'second check: ready',
      };
    });

    await page.getByTestId('assistant-recheck').click();

    await expect(page.getByTestId('assistant-detail')).toHaveText('second check: ready');
    await expect(page.getByTestId('assistant-card')).toContainText('READY');
  });

  test('Copy diagnostics uses the Clipboard API when it is available and permitted', async ({ page, context }) => {
    const detail = 'READY · Pixel 9 · SDK 35 · AICore 2026.9.1';
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setFakeNano(page, { state: 'ready', detail });
    await fresh(page);
    await page.goto('/settings');

    await page.getByTestId('assistant-copy-diagnostics').click();
    await expect(page.getByText('Copied', { exact: true })).toBeVisible();

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(detail);
  });

  test('Copy diagnostics falls back to the legacy copy when the Clipboard API rejects', async ({ page }) => {
    const detail = 'DOWNLOADABLE · samsung SM-F968B · SDK 36 · AICore 2026.9.4';
    // Simulates the Android WebView case named in the brief: navigator.clipboard exists but
    // writeText() rejects. document.execCommand('copy') is left as the browser's real
    // implementation, so this exercises the actual fallback branch, not a stand-in for it.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
      });
    });
    await setFakeNano(page, { state: 'downloadable', detail });
    await fresh(page);
    await page.goto('/settings');

    await page.getByTestId('assistant-copy-diagnostics').click();
    await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  });

  test('Copy diagnostics reports failure honestly when no copy method works at all', async ({ page }) => {
    const detail = 'UNAVAILABLE · samsung SM-F968B · SDK 36 · AICore not installed';
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
      });
      const real = document.execCommand.bind(document);
      document.execCommand = (cmd: string, ...rest: unknown[]) => (cmd === 'copy' ? false : (real as (...a: unknown[]) => boolean)(cmd, ...rest));
    });
    await setFakeNano(page, { state: 'unavailable', detail });
    await fresh(page);
    await page.goto('/settings');

    await page.getByTestId('assistant-copy-diagnostics').click();
    // Not "Copied" — the button must not claim a copy that didn't happen.
    await expect(page.getByText('Could not copy.', { exact: true })).toBeVisible();
  });
});

test.describe('Exercise Detail — Ask is gated on assistant status', () => {
  test('Ask is disabled while the on-device status is unavailable', async ({ page }) => {
    await setFakeNano(page, { state: 'unavailable', detail: 'UNAVAILABLE · samsung SM-F968B · SDK 36 · AICore 2026.9.4' });
    await fresh(page);
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill('Romanian Deadlift');
    await page.getByRole('button', { name: /Romanian Deadlift/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Romanian Deadlift (Barbell)' })).toBeVisible();

    await expect(page.getByTestId('ask-assistant')).toBeDisabled();
  });

  test('Ask is disabled while the model is downloadable but not yet downloaded', async ({ page }) => {
    await setFakeNano(page, { state: 'downloadable', detail: 'DOWNLOADABLE · samsung SM-F968B · SDK 36 · AICore 2026.9.4' });
    await fresh(page);
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill('Romanian Deadlift');
    await page.getByRole('button', { name: /Romanian Deadlift/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Romanian Deadlift (Barbell)' })).toBeVisible();

    await expect(page.getByTestId('ask-assistant')).toBeDisabled();
  });

  test('Ask is enabled once the on-device status is ready', async ({ page }) => {
    await setFakeNano(page, { state: 'ready', detail: 'READY · samsung SM-F968B · SDK 36 · AICore 2026.9.4' });
    await fresh(page);
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill('Romanian Deadlift');
    await page.getByRole('button', { name: /Romanian Deadlift/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Romanian Deadlift (Barbell)' })).toBeVisible();

    await expect(page.getByTestId('ask-assistant')).toBeEnabled();
    await page.getByTestId('ask-assistant').click();
    await expect(page.getByTestId('assistant-input')).toBeVisible();
  });

  test('the assistant sheet shows the real diagnostic, not a fixed line, when it turns out unavailable after opening', async ({ page }) => {
    // Starts ready (so the Ask button is enabled), then the phone-side status changes to
    // unavailable with its own detail before the sheet's own status check runs on open — the same
    // shape as AICore genuinely going away mid-session.
    await setFakeNano(page, { state: 'ready', detail: 'ready-detail' });
    await fresh(page);
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill('Romanian Deadlift');
    await page.getByRole('button', { name: /Romanian Deadlift/ }).first().click();
    await expect(page.getByTestId('ask-assistant')).toBeEnabled();

    const detail = 'UNAVAILABLE · samsung SM-F968B · SDK 36 · AICore 2026.9.4';
    await page.evaluate(
      (d) => {
        (window as unknown as { __ironNanoFake: { status: { state: string; detail: string } } }).__ironNanoFake.status = {
          state: 'unavailable',
          detail: d,
        };
      },
      detail,
    );

    await page.getByTestId('ask-assistant').click();
    await expect(page.getByTestId('assistant-status-detail')).toHaveText(detail);
  });
});

test.describe('Exercise Detail — lock-in cannot zero a lift with no history', () => {
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

  test('Save is allowed at 0 kg once the lift has history', async ({ page }) => {
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
    if (await skip.isVisible().catch(() => false)) await skip.click();

    await page.getByTestId('finish-session').click();
    const finishConfirm = page.getByRole('button', { name: 'Finish', exact: true }).last();
    if (await page.getByText('Finish session?').isVisible().catch(() => false)) await finishConfirm.click();
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
    // History exists (the session just saved), so 0 kg is not blocked the way it is with no history.
    await expect(page.getByTestId('lock-in-save')).toBeEnabled();

    await page.getByTestId('lock-in-save').click();
    await expect(page.getByText('Locked in at', { exact: false })).toBeVisible();
  });
});
