import { expect, test, type Page } from '@playwright/test';
import { fresh } from './fresh';

/**
 * The way back into a running workout (the session dock, `data-testid="live-banner"`, src/App.tsx).
 *
 * It used to sit across the top of the screen, and on the owner's Galaxy Z Fold 8 it drew under
 * the Android status bar twice: its text collided with the clock, and a tap there pulls down the
 * notification shade instead of reaching the app. Every test passed both times, because a desktop
 * browser reports `env(safe-area-inset-top)` as 0 — there was never a status bar to collide with.
 *
 * Every inset in the app now goes through `--inset-top` / `--inset-bottom` (src/index.css), so these
 * tests set them to a real phone's values and check the layout actually clears them. That exercises
 * the layout under an inset; it does not prove what the phone's WebView reports for env(), which
 * only the phone can.
 */

/** A status bar and a gesture bar, sized like the Fold's. */
const INSET_TOP = 40;
const INSET_BOTTOM = 24;

async function simulateInsets(page: Page): Promise<void> {
  await page.evaluate(
    ([top, bottom]) => {
      document.documentElement.style.setProperty('--inset-top', `${top}px`);
      document.documentElement.style.setProperty('--inset-bottom', `${bottom}px`);
    },
    [INSET_TOP, INSET_BOTTOM],
  );
}

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox();
  expect(b, `${testId} has no box`).not.toBeNull();
  return b!;
}

test.describe('the session dock', () => {
  test('sits above the tab bar during a workout, is a full-size target, and returns to it', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await expect(page).toHaveURL(/\/session\//);

    await page.goto('/progress');
    const dock = page.getByTestId('live-banner');
    await expect(dock).toBeVisible();
    await expect(dock).toContainText('Resume');

    const d = await box(page, 'live-banner');
    const nav = await page.locator('nav').boundingBox();
    expect(nav).not.toBeNull();
    // Docked above the tab bar, not overlapping it, and in the bottom half where the thumb is.
    expect(d.y + d.height).toBeLessThanOrEqual(nav!.y);
    expect(d.y).toBeGreaterThan(page.viewportSize()!.height / 2);
    // 44 px is the tap floor this app holds itself to everywhere.
    expect(d.height).toBeGreaterThanOrEqual(44);

    await dock.click();
    await expect(page).toHaveURL(/\/session\//);
  });

  test('with a real status bar and gesture bar, nothing tappable sits in either', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await expect(page).toHaveURL(/\/session\//);

    // The session screen: its header controls must clear the status bar.
    await simulateInsets(page);
    const finish = await box(page, 'finish-session');
    expect(finish.y).toBeGreaterThanOrEqual(INSET_TOP);

    // A tab screen with the dock showing.
    await page.goto('/settings');
    await simulateInsets(page);
    await expect(page.getByTestId('live-banner')).toBeVisible();

    const vh = page.viewportSize()!.height;
    const title = await page.getByRole('heading', { name: 'Settings' }).boundingBox();
    expect(title).not.toBeNull();
    expect(title!.y).toBeGreaterThanOrEqual(INSET_TOP);

    const d = await box(page, 'live-banner');
    expect(d.y).toBeGreaterThanOrEqual(INSET_TOP);

    // The tab bar's links sit above the gesture bar, and the dock sits above the tab bar.
    const links = page.locator('nav a');
    for (let i = 0; i < (await links.count()); i++) {
      const l = await links.nth(i).boundingBox();
      expect(l!.y + l!.height).toBeLessThanOrEqual(vh - INSET_BOTTOM + 0.5);
      expect(d.y + d.height).toBeLessThanOrEqual(l!.y);
    }
  });

  test('a running rest timer stacks above the dock instead of covering it', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await expect(page).toHaveURL(/\/session\//);

    await page.getByTestId('weight-input').first().fill('100');
    await page.getByTestId('reps-input').first().fill('8');
    await page.getByTestId('set-done').first().click();
    await expect(page.getByTestId('rest-timer')).toBeVisible();

    await page.goto('/progress');
    await expect(page.getByTestId('rest-timer')).toBeVisible();
    await expect(page.getByTestId('live-banner')).toBeVisible();

    const timer = await box(page, 'rest-timer');
    const d = await box(page, 'live-banner');
    expect(timer.y + timer.height).toBeLessThanOrEqual(d.y + 1);
  });

  test('shows on Home too, above the tab bar, with no separate in-progress card', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await expect(page).toHaveURL(/\/session\//);

    await page.goto('/progress');
    await expect(page.getByTestId('live-banner')).toBeVisible();

    // Home's own in-progress card (with its own Resume) is gone; the dock is the only way back
    // into the workout everywhere, Home included.
    await page.goto('/');
    const dock = page.getByTestId('live-banner');
    await expect(dock).toBeVisible();
    await expect(dock).toContainText('Resume');
    await expect(page.getByText('Session in progress')).toHaveCount(0);
    await expect(page.getByTestId('resume-session')).toHaveCount(0);

    const d = await box(page, 'live-banner');
    const nav = await page.locator('nav').boundingBox();
    expect(nav).not.toBeNull();
    expect(d.y + d.height).toBeLessThanOrEqual(nav!.y);

    await dock.click();
    await expect(page).toHaveURL(/\/session\//);
  });

  test('on Home, clears a real status bar and gesture bar too', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await expect(page).toHaveURL(/\/session\//);

    await page.goto('/');
    await simulateInsets(page);
    await expect(page.getByTestId('live-banner')).toBeVisible();

    const vh = page.viewportSize()!.height;
    const d = await box(page, 'live-banner');
    expect(d.y).toBeGreaterThanOrEqual(INSET_TOP);

    // The tab bar's links sit above the gesture bar, and the dock sits above the tab bar — same
    // contract as every other tab screen, now proven on Home as well.
    const links = page.locator('nav a');
    for (let i = 0; i < (await links.count()); i++) {
      const l = await links.nth(i).boundingBox();
      expect(l!.y + l!.height).toBeLessThanOrEqual(vh - INSET_BOTTOM + 0.5);
      expect(d.y + d.height).toBeLessThanOrEqual(l!.y);
    }
  });

  test('while resting, the bottom of a screen can still be scrolled clear of the timer and dock', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await page.getByTestId('weight-input').first().fill('100');
    await page.getByTestId('reps-input').first().fill('8');
    await page.getByTestId('set-done').first().click();
    await expect(page.getByTestId('rest-timer')).toBeVisible();

    await page.goto('/settings');
    await expect(page.getByTestId('rest-timer')).toBeVisible();
    await expect(page.getByTestId('live-banner')).toBeVisible();

    // Scroll to the very end: the last line on the page must end above the floating timer.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = page.getByTestId('build-id');
    await expect(last).toBeVisible();
    const l = await box(page, 'build-id');
    const timer = await box(page, 'rest-timer');
    expect(l.y + l.height).toBeLessThanOrEqual(timer.y);
  });

  test('is absent when no workout is running', async ({ page }) => {
    await fresh(page);
    await expect(page.getByTestId('live-banner')).toHaveCount(0);
  });
});

test('Settings names the exact build, so it is clear whether a fix has reached the phone', async ({ page }) => {
  await fresh(page);
  await page.goto('/settings');
  // Outside CI the run is "local"; in CI it is the run number and commit. Either way, never bare.
  await expect(page.getByTestId('build-id')).toHaveText(/^Iron \d+\.\d+\.\d+ · build (\d+ · [0-9a-f]{7}|local)$/);
});
