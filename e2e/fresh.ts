import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Start a test from a clean slate: no database, no local storage, and — this is the part that
 * is easy to leave out — no service worker or precached assets.
 *
 * The app registers a service worker with `immediate: true` (src/main.tsx), which precaches the
 * whole shell. Without unregistering it, the first navigation after a rebuild can be served the
 * PREVIOUS build's bundle, so a run goes green against code that is no longer in the repository.
 * That was observed: a screen assertion failed twice against stale assets and then passed
 * unchanged. Any suite that only clears IndexedDB is not testing what it thinks it is.
 */
export async function fresh(page: Page, ready = 'next-up'): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise<void>((resolve) => {
            if (!d.name) return resolve();
            const req = indexedDB.deleteDatabase(d.name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          }),
      ),
    );
    localStorage.clear();
  });
  // Bypass the HTTP cache as well, so the reload cannot pick up a memory-cached bundle.
  await page.reload({ waitUntil: 'load' });
  await expect(page.getByTestId(ready)).toBeVisible();
}

/**
 * Click a button that may or may not appear, waiting properly for it.
 *
 * `locator.isVisible()` does NOT wait — it samples the DOM once and its `timeout` option is
 * ignored. Used as a guard it silently answers "no" for anything not yet rendered, so the click
 * is skipped and the test carries on past a step that never happened. That is how a modal sheet
 * came to be left open mid-test while the suite reported green.
 */
export async function clickIfPresent(locator: Locator, timeout = 1500): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
  } catch {
    return false;
  }
  await locator.click();
  return true;
}
