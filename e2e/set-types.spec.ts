import { expect, test } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * The four set types (warm-up, working, failure, drop) driven through the real UI.
 *
 * The live session has no way to choose a type before logging (except a warm-up ghost row, which
 * logs itself directly at its own weight/reps) — a set is retyped afterwards, by tapping the
 * logged row to open EditSetSheet, which still carries all four chips. Every set below is still
 * logged, every type still ends up on the right set, and the assertions about what counts for the
 * decision are unchanged from before Phase 3C.
 *
 * Uses "Back Extension" (Lower (Hinge), targetSets 3, bodyweight_plus) so hitting only two counted
 * sets against a target of three exercises the hold_missing_sets path. Its target is met after the
 * 3rd plain log — the completion moment plays and the card collapses — so the 4th set (which ends
 * up retyped to a drop, and so never should have counted) is added afterwards via the ⋯ menu.
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

/** Retype the nth logged row (0-based, in logging order) via EditSetSheet. */
async function retype(page: import('@playwright/test').Page, rows: import('@playwright/test').Locator, nth: number, type: string) {
  await rows.nth(nth).click();
  await expect(page.getByText('Edit set', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: type, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Edit set', { exact: true })).toHaveCount(0);
}

test.describe('set types', () => {
  test('warm-up, working, failure and drop, set via the edit sheet; only working/failure count toward the decision', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Back Extension');
    await expect(card).toBeVisible();
    // Back Extension isn't the current exercise (Romanian Deadlift, order 0, is) — it starts
    // collapsed (§4); tap it open.
    await card.click();
    await expect(card.getByTestId('weight-input')).toBeVisible();

    // Log the 3 target sets as plain working sets — the session itself has no way to pick a type
    // before logging. Target met on the 3rd — the completion moment plays and the card collapses.
    for (const [w, r] of [[5, 12], [5, 12], [5, 12]] as const) {
      await card.getByTestId('weight-input').fill(String(w));
      await card.getByTestId('reps-input').fill(String(r));
      await card.getByTestId('set-done').click();
      await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
    }
    await waitForCompletionCollapse(page);

    // A 4th set, only reachable via the ⋯ menu now that the target is met.
    await card.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('add-set').click();
    await card.getByTestId('weight-input').fill('2');
    await card.getByTestId('reps-input').fill('15');
    await card.getByTestId('set-done').click();

    // Retype set 1 → warm-up, set 3 → failure, set 4 → drop; set 2 stays the default, working.
    // `.nth()` addresses sets by logged position, which edit-sheet type changes never reorder.
    const rows = card.locator('button:has(span.num.w-7)');
    await expect(rows).toHaveCount(4);
    await retype(page, rows, 0, 'Warm-up');
    await retype(page, rows, 2, 'Failure');
    await retype(page, rows, 3, 'Drop');

    const badges = await rows.locator('span.num.w-7').allTextContents();
    expect(badges).toEqual(['W', '1', '2', 'D']);

    await finishToSummary(page);
    const decision = page.getByTestId('decision-Back Extension');
    // Target is 3 sets; only the working + failure set count, so it holds for a missing set.
    // The exercise prescribes bodyweight (0); lifting at +5 kg is a deviation, so it is named.
    // These numbers are identical to what this spec asserted before the set table was rebuilt.
    await expect(decision.getByTestId('decision-line')).toHaveText('2/3 sets (12/12) at +5 kg → hold +5 kg (was bodyweight)');
  });

  test('a feel answer writes its RIR to every counted set (§2 replaces the RIR/RPE picker)', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
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
