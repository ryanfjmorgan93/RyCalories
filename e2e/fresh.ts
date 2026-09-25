import { expect, type Browser, type BrowserContext, type CDPSession, type Locator, type Page } from '@playwright/test';

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
 * Log one set on an exercise card and wait until it has actually been recorded.
 *
 * Clicking set-done starts an IndexedDB write; the table only moves on to the next row once the
 * live query answers. Filling the next set's inputs before then types into the row that is still
 * live, so the next click logs whatever faint values the new row starts with (this is how a loop of
 * four 90 × 8 sets came out as 90 × 8 followed by 65 × 8, 8, 6). The positive signal is this set's
 * own logged row appearing, or the card completing when this was its last target set. The baseline
 * count is read before the click, so the wait cannot be satisfied by a row that already existed.
 */
export async function logOneSet(page: Page, card: Locator, weight: number, reps: number): Promise<void> {
  const logged = card.getByTestId('logged-row');
  const before = await logged.count();
  await card.getByTestId('weight-input').fill(String(weight));
  await card.getByTestId('reps-input').fill(String(reps));
  await card.getByTestId('set-done').click();
  await expect(logged.nth(before).or(card.getByTestId('exercise-complete')).or(card.getByTestId('verdict-line')).first()).toBeVisible();
  await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }), 300);
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

/**
 * Actually deny the camera, rather than merely un-granting it: `context.clearPermissions()`
 * leaves a site's camera permission in the "ask" state, which under browser automation (nothing
 * can answer a real prompt) leaves getUserMedia's promise pending forever rather than rejecting
 * it — so the fake camera would still end up live, racing the manual path exactly as before.
 * `Browser.setPermission` with `denied`, scoped to this test's own browser context, is the one
 * thing that makes getUserMedia reject outright, the same as it would for a user who has actually
 * blocked the camera for this site. Shared by every spec that needs to land the barcode sheet (or
 * the recipe builder's "Scan pack") in its manual-entry state reliably.
 */
export async function denyCamera(browser: Browser, context: BrowserContext, page: Page): Promise<void> {
  const pageSession = await context.newCDPSession(page);
  const { targetInfo } = await pageSession.send('Target.getTargetInfo');

  const browserSession = await browser.newBrowserCDPSession();
  await browserSession.send('Browser.setPermission', {
    permission: { name: 'camera' },
    setting: 'denied',
    origin: new URL(page.url()).origin,
    browserContextId: targetInfo.browserContextId,
  });
}

// ---------------------------------------------------------------------------
// Raw IndexedDB seeding, shared between the history-safety and migration specs. Both need to build
// the `iron` database as raw IndexedDB, at an exact past shape, BEFORE the app ever boots — done by
// navigating to a same-origin static asset first (an icon; `vite preview` serves it verbatim, so no
// app JS runs) and creating the database there with `page.evaluate`, then navigating to `/`. This is
// the only way to control what "the database on the phone already looked like" before a build's boot
// code ever touches it.

export interface StoreSpec {
  name: string;
  keyPath: string;
  indexes: { name: string; keyPath: string | string[] }[];
}

/**
 * The exact Dexie v2 schema (src/db/db.ts, before recipes/v3), as raw IndexedDB store/index
 * definitions. Compound index names are the literal `[a+b]` spec string — see Dexie's
 * parseIndexSyntax/nameFromKeyPath — and their keyPath is the field list as an array.
 */
