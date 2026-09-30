import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clickIfPresent, fresh, readRawIron, waitForServiceWorker } from './fresh';

/**
 * The exercise catalogue in the app (src/ui/LibrarySheet.tsx, src/ui/ExerciseDemo.tsx,
 * src/db/catalogueRepo.ts), against the built app and its real pictures. The entry under test is read
 * from the committed JSON at test time, never named here: it is whatever the catalogue holds that
 * matches "cable crossover" and has steps.
 *
 * An image that did not load still passes `toBeVisible` (its box is there), so every picture is
 * checked by `naturalWidth` and `complete`, the two things a broken one cannot have. The raw
 * IndexedDB is read for what was stored; no assertion rests on a toast.
 */

interface Entry {
  slug: string;
  name: string;
  muscleGroup: string;
  equipment: string;
}

const read = <T>(rel: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as T;
const entries = read<Entry[]>('../src/data/exerciseCatalogue.json');
const allSteps = read<Record<string, string[]>>('../src/data/exerciseCatalogueSteps.json');

const QUERY = 'cable crossover';
const entry = entries.find((e) => e.name.toLowerCase().includes(QUERY) && (allSteps[e.slug]?.length ?? 0) > 0);
if (!entry) throw new Error(`The committed catalogue has no entry matching "${QUERY}" with steps.`);
const KEY = `cat:${entry.slug}`;
const FIRST_STEP = allSteps[entry.slug]![0]!;
const frameUrl = (n: 1 | 2) => `/catalogue/${entry.slug}/${n}.webp`;

type RawExercise = { id: string; name: string; demo?: string };

async function exercisesInDb(page: Page): Promise<RawExercise[]> {
  return (await readRawIron(page)).tables.exercises as RawExercise[];
}

async function routineId(page: Page, name: string): Promise<string> {
  const routine = (await readRawIron(page)).tables.routines.find((r: { name: string }) => r.name === name);
  if (!routine) throw new Error(`No routine named ${name}`);
  return routine.id as string;
}

/**
 * How many routine rows point at an exercise matching `which`. A pick from a routine's picker adds
 * one, and nothing else in these tests does, so a count that has moved is the signal that the pick
 * finished. It counts rows for every matching exercise, so a pick that wrongly made a second
 * exercise still moves it, and the assertions after it see the duplicate.
 */
async function routineRowsFor(page: Page, which: (e: RawExercise) => boolean): Promise<number> {
  const raw = await readRawIron(page);
  const ids = new Set((raw.tables.exercises as RawExercise[]).filter(which).map((e) => e.id));
  return (raw.tables.routineExercises as { exerciseId: string }[]).filter((r) => ids.has(r.exerciseId)).length;
}

/** True once `url` can be fetched, decoded and has a width: a renamed or missing file cannot. */
function imageLoads(page: Page, url: string): Promise<boolean> {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    try {
      await img.decode();
    } catch {
      return false;
    }
    return img.complete && img.naturalWidth > 0;
  }, url);
}

/** True while the demo on screen is showing frame `n` and that frame has really loaded. */
function demoShowsLoadedFrame(page: Page, n: 1 | 2): Promise<boolean> {
  return page.evaluate((suffix) => {
    const img = document.querySelector<HTMLImageElement>('[data-testid="demo-frame"]');
    return !!img && img.src.endsWith(suffix) && img.complete && img.naturalWidth > 0;
  }, `/${n}.webp`);
}

/** Open the picker's From library on a routine editor and choose the entry. */
async function pickFromRoutineEditor(page: Page, routine: string): Promise<void> {
  await page.goto(`/routines/${await routineId(page, routine)}`);
  await page.getByTestId('add-exercise').click();
  await page.getByTestId('from-library').click();
  await page.getByTestId('library-search').fill(QUERY);
  await page.getByTestId(`library-${KEY}`).click();
}

