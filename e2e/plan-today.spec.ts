import { expect, test, type Locator, type Page } from '@playwright/test';
import { clickIfPresent, fresh, logOneSet } from './fresh';

/**
 * "Change today": the ⋯ menu's session-only plan change (src/ui/TodayPlanSheet.tsx), the line it
 * leaves on the card, and what it does to the verdict, completion and the Summary — all offline.
 *
 * Fixture: "Bench Press (Barbell)" on Upper (Push) — 4 × 6–8 @ 65 kg, increment 2.5. The next
 * required exercise on that routine is Incline DB Press.
 */

const BENCH = 'Bench Press (Barbell)';

interface RxRow {
  id: string;
  exerciseId: string;
  targetSets: number;
  targetSetsMax?: number;
  repMin: number;
  repMax: number;
  currentWeight: number;
}

/** Every row of one store, straight from IndexedDB. */
async function readStore<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async (name) => {
    const req = indexedDB.open('iron');
    const idb = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const rows = await new Promise<unknown[]>((res) => {
      const r = idb.transaction(name, 'readonly').objectStore(name).getAll();
      r.onsuccess = () => res(r.result);
    });
    idb.close();
    return rows as never[];
  }, store);
}

/** The saved routine-exercise for the Bench Press on Upper (Push). */
async function benchRx(page: Page): Promise<RxRow> {
  const exercises = await readStore<{ id: string; name: string }>(page, 'exercises');
  const id = exercises.find((e) => e.name === BENCH)!.id;
  const rxs = await readStore<RxRow>(page, 'routineExercises');
  // Bench is on Upper (Push) only, in the seed.
  return rxs.find((r) => r.exerciseId === id)!;
}

/** The session being run, from the live URL. */
async function liveSession(page: Page): Promise<{ planOverrides?: Record<string, { targetSets?: number; repMin?: number; repMax?: number; weight?: number }> }> {
  const id = /\/session\/([^/]+)/.exec(page.url())?.[1];
  const sessions = await readStore<{ id: string; planOverrides?: never }>(page, 'sessions');
  return sessions.find((s) => s.id === id)!;
}

async function changeToday(page: Page, card: Locator, fields: { sets?: number; repMin?: number; repMax?: number; weight?: number }) {
  await card.getByRole('button', { name: 'More' }).click();
  await page.getByTestId('change-today').click();
  const sheet = page.getByTestId('today-plan-sheet');
  await expect(sheet).toBeVisible();
  if (fields.sets !== undefined) await sheet.getByTestId('today-sets').fill(String(fields.sets));
  if (fields.repMin !== undefined) await sheet.getByTestId('today-repmin').fill(String(fields.repMin));
  if (fields.repMax !== undefined) await sheet.getByTestId('today-repmax').fill(String(fields.repMax));
  if (fields.weight !== undefined) await sheet.getByTestId('today-weight').fill(String(fields.weight));
  await page.getByTestId('today-save').click();
  await expect(sheet).toHaveCount(0);
}

async function startPush(page: Page): Promise<Locator> {
  await fresh(page);
  await page.getByTestId('start-Upper (Push)').click();
  const card = page.getByTestId(`exercise-card-${BENCH}`);
  await expect(card).toContainText('4 sets of 6–8 · 65 kg');
  return card;
}

/** Waits for the completion moment to actually appear, then actually collapse away: two positive signals. */
async function waitForCompletionCollapse(page: Page) {
  await expect(page.getByTestId('exercise-complete')).toBeVisible();
  await expect(page.getByTestId('exercise-complete')).toHaveCount(0);
}

async function finishToSummary(page: Page) {
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
}