export const IRON_SCHEMA_V2: StoreSpec[] = [
  {
    name: 'exercises',
    keyPath: 'id',
    indexes: [
      { name: 'name', keyPath: 'name' },
      { name: 'kind', keyPath: 'kind' },
      { name: 'muscleGroup', keyPath: 'muscleGroup' },
      { name: 'createdAt', keyPath: 'createdAt' },
    ],
  },
  {
    name: 'routines',
    keyPath: 'id',
    indexes: [
      { name: 'order', keyPath: 'order' },
      { name: 'archived', keyPath: 'archived' },
    ],
  },
  {
    name: 'routineExercises',
    keyPath: 'id',
    indexes: [
      { name: 'routineId', keyPath: 'routineId' },
      { name: 'exerciseId', keyPath: 'exerciseId' },
      { name: '[routineId+order]', keyPath: ['routineId', 'order'] },
    ],
  },
  {
    name: 'sessions',
    keyPath: 'id',
    indexes: [
      { name: 'routineId', keyPath: 'routineId' },
      { name: 'startedAt', keyPath: 'startedAt' },
      { name: 'endedAt', keyPath: 'endedAt' },
      { name: 'source', keyPath: 'source' },
    ],
  },
  {
    name: 'setLogs',
    keyPath: 'id',
    indexes: [
      { name: 'sessionId', keyPath: 'sessionId' },
      { name: 'routineExerciseId', keyPath: 'routineExerciseId' },
      { name: 'exerciseId', keyPath: 'exerciseId' },
      { name: 'completedAt', keyPath: 'completedAt' },
      { name: '[sessionId+exerciseId]', keyPath: ['sessionId', 'exerciseId'] },
      { name: '[sessionId+routineExerciseId]', keyPath: ['sessionId', 'routineExerciseId'] },
      { name: '[exerciseId+completedAt]', keyPath: ['exerciseId', 'completedAt'] },
      { name: '[routineExerciseId+completedAt]', keyPath: ['routineExerciseId', 'completedAt'] },
    ],
  },
  {
    name: 'decisions',
    keyPath: 'id',
    indexes: [
      { name: 'sessionId', keyPath: 'sessionId' },
      { name: 'routineExerciseId', keyPath: 'routineExerciseId' },
      { name: 'decidedAt', keyPath: 'decidedAt' },
      { name: '[routineExerciseId+decidedAt]', keyPath: ['routineExerciseId', 'decidedAt'] },
    ],
  },
  { name: 'bodyweight', keyPath: 'id', indexes: [{ name: 'date', keyPath: 'date' }] },
  { name: 'settings', keyPath: 'id', indexes: [] },
  {
    name: 'meals',
    keyPath: 'id',
    indexes: [
      { name: 'date', keyPath: 'date' },
      { name: 'loggedAt', keyPath: 'loggedAt' },
      { name: '[date+loggedAt]', keyPath: ['date', 'loggedAt'] },
    ],
  },
  {
    name: 'mealItems',
    keyPath: 'id',
    indexes: [
      { name: 'mealId', keyPath: 'mealId' },
      { name: 'name', keyPath: 'name' },
      { name: '[mealId+index]', keyPath: ['mealId', 'index'] },
    ],
  },
  {
    name: 'foods',
    keyPath: 'id',
    indexes: [
      { name: 'key', keyPath: 'key' },
      { name: 'name', keyPath: 'name' },
      { name: 'lastUsedAt', keyPath: 'lastUsedAt' },
    ],
  },
  { name: 'productCache', keyPath: 'key', indexes: [{ name: 'fetchedAt', keyPath: 'fetchedAt' }] },
  { name: 'phases', keyPath: 'id', indexes: [{ name: 'startDate', keyPath: 'startDate' }] },
];

/** The current Dexie schema (v3: `IRON_SCHEMA_V2` plus `recipes`) — what an install already
 * upgraded to the latest version looks like on disk. */
export const IRON_SCHEMA_V3: StoreSpec[] = [
  ...IRON_SCHEMA_V2,
  { name: 'recipes', keyPath: 'id', indexes: [{ name: 'name', keyPath: 'name' }, { name: 'updatedAt', keyPath: 'updatedAt' }] },
];

/** Creates `iron` as raw IndexedDB at `version`, with `schema`, populated with `data`. Must run on a page that has never booted the app (see file header). */
export async function createRawIronDb(page: Page, version: number, schema: StoreSpec[], data: Record<string, unknown[]>): Promise<void> {
  await page.evaluate(
    ({ version, schema, data }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('iron', version);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const store of schema) {
            const os = db.createObjectStore(store.name, { keyPath: store.keyPath });
            for (const idx of store.indexes) os.createIndex(idx.name, idx.keyPath);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const names = Object.keys(data);
          if (names.length === 0) {
            db.close();
            resolve();
            return;
          }
          const tx = db.transaction(names, 'readwrite');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          for (const name of names) {
            const store = tx.objectStore(name);
            for (const row of data[name]) store.put(row);
          }
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('iron database is blocked'));
      });
    },
    { version, schema, data },
  );
}

