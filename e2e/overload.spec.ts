import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, expectClass, fresh } from './fresh';

/**
 * WP4 — the live-session overlays (deload, supersets, warm-ups, plate maths, personal records,
 * swap, how-to), driven through the real UI against seeded data.
 *
 * There is no UI yet to link a superset (that is the routine editor's job, owned by a different
 * work package), so the "superset" test links the pair directly in IndexedDB — the same shape
 * `toggleSupersetWithNext` would write — rather than driving a control that does not exist.
 */

/**
 * Link two adjacent required routine-exercise rows into a superset directly in IndexedDB — the
 * same shape `toggleSupersetWithNext` would write — since there is no UI yet to do it (that is
 * the routine editor's job, owned by a different work package).
 */
async function linkSuperset(page: Page, ids: [string, string], supersetId: string): Promise<void> {
  await page.evaluate(
    async ({ ids, supersetId }) => {
      const req = indexedDB.open('iron');
      const idb = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = idb.transaction('routineExercises', 'readwrite');
      const store = tx.objectStore('routineExercises');
      for (const id of ids) {
        const row = await new Promise<{ supersetId?: string }>((res) => {
          const r = store.get(id);
          r.onsuccess = () => res(r.result);
        });
        store.put({ ...row, id, supersetId });
      }
      await new Promise((res) => {
        tx.oncomplete = () => res(undefined);
      });
    },
    { ids, supersetId },
  );
}

async function finishToSummary(page: Page) {
  await page.getByTestId('finish-session').click();
  const finish = page.getByRole('button', { name: 'Finish', exact: true }).last();
  if (await page.getByText('Finish session?').isVisible().catch(() => false)) await finish.click();
  await expect(page).toHaveURL(/\/summary$/);
}

async function logSets(page: Page, exercise: string, weight: number, reps: number[]) {
  const card = page.getByTestId(`exercise-card-${exercise}`);
  await expect(card).toBeVisible();
  for (const r of reps) {
    await card.getByTestId('weight-input').fill(String(weight));
    await card.getByTestId('reps-input').fill(String(r));
    await card.getByTestId('set-done').click();
    const skip = page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
  }
}

