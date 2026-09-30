import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, createRawIronDb, IRON_SCHEMA_V3, logOneSet, readRawIron } from './fresh';

/**
 * A quick session ("Short session") runs on a HIDDEN one-off routine: archived, marked `quick`,
 * made at Start, gone with its session. Everything here seeds the `iron` database as raw IndexedDB
 * with exactly the rows Start writes (src/db/quickRepo.ts), so the screens read what a real quick
 * session leaves behind without needing the sheet that starts one. The rows are checked against the
 * live database by src/db/quickRepo.test.ts, which starts the session through the real code.
 *
 * Nothing here waits on a toast. Each assertion waits on a signal only its own event can produce (a
 * URL that changes, a row that appears, a raw IndexedDB read), and anything asserted ABSENT is
 * asserted only after something that can only be present once the screen has rendered.
 */

const T0 = Date.now();
const DAY = 24 * 60;
/** An ISO timestamp `minutes` ago. */
const ago = (minutes: number) => new Date(T0 - minutes * 60_000).toISOString();

type Row = Record<string, unknown>;

function exercise(id: string, name: string, over: Row = {}): Row {
  return {
    id,
    name,
    kind: 'reps',
    muscleGroup: 'chest',
    isCompound: false,
    isLowerBody: false,
    defaultRestSec: 75,
    defaultIncrement: 2.5,
    unilateral: false,
    createdAt: ago(30 * DAY),
    ...over,
  };
}

function routineExercise(id: string, routineId: string, exerciseId: string, over: Row = {}): Row {
  return { id, routineId, exerciseId, order: 0, targetSets: 2, repMin: 10, repMax: 15, currentWeight: 40, increment: 2.5, mode: 'normal', optional: false, ...over };
}

function setLog(id: string, sessionId: string, routineExerciseId: string, exerciseId: string, index: number, weight: number, reps: number, at: string): Row {
  return { id, sessionId, routineExerciseId, exerciseId, index, type: 'working', weight, reps, completedAt: at };
}

function finished(id: string, routineId: string, title: string, startedMinutesAgo: number, over: Row = {}): Row {
  return { id, routineId, title, startedAt: ago(startedMinutesAgo), endedAt: ago(startedMinutesAgo - 40), durationSec: 2400, ...over };
}

const SETTINGS: Row = {
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
  barKg: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
  deloadPercent: 0.9,
  weeklySessionTarget: 3,
  createdAt: ago(30 * DAY),
};

const BENCH = 'Test Bench Press';
const CRUNCH = 'Test Cable Crunch';

// The owner's week, in the order they do it: two lower days and two upper.
const EXERCISES = [
  exercise('ex-bench', BENCH),
  exercise('ex-crunch', CRUNCH, { muscleGroup: 'abs' }),
  exercise('ex-dead', 'Test Deadlift', { muscleGroup: 'hamstrings', isCompound: true, isLowerBody: true, defaultRestSec: 150, defaultIncrement: 5 }),
  exercise('ex-squat', 'Test Squat', { muscleGroup: 'quads', isCompound: true, isLowerBody: true, defaultRestSec: 150, defaultIncrement: 5 }),
];
const ROUTINES = [
  { id: 'r-hinge', name: 'Lower (Hinge)', order: 0, isLowerBody: true, targetMinutes: 50 },
  { id: 'r-push', name: 'Upper (Push)', order: 1, isLowerBody: false, targetMinutes: 45 },
  { id: 'r-squat', name: 'Lower (Squat)', order: 2, isLowerBody: true, targetMinutes: 50 },
  { id: 'r-pull', name: 'Upper (Pull)', order: 3, isLowerBody: false, targetMinutes: 45 },
];
const REAL_RXS = [
  routineExercise('rx-hinge', 'r-hinge', 'ex-dead', { currentWeight: 100, repMin: 6, repMax: 8, targetSets: 3, increment: 5 }),
  routineExercise('rx-push', 'r-push', 'ex-bench', { currentWeight: 60, repMin: 6, repMax: 8, targetSets: 3 }),
  routineExercise('rx-squat', 'r-squat', 'ex-squat', { currentWeight: 80, repMin: 6, repMax: 8, targetSets: 3, increment: 5 }),
  routineExercise('rx-pull', 'r-pull', 'ex-crunch', { currentWeight: 30, repMin: 10, repMax: 12, targetSets: 3 }),
];

