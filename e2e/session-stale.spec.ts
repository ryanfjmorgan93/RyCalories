import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, expectClass, fresh, logOneSet, readRawIron } from './fresh';

/**
 * A session left open for hours is almost certainly a forgotten one. Past eight hours the dock
 * says how long ago it started instead of "Live", its clock turns to the warning colour, and the
 * session screen offers Finish and Discard on a line of its own (src/domain/session.ts).
 */

const STALE_LABEL = 'Started 9 h ago';

/** Move the one open session's start back by 9 h 5 min, straight in IndexedDB. */
async function ageActiveSession(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('iron');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const rows = await new Promise<{ id: string; startedAt: string; endedAt?: string }[]>((resolve, reject) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const open = rows.filter((s) => !s.endedAt);
    if (open.length !== 1) throw new Error(`expected one open session, found ${open.length}`);
    store.put({ ...open[0], startedAt: new Date(Date.now() - (9 * 60 + 5) * 60_000).toISOString() });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
}

test('a fresh session shows Live, and a nine-hour-old one shows how long ago it started', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('start-session').click();
  await expect(page).toHaveURL(/\/session\//);
  const sessionUrl = page.url();
  // The session screen itself, while the session is fresh: no stale line.
  await expect(page.getByTestId('finish-session')).toBeVisible();
  await expect(page.getByTestId('stale-session')).toHaveCount(0);

  await page.goto('/');
  const caption = page.getByTestId('live-banner-caption');
  await expect(caption).toHaveText('Live');
  await expectClass(page.getByTestId('live-banner-clock'), 'text-warn', false);

  await ageActiveSession(page);
  await page.reload({ waitUntil: 'load' });
  await expect(caption).toHaveText(STALE_LABEL);
  await expectClass(page.getByTestId('live-banner-clock'), 'text-warn');

  // The same session, on its own screen: the line, with both ways out.
  await page.goto(sessionUrl);
  const line = page.getByTestId('stale-session');
  await expect(line).toBeVisible();
  await expect(page.getByTestId('stale-session-age')).toHaveText(STALE_LABEL);
  await expect(line.getByRole('button', { name: 'Finish' })).toBeVisible();
  await expect(line.getByRole('button', { name: 'Discard' })).toBeVisible();
});

test('Discard on the stale line discards the session', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('start-session').click();
  await expect(page).toHaveURL(/\/session\//);
  await ageActiveSession(page);
  await page.reload({ waitUntil: 'load' });

  await expect(page.getByTestId('stale-session-age')).toHaveText(STALE_LABEL);
  await page.getByTestId('stale-discard').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  // The session is gone from the database, and so is the dock that pointed at it.
  await expect.poll(async () => (await readRawIron(page)).tables.sessions.length).toBe(0);
  await expect(page.getByTestId('live-banner')).toHaveCount(0);
});

test('Finish on the stale line goes to the summary of what was logged', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('start-session').click();
  await expect(page).toHaveURL(/\/session\//);
  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await logOneSet(page, card, 110, 8);
  await ageActiveSession(page);
  await page.reload({ waitUntil: 'load' });

  await expect(page.getByTestId('stale-session-age')).toHaveText(STALE_LABEL);
  await page.getByTestId('stale-finish').click();
  // Required exercises are still undone, so the existing finish sheet asks first.
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
});