test.describe('WP4 overlays', () => {
  test('deload: reduces the prescribed weight, the summary shows it, the stored weight is unchanged', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Lower (Hinge)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await expect(page).toHaveURL(/\/session\//);

    await page.getByTestId('session-options').click();
    await page.getByRole('switch', { name: 'Deload session' }).click();
    await page.keyboard.press('Escape');

    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(card).toContainText('deload');
    const weightValue = Number(await card.getByTestId('weight-input').inputValue());
    expect(weightValue).toBeLessThan(110);

    await logSets(page, 'Romanian Deadlift (Barbell)', weightValue, [8, 8, 8, 8]);
    await finishToSummary(page);

    const decision = page.getByTestId('decision-Romanian Deadlift (Barbell)');
    await expect(decision).toContainText('deload');
    await expect(decision.getByTestId('decision-line')).toContainText('stays');
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    // The stored weight didn't move: the routine editor still prescribes the original 110 kg.
    await page.goto('/routines');
    await page.getByText('Lower (Hinge)', { exact: true }).click();
    await expect(page.getByTestId('rx-card-Romanian Deadlift (Barbell)')).toContainText('@ 110 kg');
  });

  test('superset: bracket label, alternating current highlight, rest timer only after the second', async ({ page }) => {
    await fresh(page);

    // Bench Press (order 0) and Incline DB Press (order 1) in "Upper (Push)" — adjacent, both required.
    await linkSuperset(page, ['06e6d774-dded-5317-a459-3c24a575f9a5', '23809c40-32bd-5fe4-8f71-eb2efdb47cc6'], 'superset-test-1');

    await page.getByTestId('start-Upper (Push)').click();
    await expect(page).toHaveURL(/\/session\//);
    await expect(page.getByText('Superset', { exact: true })).toBeVisible();

    const benchCard = page.getByTestId('exercise-card-Bench Press (Barbell)');
    const inclineCard = page.getByTestId('exercise-card-Incline DB Press');
    await expect(benchCard).toBeVisible();
    await expect(inclineCard).toBeVisible();

    // A (Bench) is current first — both start at 0 done, ties go to order.
    await expectClass(benchCard, 'border-accent');

    await benchCard.getByTestId('weight-input').fill('65');
    await benchCard.getByTestId('reps-input').fill('6');
    await benchCard.getByTestId('set-done').click();
    // A isn't the last member of the group, so the current-card highlight moves to B and no rest
    // timer starts. Wait for the highlight to actually move first: the rest-timer count is 0 before
    // the click too, so asserting it first would wait for nothing and race the check that matters.
    await expectClass(inclineCard, 'border-accent');
    await expectClass(benchCard, 'border-accent', false);
    await expect(page.getByTestId('rest-timer')).toHaveCount(0);

    await inclineCard.getByTestId('weight-input').fill('20');
    await inclineCard.getByTestId('reps-input').fill('8');
    await inclineCard.getByTestId('set-done').click();
    // B is the last member logged — the rest timer starts now.
    await expect(page.getByTestId('rest-timer')).toBeVisible();

    expect(await benchCard.locator('button span.num.w-7').allTextContents()).toEqual(['1']);
    expect(await inclineCard.locator('button span.num.w-7').allTextContents()).toEqual(['1']);
  });

  test('superset: rest timer fires from the remaining member once the other is skipped', async ({ page }) => {
    await fresh(page);

    // Same Bench Press / Incline DB Press pair as above, in "Upper (Push)".
    await linkSuperset(page, ['06e6d774-dded-5317-a459-3c24a575f9a5', '23809c40-32bd-5fe4-8f71-eb2efdb47cc6'], 'superset-test-2');

    await page.getByTestId('start-Upper (Push)').click();
    await expect(page).toHaveURL(/\/session\//);

    const benchCard = page.getByTestId('exercise-card-Bench Press (Barbell)');
    const inclineCard = page.getByTestId('exercise-card-Incline DB Press');
    await expect(benchCard).toBeVisible();
    await expect(inclineCard).toBeVisible();

    // Skip the later-ordered member (Incline, order 1) via its More sheet.
    await inclineCard.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Skip this exercise' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(inclineCard).toContainText('skipped');

    // Bench is now the only member left to log. Array position (last in the group) would never
    // start the timer here since Incline never logs again — it must come from whichever member
    // is still active.
    await benchCard.getByTestId('weight-input').fill('65');
    await benchCard.getByTestId('reps-input').fill('6');
    await benchCard.getByTestId('set-done').click();
    await expect(page.getByTestId('rest-timer')).toBeVisible();
  });

  test('warm-up pills and plates on a known barbell weight', async ({ page }) => {
    await fresh(page);

    // Lock Bench Press in at 60 kg via the ordinary override flow (acceptance.spec.ts style).
    await page.getByTestId('start-Upper (Push)').click();
    await logSets(page, 'Bench Press (Barbell)', 65, [6, 6, 6, 6]);
    await finishToSummary(page);
    const decision = page.getByTestId('decision-Bench Press (Barbell)');
    await decision.getByTestId('override').click();
    await decision.getByTestId('override-input').fill('60');
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    await page.getByTestId('start-Upper (Push)').click();
    const card = page.getByTestId('exercise-card-Bench Press (Barbell)');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('weight-input')).toHaveValue('60');

    // Plate maths for the 60 kg default, before anything changes the draft.
    await expect(card.getByTestId('plate-line')).toHaveText('20 per side');
    await card.getByTestId('plate-line').click();
    await expect(page.getByText('Plates', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // Warm-up pills, shown only before a counted set exists. The session no longer has a set-type
    // chip row to check for the "active" state; the pill's own tap sets the draft type, provable
    // by the log button now reading "Warm-up done".
    await expect(card.getByTestId('warmup-pill-0')).toHaveText('20 × 10');
    await card.getByTestId('warmup-pill-0').click();
    await expect(card.getByTestId('set-done')).toHaveText(/Warm-up done/);
    await expect(card.getByTestId('weight-input')).toHaveValue('20');
  });

  test('personal record: a beaten reps-at-weight gets a PR chip and the summary lists it', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    const card = page.getByTestId('exercise-card-Bench Press (Barbell)');
    await expect(card).toBeVisible();

    await card.getByTestId('weight-input').fill('60');
    await card.getByTestId('reps-input').fill('8');
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));

    await card.getByTestId('weight-input').fill('60');
    await card.getByTestId('reps-input').fill('9');
    await card.getByTestId('set-done').click();

    // Both rows are first-ever sets, so both are PRs (weight/e1RM/volume on the first, reps-at-weight
    // on the second) — the second, in DOM order, is the one the spec calls out.
    await expect(card.getByTestId('pr-chip').nth(1)).toBeVisible();

    await finishToSummary(page);
    await expect(page.getByTestId('decision-Bench Press (Barbell)')).toContainText('PR reps');
  });

  test('swap: substitutes an exercise for the session, and undo restores it', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    // Triceps Pushdown is the only triceps exercise already in this routine; its one same-muscle
    // substitute (Overhead Triceps Extension) lives only in "Arms", so no duplicate card appears.
    const card = page.getByTestId('exercise-card-Triceps Pushdown');
    await expect(card).toBeVisible();
    // Not the current exercise (order 3 of 4) — starts collapsed; tap it open to reach "More".
    await card.click();
    await card.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Swap exercise' }).click();
    await page.getByText('Overhead Triceps Extension', { exact: true }).click();

    await expect(card).toContainText('Swapped for Overhead Triceps Extension');
    const subCard = page.getByTestId('exercise-card-Overhead Triceps Extension');
    await expect(subCard).toBeVisible();
    await expect(subCard).toContainText('extra');

    await card.getByRole('button', { name: 'Undo' }).click();
    await expect(card).not.toContainText('Swapped for');
    await expect(page.getByTestId('exercise-card-Overhead Triceps Extension')).toHaveCount(0);
  });

  test('swap: excludes an exercise already in the session, offering only what is left', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Upper (Pull)').click();
    await expect(page).toHaveURL(/\/session\//);

    // Add Incline DB Curl (biceps) as an extra, alongside the routine's own DB Curl (biceps).
    await page.getByRole('button', { name: 'Add exercise (this session only)' }).click();
    await page.getByRole('dialog').getByText('Incline DB Curl', { exact: true }).click();
    await expect(page.getByTestId('exercise-card-Incline DB Curl')).toBeVisible();

    // DB Curl and Incline DB Curl are both biceps and both now in the session; Hammer Curl (also
    // biceps) isn't, so it's the only exercise the swap sheet offers.
    const card = page.getByTestId('exercise-card-DB Curl');
    await expect(card).toBeVisible();
    // Not the current exercise (order 3 of 4) — starts collapsed; tap it open to reach "More".
    await card.click();
    await card.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Swap exercise' }).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Incline DB Curl', { exact: true })).toHaveCount(0);
    await expect(sheet.getByText('Hammer Curl', { exact: true })).toBeVisible();
  });

  test('swap: nothing to offer once every same-muscle exercise is already in the session', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    // Bench Press and Incline DB Press are the only two chest exercises in the app, and both are
    // already in this routine — there is nothing left to swap in.
    const card = page.getByTestId('exercise-card-Bench Press (Barbell)');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Swap exercise' }).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('No other chest exercise to swap in.', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Incline DB Press', { exact: true })).toHaveCount(0);
    await expect(sheet.getByRole('textbox')).toHaveCount(0);
  });

  test('edit set: the set-type chips meet the 44px tap floor', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    const card = page.getByTestId('exercise-card-Bench Press (Barbell)');
    await expect(card).toBeVisible();

    await card.getByTestId('weight-input').fill('60');
    await card.getByTestId('reps-input').fill('8');
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));

    // Tap the logged set row to open the edit sheet.
    await card.getByText('60 × 8', { exact: true }).click();
    await expect(page.getByText('Edit set', { exact: true })).toBeVisible();

    const failureChip = page.getByRole('dialog').getByRole('button', { name: 'Failure', exact: true });
    await expect(failureChip).toBeVisible();
    const box = await failureChip.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  test('how to: shows the demo image and a video link', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    const card = page.getByTestId('exercise-card-Bench Press (Barbell)');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'How to' }).click();

    await expect(page.getByRole('img', { name: 'Bench Press (Barbell)' })).toBeVisible();
    const video = page.getByRole('link', { name: 'Video' });
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('target', '_blank');
  });

  test('ask: opens the assistant sheet with a live question box', async ({ page }) => {
    // The "Ask" button is gated on the assistant's status (§6) — 'unavailable' by default on the
    // web build (see state/nano.ts), so the fake stands in for a ready on-device model. Must be
    // set before the app's first script runs, so this goes in before `fresh()` navigates at all.
    await page.addInitScript((cfg: { state: string; detail: string }) => {
      (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
        status: { state: cfg.state, detail: cfg.detail },
        generate: async () => ({ text: 'unused' }),
      };
    }, { state: 'ready', detail: 'fake, ready' });

    await fresh(page);
    await page.getByTestId('start-session').click();
    await expect(page.getByTestId('ask-assistant')).toBeEnabled();
    await page.getByTestId('ask-assistant').click();
    await expect(page.getByText('Assistant', { exact: true })).toBeVisible();
    await expect(page.getByTestId('assistant-input')).toBeVisible();
  });

  test('ask: is disabled while the on-device model is unavailable (the default on the web build)', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    await expect(page.getByTestId('ask-assistant')).toBeDisabled();
  });
});
