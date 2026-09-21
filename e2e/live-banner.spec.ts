import { expect, test } from '@playwright/test';
import { fresh } from './fresh';

/**
 * The live-session banner (src/App.tsx) is a persistent global control — it sits above every
 * screen while a session is running and is the only way back into that session from elsewhere in
 * the app. It had no test at all until the owner hit a real fault with it on a Galaxy Z Fold 8:
 * it was `sticky top-0` with no safe-area padding, so it drew underneath the system status bar.
 * Its own text collided with the clock, and Resume could not be pressed.
 *
 * What a desktop browser CANNOT exercise: `env(safe-area-inset-top)` is 0 here, so the inset
 * itself never appears and no assertion below would have caught the original bug. What it CAN
 * check is the structural invariant that broke — the banner declares the same `pt-safe` utility
 * every other header in the app uses — plus the behaviour that has never been guarded at all.
 * Stated plainly rather than dressed up: only the phone proves the inset.
 */
test.describe('the live session banner', () => {
  test('appears during a session, is a full-size tap target, and returns to the session', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await expect(page).toHaveURL(/\/session\//);

    // Leave the session by another route; the banner is what gets you back.
    await page.goto('/progress');
    const banner = page.getByTestId('live-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Resume');

    const box = await banner.boundingBox();
    expect(box).not.toBeNull();
    // 44 px is the tap floor this app holds itself to on every other control.
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // Fully on screen: the Fold bug put its top edge behind the status bar.
    expect(box!.y).toBeGreaterThanOrEqual(0);

    await banner.click();
    await expect(page).toHaveURL(/\/session\//);
  });

  test('declares the same safe-area padding as the app header', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await page.goto('/progress');

    // The structural invariant that was broken. The inset resolves to 0 in this browser, so this
    // asserts the declaration, not the rendered offset — the phone is the only real proof.
    await expect(page.getByTestId('live-banner')).toHaveClass(/(^|\s)pt-safe(\s|$)/);
    await expect(page.locator('header').first()).toHaveClass(/(^|\s)pt-safe(\s|$)/);
  });

  test('is absent when no session is running', async ({ page }) => {
    await fresh(page);
    await expect(page.getByTestId('live-banner')).toHaveCount(0);
  });
});
