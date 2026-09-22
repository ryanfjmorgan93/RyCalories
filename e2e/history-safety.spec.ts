import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * Phase 1 — "history that cannot be lost silently": automatic backups, the pre-migration raw
 * backup, and loss detection with a restore offer on Home.
 *
 * (a) and (b) build the `iron` database as raw IndexedDB, at the exact shape Dexie v2 creates,
 * BEFORE the app ever boots — done by navigating to a same-origin static asset first (an icon;
 * `vite preview` serves it verbatim, so no app JS runs) and creating the database there with
 * `page.evaluate`, then navigating to `/`. This is the only way to control what "the database on
 * the phone already looked like" before a build's boot code ever touches it.
 */

// ---------------------------------------------------------------------------
// The exact Dexie v2 schema (src/db/db.ts), as raw IndexedDB store/index definitions. Compound
// index names are the literal `[a+b]` spec string — see Dexie's parseIndexSyntax/nameFromKeyPath —
// and their keyPath is the field list as an array.
const IRON_SCHEMA_V2 = [
  {
    name: 'exercises',
    keyPath: 'id',
    indexes: [
      { name: 'name', keyPath: 'name' },
      { name: 'kind', keyPath: 'kind' },
      { name: 'muscleGroup', keyPath: 'muscleGroup' },
      { name: 'createdAt', keyPath: 'createdAt' },
    ],
  },
  {
    name: 'routines',
    keyPath: 'id',
    indexes: [
      { name: 'order', keyPath: 'order' },
      { name: 'archived', keyPath: 'archived' },
    ],
  },
  {
    name: 'routineExercises',
    keyPath: 'id',
    indexes: [
      { name: 'routineId', keyPath: 'routineId' },
      { name: 'exerciseId', keyPath: 'exerciseId' },
      { name: '[routineId+order]', keyPath: ['routineId', 'order'] },
    ],
  },
  {
    name: 'sessions',
    keyPath: 'id',
    indexes: [
      { name: 'routineId', keyPath: 'routineId' },
      { name: 'startedAt', keyPath: 'startedAt' },
      { name: 'endedAt', keyPath: 'endedAt' },
      { name: 'source', keyPath: 'source' },
    ],
  },
  {
    name: 'setLogs',
    keyPath: 'id',
    indexes: [
      { name: 'sessionId', keyPath: 'sessionId' },
      { name: 'routineExerciseId', keyPath: 'routineExerciseId' },
      { name: 'exerciseId', keyPath: 'exerciseId' },
      { name: 'completedAt', keyPath: 'completedAt' },
      { name: '[sessionId+exerciseId]', keyPath: ['sessionId', 'exerciseId'] },
      { name: '[sessionId+routineExerciseId]', keyPath: ['sessionId', 'routineExerciseId'] },
      { name: '[exerciseId+completedAt]', keyPath: ['exerciseId', 'completedAt'] },
      { name: '[routineExerciseId+completedAt]', keyPath: ['routineExerciseId', 'completedAt'] },
    ],
  },
  {
    name: 'decisions',
    keyPath: 'id',
    indexes: [
      { name: 'sessionId', keyPath: 'sessionId' },
      { name: 'routineExerciseId', keyPath: 'routineExerciseId' },
      { name: 'decidedAt', keyPath: 'decidedAt' },
      { name: '[routineExerciseId+decidedAt]', keyPath: ['routineExerciseId', 'decidedAt'] },
    ],
  },
  { name: 'bodyweight', keyPath: 'id', indexes: [{ name: 'date', keyPath: 'date' }] },
  { name: 'settings', keyPath: 'id', indexes: [] },
  {
    name: 'meals',
    keyPath: 'id',
    indexes: [
      { name: 'date', keyPath: 'date' },
      { name: 'loggedAt', keyPath: 'loggedAt' },
      { name: '[date+loggedAt]', keyPath: ['date', 'loggedAt'] },
    ],
  },
  {
    name: 'mealItems',
    keyPath: 'id',
    indexes: [
      { name: 'mealId', keyPath: 'mealId' },
      { name: 'name', keyPath: 'name' },
      { name: '[mealId+index]', keyPath: ['mealId', 'index'] },
    ],
  },
  {
    name: 'foods',
    keyPath: 'id',
    indexes: [
      { name: 'key', keyPath: 'key' },
      { name: 'name', keyPath: 'name' },
      { name: 'lastUsedAt', keyPath: 'lastUsedAt' },
    ],
  },
  { name: 'productCache', keyPath: 'key', indexes: [{ name: 'fetchedAt', keyPath: 'fetchedAt' }] },
  { name: 'phases', keyPath: 'id', indexes: [{ name: 'startDate', keyPath: 'startDate' }] },
];