/** Reads every row of every store in `iron` at whatever version is on disk, bypassing Dexie — the same technique src/boot/recovery.ts uses. */
export async function readRawIron(page: Page): Promise<{ version: number; tables: Record<string, any[]> }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('iron');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const names = Array.from(db.objectStoreNames);
    const tables: Record<string, unknown[]> = {};
    for (const name of names) {
      tables[name] = await new Promise((resolve, reject) => {
        const r = db.transaction(name, 'readonly').objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    const version = db.version;
    db.close();
    return { version, tables };
  });
}

/** Reads the automatic-backup files the app has written, from the Filesystem plugin's OWN IndexedDB store ("Disc" — see @capacitor/filesystem's web implementation), the real artifact the app produced, not a stand-in for it. */
export async function readBackupFiles(page: Page): Promise<{ path: string; content: string }[]> {
  return page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    if (!dbs.some((d) => d.name === 'Disc')) return [];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('Disc');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const entries = await new Promise<any[]>((resolve, reject) => {
      const r = db.transaction('FileStorage', 'readonly').objectStore('FileStorage').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return entries.filter((e) => e.type === 'file' && typeof e.path === 'string' && e.path.startsWith('/DOCUMENTS/Iron/')).map((e) => ({ path: e.path, content: e.content }));
  });
}

export function backupsOfKind(files: { path: string; content: string }[], kind: 'auto' | 'premig' | 'predestr'): { path: string; content: string }[] {
  return files.filter((f) => f.path.split('/').pop()?.startsWith(`iron-${kind}-`));
}

/**
 * Waits for THIS page load's history check to have decided. The baseline and the notice both
 * outlive a reload, so waiting on either can be satisfied by the previous load before this one's
 * check has run — which made "no notice after reload" pass vacuously. main.tsx marks <html> once
 * per load, after the decision is stored.
 */
export async function waitForHistoryCheckSettled(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-history-check', 'done', { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Real touch input.

const touchSessions = new WeakMap<Page, CDPSession>();

/**
 * Drag a finger from `from` to `to` through Chromium's own touch pipeline (CDP
 * `Input.dispatchTouchEvent`), as a phone would.
 *
 * Not a synthetic DOM `TouchEvent`: one of those reaches the page's listeners and nothing else —
 * no native scrolling, no `touch-action`, no "the browser has taken this gesture" — which are
 * exactly what a sheet's pull-to-close has to get right, so a test built on it would pass whatever
 * the sheet did. Checked in this suite's headless Chromium under the Pixel 7 profile
 * (`hasTouch`): these events scroll an `overflow-y: auto` list natively, the first touchmove
 * arrives about 16 px out and is cancelable, and once the browser starts scrolling the rest are
 * not — the same sequence a finger produces.
 *
 * `steps` moves spread over `durationMs`: many over a long time is a slow pull, few over a short
 * time is a flick. Each event carries an explicit timestamp on that schedule, which is what the
 * page sees as `event.timeStamp`: a CDP round trip takes tens of milliseconds, so without it every
 * gesture reached the page slower than written and a flick measured as a slow pull. Moves under
 * ~16 px are swallowed by the browser's own slop, so keep drags longer than that.
 *
 * `holdMs` keeps the finger still before lifting it, so the release has no speed: no fling. A
 * scroll that flings keeps coasting after the finger lifts, and Chrome hands the NEXT touch that
 * starts during the coast to scrolling outright (its touchmoves arrive uncancelable) — so a test
 * that swipes again straight after a flinging scroll is not testing the page's own decision.
 */
export async function swipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { steps = 12, durationMs = 240, holdMs = 0 }: { steps?: number; durationMs?: number; holdMs?: number } = {},
): Promise<void> {
  let cdp = touchSessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    touchSessions.set(page, cdp);
  }
  const at = (f: number) => [{ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f }];
  const start = Date.now() / 1000; // CDP timestamps are seconds since the epoch
  const stepS = durationMs / steps / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0), timestamp: start });
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(durationMs / steps);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / steps), timestamp: start + i * stepS });
  }
  // The finger lifts one frame after its last move, as it does on a phone — or after holding still.
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
    timestamp: start + (durationMs + Math.max(8, holdMs)) / 1000,
  });
}

/** Centre of an element, for `swipe`. Waits for it to be visible first. */
export async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('No bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