test.describe('catalogue in the app', () => {
  test('an entry is added once from Exercises, fetched lazily, then picked again without a second row', async ({ page }) => {
    const catalogueRequests: string[] = [];
    page.on('request', (r) => {
      if (/exerciseCatalogue/.test(r.url())) catalogueRequests.push(r.url());
    });
    const entryRequests = () => catalogueRequests.filter((u) => !/Steps/.test(u)).length;
    const stepRequests = () => catalogueRequests.filter((u) => /Steps/.test(u)).length;

    await fresh(page);
    const baseline = (await exercisesInDb(page)).length;
    await page.goto('/exercises');
    await expect(page.getByTestId('exercise-search')).toBeVisible();
    await page.waitForLoadState('networkidle');
    // Nothing of the catalogue is fetched to show the Exercises list.
    expect(catalogueRequests).toEqual([]);

    await page.getByTestId('add-from-library').click();
    await expect(page.getByTestId('library-search')).toBeVisible();
    // Opening the sheet is what fetches the entries; the steps are still not wanted.
    await expect.poll(entryRequests).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    expect(stepRequests()).toBe(0);

    // An empty search lists nothing; a broad one is capped, and each row carries one lazy thumbnail.
    const rows = page.locator('button[data-testid^="library-"]');
    await expect(rows).toHaveCount(0);
    await page.getByTestId('library-search').fill('press');
    await expect.poll(() => rows.count()).toBe(30);
    await expect(page.locator('button[data-testid^="library-"] img[loading="lazy"]')).toHaveCount(30);
    await page.getByTestId('library-search').fill('');
    await expect(rows).toHaveCount(0);

    await page.getByTestId('library-search').fill(QUERY);
    const row = page.getByTestId(`library-${KEY}`);
    await expect(row).toContainText(entry.name);
    await expect(row).toContainText(`${entry.muscleGroup} · ${entry.equipment}`);
    await expect(row.locator('img')).toHaveAttribute('src', frameUrl(1));
    await expect(row.locator('img')).toHaveAttribute('loading', 'lazy');

    await row.click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);

    // Stored once, with the catalogue key, and nothing else added or changed.
    const stored = (await exercisesInDb(page)).filter((e) => e.demo === KEY);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe(entry.name);
    expect((await exercisesInDb(page)).length).toBe(baseline + 1);
    expect(page.url().endsWith(`/exercises/${stored[0]!.id}`)).toBe(true);

    // Both photographs load, and the demo really alternates between them in a 3:2 box.
    await expect(page.getByTestId('demo-frame')).toBeVisible();
    expect(await imageLoads(page, frameUrl(1))).toBe(true);
    expect(await imageLoads(page, frameUrl(2))).toBe(true);
    await expect.poll(() => demoShowsLoadedFrame(page, 1)).toBe(true);
    await expect.poll(() => demoShowsLoadedFrame(page, 2)).toBe(true);
    const box = await page.getByRole('button', { name: /^(Pause|Play)$/ }).boundingBox();
    expect(Math.abs(box!.width / box!.height - 1.5)).toBeLessThan(0.02);

    // The steps are this entry's own, fetched now that a demo wants them.
    await expect(page.getByTestId('demo-steps').locator('li').first()).toHaveText(FIRST_STEP);
    expect(stepRequests()).toBeGreaterThan(0);

    // In the Exercises list it has a 3:2 thumbnail that loads.
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill(entry.name);
    const thumb = page.getByRole('button', { name: new RegExp(entry.name) }).first().locator('img');
    await expect(thumb).toHaveAttribute('src', frameUrl(1));
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);

    // Picking the same entry again, from a routine's picker, is the same exercise. The routine row
    // appearing is the signal that this second pick finished: the first pick made none.
    await pickFromRoutineEditor(page, 'Upper (Push)');
    await expect.poll(() => routineRowsFor(page, (e) => e.demo === KEY)).toBe(1);
    const after = await exercisesInDb(page);
    expect(after.filter((e) => e.demo === KEY)).toHaveLength(1);
    expect(after.filter((e) => e.name === entry.name)).toHaveLength(1);
    expect(after).toHaveLength(baseline + 1);

    // With it in the routine, the same picker shows it as added and will not take it twice.
    await page.keyboard.press('Escape');
    await page.getByTestId('add-exercise').click();
    await page.getByTestId('from-library').click();
    await page.getByTestId('library-search').fill(QUERY);
    await expect(page.getByTestId(`library-${KEY}`)).toBeDisabled();
    await expect(page.getByTestId(`library-${KEY}`)).toContainText('Added');
  });

  test('How to in a live session shows the first step of a catalogue exercise', async ({ page }) => {
    await fresh(page);
    await pickFromRoutineEditor(page, 'Upper (Push)');
    // The routine row is what only this pick can produce.
    await expect.poll(() => routineRowsFor(page, (e) => e.demo === KEY)).toBe(1);

    await page.goto('/');
    await page.getByTestId('start-Upper (Push)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await expect(page).toHaveURL(/\/session\//);

    const card = page.getByTestId(`exercise-card-${entry.name}`);
    await expect(card).toBeVisible();
    // It is the last exercise in the routine, so its card starts collapsed.
    await card.locator('button[aria-expanded="false"]').click();
    await card.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'How to' }).click();

    await expect(page.getByTestId('demo-steps').locator('li').first()).toHaveText(FIRST_STEP);
    await expect.poll(() => demoShowsLoadedFrame(page, 1)).toBe(true);
    await expect.poll(() => demoShowsLoadedFrame(page, 2)).toBe(true);
  });

  test('a bundled diagram picked twice is one exercise, and a seeded exercise\'s diagram returns the seeded row', async ({ page }) => {
    await fresh(page);
    const baseline = (await exercisesInDb(page)).length;

    await page.goto('/exercises');
    await page.getByTestId('add-from-library').click();
    await page.getByTestId('library-search').fill('arnold press');
    await page.getByTestId('library-arnold-press').click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);
    expect((await exercisesInDb(page)).filter((e) => e.demo === 'arnold-press')).toHaveLength(1);
    expect((await exercisesInDb(page)).length).toBe(baseline + 1);

    // Second time, through a routine's picker; its routine row is what shows the pick completed.
    await page.goto(`/routines/${await routineId(page, 'Upper (Push)')}`);
    await page.getByTestId('add-exercise').click();
    await page.getByTestId('from-library').click();
    await page.getByTestId('library-search').fill('arnold press');
    await page.getByTestId('library-arnold-press').click();
    await expect.poll(() => routineRowsFor(page, (e) => e.demo === 'arnold-press')).toBe(1);
    const after = await exercisesInDb(page);
    expect(after.filter((e) => e.demo === 'arnold-press')).toHaveLength(1);
    expect(after).toHaveLength(baseline + 1);

    // A seeded exercise's own diagram returns the seeded row, not a twin.
    await page.goto('/exercises');
    await page.getByTestId('add-from-library').click();
    await page.getByTestId('library-search').fill('bench press');
    await page.getByTestId('library-bench-press').click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);
    const afterBench = await exercisesInDb(page);
    expect(afterBench.filter((e) => e.demo === 'bench-press')).toHaveLength(1);
    expect(afterBench).toHaveLength(baseline + 1);
    await expect(page.getByRole('heading', { name: 'Bench Press (Barbell)' })).toBeVisible();
  });

  test('the diagram picker on the exercise form offers catalogue photographs', async ({ page }) => {
    await fresh(page);
    await page.goto('/exercises/new');
    await page.getByTestId('pick-diagram').click();
    await page.getByTestId('diagram-search').fill(QUERY);
    await page.getByTestId(`diagram-${KEY}`).click();

    // The form's preview is the photograph, 3:2, and it loaded.
    const preview = page.locator('img[src$="' + frameUrl(1) + '"]');
    await expect(preview).toHaveCount(1);
    await expect.poll(() => preview.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    const box = await preview.boundingBox();
    expect(Math.abs(box!.width / box!.height - 1.5)).toBeLessThan(0.02);
  });

  test('Settings lists the catalogue among the attributions', async ({ page }) => {
    await fresh(page);
    await page.goto('/settings');
    await expect(page.getByTestId('about-card')).toContainText('Exercise library: free-exercise-db (public domain)');
  });
});

