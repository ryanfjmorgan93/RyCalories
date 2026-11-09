import { expect, test, type Locator, type Page } from '@playwright/test';
import { fresh, readRawIron } from './fresh';

/**
 * Short session → My own: the owner picks the exercises. Through the real sheet, the real picker and
 * the real Start on the built app, with the database read raw wherever a test is about what was
 * written. The picks are named seeded exercises, so (unlike a suggested plan) names and numbers are
 * asserted: each row is the owner's own prescription for that exercise, from the seed's routines.
 *
 * A row is waited for by the count of rows rising (asserted before each pick), a removal by the
 * count falling, a session by its URL. Nothing waits on a toast.
 */

type Row = Record<string, unknown>;

const rowsOf = (page: Page): Locator => page.locator('[data-testid^="quick-row-"]');
const cardsOf = (page: Page): Locator => page.locator('[data-testid^="exercise-card-"]');

async function openOwn(page: Page): Promise<void> {
  await page.getByTestId('short-session').click();
  await expect(page.getByTestId('quick-preview')).toBeVisible();
  await page.getByTestId('quick-mode-own').click();
  await expect(page.getByTestId('quick-add')).toBeVisible();
}

/** Pick one exercise by its exact name in the picker, and wait for it to be the last row. */
async function add(page: Page, name: string): Promise<void> {
  const before = await rowsOf(page).count();
  await page.getByTestId('quick-add').click();
  await page.getByTestId('picker-search').fill(name);
  await page.getByTestId('picker-list').locator('button').filter({ has: page.getByText(name, { exact: true }) }).first().click();
  await expect(rowsOf(page)).toHaveCount(before + 1);
  await expect(rowsOf(page).nth(before)).toContainText(name);
}

async function names(page: Page): Promise<string[]> {
  return (await rowsOf(page).allInnerTexts()).map((t) => t.split('\n')[0]!.trim());
}