test.describe('Change today', () => {
  test('cutting an exercise to 2 sets finishes it after 2, and the Summary does not call it a missed session', async ({ page }) => {
    const bench = await startPush(page);
    await changeToday(page, bench, { sets: 2 });

    // The card, its subtitle and its own line all speak of today's plan.
    await expect(bench).toContainText('2 sets of 6–8 · 65 kg · 0 of 2');
    await expect(bench.getByTestId('today-plan-text')).toHaveText('Today: 2 sets');
    await expect(bench.getByTestId('weight-input')).toBeVisible();
    // Two rows to fill, not four.
    await expect(bench.getByTestId('set-done')).toHaveCount(1);

    await logOneSet(page, bench, 65, 8);
    await logOneSet(page, bench, 65, 8);

    // Two sets complete the exercise: the completion moment plays and the next exercise takes over.
    await waitForCompletionCollapse(page);
    await expect(page.getByTestId('verdict-line')).toHaveText('→ 67.5 kg next time');
    await expect(bench.getByTestId('weight-input')).toHaveCount(0);
    await expect(page.getByTestId('exercise-card-Incline DB Press')).toHaveAttribute('data-current', 'true');

    await finishToSummary(page);
    const decision = page.getByTestId(`decision-${BENCH}`);
    await expect(decision).toBeVisible();
    // Judged against today's two sets: not "2/4 sets … hold".
    await expect(decision.getByTestId('decision-line')).toHaveText('8/8 at 65 kg → 67.5 kg next time');

    await page.getByTestId('save-session').click();
    await expect(page).toHaveURL(/\/$/);
    // The progression landed, and the saved routine still says four sets.
    const rx = await benchRx(page);
    expect(rx).toMatchObject({ targetSets: 4, repMin: 6, repMax: 8, currentWeight: 67.5 });
    const decisions = await readStore<{ routineExerciseId: string; rule: string }>(page, 'decisions');
    expect(decisions.find((d) => d.routineExerciseId === rx.id)?.rule).toBe('increase');
  });

  test('the same two sets without Change today are still a missed session (the control)', async ({ page }) => {
    const bench = await startPush(page);
    await logOneSet(page, bench, 65, 8);
    await logOneSet(page, bench, 65, 8);
    await finishToSummary(page);
    await expect(page.getByTestId(`decision-${BENCH}`).getByTestId('decision-line')).toHaveText('2/4 sets (8/8) at 65 kg → hold 65 kg');
  });

  test('Keep in routine writes the change to the saved routine and the line goes away', async ({ page }) => {
    const bench = await startPush(page);
    await changeToday(page, bench, { sets: 3, repMin: 8, repMax: 10 });
    await expect(bench).toContainText('3 sets of 8–10 · 65 kg · 0 of 3');
    await expect(bench.getByTestId('today-plan-text')).toHaveText('Today: 3 × 8–10');

    // Nothing is saved yet.
    expect(await benchRx(page)).toMatchObject({ targetSets: 4, repMin: 6, repMax: 8 });
    expect((await liveSession(page)).planOverrides).toBeTruthy();

    await bench.getByTestId('today-keep').click();
    await expect(bench.getByTestId('today-plan-line')).toHaveCount(0);
    await expect(bench).toContainText('3 sets of 8–10 · 65 kg · 0 of 3');
    await expect.poll(async () => benchRx(page)).toMatchObject({ targetSets: 3, repMin: 8, repMax: 10, currentWeight: 65 });
    expect((await liveSession(page)).planOverrides).toBeUndefined();
  });

  test('Undo puts the routine\'s plan back and the routine was never touched', async ({ page }) => {
    const bench = await startPush(page);
    await changeToday(page, bench, { sets: 2, weight: 60 });
    await expect(bench).toContainText('2 sets of 6–8 · 60 kg · 0 of 2');
    await expect(bench.getByTestId('today-plan-text')).toHaveText('Today: 2 sets at 60 kg');
    // Today's weight is what the live row is prescribed.
    await expect(bench.getByTestId('weight-input')).toHaveValue('60');

    await bench.getByTestId('today-undo').click();
    await expect(bench.getByTestId('today-plan-line')).toHaveCount(0);
    await expect(bench).toContainText('4 sets of 6–8 · 65 kg · 0 of 4');
    expect(await benchRx(page)).toMatchObject({ targetSets: 4, repMin: 6, repMax: 8, currentWeight: 65 });
    expect((await liveSession(page)).planOverrides).toBeUndefined();
  });

  test('the change survives a reload of the live session, and is offered again from the finished card', async ({ page }) => {
    const bench = await startPush(page);
    await changeToday(page, bench, { sets: 2 });
    await page.reload();
    const again = page.getByTestId(`exercise-card-${BENCH}`);
    await expect(again).toContainText('2 sets of 6–8 · 65 kg · 0 of 2');
    await expect(again.getByTestId('today-plan-line')).toBeVisible();

    await logOneSet(page, again, 65, 8);
    await logOneSet(page, again, 65, 8);
    await waitForCompletionCollapse(page);
    // The finished card still carries the line, with Keep and Undo.
    await expect(again.getByTestId('today-plan-text')).toHaveText('Today: 2 sets');
    await again.getByTestId('today-keep').click();
    await expect.poll(async () => (await benchRx(page)).targetSets).toBe(2);
  });

  test('opening Change today again starts from today\'s plan, and putting a number back clears the line', async ({ page }) => {
    const bench = await startPush(page);
    await changeToday(page, bench, { sets: 2 });
    await bench.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('change-today').click();
    await expect(page.getByTestId('today-sets')).toHaveValue('2');
    await page.getByTestId('today-sets').fill('4'); // the routine's own number again
    await page.getByTestId('today-save').click();
    await expect(bench.getByTestId('today-plan-line')).toHaveCount(0);
    await expect(bench).toContainText('4 sets of 6–8 · 65 kg · 0 of 4');
    expect((await liveSession(page)).planOverrides).toBeUndefined();
  });

  test('raising the sets re-opens a finished exercise for the extra set', async ({ page }) => {
    const bench = await startPush(page);
    await changeToday(page, bench, { sets: 1 });
    await logOneSet(page, bench, 65, 8);
    await waitForCompletionCollapse(page);
    await expect(bench.getByTestId('weight-input')).toHaveCount(0);

    await bench.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('change-today').click();
    await page.getByTestId('today-sets').fill('2');
    await page.getByTestId('today-save').click();
    await expect(bench.getByTestId('weight-input')).toBeVisible();
    await expect(bench).toContainText('2 sets of 6–8 · 65 kg · 1 of 2');
  });
});