/** The hidden routine a quick session runs on, as Start writes it. */
function quickRoutine(id: string, isLowerBody: boolean): Row {
  return { id, name: 'Quick session', order: -1, isLowerBody, archived: true, quick: true };
}

/** What the live card needs: a normal 40 kg slot and a calibrating one, fresh rows with no link. */
const QUICK_RXS = [
  routineExercise('qrx-bench', 'r-quick', 'ex-bench', { order: 0, currentWeight: 40 }),
  routineExercise('qrx-crunch', 'r-quick', 'ex-crunch', { order: 1, currentWeight: 0, mode: 'calibrating', repMin: 12, repMax: 15 }),
];

function byId(a: Row, b: Row): number {
  return String(a.id).localeCompare(String(b.id));
}

/** Seed the database BEFORE the app ever boots, then leave the page on a neutral asset. */
async function seed(page: Page, data: Record<string, Row[]>): Promise<void> {
  await page.goto('/icons/icon-192.png'); // static: no app JS runs, so nothing opens `iron` first
  await createRawIronDb(page, 30, IRON_SCHEMA_V3, { exercises: EXERCISES, settings: [SETTINGS], ...data });
}

/** Finish from the live screen and save from the summary, as a person does. */
async function finishAndSave(page: Page): Promise<void> {
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
}

// ---------------------------------------------------------------------------

test('a finished quick session leaves Next up where it was: Upper (Push) after Lower (Hinge)', async ({ page }) => {
  await seed(page, {
    routines: [...ROUTINES, quickRoutine('r-quick', false)],
    routineExercises: [...REAL_RXS, ...QUICK_RXS],
    sessions: [
      finished('s-hinge', 'r-hinge', 'Lower (Hinge)', 2 * DAY),
      finished('s-quick', 'r-quick', 'Quick session · light', 1 * DAY, { quick: 'light' }),
    ],
    setLogs: [setLog('l-quick-1', 's-quick', 'qrx-bench', 'ex-bench', 0, 26, 12, ago(1 * DAY - 10))],
  });
  await page.goto('/');

  // Both sessions are in the list, so the quick one is there to be mistaken for the last.
  await expect(page.getByText('Quick session · light')).toBeVisible();
  await expect(page.getByText('Lower (Hinge)', { exact: true }).first()).toBeVisible();
  // The hidden routine is in no list of routines, and the rotation carries on from the Hinge day.
  await expect(page.getByTestId('next-up').locator('.text-3xl')).toHaveText('Upper (Push)');
  await expect(page.getByTestId('start-Upper (Push)')).toBeVisible();
  await expect(page.getByTestId('start-Quick session')).toHaveCount(0);
});

test('a quick lower session counts as a lower day: Lower (Squat) is skipped and asks before it starts', async ({ page }) => {
  await seed(page, {
    routines: [...ROUTINES, quickRoutine('r-quick', true)],
    routineExercises: [...REAL_RXS, routineExercise('qrx-dead', 'r-quick', 'ex-dead', { currentWeight: 65 }), routineExercise('qrx-squat', 'r-quick', 'ex-squat', { order: 1, currentWeight: 50 })],
    sessions: [
      finished('s-push', 'r-push', 'Upper (Push)', 2 * DAY),
      finished('s-quick', 'r-quick', 'Quick session · light', 1 * DAY, { quick: 'light' }),
    ],
  });
  await page.goto('/');

  // After Push the week says Lower (Squat); the lower day in between moves it on to Upper (Pull).
  await expect(page.getByTestId('next-up').locator('.text-3xl')).toHaveText('Upper (Pull)');

  await page.getByTestId('start-Lower (Squat)').click();
  const warning = page.getByRole('dialog');
  await expect(warning.getByRole('button', { name: 'Start anyway' })).toBeVisible();
  await expect(warning).toContainText('Last session was Quick session · light.');
  await expect(page).toHaveURL(/\/$/);
});