test('My own: the exercises picked, in the order picked, at the owner\'s own numbers, are what starts', async ({ page }) => {
  await fresh(page);
  const before = await readRawIron(page);
  const seededRoutines = before.tables.routines as Row[];
  const seededRxs = before.tables.routineExercises as Row[];
  expect((before.tables.exercises as Row[]).some((e) => e.name === 'Leg Press')).toBe(false);

  await openOwn(page);
  // Nothing is suggested here: no rows, no Shuffle, no request, and nothing to start.
  await expect(page.getByTestId('quick-own-empty')).toHaveText('No exercises yet');
  await expect(rowsOf(page)).toHaveCount(0);
  await expect(page.getByTestId('quick-shuffle')).toHaveCount(0);
  await expect(page.getByTestId('quick-request')).toHaveCount(0);
  await expect(page.getByTestId('quick-start')).toBeDisabled();

  // The seed: DB Curl 3 × 10–12 at 9 kg (Upper (Pull), before Arms), Bench 4 × 6–8 at 65 kg, Lateral Raise 3 × 12–15 at 8 kg.
  await add(page, 'DB Curl');
  await expect(rowsOf(page).nth(0)).toContainText('3 × 10–12 · 9 kg');
  await expect(page.getByTestId('quick-own-empty')).toHaveCount(0);
  await add(page, 'Bench Press (Barbell)');
  await expect(rowsOf(page).nth(1)).toContainText('4 × 6–8 · 65 kg');
  await add(page, 'Lateral Raise');
  await expect(rowsOf(page).nth(2)).toContainText('3 × 12–15 · 8 kg');
  // An isolation lift stays above the compound: the order is the owner's.
  expect(await names(page)).toEqual(['DB Curl', 'Bench Press (Barbell)', 'Lateral Raise']);

  // One already in the list cannot be picked twice.
  await page.getByTestId('quick-add').click();
  await page.getByTestId('picker-search').fill('DB Curl');
  // The search has answered (its other match is listed), and DB Curl itself is not among the rows.
  await expect(page.getByTestId('picker-list')).toContainText('Incline DB Curl');
  await expect(page.getByTestId('picker-list').getByText('DB Curl', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picker-list')).toHaveCount(0);

  // Remove the first: three rows become two, and the rest keep their order.
  await page.getByTestId('quick-remove-0').click();
  await expect(rowsOf(page)).toHaveCount(2);
  expect(await names(page)).toEqual(['Bench Press (Barbell)', 'Lateral Raise']);

  // A carry, which a suggested plan never holds: walks over their routine's 30 to 40 m, at a load that is theirs
  // to pick (the seed's row is calibrating).
  await add(page, "Farmer's Carry");
  await expect(rowsOf(page).nth(2)).toContainText('3 walks · 30–40 m · no weight yet');
  // One from the library they have never done: it becomes theirs at the pick, with no weight from anywhere.
  await add(page, 'Leg Press');
  await expect(rowsOf(page).nth(3)).toContainText('no weight yet');
  await expect(page.getByTestId('quick-estimate')).toContainText('4 exercises');

  // Light is the same list at light numbers: three sets of 10 to 15 at no more than 65% of 65 kg. Normal brings it back.
  await page.getByTestId('quick-effort-light').click();
  await expect(rowsOf(page).nth(0)).toContainText('3 × 10–15 · ');
  const lightKg = Number(/· ([\d.]+) kg/.exec(await rowsOf(page).nth(0).innerText())![1]);
  expect(lightKg).toBeGreaterThan(0);
  expect(lightKg).toBeLessThanOrEqual(0.65 * 65);
  expect(await names(page)).toEqual(['Bench Press (Barbell)', 'Lateral Raise', "Farmer's Carry", 'Leg Press']);
  await page.getByTestId('quick-effort-normal').click();
  await expect(rowsOf(page).nth(0)).toContainText('4 × 6–8 · 65 kg');

  await page.getByTestId('quick-start').click();
  await expect(page).toHaveURL(/\/session\//);

  // The live session: those four, in that order, the first starting on its own weight.
  await expect(cardsOf(page)).toHaveCount(4);
  expect((await cardsOf(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).map((id) => id!.replace('exercise-card-', ''))).toEqual([
    'Bench Press (Barbell)',
    'Lateral Raise',
    "Farmer's Carry",
    'Leg Press',
  ]);
  await expect(cardsOf(page).first().getByTestId('weight-input').first()).toHaveValue('65');
  // The carry's card says how far.
  await expect(cardsOf(page).nth(2)).toContainText('30–40 m');

  // The raw database: a hidden routine holding exactly those rows, and no real routine touched.
  const raw = await readRawIron(page);
  const exercises = raw.tables.exercises as Row[];
  const hidden = (raw.tables.routines as Row[]).filter((r) => r.quick === true);
  expect(hidden).toEqual([expect.objectContaining({ name: 'Quick session', archived: true })]);
  const byId = (a: Row, b: Row) => String(a.id).localeCompare(String(b.id));
  expect((raw.tables.routines as Row[]).filter((r) => r.quick !== true).sort(byId)).toEqual([...seededRoutines].sort(byId));
  const rxs = raw.tables.routineExercises as Row[];
  expect(rxs.filter((r) => r.routineId !== hidden[0]!.id).sort(byId)).toEqual([...seededRxs].sort(byId));
  const legPress = exercises.find((e) => e.name === 'Leg Press')!;
  const mine = rxs.filter((r) => r.routineId === hidden[0]!.id).sort((a, b) => Number(a.order) - Number(b.order));
  expect(mine.map((r) => [exercises.find((e) => e.id === r.exerciseId)!.name, r.targetSets, r.repMin, r.repMax, r.currentWeight, r.mode, r.distanceMinM, r.distanceMaxM])).toEqual([
    ['Bench Press (Barbell)', 4, 6, 8, 65, 'normal', undefined, undefined],
    ['Lateral Raise', 3, 12, 15, 8, 'normal', undefined, undefined],
    ["Farmer's Carry", 3, 1, 1, 0, 'calibrating', 30, 40],
    // Never done: the default sets and reps for what it is, and no weight.
    ['Leg Press', 3, legPress.isCompound ? 8 : 10, legPress.isCompound ? 10 : 15, 0, 'calibrating', undefined, undefined],
  ]);
  expect(raw.tables.sessions as Row[]).toEqual([expect.objectContaining({ quick: 'normal', title: 'Quick session · normal', routineId: hidden[0]!.id })]);

  // Discarded: the hidden routine goes, and the library exercise stays. The owner picked it; Start did not make it.
  await page.getByRole('button', { name: 'Discard session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => ((await readRawIron(page)).tables.sessions as Row[]).length).toBe(0);
  const after = await readRawIron(page);
  expect((after.tables.routines as Row[]).sort(byId)).toEqual([...seededRoutines].sort(byId));
  expect((after.tables.routineExercises as Row[]).sort(byId)).toEqual([...seededRxs].sort(byId));
  expect((after.tables.exercises as Row[]).some((e) => e.name === 'Leg Press')).toBe(true);
});

test('Suggested is as it was, the two lists do not leak into each other, and a light list of one\'s own starts light', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('short-session').click();
  await expect(page.getByTestId('quick-preview')).toBeVisible();
  // Opens on the suggested plan, with its controls.
  await expect(page.getByTestId('quick-request')).toBeVisible();
  await expect(page.getByTestId('quick-shuffle')).toBeVisible();
  const suggested = await rowsOf(page).allInnerTexts();
  expect(suggested.length).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('quick-remove-0')).toHaveCount(0);
  await expect(page.getByTestId('quick-add')).toHaveCount(0);

  // My own starts empty, whatever was suggested; one pick is one row.
  await page.getByTestId('quick-mode-own').click();
  await expect(page.getByTestId('quick-own-empty')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(0);
  await add(page, 'Lateral Raise');

  // Back to Suggested (Shuffle is only there): the very plan it had, row for row, not the pick and not a new draw.
  await page.getByTestId('quick-mode-suggested').click();
  await expect(page.getByTestId('quick-shuffle')).toBeVisible();
  expect(await rowsOf(page).allInnerTexts()).toEqual(suggested);
  // And My own still holds the pick.
  await page.getByTestId('quick-mode-own').click();
  await expect(page.getByTestId('quick-add')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(rowsOf(page).nth(0)).toContainText('Lateral Raise');

  // Light, and started light: two sets of 10 to 15 at 5 kg (65% of the seed's 8 kg is 5.2, on its 1 kg step).
  await page.getByTestId('quick-effort-light').click();
  await expect(rowsOf(page).nth(0)).toContainText('2 × 10–15 · 5 kg');
  await page.getByTestId('quick-start').click();
  await expect(page).toHaveURL(/\/session\//);
  await expect(cardsOf(page)).toHaveCount(1);
  const raw = await readRawIron(page);
  const hidden = (raw.tables.routines as Row[]).filter((r) => r.quick === true);
  expect(hidden).toHaveLength(1);
  expect(raw.tables.sessions as Row[]).toEqual([expect.objectContaining({ quick: 'light', title: 'Quick session · light', routineId: hidden[0]!.id })]);
  expect((raw.tables.routineExercises as Row[]).filter((r) => r.routineId === hidden[0]!.id).map((r) => [r.targetSets, r.repMin, r.repMax, r.currentWeight, r.mode])).toEqual([[2, 10, 15, 5, 'normal']]);
});
