import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh, logOneSet } from './fresh';

/**
 * The set table (Phase 3C): ghosts, the completion moment and its collapse, extras only via the
 * ⋯ menu, feel → RIR, records gating, the lock-in pending state, the superset rest-timer fix, and
 * the Fold layout. Every wait here rests on a positive signal — the thing actually having
 * happened, not a sample taken once or a signal a previous occurrence could already satisfy.
 *
 * Fixtures: "Romanian Deadlift (Barbell)" (Lower (Hinge), targetSets 4, repMin 6, repMax 8,
 * currentWeight 110, increment 5) and "Hip Thrust (Barbell)" (same routine, order 1, next after
 * it). "Barbell Back Squat" (Lower (Squat), calibrating, targetSets 4). "Bench Press (Barbell)"
 * (Upper (Push), targetSets 4) and "Incline DB Press" (same routine, targetSets 3) — the routine's
 * own unequal pair, used for the superset rest-timer fix.
 */

const BENCH_ID = '06e6d774-dded-5317-a459-3c24a575f9a5';
const INCLINE_ID = '23809c40-32bd-5fe4-8f71-eb2efdb47cc6';

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

async function skipRest(page: Page) {
  await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
}

/** Waits for the completion moment to actually appear, then for it to actually collapse away —
 * two positive signals, never a bare "and now assume it's done". */
async function waitForCompletionCollapse(page: Page) {
  await expect(page.getByTestId('exercise-complete')).toBeVisible();
  await expect(page.getByTestId('exercise-complete')).toHaveCount(0);
}

/**
 * Log four sets, waiting for each one to actually be recorded before typing the next — via
 * `logOneSet` (e2e/fresh.ts), the same fix already applied to design-shots.spec.ts's identical
 * helper (see its history): filling the next set's inputs before the live-query re-render lands
 * types into the row that is still live, so the next click logs whatever faint values the new row
 * starts with. That is how a loop of four 90 × 8 sets came out as 90 × 8 followed by 65 × 8, 8, 6.
 */
async function logFour(page: Page, card: import('@playwright/test').Locator, weight: number, reps: number) {
  for (let i = 0; i < 4; i++) {
    await logOneSet(page, card, weight, reps);
  }
}

