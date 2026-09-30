import { expect, test, type Locator, type Page } from '@playwright/test';
import { clickIfPresent, createRawIronDb, fresh, IRON_SCHEMA_V3, logOneSet, readRawIron } from './fresh';

/**
 * "Short session": the sheet on Home, and what Start makes of it. Everything goes through the real
 * screens on the built app; the database is read raw (IndexedDB, bypassing Dexie) wherever a test is
 * about what was written or left alone.
 *
 * The plan is drawn from a random seed, and so are the exercises in it: these tests assert
 * properties of the plan and never names. Nothing here waits on a toast. A preview is waited for by
 * its own `data-seed` (it changes exactly when Shuffle has been pressed and the new plan is on
 * screen), a session by its URL, a finished one by a raw IndexedDB read, and an absence only after
 * something that can only be there once the screen has rendered.
 */

type Row = Record<string, unknown>;

const LEGS = ['quads', 'hamstrings', 'glutes', 'adductors', 'calves'];
/** Barbell lifts among the seeded exercises that a light session leaves out. */
const LIGHT_EXCLUDED = ['Bench Press (Barbell)', 'Romanian Deadlift (Barbell)', 'Hip Thrust (Barbell)', 'Barbell Back Squat'];

// ---------------------------------------------------------------------------
// The sheet

const rowsOf = (page: Page): Locator => page.locator('[data-testid^="quick-row-"]');

async function openSheet(page: Page): Promise<void> {
  await page.getByTestId('short-session').click();
  await expect(page.getByTestId('quick-preview')).toBeVisible();
}

async function expectPressed(page: Page, testId: string, pressed = true): Promise<void> {
  await expect(page.getByTestId(testId)).toHaveAttribute('aria-pressed', String(pressed));
}

/**
 * Press Shuffle and wait for the plan it drew: the preview's own seed changes in the same render
 * that puts the new rows on screen, so nothing earlier can satisfy this.
 */
async function shuffle(page: Page): Promise<void> {
  const preview = page.getByTestId('quick-preview');
  const before = await preview.getAttribute('data-seed');
  await page.getByTestId('quick-shuffle').click();
  await expect(preview).not.toHaveAttribute('data-seed', before!);
}

interface PreviewRow {
  name: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** "32.5 kg", "bodyweight", "+5 kg" or "no weight yet". */
  weight: string;
  muscle: string;
  isNew: boolean;
  text: string;
}

function parseRow(text: string): PreviewRow {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const prescription = lines.at(-2)!;
  const m = /^(\d+) × (\d+)(?:–(\d+))? · (.+)$/.exec(prescription);
  if (!m) throw new Error(`Unreadable preview line: ${prescription}`);
  return {
    name: lines[0],
    sets: Number(m[1]),
    repMin: Number(m[2]),
    repMax: Number(m[3] ?? m[2]),
    weight: m[4],
    muscle: lines.at(-1)!.split(' · ')[0],
    isNew: lines.includes('New'),
    text: lines.join(' | '),
  };
}

/** The rows on screen, once a plan is there. Read only after a signal that the plan is the one wanted. */
async function readPreview(page: Page): Promise<PreviewRow[]> {
  return (await rowsOf(page).allInnerTexts()).map(parseRow);
}

/** What the live card's weight box holds for a previewed weight: the same number, or nothing to start from. */
function ghostOf(weight: string): string {
  if (weight === 'no weight yet') return '';
  if (weight === 'bodyweight') return '0';
  const m = /^\+?([\d.]+) kg$/.exec(weight);
  if (!m) throw new Error(`Unreadable weight: ${weight}`);
  return String(Number(m[1]));
}

/** The kg a previewed weight writes onto the hidden routine's row: 0 when there is none. */
function storedOf(weight: string): number {
  return weight === 'no weight yet' || weight === 'bodyweight' ? 0 : Number(ghostOf(weight));
}

const hasKg = (rows: PreviewRow[]): boolean => rows.some((r) => storedOf(r.weight) > 0);

// ---------------------------------------------------------------------------
// The live session and what it leaves behind

const cardsOf = (page: Page): Locator => page.locator('[data-testid^="exercise-card-"]');

async function cardNames(page: Page): Promise<string[]> {
  return (await cardsOf(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''))).map((id) => id.replace(/^exercise-card-/, ''));
}