test.describe('catalogue in the web build', () => {
  test('the service worker does not precache the frames, and every frame is still served as WebP', async ({ request }) => {
    const sw = await (await request.get('/sw.js')).text();
    // The precache list names files as url:"path". The diagrams are in it, so this looks in the right place...
    expect(sw).toMatch(/url\s*:\s*["']exercises\/[^"']+\.png["']/);
    // ...and no catalogue frame is.
    expect(sw).not.toMatch(/url\s*:\s*["'][^"']*catalogue\//);
    // A frame shown on the web is cached when first seen instead.
    expect(sw).toContain('iron-catalogue');

    for (let i = 0; i < entries.length; i += 60) {
      await Promise.all(
        entries.slice(i, i + 60).flatMap((e) =>
          [1, 2].map(async (n) => {
            const res = await request.get(`/catalogue/${e.slug}/${n}.webp`);
            expect(res.status(), `${e.slug}/${n}.webp`).toBe(200);
            expect(res.headers()['content-type'], `${e.slug}/${n}.webp`).toBe('image/webp');
            const body = await res.body();
            expect(body.subarray(0, 4).toString('ascii'), `${e.slug}/${n}.webp`).toBe('RIFF');
            expect(body.subarray(8, 12).toString('ascii'), `${e.slug}/${n}.webp`).toBe('WEBP');
          }),
        ),
      );
    }
  });

  test('frames seen once are served with the network off', async ({ page, context }) => {
    await fresh(page);
    await waitForServiceWorker(page);

    await page.goto('/exercises');
    await page.getByTestId('add-from-library').click();
    await page.getByTestId('library-search').fill(QUERY);
    await page.getByTestId(`library-${KEY}`).click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);
    const detail = page.url();

    // The worker caches each frame as it is fetched: wait until both are in.
    const cached = () =>
      page.evaluate(async () => {
        const cache = await caches.open('iron-catalogue');
        return (await cache.keys()).map((r) => new URL(r.url).pathname);
      });
    await expect.poll(cached).toEqual(expect.arrayContaining([frameUrl(1), frameUrl(2)]));

    await context.setOffline(true);
    try {
      await page.goto(detail);
      await expect(page.getByTestId('demo-frame')).toBeVisible();
      await expect.poll(() => demoShowsLoadedFrame(page, 1)).toBe(true);
      await expect.poll(() => demoShowsLoadedFrame(page, 2)).toBe(true);
      await expect(page.getByTestId('demo-steps').locator('li').first()).toHaveText(FIRST_STEP);
    } finally {
      await context.setOffline(false);
    }
  });
});