async function finishAndSave(page: Page) {
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

interface RawSetLog {
  type: string;
  rir?: number;
  weight: number;
  reps?: number;
  index: number;
}

/** Every set log row in IndexedDB, sorted the way the app itself orders a slot's sets. */
async function readAllSetLogs(page: Page): Promise<RawSetLog[]> {
  const rows = await page.evaluate(async () => {
    const req = indexedDB.open('iron');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('setLogs', 'readonly');
    return new Promise<RawSetLog[]>((res) => {
      const r = tx.objectStore('setLogs').getAll();
      r.onsuccess = () => res(r.result as RawSetLog[]);
    });
  });
  return rows.sort((a, b) => a.index - b.index);
}

async function readAllDecisions(page: Page): Promise<{ rule: string; toWeight: number; routineExerciseId: string }[]> {
  return page.evaluate(async () => {
    const req = indexedDB.open('iron');
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('decisions', 'readonly');
    return new Promise<{ rule: string; toWeight: number; routineExerciseId: string }[]>((res) => {
      const r = tx.objectStore('decisions').getAll();
      r.onsuccess = () => res(r.result);
    });
  });
}

test.describe('set table', () => {
  test('ghost reps come from last time, not the target minimum', async ({ page }) => {
    await fresh(page);
    // Named explicitly, both times: the suggested routine rotates on to the next one once this
    // session is saved, so `start-session` would land on a different routine the second time.
    await page.getByTestId('start-Lower (Hinge)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    // repMin is 6 — logging 7 (a different number) proves a later ghost isn't just falling back to it.
    await logFour(page, card, 110, 7);
    await finishAndSave(page);

    await page.getByTestId('start-Lower (Hinge)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    const next = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(next.getByTestId('reps-input')).toHaveValue('7');
  });

  test('ticking the last target row plays the completion moment, then the next card is expanded', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const rdl = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    const hipThrust = page.getByTestId('exercise-card-Hip Thrust (Barbell)');
    await expect(rdl.getByTestId('weight-input')).toBeVisible();
    await expect(hipThrust.getByTestId('weight-input')).toHaveCount(0);

    await logFour(page, rdl, 110, 8);
    await waitForCompletionCollapse(page);

    // No live input left in the finished card…
    await expect(rdl.getByTestId('weight-input')).toHaveCount(0);
    // …and the next slot is the one now showing a live row.
    await expect(hipThrust.getByTestId('weight-input')).toBeVisible();
  });

  test('a skip during the completion hold does not strand currentKey on the finished card', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const rdl = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    const hipThrust = page.getByTestId('exercise-card-Hip Thrust (Barbell)');
    const legCurl = page.getByTestId('exercise-card-Lying Leg Curl (Machine)');

    for (let i = 0; i < 4; i++) {
      await rdl.getByTestId('weight-input').fill('110');
      await rdl.getByTestId('reps-input').fill('8');
      await rdl.getByTestId('set-done').click();
      if (i < 3) await skipRest(page);
    }
    // The 4th log starts RDL's ~1.8s completion hold (LiveSessionScreen's `useCompletionHold`): a
    // second, non-completing transition inside that window — here, skipping Hip Thrust — must clear
    // the hold outright rather than leave `currentKey` stuck on the now-finished RDL card. Done
    // through the real skip UI (not a raw DB write) so it goes through the same Dexie write the
    // live query actually reacts to.
    await hipThrust.click(); // collapsed row — expands it
    await hipThrust.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Skip this exercise' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Skip', exact: true }).click();

    // Well past the hold window: the real next undone slot (Lying Leg Curl — Hip Thrust is now
    // skipped) must actually receive focus, not RDL forever.
    await expect(legCurl).toHaveAttribute('data-current', 'true', { timeout: 5000 });
  });

  test('an extra set is reachable only through the exercise menu', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await logFour(page, card, 110, 8);
    await waitForCompletionCollapse(page);
    await expect(card.getByTestId('weight-input')).toHaveCount(0);

    // Reopening the done card by itself only reveals the logged rows.
    await card.click();
    await expect(card.getByTestId('weight-input')).toHaveCount(0);

    // "Add a set" is the only door back to a live row.
    await card.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('add-set').click();
    await expect(card.getByTestId('weight-input')).toBeVisible();
  });

  test('Easy writes RIR 3 to every counted non-failure set; a failure set keeps none', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');

    for (const _ of [0, 1, 2]) {
      await card.getByTestId('weight-input').fill('110');
      await card.getByTestId('reps-input').fill('8');
      await card.getByTestId('set-done').click();
      await skipRest(page);
    }
    // Retype the 3rd logged set to Failure before finishing the exercise.
    const rows = card.locator('button:has(span.num.w-7)');
    await rows.nth(2).click();
    await expect(page.getByText('Edit set', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Failure', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Edit set', { exact: true })).toHaveCount(0);

    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill('8');
    await card.getByTestId('set-done').click();
    await waitForCompletionCollapse(page);

    const easy = card.getByTestId('feel-Easy');
    await expect(easy).toHaveAttribute('aria-pressed', 'false');
    await easy.click();
    await expect(easy).toHaveAttribute('aria-pressed', 'true');

    const sets = await readAllSetLogs(page);
    expect(sets.filter((s) => s.type === 'working').map((s) => s.rir)).toEqual([3, 3, 3]);
    expect(sets.filter((s) => s.type === 'failure').map((s) => s.rir)).toEqual([undefined]);
  });

  test('retyping a logged set away from Working clears its inherited RIR, not just its type', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await logFour(page, card, 110, 8);
    await waitForCompletionCollapse(page);

    // Answer "Easy" — every counted working set now carries rir: 3 (the slot's feel).
    const easy = card.getByTestId('feel-Easy');
    await easy.click();
    await expect(easy).toHaveAttribute('aria-pressed', 'true');
    expect((await readAllSetLogs(page)).map((s) => s.rir)).toEqual([3, 3, 3, 3]);

    // Reopen the card and retype the 3rd and 4th logged sets: one to Failure, one to Drop. Neither
    // still counts as an "Easy" set once retyped, so neither may still carry the RIR 3 it inherited
    // before the retype — a stale RIR 3 on the Failure set would feed a double-increment suggestion
    // it never earned (§3), and a Drop set never has an effort answer of its own. The done card's
    // whole tile is taller than its own toggle button (verdict/lock-in/feel sit below), so click
    // the heading itself — nested inside that button — rather than the tile's own centre point.
    await card.getByRole('heading', { name: 'Romanian Deadlift (Barbell)' }).click();
    const rows = card.locator('button:has(span.num.w-7)');

    await rows.nth(2).click();
    await expect(page.getByText('Edit set', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Failure', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Edit set', { exact: true })).toHaveCount(0);

    await rows.nth(3).click();
    await expect(page.getByText('Edit set', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Drop', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Edit set', { exact: true })).toHaveCount(0);

    const after = await readAllSetLogs(page);
    const failureSet = after.find((s) => s.type === 'failure');
    const dropSet = after.find((s) => s.type === 'drop');
    expect(failureSet).toBeDefined();
    expect(dropSet).toBeDefined();
    expect(failureSet!.rir).toBeUndefined();
    expect(dropSet!.rir).toBeUndefined();
    // The two untouched working sets keep their real answer.
    expect(after.filter((s) => s.type === 'working').map((s) => s.rir)).toEqual([3, 3]);
  });

  test('a lift whose sets all hit the top of the range surfaces the double-increment suggestion on Summary when answered Easy, and none when answered Good', async ({ page }) => {
    // Positive case first, so the negative case (no such line) is actually meaningful.
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    const bench = page.getByTestId('exercise-card-Bench Press (Barbell)'); // 65 kg, 4 × 6–8
    await logFour(page, bench, 65, 8); // every set at repMax
    await waitForCompletionCollapse(page);
    const easy = bench.getByTestId('feel-Easy');
    await easy.click();
    await expect(easy).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('finish-session').click();
    await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
    await expect(page).toHaveURL(/\/summary$/);
    const decision = page.getByTestId('decision-Bench Press (Barbell)');
    // Wait for Summary's own decision card before asserting anything about it — it's built only
    // once records/decisions are fully computed.
    await expect(decision).toBeVisible();
    await expect(decision).toContainText('Every set felt easy');
    await expect(decision).toContainText('70 kg'); // 65 + 2.5 increment × 2

    // A second, clean session where the same lift is instead answered Good (RIR 2) — no set was
    // "easy", so no double-increment suggestion should appear at all.
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    const bench2 = page.getByTestId('exercise-card-Bench Press (Barbell)');
    await logFour(page, bench2, 65, 8);
    await waitForCompletionCollapse(page);
    const good = bench2.getByTestId('feel-Good');
    await good.click();
    await expect(good).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('finish-session').click();
    await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
    await expect(page).toHaveURL(/\/summary$/);
    const decision2 = page.getByTestId('decision-Bench Press (Barbell)');
    await expect(decision2).toBeVisible();
    await expect(decision2).not.toContainText('Every set felt easy');
  });

  test('an extra set added after the feel answer inherits it', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await logFour(page, card, 110, 8);
    await waitForCompletionCollapse(page);

    const good = card.getByTestId('feel-Good');
    await good.click();
    await expect(good).toHaveAttribute('aria-pressed', 'true');

    await card.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('add-set').click();
    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill('8');
    await card.getByTestId('set-done').click();

    // The click resolves once the DOM event dispatches, not once the async handler chain (log the
    // set, then a second transaction inheriting the slot's feel into it) has settled — poll for
    // the real end state rather than sampling straight after the click.
    await expect
      .poll(async () => (await readAllSetLogs(page)).map((s) => s.rir))
      .toEqual([2, 2, 2, 2, 2]); // Good = RIR 2, the new set included

    const sets = await readAllSetLogs(page);
    expect(sets).toHaveLength(5);
  });

  test('no PR on a first-ever session, even mid-exercise; a medal appears once there is real history', async ({ page }) => {
    await fresh(page);
    // Named explicitly both times: the suggested routine rotates on once this session is saved.
    await page.getByTestId('start-Lower (Hinge)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill('8');
    await card.getByTestId('set-done').click();

    await page.getByTestId('finish-session').click();
    await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
    await expect(page).toHaveURL(/\/summary$/);
    // Summary is built only once records are fully computed — a positive signal the query settled.
    const decision = page.getByTestId('decision-Romanian Deadlift (Barbell)');
    await expect(decision).toBeVisible();
    await expect(decision).not.toContainText('PR');
    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);

    // A second, heavier session now has real history to beat.
    await page.getByTestId('start-Lower (Hinge)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    const card2 = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await card2.getByTestId('weight-input').fill('120');
    await card2.getByTestId('reps-input').fill('8');
    await card2.getByTestId('set-done').click();
    await expect(card2.getByTestId('pr-chip')).toBeVisible();
  });

  test('a lock-in at completion survives Save as a lock_in decision, with no surprise increase', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Lower (Squat)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    const card = page.getByTestId('exercise-card-Barbell Back Squat');
    await expect(card).toContainText('calibrating');

    // Every set at/above repMax — the exact shape that used to trigger a surprise re-increase on
    // top of the lock-in once `finishSession` re-decided from scratch.
    await logFour(page, card, 60, 8);
    await waitForCompletionCollapse(page);

    await expect(card.getByTestId('session-lock-in')).toHaveText('Lock in 60 kg');
    await card.getByTestId('session-lock-in').click();
    await expect(card.getByTestId('session-lock-in-pending')).toHaveText('60 kg locked in');

    await finishAndSave(page);

    const decisions = await readAllDecisions(page);
    const lockIn = decisions.find((d) => d.rule === 'lock_in');
    expect(lockIn).toBeDefined();
    expect(lockIn!.toWeight).toBe(60);
    expect(decisions.some((d) => d.rule === 'increase')).toBe(false);
  });

  test('an unequal-target superset starts the rest timer on the longer member\'s final solo sets', async ({ page }) => {
    await fresh(page);
    await linkSuperset(page, [BENCH_ID, INCLINE_ID], 'set-table-unequal');
    await page.getByTestId('start-Upper (Push)').click();
    await expect(page).toHaveURL(/\/session\//);

    const bench = page.getByTestId('exercise-card-Bench Press (Barbell)'); // targetSets 4
    const incline = page.getByTestId('exercise-card-Incline DB Press'); // targetSets 3
    await expect(bench).toBeVisible();
    await expect(incline).toBeVisible();

    const log = async (card: import('@playwright/test').Locator, weight: number, reps: number) => {
      await card.getByTestId('weight-input').fill(String(weight));
      await card.getByTestId('reps-input').fill(String(reps));
      await card.getByTestId('set-done').click();
      await skipRest(page);
    };

    // Bench (order 0) and Incline (order 1) alternate, ties going to order.
    await log(bench, 65, 6); // Bench 1, Incline 0
    await log(incline, 20, 8); // Bench 1, Incline 1
    await log(bench, 65, 6); // Bench 2, Incline 1
    await log(incline, 20, 8); // Bench 2, Incline 2
    await log(bench, 65, 6); // Bench 3, Incline 2

    // Incline's 3rd set meets its own (smaller) target — its own completion moment plays and it
    // collapses into its own done card, independent of Bench, which still owes one set.
    await incline.getByTestId('weight-input').fill('20');
    await incline.getByTestId('reps-input').fill('8');
    await incline.getByTestId('set-done').click();
    await waitForCompletionCollapse(page);
    await skipRest(page);
    await expect(page.getByTestId('rest-timer')).toHaveCount(0);

    // Bench's own 4th and final set, now logged alone — Incline is done and out of the rotation.
    // The old array-position rule looked for whichever member is LAST in the group (Incline) and
    // would never have started rest here; the real rule asks whether anyone is still owed a turn.
    await bench.getByTestId('weight-input').fill('65');
    await bench.getByTestId('reps-input').fill('6');
    await bench.getByTestId('set-done').click();
    await expect(page.getByTestId('rest-timer')).toBeVisible();
  });

  test('at 884×1104 the Fold shows two panes side by side', async ({ page }) => {
    await page.setViewportSize({ width: 884, height: 1104 });
    await fresh(page);
    await page.getByTestId('start-session').click();

    const list = page.getByTestId('fold-list');
    const focus = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await expect(list).toBeVisible();
    await expect(focus).toBeVisible();

    const listBox = await list.boundingBox();
    const focusBox = await focus.boundingBox();
    expect(listBox).not.toBeNull();
    expect(focusBox).not.toBeNull();
    // The list pane sits to the left of the focused card, not stacked above it.
    expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(focusBox!.x + 1);
    expect(listBox!.y).toBeLessThan(focusBox!.y + focusBox!.height);
  });

  test('at 884×1104, finishing every target set shows the all-done card in the right pane and its Finish workout reaches Summary', async ({ page }) => {
    await page.setViewportSize({ width: 884, height: 1104 });
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();

    const list = page.getByTestId('fold-list');
    const allDone = page.getByTestId('all-done');
    const bench = page.getByTestId('exercise-card-Bench Press (Barbell)'); // targetSets 4
    const incline = page.getByTestId('exercise-card-Incline DB Press'); // targetSets 3
    const shoulder = page.getByTestId('exercise-card-DB Shoulder Press'); // targetSets 3
    const triceps = page.getByTestId('exercise-card-Triceps Pushdown'); // targetSets 3
    await expect(bench).toBeVisible();
    await expect(allDone).toHaveCount(0); // nothing done yet — no all-done card at all

    const logN = async (card: import('@playwright/test').Locator, n: number, weight: number, reps: number) => {
      for (let i = 0; i < n; i++) {
        await card.getByTestId('weight-input').fill(String(weight));
        await card.getByTestId('reps-input').fill(String(reps));
        await card.getByTestId('set-done').click();
        await skipRest(page);
      }
      // Only the focused card is visible in the Fold's right pane (≥840px) — the next exercise's
      // own completion hold doesn't clear, and its card doesn't become visible there, until this
      // one's celebration has actually finished.
      await waitForCompletionCollapse(page);
    };

    await logN(bench, 4, 65, 8);
    await logN(incline, 3, 20, 8);
    await logN(shoulder, 3, 20, 8);
    await logN(triceps, 3, 20, 12);

    await expect(allDone).toBeVisible();
    await expect(allDone).toContainText('All 13 sets done'); // 4 + 3 + 3 + 3
    // In the right pane, not stacked under the left one.
    const listBox = await list.boundingBox();
    const doneBox = await allDone.boundingBox();
    expect(listBox).not.toBeNull();
    expect(doneBox).not.toBeNull();
    expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(doneBox!.x + 1);

    await page.getByTestId('all-done-finish').click();
    await expect(page).toHaveURL(/\/summary$/);
  });

  test('at 884×1104, removing a focused extra leaves a visible card in the right pane, not a blank one', async ({ page }) => {
    await page.setViewportSize({ width: 884, height: 1104 });
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();

    await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
    await page.getByRole('dialog').getByText('Overhead Triceps Extension', { exact: true }).click();
    const extraCard = page.getByTestId('exercise-card-Overhead Triceps Extension');
    await expect(extraCard).toHaveCount(1);

    // Pin it as the Fold's right-pane focus via its row in the left pane.
    await page.getByTestId('fold-list').getByText('Overhead Triceps Extension', { exact: true }).click();
    await expect(extraCard).toBeVisible();

    // Remove it from the session while it is still the pinned focus.
    await extraCard.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Remove from session' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(extraCard).toHaveCount(0);

    // The pinned focus named a group that no longer exists — the right pane must fall back to the
    // real current exercise rather than sit blank.
    await expect(page.getByTestId('exercise-card-Bench Press (Barbell)')).toBeVisible();
  });

  test('under reduced motion, the completion still reaches its real end state', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fresh(page);
    await page.getByTestId('start-session').click();
    const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
    await logFour(page, card, 110, 8);

    // No motion to wait out, but the collapse is still a real state transition to wait for, not
    // an assumption: the done card's own verdict text is the positive signal.
    await expect(card.getByTestId('verdict-line')).toHaveText('→ 115 kg next time');
    await expect(card.getByTestId('weight-input')).toHaveCount(0);
  });
});

