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

/**
 * Wait until the service worker that makes the app work offline has installed and taken control.
 * `ready` resolves once a worker is active, which with Workbox means the whole precache (every
 * asset, including the 900-odd exercise diagrams) has been fetched; `controller` confirms this
 * page is under it, so a reload with the network off is served from the cache.
 */
export async function waitForServiceWorker(page: Page, timeout = 60_000): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout });
}

/**
 * Assert a class is (or is not) in an element's class list, RETRYING.
 *
 * The obvious `getAttribute('class')` version samples the DOM exactly once with no waiting, so it
 * races anything that arrives asynchronously — and in this app nearly everything does: a set is
 * logged by a fired-and-forgotten handler, the Dexie write lands later, and only then does the
 * liveQuery re-render move `border-accent` to the next card. A one-shot read of that is a
 * coin-flip, and it duly failed in CI and passed on retry. `toHaveClass` polls, so it waits out
 * the same round-trip the assertion is actually about.
 *
 * Matches on class-list membership, not substring: "bg-warn" must not match "bg-warn/10".
 */
export async function expectClass(locator: Locator, cls: string, present = true): Promise<void> {
  const re = new RegExp(`(^|\\s)${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
  if (present) await expect(locator).toHaveClass(re);
  else await expect(locator).not.toHaveClass(re);
}