interface StoreSpec {
  name: string;
  keyPath: string;
  indexes: { name: string; keyPath: string | string[] }[];
}

/** Creates `iron` as raw IndexedDB at `version`, with `schema`, populated with `data`. Must run on a page that has never booted the app (see file header). */
async function createRawIronDb(page: Page, version: number, schema: StoreSpec[], data: Record<string, unknown[]>): Promise<void> {
  await page.evaluate(
    ({ version, schema, data }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('iron', version);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const store of schema) {
            const os = db.createObjectStore(store.name, { keyPath: store.keyPath });
            for (const idx of store.indexes) os.createIndex(idx.name, idx.keyPath);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const names = Object.keys(data);
          if (names.length === 0) {
            db.close();
            resolve();
            return;
          }
          const tx = db.transaction(names, 'readwrite');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          for (const name of names) {
            const store = tx.objectStore(name);
            for (const row of data[name]) store.put(row);
          }
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('iron database is blocked'));
      });
    },
    { version, schema, data },
  );
}

/** Reads every row of every store in `iron` at whatever version is on disk, bypassing Dexie — the same technique src/boot/recovery.ts uses. */
async function readRawIron(page: Page): Promise<{ version: number; tables: Record<string, any[]> }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('iron');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const names = Array.from(db.objectStoreNames);
    const tables: Record<string, unknown[]> = {};
    for (const name of names) {
      tables[name] = await new Promise((resolve, reject) => {
        const r = db.transaction(name, 'readonly').objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    const version = db.version;
    db.close();
    return { version, tables };
  });
}

/** Reads the automatic-backup files the app has written, from the Filesystem plugin's OWN IndexedDB store ("Disc" — see @capacitor/filesystem's web implementation), the real artifact the app produced, not a stand-in for it. */
async function readBackupFiles(page: Page): Promise<{ path: string; content: string }[]> {
  return page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    if (!dbs.some((d) => d.name === 'Disc')) return [];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('Disc');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const entries = await new Promise<any[]>((resolve, reject) => {
      const r = db.transaction('FileStorage', 'readonly').objectStore('FileStorage').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return entries.filter((e) => e.type === 'file' && typeof e.path === 'string' && e.path.startsWith('/DOCUMENTS/Iron/')).map((e) => ({ path: e.path, content: e.content }));
  });
}

function backupsOfKind(files: { path: string; content: string }[], kind: 'auto' | 'premig' | 'predestr'): { path: string; content: string }[] {
  return files.filter((f) => f.path.split('/').pop()?.startsWith(`iron-${kind}-`));
}

/** Every history-safety boot check ends by writing EITHER the baseline OR a notice — waiting for either is a positive signal the check has actually finished, not a guess at how long it takes. */
async function waitForHistoryCheckSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => localStorage.getItem('iron.lossBaseline.v1') !== null || localStorage.getItem('iron.historyNotice.v1') !== null,
    undefined,
    { timeout: 15_000 },
  );
}

