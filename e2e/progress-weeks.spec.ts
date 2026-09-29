import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh, logOneSet } from './fresh';

/**
 * Progress → Weekly sets can be stepped back through earlier weeks. The body map above it stays on
 * this week.
 */

/** Complete a real session today: two working sets of Romanian deadlift, which is hamstrings. */
async function completeSession(page: Page): Promise<void> {
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await logOneSet(page, card, 110, 8);
  await logOneSet(page, card, 110, 7);
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

test('the weekly sets card steps back a week and forward again', async ({ page }) => {
  await fresh(page);
  await completeSession(page);

  await page.goto('/progress');
  const label = page.getByTestId('week-label');
  const prev = page.getByTestId('week-prev');
  const next = page.getByTestId('week-next');
  const row = page.getByTestId('weekly-row-hamstrings');

  // This week: today's two sets are counted, and there is nothing later to step to.
  await expect(label).toHaveText('This week');
  await expect(row).toHaveText(/hamstrings\s*2( of \d+)?$/);
  await expect(next).toBeDisabled();

  await prev.click();
  await expect(label).toHaveText(/^Week of \d{1,2} \w+/);
  // The week's own answer, not the one just left: the empty state names the other week, and the
  // row that showed 2 a moment ago is gone.
  await expect(page.getByText('No sets logged that week.')).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(next).toBeEnabled();

  await next.click();
  await expect(label).toHaveText('This week');
  await expect(row).toHaveText(/hamstrings\s*2( of \d+)?$/);
  await expect(next).toBeDisabled();
});

test('sets logged last week show under the previous week and not under this one', async ({ page }) => {
  await fresh(page);
  await completeSession(page);

  // Move the session's sets back seven days in the database itself — the only way to have
  // last week's training without waiting a week — then load Progress fresh, so it reads them.
  const moved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('iron');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction('setLogs', 'readwrite');
      let n = 0;
      const cursor = tx.objectStore('setLogs').openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        const row = c.value as { completedAt: string };
        const d = new Date(row.completedAt);
        d.setDate(d.getDate() - 7);
        c.update({ ...row, completedAt: d.toISOString() });
        n++;
        c.continue();
      };
      tx.oncomplete = () => resolve(n);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return count;
  });
  expect(moved).toBeGreaterThanOrEqual(2);

  await page.goto('/progress');
  const label = page.getByTestId('week-label');
  const row = page.getByTestId('weekly-row-hamstrings');

  await expect(label).toHaveText('This week');
  await expect(page.getByText('No sets logged this week.')).toBeVisible();
  await expect(row).toHaveCount(0);

  await page.getByTestId('week-prev').click();
  await expect(label).toHaveText(/^Week of \d{1,2} \w+/);
  await expect(row).toHaveText(/hamstrings\s*2( of \d+)?$/);

  // A second step back is a week with nothing in it.
  await page.getByTestId('week-prev').click();
  await expect(page.getByText('No sets logged that week.')).toBeVisible();
  await expect(row).toHaveCount(0);

  await page.getByTestId('week-next').click();
  await expect(row).toHaveText(/hamstrings\s*2( of \d+)?$/);
  await page.getByTestId('week-next').click();
  await expect(label).toHaveText('This week');
  await expect(page.getByText('No sets logged this week.')).toBeVisible();
});
