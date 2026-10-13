import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh, logOneSet } from './fresh';

/**
 * The effort chips (Easy / Good / Hard) decide next session's weight when every set reached the top
 * of the rep range: Easy takes two increments, Good one, Hard holds the weight one more session.
 * Below the top of the range every chip holds. Driven through the real UI, then read back from the
 * NEXT session's own prescription.
 *
 * Fixture: "Bench Press (Barbell)" on Upper (Push) — 4 × 6–8 @ 65 kg, increment 2.5.
 */

const BENCH = 'Bench Press (Barbell)';

async function waitForCompletionCollapse(page: Page) {
  await expect(page.getByTestId('exercise-complete')).toBeVisible();
  await expect(page.getByTestId('exercise-complete')).toHaveCount(0);
}

/** One session of bench: four sets at `reps`, an optional chip, finish, read the Summary, save. */
async function benchSession(page: Page, reps: number, chip: 'Easy' | 'Good' | 'Hard' | null) {
  await page.getByTestId('start-Upper (Push)').click();
  const bench = page.getByTestId(`exercise-card-${BENCH}`);
  for (let i = 0; i < 4; i++) await logOneSet(page, bench, 65, reps);
  await waitForCompletionCollapse(page);
  if (chip) {
    const button = bench.getByTestId(`feel-${chip}`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  const decision = page.getByTestId(`decision-${BENCH}`);
  await expect(decision).toBeVisible();
  return decision;
}

async function saveAndStartAgain(page: Page) {
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByTestId('start-Upper (Push)').click();
  return page.getByTestId(`exercise-card-${BENCH}`);
}

test.describe('effort chips decide the next prescription', () => {
  test('there are three chips: Easy, Good and Hard (Maxed is gone)', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    const bench = page.getByTestId(`exercise-card-${BENCH}`);
    for (let i = 0; i < 4; i++) await logOneSet(page, bench, 65, 8);
    await waitForCompletionCollapse(page);
    await expect(bench.getByTestId('feel-Easy')).toBeVisible();
    await expect(bench.getByTestId('feel-Good')).toBeVisible();
    await expect(bench.getByTestId('feel-Hard')).toBeVisible();
    await expect(bench.getByTestId('feel-Maxed')).toHaveCount(0);
    await expect(bench.locator('[data-testid^="feel-"]')).toHaveCount(3);
  });

  test('Easy at the top of the range: two increments (65 → 70 kg) on the next prescription', async ({ page }) => {
    await fresh(page);
    const decision = await benchSession(page, 8, 'Easy');
    await expect(decision.getByTestId('decision-line')).toHaveText('8/8/8/8 at 65 kg → 70 kg next time');
    await expect(decision.getByTestId('decision-reason')).toHaveText('Felt easy: up 5 kg');
    const next = await saveAndStartAgain(page);
    await expect(next).toContainText('4 sets of 6–8 · 70 kg');
  });

  test('Good at the top of the range: one increment (65 → 67.5 kg)', async ({ page }) => {
    await fresh(page);
    const decision = await benchSession(page, 8, 'Good');
    await expect(decision.getByTestId('decision-line')).toHaveText('8/8/8/8 at 65 kg → 67.5 kg next time');
    const next = await saveAndStartAgain(page);
    await expect(next).toContainText('4 sets of 6–8 · 67.5 kg');
  });

  test('no chip counts as Good: one increment', async ({ page }) => {
    await fresh(page);
    const decision = await benchSession(page, 8, null);
    await expect(decision.getByTestId('decision-line')).toHaveText('8/8/8/8 at 65 kg → 67.5 kg next time');
    await expect(decision.getByTestId('decision-reason')).toHaveCount(0);
    const next = await saveAndStartAgain(page);
    await expect(next).toContainText('4 sets of 6–8 · 67.5 kg');
  });

  test('Hard at the top of the range: the weight is held one more session, and the Summary says why', async ({ page }) => {
    await fresh(page);
    const decision = await benchSession(page, 8, 'Hard');
    await expect(decision.getByTestId('decision-line')).toHaveText('8/8/8/8 at 65 kg → hold 65 kg');
    await expect(decision.getByTestId('decision-reason')).toHaveText('Marked Hard, so 65 kg again');
    const next = await saveAndStartAgain(page);
    await expect(next).toContainText('4 sets of 6–8 · 65 kg');
    // Stored as its own rule, so History and the exercise page can say so.
    const rules = await page.evaluate(async () => {
      const req = indexedDB.open('iron');
      const idb = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const rows = await new Promise<{ rule: string }[]>((res) => {
        const r = idb.transaction('decisions', 'readonly').objectStore('decisions').getAll();
        r.onsuccess = () => res(r.result);
      });
      idb.close();
      return rows.map((d) => d.rule);
    });
    expect(rules).toContain('hold_hard');
  });

  test('the live verdict follows the chip: two increments for Easy, "Marked Hard" for Hard', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    const bench = page.getByTestId(`exercise-card-${BENCH}`);
    for (let i = 0; i < 4; i++) await logOneSet(page, bench, 65, 8);
    await waitForCompletionCollapse(page);
    await expect(bench.getByTestId('verdict-line')).toHaveText('→ 67.5 kg next time');
    await bench.getByTestId('feel-Easy').click();
    await expect(bench.getByTestId('verdict-line')).toHaveText('→ 70 kg next time');
    await bench.getByTestId('feel-Hard').click();
    await expect(bench.getByTestId('verdict-line')).toHaveText('Marked Hard, so 65 kg again');
    // The same chip again clears it.
    await bench.getByTestId('feel-Hard').click();
    await expect(bench.getByTestId('feel-Hard')).toHaveAttribute('aria-pressed', 'false');
    await expect(bench.getByTestId('verdict-line')).toHaveText('→ 67.5 kg next time');
  });

  test('below the top of the range every chip holds the weight', async ({ page }) => {
    await fresh(page);
    const decision = await benchSession(page, 7, 'Easy');
    await expect(decision.getByTestId('decision-line')).toHaveText('7/7/7/7 at 65 kg → hold 65 kg');
    await expect(decision.getByTestId('decision-reason')).toHaveCount(0);
    const next = await saveAndStartAgain(page);
    await expect(next).toContainText('4 sets of 6–8 · 65 kg');
  });

  test('an earlier Maxed answer (RIR 0) shows as Hard on the done card and holds the weight', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    const bench = page.getByTestId(`exercise-card-${BENCH}`);
    for (let i = 0; i < 4; i++) await logOneSet(page, bench, 65, 8);
    await waitForCompletionCollapse(page);
    // Write the retired answer straight into the sets, as an older build would have left it.
    await page.evaluate(async () => {
      const req = indexedDB.open('iron');
      const idb = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = idb.transaction('setLogs', 'readwrite');
      const store = tx.objectStore('setLogs');
      const all = await new Promise<{ id: string }[]>((res) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result);
      });
      for (const s of all) store.put({ ...s, rir: 0 });
      await new Promise((res) => {
        tx.oncomplete = () => res(undefined);
      });
      idb.close();
    });
    // A raw write is not seen by the live queries: reload to read it back.
    await page.reload();
    const again = page.getByTestId(`exercise-card-${BENCH}`);
    await expect(again.getByTestId('feel-Hard')).toHaveAttribute('aria-pressed', 'true');
    await expect(again.getByTestId('feel-Easy')).toHaveAttribute('aria-pressed', 'false');
    await expect(again.getByTestId('verdict-line')).toHaveText('Marked Hard, so 65 kg again');
  });

  test('moving up mid-session: next time starts from the heaviest weight done for the range, not the old prescription', async ({ page }) => {
    // The owner's adductor case on bench: prescribed 65, lifted 65 then 80 three times, marked Hard.
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    const bench = page.getByTestId(`exercise-card-${BENCH}`);
    await logOneSet(page, bench, 65, 8);
    for (let i = 0; i < 3; i++) await logOneSet(page, bench, 80, 8);
    await waitForCompletionCollapse(page);
    const hard = bench.getByTestId('feel-Hard');
    await hard.click();
    await expect(hard).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('finish-session').click();
    await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
    await expect(page).toHaveURL(/\/summary$/);
    const decision = page.getByTestId(`decision-${BENCH}`);
    await expect(decision.getByTestId('decision-line')).toHaveText('8 at 65 kg, 8/8/8 at 80 kg → hold 80 kg (was 65 kg)');
    await expect(decision.getByTestId('decision-reason')).toHaveText('Heaviest set in the rep range: 80 kg, so 80 kg next time');
    // The Summary asks for no niggles and no checklist any more.
    await expect(page.getByText('Niggles', { exact: true })).toHaveCount(0);
    const next = await saveAndStartAgain(page);
    await expect(next).toContainText('4 sets of 6–8 · 80 kg');
  });
});