function buildFixture(seedVersion: number) {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
  const exercise = {
    id: 'fx-ex-1',
    name: 'Fixture RDL',
    kind: 'reps',
    muscleGroup: 'hamstrings',
    isCompound: true,
    isLowerBody: true,
    defaultRestSec: 150,
    defaultIncrement: 5,
    unilateral: false,
    createdAt: iso(60),
  };
  const routine = { id: 'fx-routine-1', name: 'Fixture Routine', order: 0, isLowerBody: true };
  const rx = {
    id: 'fx-rx-1',
    routineId: routine.id,
    exerciseId: exercise.id,
    order: 0,
    targetSets: 4,
    repMin: 6,
    repMax: 8,
    // A non-seed weight — this is what an install that has actually been used looks like.
    currentWeight: 137.5,
    increment: 5,
    mode: 'normal',
    optional: false,
  };
  const sessionIds = ['fx-session-1', 'fx-session-2', 'fx-session-3'];
  const sessions = sessionIds.map((id, i) => ({
    id,
    routineId: routine.id,
    title: routine.name,
    startedAt: iso(10 - i * 2),
    endedAt: iso(10 - i * 2),
    durationSec: 1800,
  }));
  const setLogs = sessions.flatMap((s, i) => [
    { id: `${s.id}-set-1`, sessionId: s.id, routineExerciseId: rx.id, exerciseId: exercise.id, index: 0, type: 'working', weight: 130 + i * 2.5, reps: 8, completedAt: s.startedAt },
    { id: `${s.id}-set-2`, sessionId: s.id, routineExerciseId: rx.id, exerciseId: exercise.id, index: 1, type: 'working', weight: 130 + i * 2.5, reps: 7, completedAt: s.startedAt },
  ]);
  const decisions = sessions.map((s, i) => ({
    id: `${s.id}-decision`,
    sessionId: s.id,
    routineExerciseId: rx.id,
    fromWeight: 125 + i * 2.5,
    toWeight: 130 + i * 2.5,
    rule: 'increase',
    accepted: true,
    decidedAt: s.startedAt,
  }));
  const settings = {
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
    seedVersion,
    barKg: 20,
    plates: [25, 20, 15, 10, 5, 2.5, 1.25],
    deloadPercent: 0.9,
    weeklySessionTarget: 3,
    createdAt: iso(60),
  };
  return {
    exercises: [exercise],
    routines: [routine],
    routineExercises: [rx],
    sessions,
    setLogs,
    decisions,
    settings: [settings],
  };
}

/** Logs and finishes a real session against the seeded Lower (Hinge) routine / Romanian Deadlift, through the real UI. */
async function trainAndFinish(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);

  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await expect(card).toBeVisible();
  for (const reps of [8, 8]) {
    await card.getByTestId('weight-input').fill('110');
    await card.getByTestId('reps-input').fill(String(reps));
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }), 800);
  }

  await page.getByTestId('finish-session').click();
  if (await page.getByText('Finish session?').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Finish', exact: true }).last().click();
  }
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

// ---------------------------------------------------------------------------

test.describe('upgrade safety', () => {
  test('boots straight through at the current schema, every session/set/decision/weight intact, no loss notice', async ({ page }) => {
    await page.goto('/icons/icon-192.png');
    const fixture = buildFixture(2);
    await createRawIronDb(page, 20, IRON_SCHEMA_V2, fixture);

    await page.goto('/');
    await expect(page.getByTestId('next-up')).toBeVisible();
    await waitForHistoryCheckSettled(page);

    // No loss notice on an ordinary boot at the current shape.
    await expect(page.getByTestId('history-notice')).toHaveCount(0);

    // Every fixture session, through the real History screen.
    await page.goto('/history');
    await expect(page.getByRole('button', { name: /Fixture Routine/ })).toHaveCount(fixture.sessions.length);

    // The routine-exercise's non-seed weight, through the real routine editor.
    await page.goto(`/routines/${fixture.routines[0].id}`);
    await page.getByTestId(`rx-card-${fixture.exercises[0].name}`).getByRole('button').first().click();
    await expect(page.getByTestId('rx-weight')).toHaveValue('137.5');

    // Exact counts, straight off IndexedDB.
    const raw = await readRawIron(page);
    expect(raw.version).toBe(20);
    expect(raw.tables.sessions).toHaveLength(fixture.sessions.length);
    expect(raw.tables.setLogs).toHaveLength(fixture.setLogs.length);
    expect(raw.tables.decisions).toHaveLength(fixture.decisions.length);
    expect(raw.tables.routineExercises[0].currentWeight).toBe(137.5);
  });

  test('a pre-migration backup is written before the seed migration runs', async ({ page }) => {
    await page.goto('/icons/icon-192.png');
    const fixture = buildFixture(1); // behind DEFAULT_SETTINGS.seedVersion — a migration is coming
    await createRawIronDb(page, 20, IRON_SCHEMA_V2, fixture);

    await page.goto('/');
    await expect(page.getByTestId('next-up')).toBeVisible();
    await waitForHistoryCheckSettled(page);

    const files = await readBackupFiles(page);
    const premig = backupsOfKind(files, 'premig');
    expect(premig.length).toBeGreaterThan(0);

    const content = JSON.parse(premig[0].content);
    // The whole point: the file was written BEFORE migrateSeed ran, so it still shows the OLD
    // seedVersion, not the one the app has since migrated to.
    expect(content.tables.settings[0].seedVersion).toBe(1);
    expect(content.tables.sessions).toHaveLength(fixture.sessions.length);
  });
});

