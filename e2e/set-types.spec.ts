import { expect, test } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * What a logged set counts for, driven through the real UI. A set is weight and reps: the live
 * session offers no set type, before or after logging (the old warm-up row and the type chips in
 * the edit sheet are gone). Rows already stored as warm-up, failure or drop keep their counting
 * rules, which `src/domain/sets.test.ts` and the engine tests cover.
 *
 * Uses "Back Extension" (Lower (Hinge), targetSets 3, bodyweight_plus) so hitting only two counted
 * sets against a target of three exercises the hold_missing_sets path.
 */

async function finishToSummary(page: import('@playwright/test').Page) {
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
}

async function waitForCompletionCollapse(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('exercise-complete')).toBeVisible();
  await expect(page.getByTestId('exercise-complete')).toHaveCount(0);
}

test.describe('set types', () => {
  test('a set is weight and reps: the edit sheet has no type to pick, and a missing set holds the weight', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Lower (Hinge)').click();
    const card = page.getByTestId('exercise-card-Back Extension');
    await expect(card).toBeVisible();
    // Back Extension isn't the current exercise (Romanian Deadlift, order 0, is) — it starts
    // collapsed (§4); tap it open.
    await card.click();
    await expect(card.getByTestId('weight-input')).toBeVisible();

    // Two of the three target sets.
    for (const [w, r] of [[5, 12], [5, 12]] as const) {
      await card.getByTestId('weight-input').fill(String(w));
      await card.getByTestId('reps-input').fill(String(r));
      await card.getByTestId('set-done').click();
      await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
    }

    // Tapping a logged row opens the edit sheet: weight and reps, Delete and Save, and no set type.
    const rows = card.locator('button:has(span.num.w-7)');
    await expect(rows).toHaveCount(2);
    await rows.nth(0).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Edit set', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('radiogroup', { name: 'Set type' })).toHaveCount(0);
    for (const type of ['Warm-up', 'Working', 'Failure', 'Drop']) await expect(sheet.getByRole('button', { name: type, exact: true })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Edit set', { exact: true })).toHaveCount(0);
    expect(await rows.locator('span.num.w-7').allTextContents()).toEqual(['1', '2']);

    await finishToSummary(page);
    const decision = page.getByTestId('decision-Back Extension');
    // Target is 3 sets and only two were done, so it holds for a missing set.
    // The exercise prescribes bodyweight (0); lifting at +5 kg is a deviation, so it is named.
    await expect(decision.getByTestId('decision-line')).toHaveText('2/3 sets (12/12) at +5 kg → hold +5 kg (was bodyweight)');
  });

  test('a feel answer writes its RIR to every counted set (§2 replaces the RIR/RPE picker)', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Lower (Hinge)').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(card).toBeVisible();

    for (const _ of [0, 1, 2, 3]) {
      await card.getByTestId('weight-input').fill('110');
      await card.getByTestId('reps-input').fill('8');
      await card.getByTestId('set-done').click();
      await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
    }
    await waitForCompletionCollapse(page);

    const easy = card.getByTestId('feel-Easy');
    await expect(easy).toHaveAttribute('aria-pressed', 'false');
    await easy.click();
    await expect(easy).toHaveAttribute('aria-pressed', 'true');

    const rirs = await page.evaluate(async () => {
      const req = indexedDB.open('iron');
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = db.transaction('setLogs', 'readonly');
      const all = await new Promise<{ type: string; rir?: number }[]>((res) => {
        const r = tx.objectStore('setLogs').getAll();
        r.onsuccess = () => res(r.result);
      });
      return all.filter((s) => s.type === 'working').map((s) => s.rir);
    });
    expect(rirs).toEqual([3, 3, 3, 3]);
  });
});