test.describe('keyboard focus through the completion moment', () => {
  test('logging the last set from the keyboard keeps focus: on the completion, then on the next exercise', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    const bench = page.getByTestId('exercise-card-Bench Press (Barbell)');
    for (let i = 0; i < 3; i++) {
      await bench.getByTestId('weight-input').fill('65');
      await bench.getByTestId('reps-input').fill('8');
      await bench.getByTestId('set-done').click();
      await skipRest(page);
    }
    // The fourth set from the keyboard: focus on the tick, Enter.
    await bench.getByTestId('weight-input').fill('65');
    await bench.getByTestId('reps-input').fill('8');
    await bench.getByTestId('set-done').focus();
    await page.keyboard.press('Enter');

    // Focus follows the card into its completion moment instead of falling to <body>...
    await expect(page.getByTestId('exercise-complete')).toBeFocused();
    // ...and, once the next exercise opens, lands on its first live input.
    const incline = page.getByTestId('exercise-card-Incline DB Press');
    await expect(incline.getByTestId('weight-input')).toBeFocused();
  });

  // With no celebration to wait out, the next exercise can become current before the finished
  // card has reported its hand-off (the report follows its own write). Focus must still arrive.
  test('under reduced motion, focus still reaches the next exercise', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fresh(page);
    await page.getByTestId('start-Upper (Push)').click();
    const bench = page.getByTestId('exercise-card-Bench Press (Barbell)');
    for (let i = 0; i < 3; i++) await logOneSet(page, bench, 65, 8);
    await bench.getByTestId('weight-input').fill('65');
    await bench.getByTestId('reps-input').fill('8');
    await bench.getByTestId('set-done').focus();
    await page.keyboard.press('Enter');

    const incline = page.getByTestId('exercise-card-Incline DB Press');
    await expect(incline.getByTestId('weight-input')).toBeFocused();
  });
});