test('the Archived list counts the routine that was deleted, and not the hidden one beside it', async ({ page }) => {
  await seed(page, {
    routines: [...ROUTINES, { id: 'r-old', name: 'Old routine', order: 9, isLowerBody: false, archived: true }, quickRoutine('r-quick', false)],
    routineExercises: [...REAL_RXS, routineExercise('rx-old', 'r-old', 'ex-bench'), ...QUICK_RXS],
    sessions: [
      finished('s-old', 'r-old', 'Old routine', 3 * DAY),
      finished('s-quick', 'r-quick', 'Quick session · light', 1 * DAY, { quick: 'light' }),
    ],
  });
  await page.goto('/routines');

  await expect(page.getByTestId('routine-more-Lower (Hinge)')).toBeVisible();
  // toHaveText matches the whole string: a count that has not settled cannot pass for the right one.
  const toggle = page.getByTestId('archived-toggle');
  await expect(toggle).toHaveText('Archived · 1');
  await toggle.click();
  await expect(page.getByTestId('restore-routine-Old routine')).toBeVisible();
  await expect(page.locator('[data-testid^="restore-routine-"]')).toHaveCount(1);
  await expect(page.getByTestId('restore-routine-Quick session')).toHaveCount(0);
  // Nor is it one of the routines themselves.
  await expect(page.locator('[data-testid^="routine-more-"]')).toHaveCount(ROUTINES.length);
});