/** Finish from the live screen, as a person does, and stop on the summary. */
async function finish(page: Page): Promise<void> {
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
}

/** One set on the first card, then finish and save: the shortest real session that counts as finished. */
async function completeSession(page: Page): Promise<void> {
  await expect(cardsOf(page).first()).toBeVisible();
  await logOneSet(page, cardsOf(page).first(), 20, 10);
  await finish(page);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

async function startQuick(page: Page): Promise<void> {
  await openSheet(page);
  await page.getByTestId('quick-start').click();
  await expect(page).toHaveURL(/\/session\//);
}

/** Raw rows of one store. */
async function table(page: Page, name: string): Promise<Row[]> {
  return (await readRawIron(page)).tables[name] as Row[];
}

const byId = (a: Row, b: Row): number => String(a.id).localeCompare(String(b.id));

/** The hidden routine, its rows, the session and its sets are all gone; every seeded row is as it was. */
async function expectNoQuickRows(page: Page, seeded: { routines: Row[]; routineExercises: Row[] }): Promise<void> {
  const raw = await readRawIron(page);
  expect(raw.tables.sessions).toEqual([]);
  expect(raw.tables.setLogs).toEqual([]);
  expect((raw.tables.routines as Row[]).sort(byId)).toEqual([...seeded.routines].sort(byId));
  expect((raw.tables.routineExercises as Row[]).sort(byId)).toEqual([...seeded.routineExercises].sort(byId));
}

async function seededRows(page: Page): Promise<{ routines: Row[]; routineExercises: Row[] }> {
  const raw = await readRawIron(page);
  return { routines: raw.tables.routines as Row[], routineExercises: raw.tables.routineExercises as Row[] };
}

// ---------------------------------------------------------------------------

test('what the sheet previews is what starts: the same exercises and weights, nothing decided, no real row touched', async ({ page }) => {
  await fresh(page);
  const seeded = await seededRows(page);
  expect(seeded.routines).toHaveLength(5);

  await openSheet(page);
  await page.getByTestId('quick-effort-light').click();
  await expectPressed(page, 'quick-effort-light');

  // A plan with at least one real weight on it, so a light weight written anywhere it should not
  // be has a number to differ from.
  let preview = await readPreview(page);
  for (let i = 0; i < 25 && !hasKg(preview); i++) {
    await shuffle(page);
    preview = await readPreview(page);
  }
  expect(hasKg(preview), 'a previewed plan with a weight on it').toBe(true);
  expect(preview.every((r) => r.repMin === 10 && r.repMax === 15)).toBe(true);

  await page.getByTestId('quick-start').click();
  await expect(page).toHaveURL(/\/session\//);

  // The live session: the same exercises in the same order.
  await expect(cardsOf(page)).toHaveCount(preview.length);
  expect(await cardNames(page)).toEqual(preview.map((r) => r.name));

  // Each card, as it comes up, starts on the previewed weight (only the card being done has a box),
  // for a row that has a number. A row that says "no weight yet" starts empty only because this
  // database has no history for it: with history it starts on the exercise's last real set (see the
  // last-time test below), which is a ghost and not a prescription. Then every target set at the top
  // of the range, which a real routine would put the weight up for.
  for (const [i, row] of preview.entries()) {
    const card = cardsOf(page).nth(i);
    await expect(card.getByTestId('weight-input').first()).toHaveValue(ghostOf(row.weight));
    for (let k = 0; k < row.sets; k++) await logOneSet(page, card, row.weight === 'no weight yet' ? 20 : storedOf(row.weight), row.repMax);
  }
  await finish(page);

  // Nothing is offered for next time, and every item reads as it was done.
  await expect(page.getByTestId('summary-hero')).toHaveAttribute('data-settled', 'true');
  await expect(page.getByText(/ · no progression$/)).toHaveCount(preview.length);
  await expect(page.getByText('Next time', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('lock-in')).toHaveCount(0);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);

  // The raw database, not the screen. The session ended, so everything below is what finishing left.
  await expect.poll(async () => (await table(page, 'sessions'))[0]?.endedAt).toBeTruthy();
  const raw = await readRawIron(page);
  const routines = raw.tables.routines as Row[];
  const hidden = routines.filter((r) => r.quick === true);
  expect(hidden).toEqual([expect.objectContaining({ name: 'Quick session', archived: true, quick: true, order: -1 })]);
  expect(routines.filter((r) => r.quick !== true).sort(byId)).toEqual([...seeded.routines].sort(byId));

  const rxs = raw.tables.routineExercises as Row[];
  // The seeded routines' rows are exactly as they were: a light weight never reaches a real one.
  expect(rxs.filter((r) => r.routineId !== hidden[0].id).sort(byId)).toEqual([...seeded.routineExercises].sort(byId));
  // The hidden rows hold what was previewed, and finishing decided nothing for them.
  const quickRxs = rxs.filter((r) => r.routineId === hidden[0].id).sort((a, b) => Number(a.order) - Number(b.order));
  expect(quickRxs.map((r) => [r.currentWeight, r.mode])).toEqual(preview.map((r) => [storedOf(r.weight), r.weight === 'no weight yet' ? 'calibrating' : 'normal']));
  const decisions = raw.tables.decisions as Row[];
  expect(decisions.map((d) => d.rule)).toEqual(preview.filter((r) => r.weight === 'no weight yet').map(() => 'calibrating'));
  expect(raw.tables.sessions as Row[]).toEqual([expect.objectContaining({ quick: 'light', title: 'Quick session · light', routineId: hidden[0].id })]);
  expect((raw.tables.setLogs as Row[]).length).toBe(preview.reduce((n, r) => n + r.sets, 0));
});

test('a typed request sets the chips and the plan, and a tap or another phrase replaces it', async ({ page }) => {
  await fresh(page);
  await openSheet(page);

  await page.getByTestId('quick-request').pressSequentially("can't be bothered today, give me four exercises that are lightweight");
  await expectPressed(page, 'quick-count-4');
  await expectPressed(page, 'quick-effort-light');
  await expectPressed(page, 'quick-count-auto', false);
  await expectPressed(page, 'quick-effort-normal', false);
  // Four exercises are asked for, so the thirty minutes size nothing and no Time chip is lit.
  await expectPressed(page, 'quick-minutes-30', false);

  // The plan is for those options: four rows, each a light prescription, none of the barbell lifts.
  await expect(rowsOf(page)).toHaveCount(4);
  const light = await readPreview(page);
  for (const row of light) {
    expect(row.repMin, row.text).toBe(10);
    expect(row.repMax, row.text).toBe(15);
    expect(row.sets, row.text).toBeLessThanOrEqual(3);
    expect(LIGHT_EXCLUDED).not.toContain(row.name);
  }
  await expect(page.getByTestId('quick-estimate')).toHaveText(/^about \d+ min · 4 exercises$/);

  // Auto hands the sizing back to the minutes, which are the thirty that "can't be bothered" said.
  await page.getByTestId('quick-count-auto').click();
  await expectPressed(page, 'quick-count-auto');
  await expectPressed(page, 'quick-minutes-30');

  // A tap beats what was typed.
  await page.getByTestId('quick-count-6').click();
  await expectPressed(page, 'quick-count-6');
  await expectPressed(page, 'quick-count-4', false);
  await expect(rowsOf(page)).toHaveCount(6);

  // A new phrase about the count beats the tap; what it says nothing about stays as it was.
  await page.getByTestId('quick-request').fill('light, five exercises');
  await expectPressed(page, 'quick-count-5');
  await expectPressed(page, 'quick-effort-light');
  await expect(rowsOf(page)).toHaveCount(5);

  // A count outside the fixed chips is one more chip, selected.
  await page.getByTestId('quick-request').fill('two exercises');
  await expectPressed(page, 'quick-count-2');
  await expect(rowsOf(page)).toHaveCount(2);

  // A time outside the fixed chips is one more chip too. It is lit only while the minutes size the
  // plan, so the count goes to Auto first: the 6 tapped earlier waits behind the text and would come
  // back the moment the typed count goes, which is a count again.
  await page.getByTestId('quick-count-auto').click();
  await expectPressed(page, 'quick-count-auto');
  await page.getByTestId('quick-request').fill('35 min');
  await expectPressed(page, 'quick-minutes-35');
});

test('a count tapped survives typing a time one key at a time: the "4" of "45" is not a count', async ({ page }) => {
  await fresh(page);
  await openSheet(page);
  await page.getByTestId('quick-count-5').click();
  await expectPressed(page, 'quick-count-5');

  // "light" is the last word typed, so its chip lighting means every key before it has been read: the
  // tap is asserted only after that, and cannot be satisfied by the state before the typing.
  await page.getByTestId('quick-request').pressSequentially('45 min light');
  await expectPressed(page, 'quick-effort-light');
  await expectPressed(page, 'quick-count-5');
  await expectPressed(page, 'quick-count-auto', false);
  await expectPressed(page, 'quick-count-4', false);
  await expect(rowsOf(page)).toHaveCount(5);
  // With five exercises asked for the minutes size nothing, so no Time chip is lit; Auto gives the
  // sizing back to them, and the 45 that was typed is what lights.
  await expectPressed(page, 'quick-minutes-45', false);
  await page.getByTestId('quick-count-auto').click();
  await expectPressed(page, 'quick-count-auto');
  await expectPressed(page, 'quick-minutes-45');
  await expectPressed(page, 'quick-minutes-40', false);
});

test('"no legs or arms" rules out both: two No chips, and no plan row is a leg or an arm however it is shuffled', async ({ page }) => {
  await fresh(page);
  await openSheet(page);
  const ARMS = ['biceps', 'triceps', 'forearms'];

  await page.getByTestId('quick-request').fill('no legs or arms');
  await expect(page.getByTestId('quick-exclude-legs')).toBeVisible();
  await expect(page.getByTestId('quick-exclude-arms')).toBeVisible();
  // Neither is asked for: the arms are not lit as a focus.
  await expectPressed(page, 'quick-focus-arms', false);
  await expectPressed(page, 'quick-focus-auto');
  await expect(page.locator('[data-testid^="quick-exclude-"]')).toHaveCount(2);

  for (let i = 0; i < 15; i++) {
    const rows = await readPreview(page);
    expect(rows.length, 'a plan with the legs and arms left out still has rows').toBeGreaterThan(0);
    for (const row of rows) {
      expect(LEGS, row.text).not.toContain(row.muscle);
      expect(ARMS, row.text).not.toContain(row.muscle);
    }
    await shuffle(page);
  }
});

test('Shuffle draws another plan from the same options, and never writes anything', async ({ page }) => {
  await fresh(page);
  const seeded = await seededRows(page);
  await openSheet(page);
  await page.getByTestId('quick-count-4').click();
  await page.getByTestId('quick-effort-light').click();
  await expectPressed(page, 'quick-count-4');
  await expectPressed(page, 'quick-effort-light');
  await expect(rowsOf(page)).toHaveCount(4);
  const first = (await readPreview(page)).map((r) => r.text);

  let changed = false;
  for (let i = 0; i < 15; i++) {
    await shuffle(page);
    const now = await readPreview(page);
    // The options stand, so every plan is four light rows.
    expect(now).toHaveLength(4);
    expect(now.every((r) => r.repMin === 10 && r.repMax === 15)).toBe(true);
    changed ||= now.map((r) => r.text).join('\n') !== first.join('\n');
  }
  expect(changed, 'at least one press gave a different plan').toBe(true);
  await expectPressed(page, 'quick-count-4');
  await expectPressed(page, 'quick-effort-light');

  // Previewing and shuffling write nothing: closing the sheet leaves the database as it was.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quick-preview')).toHaveCount(0);
  await expectNoQuickRows(page, seeded);
});

test('a quick session does not move the rotation, and a quick lower session counts as a lower day', async ({ page }) => {
  test.setTimeout(180_000);
  await fresh(page);
  const nextUp = page.getByTestId('next-up').locator('.text-3xl');

  // Lower (Hinge) for real: the week moves on to Upper (Push).
  await page.getByTestId('start-session').click();
  await expect(page).toHaveURL(/\/session\//);
  await completeSession(page);
  await expect(nextUp).toHaveText('Upper (Push)');

  // A quick session after it, whatever it is made of: Next up is still Upper (Push). Read again from
  // scratch, so a stale first render cannot stand in for the settled one.
  await openSheet(page);
  await page.getByTestId('quick-start').click();
  await expect(page).toHaveURL(/\/session\//);
  await completeSession(page);
  await expect(page.getByText(/^Quick session · /).first()).toBeVisible();
  await page.reload({ waitUntil: 'load' });
  await expect(nextUp).toHaveText('Upper (Push)');

  // Upper (Push) for real, so the last real session is not a lower day; then the week says Lower (Squat).
  await page.getByTestId('start-Upper (Push)').click();
  await expect(page).toHaveURL(/\/session\//);
  await completeSession(page);
  await page.reload({ waitUntil: 'load' });
  await expect(nextUp).toHaveText('Lower (Squat)');

  // A quick session on legs only: a lower day. It does not move the rotation, but the week will not
  // put a second lower day straight after it: Next up steps over Lower (Squat).
  await openSheet(page);
  await page.getByTestId('quick-request').fill('legs');
  await expectPressed(page, 'quick-focus-legs');
  const legs = await readPreview(page);
  expect(legs.length).toBeGreaterThan(0);
  for (const row of legs) expect(LEGS, row.text).toContain(row.muscle);
  await page.getByTestId('quick-start').click();
  await expect(page).toHaveURL(/\/session\//);
  await completeSession(page);
  await page.reload({ waitUntil: 'load' });
  await expect(nextUp).toHaveText('Upper (Pull)');

  // And picking Lower (Squat) by hand asks first: the last session was a lower day.
  await page.getByTestId('start-Lower (Squat)').click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Start anyway' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('discarding a live quick session from the live screen leaves none of its rows behind', async ({ page }) => {
  await fresh(page);
  const seeded = await seededRows(page);
  await startQuick(page);
  await expect(cardsOf(page).first()).toBeVisible();
  await logOneSet(page, cardsOf(page).first(), 20, 10);
  // The rows exist now, so their absence below is the discard's doing.
  await expect.poll(async () => (await table(page, 'routines')).filter((r) => r.quick === true).length).toBe(1);

  await page.getByRole('button', { name: 'Discard session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await table(page, 'sessions')).length).toBe(0);

  await expectNoQuickRows(page, seeded);
});

test('deleting a finished quick session from History leaves none of its rows behind', async ({ page }) => {
  await fresh(page);
  const seeded = await seededRows(page);
  await startQuick(page);
  await completeSession(page);
  await expect.poll(async () => (await table(page, 'sessions'))[0]?.endedAt).toBeTruthy();

  await page.goto('/history');
  await page.getByRole('button', { name: /Quick session/ }).first().click();
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);
  await page.getByTestId('delete-session').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect.poll(async () => (await table(page, 'sessions')).length).toBe(0);

  await expectNoQuickRows(page, seeded);
});

test('a muscle ruled out is never in the plan, however often it is shuffled', async ({ page }) => {
  await fresh(page);
  await openSheet(page);

  // The control: asked for, the legs are there (so the pool has them to leave out below).
  await page.getByTestId('quick-focus-legs').click();
  await expectPressed(page, 'quick-focus-legs');
  for (let i = 0; i < 4; i++) {
    const rows = await readPreview(page);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(LEGS, row.text).toContain(row.muscle);
    await shuffle(page);
  }

  await page.getByTestId('quick-focus-legs').click();
  await expectPressed(page, 'quick-focus-legs', false);
  await page.getByTestId('quick-request').fill('no legs');
  await expect(page.getByTestId('quick-exclude-legs')).toBeVisible();
  for (let i = 0; i < 15; i++) {
    const rows = await readPreview(page);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(LEGS, row.text).not.toContain(row.muscle);
    await shuffle(page);
  }

  // The exclusion survives a tap on another chip, and lifting it brings the legs back into reach.
  await page.getByTestId('quick-count-6').click();
  await expectPressed(page, 'quick-count-6');
  await expect(page.getByTestId('quick-exclude-legs')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(6);
  const six = await readPreview(page);
  expect(six.length).toBeGreaterThan(0);
  for (const row of six) expect(LEGS, row.text).not.toContain(row.muscle);
  await page.getByTestId('quick-exclude-legs').click();
  await expect(page.getByTestId('quick-exclude-legs')).toHaveCount(0);
});

test('Push then Pull asks for both, tapping Push again leaves Pull, and Auto clears the focus', async ({ page }) => {
  await fresh(page);
  await openSheet(page);
  const PUSH = ['chest', 'shoulders', 'triceps'];
  const PULL = ['lats', 'upper back', 'traps', 'rear delts', 'biceps'];

  await page.getByTestId('quick-focus-push').click();
  await expectPressed(page, 'quick-focus-push');
  await expectPressed(page, 'quick-focus-auto', false);
  const push = await readPreview(page);
  expect(push.length, 'a Push plan has rows').toBeGreaterThan(0);
  for (const row of push) expect(PUSH, row.text).toContain(row.muscle);

  await page.getByTestId('quick-focus-pull').click();
  await expectPressed(page, 'quick-focus-pull');
  await expectPressed(page, 'quick-focus-push');
  const both = await readPreview(page);
  expect(both.length, 'a Push and Pull plan has rows').toBeGreaterThan(0);
  for (const row of both) expect([...PUSH, ...PULL], row.text).toContain(row.muscle);
  // Both were asked for, so across a few shuffles the plans draw on both.
  let sawPush = both.some((r) => PUSH.includes(r.muscle) && !PULL.includes(r.muscle));
  let sawPull = both.some((r) => PULL.includes(r.muscle) && !PUSH.includes(r.muscle));
  for (let i = 0; i < 12 && !(sawPush && sawPull); i++) {
    await shuffle(page);
    const rows = await readPreview(page);
    expect(rows.length, 'a shuffled Push and Pull plan has rows').toBeGreaterThan(0);
    for (const row of rows) expect([...PUSH, ...PULL], row.text).toContain(row.muscle);
    sawPush ||= rows.some((r) => PUSH.includes(r.muscle) && !PULL.includes(r.muscle));
    sawPull ||= rows.some((r) => PULL.includes(r.muscle) && !PUSH.includes(r.muscle));
  }
  expect(sawPush, 'a plan with a push muscle only').toBe(true);
  expect(sawPull, 'a plan with a pull muscle only').toBe(true);

  await page.getByTestId('quick-focus-push').click();
  await expectPressed(page, 'quick-focus-push', false);
  await expectPressed(page, 'quick-focus-pull');
  const pull = await readPreview(page);
  expect(pull.length, 'a Pull plan has rows').toBeGreaterThan(0);
  for (const row of pull) expect(PULL, row.text).toContain(row.muscle);

  await page.getByTestId('quick-focus-auto').click();
  await expectPressed(page, 'quick-focus-auto');
  await expectPressed(page, 'quick-focus-pull', false);

  // A muscle typed by name is its own chip, and a tap on it takes it away.
  await page.getByTestId('quick-request').fill('neck');
  await expectPressed(page, 'quick-focus-neck');
  await page.getByTestId('quick-focus-neck').click();
  await expect(page.getByTestId('quick-focus-neck')).toHaveCount(0);
  await expectPressed(page, 'quick-focus-auto');
});

test('says what there is to say and no more: a muscle with no exercise, a short count, nothing to choose from', async ({ page }) => {
  await fresh(page);
  await openSheet(page);

  // No seeded exercise is for the forearms: named on its own, that is a fact, and Start has nothing to start.
  await page.getByTestId('quick-request').fill('forearms');
  await expect(page.getByTestId('quick-unmet')).toHaveText('No exercises for forearms');
  await expect(page.getByTestId('quick-empty')).toHaveText('Nothing to choose from');
  await expect(rowsOf(page)).toHaveCount(0);
  await expect(page.getByTestId('quick-start')).toBeDisabled();

  // The same muscle inside Arms is not reported by name: the other two arm muscles have exercises.
  await page.getByTestId('quick-request').fill('arms');
  await expectPressed(page, 'quick-focus-arms');
  await expect(page.getByTestId('quick-unmet')).toHaveCount(0);
  await expect(page.getByTestId('quick-empty')).toHaveCount(0);
  expect((await readPreview(page)).length).toBeGreaterThan(0);
  await expect(page.getByTestId('quick-start')).toBeEnabled();

  // One exercise for the neck, six asked for.
  await page.getByTestId('quick-request').fill('six neck exercises');
  await expectPressed(page, 'quick-count-6');
  await expect(page.getByTestId('quick-short')).toHaveText('Only 1 available');
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(page.getByTestId('quick-estimate')).toHaveText(/^about \d+ min · 1 exercise$/);
});

test('Include new adds exercises from the catalogue, marks them New, and Start makes them the owner\'s own', async ({ page }) => {
  await fresh(page);
  await openSheet(page);
  await expect(page.getByTestId('quick-include-new')).toHaveAttribute('aria-checked', 'false');

  // One exercise of their own for the abs, four asked for.
  await page.getByTestId('quick-request').fill('four abs');
  await expectPressed(page, 'quick-count-4');
  await expect(page.getByTestId('quick-short')).toHaveText('Only 1 available');
  await expect(page.locator('[data-testid^="quick-new-"]')).toHaveCount(0);

  await page.getByTestId('quick-include-new').click();
  await expect(page.getByTestId('quick-include-new')).toHaveAttribute('aria-checked', 'true');
  // The catalogue loads, and the short count fills up: at most two rows are new.
  await expect(page.getByTestId('quick-short')).toHaveText('Only 3 available');
  const preview = await readPreview(page);
  expect(preview).toHaveLength(3);
  const added = preview.filter((r) => r.isNew);
  expect(added).toHaveLength(2);
  for (const row of added) expect(row.weight, row.text).toBe('no weight yet');

  await page.getByTestId('quick-start').click();
  await expect(page).toHaveURL(/\/session\//);
  await expect(cardsOf(page)).toHaveCount(3);
  expect(await cardNames(page)).toEqual(preview.map((r) => r.name));

  // The new ones are exercises now, each with its picture key, and only the ones that were shown.
  await expect.poll(async () => (await table(page, 'exercises')).filter((e) => String(e.demo ?? '').startsWith('cat:')).length).toBe(2);
  const made = (await table(page, 'exercises')).filter((e) => String(e.demo ?? '').startsWith('cat:'));
  expect(made.map((e) => e.name).sort()).toEqual(added.map((r) => r.name).sort());
  expect(made.every((e) => e.equipment === 'bodyweight')).toBe(true);
});

test('discarding a session that used Include new takes the exercises Start made from the catalogue, and nothing else', async ({ page }) => {
  await fresh(page);
  const seeded = await seededRows(page);
  const exercisesBefore = (await table(page, 'exercises')).length;
  const made = async (): Promise<Row[]> => (await table(page, 'exercises')).filter((e) => String(e.demo ?? '').startsWith('cat:'));

  await openSheet(page);
  await page.getByTestId('quick-request').fill('four abs');
  await expectPressed(page, 'quick-count-4');
  await page.getByTestId('quick-include-new').click();
  await expect(page.getByTestId('quick-short')).toHaveText('Only 3 available');
  expect((await readPreview(page)).filter((r) => r.isNew)).toHaveLength(2);
  await page.getByTestId('quick-start').click();
  await expect(page).toHaveURL(/\/session\//);
  // They are exercises now, so their absence below is the discard's doing.
  await expect.poll(async () => (await made()).length).toBe(2);

  await page.getByRole('button', { name: 'Discard session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await table(page, 'sessions')).length).toBe(0);

  await expect.poll(async () => (await table(page, 'exercises')).length).toBe(exercisesBefore);
  expect(await made()).toEqual([]);
  await expectNoQuickRows(page, seeded);
});

/** Raw rows for a database made before the app ever boots: an exercise, and the settings it needs. */
const rawExercise = (day: string, id: string, name: string, muscleGroup: string, over: Row = {}): Row => ({
  id,
  name,
  kind: 'reps',
  muscleGroup,
  isCompound: false,
  isLowerBody: false,
  defaultRestSec: 75,
  defaultIncrement: 2.5,
  unilateral: false,
  equipment: 'dumbbell',
  createdAt: day,
  ...over,
});

const rawSettings = (day: string): Row => ({
  id: 'settings',
  units: 'kg',
  theme: 'dark',
  calorieStart: 1900,
  calorieStep: 200,
  calorieStepDays: 14,
  calorieCeiling: 3000,
  proteinTarget: 170,
  proteinTargetLegDay: 200,
  weeklyGainTargetMin: 0.25,
  weeklyGainTargetMax: 0.5,
  bodyweightTargetMin: 80,
  bodyweightTargetMax: 82,
  restCompoundSec: 150,
  restIsolationSec: 75,
  restCarrySec: 90,
  restVibrate: true,
  restNotify: true,
  productLookup: true,
  seedVersion: 3,
  createdAt: day,
});

test('with no routines at all, Short session is still there and starts a session', async ({ page }) => {
  // The owner has exercises and settings and no routine: raw rows, before the app ever boots.
  await page.goto('/icons/icon-192.png');
  const day = new Date().toISOString();
  const exercise = (id: string, name: string, muscleGroup: string): Row => rawExercise(day, id, name, muscleGroup);
  await createRawIronDb(page, 30, IRON_SCHEMA_V3, {
    exercises: [exercise('e-press', 'Test Press', 'chest'), exercise('e-row', 'Test Row', 'lats'), exercise('e-curl', 'Test Curl', 'biceps'), exercise('e-ext', 'Test Extension', 'triceps')],
    settings: [rawSettings(day)],
  });
  await page.goto('/');
  await expect(page.getByText('No routines yet')).toBeVisible();
  await expect(page.getByTestId('start-session')).toHaveCount(0);

  await openSheet(page);
  // Nothing of theirs has a weight: every row says so.
  const preview = await readPreview(page);
  expect(preview.length).toBeGreaterThanOrEqual(3);
  expect(preview.every((r) => r.weight === 'no weight yet')).toBe(true);
  await page.getByTestId('quick-start').click();
  await expect(page).toHaveURL(/\/session\//);
  await expect(cardsOf(page)).toHaveCount(preview.length);
  expect(await cardNames(page)).toEqual(preview.map((r) => r.name));
});

test('a row with no weight yet starts the live card on the last real set: a last-time ghost, not a prescription', async ({ page }) => {
  // One exercise, in a real routine that still has it calibrating, with one real finished set of
  // 25 x 8: raw rows, before the app ever boots. Nothing quick has ever run.
  await page.goto('/icons/icon-192.png');
  const day = new Date().toISOString();
  const lastTime = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  await createRawIronDb(page, 30, IRON_SCHEMA_V3, {
    exercises: [rawExercise(day, 'e-press', 'Test Press', 'chest')],
    settings: [rawSettings(day)],
    routines: [{ id: 'r-day', name: 'Test Day', order: 0, isLowerBody: false }],
    routineExercises: [
      { id: 'rx-press', routineId: 'r-day', exerciseId: 'e-press', order: 0, targetSets: 3, repMin: 8, repMax: 10, currentWeight: 0, increment: 2.5, mode: 'calibrating', optional: false },
    ],
    sessions: [{ id: 's-last', routineId: 'r-day', title: 'Test Day', startedAt: lastTime, endedAt: lastTime, durationSec: 2400 }],
    setLogs: [{ id: 'set-last', sessionId: 's-last', routineExerciseId: 'rx-press', exerciseId: 'e-press', index: 0, type: 'working', weight: 25, reps: 8, completedAt: lastTime }],
  });
  await page.goto('/');
  await openSheet(page);
  await page.getByTestId('quick-effort-light').click();
  await expectPressed(page, 'quick-effort-light');

  // The preview offers no weight, because the exercise is calibrating: its history is not borrowed.
  const preview = await readPreview(page);
  expect(preview.map((r) => [r.name, r.weight, r.repMin, r.repMax])).toEqual([['Test Press', 'no weight yet', 10, 15]]);
  await page.getByTestId('quick-start').click();
  await expect(page).toHaveURL(/\/session\//);

  // The live card, as any card is, is pre-filled from the exercise's last real set: 25 kg for 8, which
  // is the last time it was done and neither the light range nor a prescribed weight.
  const card = cardsOf(page).first();
  await expect(card.getByTestId('weight-input').first()).toHaveValue('25');
  await expect(card.getByTestId('reps-input').first()).toHaveValue('8');

  // What Start wrote is still the preview: a calibrating row with no weight and the light range.
  const raw = await readRawIron(page);
  const hidden = (raw.tables.routines as Row[]).find((r) => r.quick === true)!;
  const quickRows = (raw.tables.routineExercises as Row[]).filter((r) => r.routineId === hidden.id);
  expect(quickRows).toEqual([expect.objectContaining({ exerciseId: 'e-press', mode: 'calibrating', currentWeight: 0, repMin: 10, repMax: 15 })]);
});

test('with a session running, Home has no Short session button', async ({ page }) => {
  await fresh(page);
  await startQuick(page);
  await expect(cardsOf(page).first()).toBeVisible();

  await page.goto('/');
  // The dock is only there once the live session has been read, so what follows is not a screen still loading.
  await expect(page.getByTestId('live-banner')).toBeVisible();
  await expect(page.getByTestId('short-session')).toHaveCount(0);
  await expect(page.getByTestId('next-up')).toHaveCount(0);
  expect((await table(page, 'sessions')).length).toBe(1);
});