test.describe('backup, loss and restore', () => {
  test('a backup survives a raw-IndexedDB loss and restores the data; the notice does not return', async ({ page }) => {
    await fresh(page);
    await trainAndFinish(page);

    await page.goto('/settings');
    await page.getByTestId('backup-now').click();
    await expect.poll(async () => backupsOfKind(await readBackupFiles(page), 'auto').length, { timeout: 15_000 }).toBeGreaterThan(0);

    const before = await readRawIron(page);
    const sessionsBefore = before.tables.sessions.length;
    const setsBefore = before.tables.setLogs.length;
    expect(sessionsBefore).toBeGreaterThan(0);
    expect(setsBefore).toBeGreaterThan(0);

    // Simulate loss through RAW IndexedDB — not through the app, so the dbcore middleware never
    // sees it and never marks it as an accounted-for in-app deletion. This is what real loss looks
    // like: something outside the app's own code removed the rows.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('iron');
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(['sessions', 'setLogs'], 'readwrite');
            tx.objectStore('sessions').clear();
            tx.objectStore('setLogs').clear();
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        }),
    );

    await page.goto('/');
    await expect(page.getByTestId('next-up')).toBeVisible();
    await waitForHistoryCheckSettled(page);

    const notice = page.getByTestId('history-notice');
    await expect(notice).toBeVisible();
    const text = page.getByTestId('history-notice-text');
    await expect(text).toContainText(`${sessionsBefore} sessions`);
    await expect(text).toContainText(`${setsBefore} sets`);
    await expect(text).toContainText('0 sessions');

    await page.getByTestId('history-notice-restore').click();
    await expect(notice).toHaveCount(0);

    await expect.poll(async () => (await readRawIron(page)).tables.sessions.length, { timeout: 15_000 }).toBe(sessionsBefore);
    expect((await readRawIron(page)).tables.setLogs).toHaveLength(setsBefore);

    // After a restore the notice must not come back on its own.
    await page.goto('/');
    await expect(page.getByTestId('next-up')).toBeVisible();
    await waitForHistoryCheckSettled(page);
    await expect(page.getByTestId('history-notice')).toHaveCount(0);
  });

  test('an in-app delete never raises the loss notice', async ({ page }) => {
    await fresh(page);
    await trainAndFinish(page);

    await page.goto('/history');
    await page.getByRole('button', { name: /Lower \(Hinge\)/ }).first().click();
    await expect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);

    await page.getByLabel('More').click();
    await page.getByRole('button', { name: 'Delete session' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL(/\/history$/);

    // A real completion signal — the middleware's baseline refresh actually landing — before
    // treating "no notice next boot" as meaning anything.
    await expect
      .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('iron.lossBaseline.v1') ?? 'null')?.sessions ?? null), { timeout: 15_000 })
      .toBe(0);

    await page.goto('/');
    await expect(page.getByTestId('next-up')).toBeVisible();
    await waitForHistoryCheckSettled(page);
    await expect(page.getByTestId('history-notice')).toHaveCount(0);
  });

  test('a fresh install offers a backup found on disk, and restoring it clears the notice', async ({ page }) => {
    await fresh(page);
    await trainAndFinish(page);
    await expect.poll(async () => (await readBackupFiles(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);

    const before = await readRawIron(page);
    const sessionsBefore = before.tables.sessions.length;
    expect(sessionsBefore).toBeGreaterThan(0);

    // Delete only the app's own database. The Filesystem plugin's own IndexedDB store (where the
    // backup lives) is untouched — the same shape as Android attributing Documents/Iron to a
    // previous install after a reinstall while the files themselves are still on disk.
    await page.goto('/icons/icon-192.png'); // closes the app's live `iron` connection first
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.deleteDatabase('iron');
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          req.onblocked = () => resolve();
        }),
    );

    await page.goto('/');
    await expect(page.getByTestId('next-up')).toBeVisible();
    await waitForHistoryCheckSettled(page);

    const notice = page.getByTestId('history-notice');
    await expect(notice).toBeVisible();
    await expect(page.getByTestId('history-notice-text')).toContainText(`${sessionsBefore} sessions`);

    await page.getByTestId('history-notice-restore').click();
    await expect(notice).toHaveCount(0);

    await expect.poll(async () => (await readRawIron(page)).tables.sessions.length, { timeout: 15_000 }).toBe(sessionsBefore);
  });
});