test('a live quick session shows no verdict, lock-in or deload switch, and saving it decides no weight', async ({ page }) => {
  await seed(page, {
    routines: [...ROUTINES, quickRoutine('r-quick', false)],
    routineExercises: [...REAL_RXS, ...QUICK_RXS],
    sessions: [
      finished('s-hinge', 'r-hinge', 'Lower (Hinge)', 3 * DAY),
      { id: 's-live', routineId: 'r-quick', title: 'Quick session · light', startedAt: ago(10), quick: 'light' },
    ],
  });
  const realBefore = [...REAL_RXS].sort(byId);

  await page.goto('/session/s-live');
  const bench = page.getByTestId(`exercise-card-${BENCH}`);
  const crunch = page.getByTestId(`exercise-card-${CRUNCH}`);
  await expect(page.getByTestId('finish-session')).toBeVisible();
  await expect(bench).toBeVisible();
  // The header's menu holds the deload switch only, so a quick session has none.
  await expect(page.getByTestId('session-options')).toHaveCount(0);

  // Every set at the top of the range: a real routine would promise an increase here.
  await logOneSet(page, bench, 40, 15);
  await logOneSet(page, bench, 40, 15);
  await expect(page.getByTestId('exercise-complete')).toBeVisible();
  await expect(page.getByTestId('verdict-line')).toHaveCount(0);
  await expect(page.getByTestId('exercise-complete')).toHaveCount(0);
  await expect(bench.getByTestId('feel-Easy')).toBeVisible();
  await expect(bench.getByTestId('verdict-line')).toHaveCount(0);

  // A calibrating slot would offer to lock its weight in.
  await logOneSet(page, crunch, 30, 12);
  await logOneSet(page, crunch, 30, 12);
  await expect(page.getByTestId('exercise-complete')).toBeVisible();
  await expect(page.getByTestId('exercise-complete')).toHaveCount(0);
  await expect(crunch.getByTestId('feel-Easy')).toBeVisible();
  await expect(crunch.getByTestId('session-lock-in')).toHaveCount(0);
  await expect(crunch.getByTestId('verdict-line')).toHaveCount(0);

  await finishAndSave(page);

  // Nothing is offered for next time: every item reads as it was done.
  await expect(page.getByTestId('summary-hero')).toHaveAttribute('data-settled', 'true');
  await expect(page.getByText('2 sets · no progression', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Next time', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId(`decision-${BENCH}`)).toHaveCount(0);
  await expect(page.getByTestId(`decision-${CRUNCH}`)).toHaveCount(0);
  await expect(page.getByTestId('lock-in')).toHaveCount(0);

  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);

  // The raw database, not the screen: the session ended, no weight moved, one decision exists.
  await expect.poll(async () => (await readRawIron(page)).tables.sessions.find((s: Row) => s.id === 's-live')?.endedAt).toBeTruthy();
  const raw = await readRawIron(page);
  const rxs = raw.tables.routineExercises as Row[];
  expect(rxs.filter((r) => !String(r.id).startsWith('qrx-')).sort(byId)).toEqual(realBefore);
  expect(rxs.find((r) => r.id === 'qrx-bench')).toMatchObject({ currentWeight: 40, mode: 'normal' });
  expect(rxs.find((r) => r.id === 'qrx-crunch')).toMatchObject({ currentWeight: 0, mode: 'calibrating' });
  expect(raw.tables.decisions).toEqual([expect.objectContaining({ sessionId: 's-live', routineExerciseId: 'qrx-crunch', rule: 'calibrating' })]);
  expect(raw.tables.sessions.find((s: Row) => s.id === 's-live')).toMatchObject({ quick: 'light', routineId: 'r-quick' });
  expect(raw.tables.routines.find((r: Row) => r.id === 'r-quick')).toMatchObject({ archived: true, quick: true });
});

test('discarding a live quick session leaves none of its rows behind, and no real one changed', async ({ page }) => {
  await seed(page, {
    routines: [...ROUTINES, quickRoutine('r-quick', false)],
    routineExercises: [...REAL_RXS, ...QUICK_RXS],
    sessions: [{ id: 's-live', routineId: 'r-quick', title: 'Quick session · light', startedAt: ago(10), quick: 'light' }],
    setLogs: [setLog('l-live-1', 's-live', 'qrx-bench', 'ex-bench', 0, 26, 12, ago(5))],
  });

  await page.goto('/session/s-live');
  await expect(page.getByTestId(`exercise-card-${BENCH}`)).toBeVisible();
  await page.getByRole('button', { name: 'Discard session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/$/);

  await expectNoQuickRows(page);
});

test('deleting a finished quick session from History leaves none of its rows behind', async ({ page }) => {
  await seed(page, {
    routines: [...ROUTINES, quickRoutine('r-quick', false)],
    routineExercises: [...REAL_RXS, ...QUICK_RXS],
    sessions: [finished('s-quick', 'r-quick', 'Quick session · light', 1 * DAY, { quick: 'light' })],
    setLogs: [setLog('l-quick-1', 's-quick', 'qrx-bench', 'ex-bench', 0, 26, 12, ago(1 * DAY - 10))],
  });

  await page.goto('/history/s-quick');
  await expect(page.getByTestId(`detail-card-${BENCH}`)).toBeVisible();
  await page.getByTestId('delete-session').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);

  await expectNoQuickRows(page);
});

test('a finished quick session cannot be saved as a routine, and a real one can', async ({ page }) => {
  await seed(page, {
    routines: [...ROUTINES, quickRoutine('r-quick', false)],
    routineExercises: [...REAL_RXS, ...QUICK_RXS],
    sessions: [
      finished('s-push', 'r-push', 'Upper (Push)', 2 * DAY),
      finished('s-quick', 'r-quick', 'Quick session · light', 1 * DAY, { quick: 'light' }),
    ],
    setLogs: [
      setLog('l-push-1', 's-push', 'rx-push', 'ex-bench', 0, 60, 8, ago(2 * DAY - 10)),
      setLog('l-quick-1', 's-quick', 'qrx-bench', 'ex-bench', 0, 26, 12, ago(1 * DAY - 10)),
    ],
  });

  // The button is there on a real session, so its absence below is not a wrong locator.
  await page.goto('/history/s-push');
  await expect(page.getByTestId(`detail-card-${BENCH}`)).toBeVisible();
  await expect(page.getByTestId('save-as-routine')).toBeVisible();

  await page.goto('/history/s-quick');
  await expect(page.getByTestId(`detail-card-${BENCH}`)).toBeVisible();
  await expect(page.getByTestId('delete-session')).toBeVisible();
  await expect(page.getByTestId('save-as-routine')).toHaveCount(0);
});

test('the sets CSV says which sessions were quick: light, normal, and empty for a real one', async ({ page }) => {
  await seed(page, {
    routines: [...ROUTINES, quickRoutine('r-quick', false), quickRoutine('r-quick-n', false)],
    routineExercises: [...REAL_RXS, ...QUICK_RXS, routineExercise('qrx-n-bench', 'r-quick-n', 'ex-bench', { order: 0, currentWeight: 40 })],
    sessions: [
      finished('s-push', 'r-push', 'Upper (Push)', 3 * DAY),
      finished('s-light', 'r-quick', 'Quick session · light', 2 * DAY, { quick: 'light' }),
      finished('s-normal', 'r-quick-n', 'Quick session · normal', 1 * DAY, { quick: 'normal' }),
    ],
    setLogs: [
      setLog('l-push', 's-push', 'rx-push', 'ex-bench', 0, 60, 8, ago(3 * DAY - 10)),
      setLog('l-light', 's-light', 'qrx-bench', 'ex-bench', 0, 40, 12, ago(2 * DAY - 10)),
      setLog('l-normal', 's-normal', 'qrx-n-bench', 'ex-bench', 0, 40, 12, ago(1 * DAY - 10)),
    ],
  });
  await page.goto('/settings');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sets CSV' }).click();
  const csv = Buffer.concat((await (await (await download).createReadStream()).toArray()) as Buffer[]).toString('utf8');

  const [header, ...lines] = csv.trim().split('\n').map((l) => l.split(','));
  expect(header.slice(0, 3)).toEqual(['session_id', 'session_start', 'session_end']);
  expect(header.at(-2)).toBe('source');
  expect(header.at(-1)).toBe('quick');
  // Each row's last cell, by session: the file says what the routine column cannot.
  expect(Object.fromEntries(lines.map((cells) => [cells[0], cells.at(-1)]))).toEqual({ 's-push': '', 's-light': 'light', 's-normal': 'normal' });
  // Both quick sessions ran on a routine called the same thing.
  expect(lines.filter((cells) => cells[4] === 'Quick session')).toHaveLength(2);
});

test('an exercise only the live quick session lists cannot be deleted from Exercises, and its card stays', async ({ page }) => {
  const ONLY = 'Test Only Move';
  await seed(page, {
    exercises: [...EXERCISES, exercise('ex-only', ONLY, { muscleGroup: 'biceps' })],
    routines: [...ROUTINES, quickRoutine('r-quick', false)],
    routineExercises: [...REAL_RXS, ...QUICK_RXS, routineExercise('qrx-only', 'r-quick', 'ex-only', { order: 2, currentWeight: 10 })],
    sessions: [{ id: 's-live', routineId: 'r-quick', title: 'Quick session · light', startedAt: ago(10), quick: 'light' }],
  });

  // It is in no real routine and has no set: the screen says so, and offers Delete.
  await page.goto('/exercises/ex-only/edit');
  await expect(page.getByText('In 0 routines · 0 logged sets')).toBeVisible();
  await page.getByTestId('delete-exercise').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

  // This page has shown no toast before this one, and only the refusal shows it. A deletion would
  // leave the screen for the list instead, and this would never appear.
  await expect(page.getByText('In use by a routine or history')).toBeVisible();
  await expect(page).toHaveURL(/\/exercises\/ex-only\/edit$/);
  const raw = await readRawIron(page);
  expect(raw.tables.exercises.map((e: Row) => e.id)).toContain('ex-only');
  expect(raw.tables.routineExercises.map((r: Row) => r.id)).toContain('qrx-only');

  // And the session it belongs to still has the card.
  await page.goto('/session/s-live');
  await expect(page.getByTestId(`exercise-card-${ONLY}`)).toBeVisible();
});

/** The hidden routine, its rows, the session and its sets are all gone; every real row is as seeded. */
async function expectNoQuickRows(page: Page): Promise<void> {
  const raw = await readRawIron(page);
  expect(raw.tables.sessions).toEqual([]);
  expect(raw.tables.setLogs).toEqual([]);
  expect(raw.tables.routines.map((r: Row) => r.id).sort()).toEqual(ROUTINES.map((r) => r.id).sort());
  expect((raw.tables.routineExercises as Row[]).sort(byId)).toEqual([...REAL_RXS].sort(byId));
}
