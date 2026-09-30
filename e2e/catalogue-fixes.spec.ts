import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRawIronDb, fresh, IRON_SCHEMA_V3 } from './fresh';

/**
 * What the owner sees of the exercise catalogue where a review found it wrong, against the built
 * app and its real pictures and chunks (the catalogue's own behaviour is in catalogue.spec.ts):
 *
 *  - a catalogue photograph that is not 3:2 is shown whole, letterboxed, in the library rows, the
 *    Exercises list and the demo, while a diagram is drawn as it always was;
 *  - an exercise whose catalogue key no longer has a picture shows a fallback, not a broken image;
 *  - the library says so when the catalogue could not be fetched, instead of "No matches".
 *
 * Every wait is on something only the event under test can produce: the fallback's own test id, the
 * text the failure puts up, a counter on the aborted request. An absence is asserted only after
 * that signal, never before.
 */

interface Entry {
  slug: string;
  name: string;
}

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = <T>(rel: string): T => JSON.parse(readFileSync(here(rel), 'utf8')) as T;
const entries = read<Entry[]>('../src/data/exerciseCatalogue.json');

/** Width and height of a lossy, extended or lossless WebP, from its header. */
function webpSize(b: Buffer): { width: number; height: number } {
  const fourcc = b.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (fourcc === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  const bits = b.readUInt32LE(21);
  return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
}

const frameFile = (slug: string, n: 1 | 2) => readFileSync(here(`../assets/catalogue-frames/${slug}/${n}.webp`));
const frameUrl = (slug: string, n: 1 | 2) => `/catalogue/${slug}/${n}.webp`;
const isThreeByTwo = (slug: string) => ([1, 2] as const).every((n) => Math.abs(webpSize(frameFile(slug, n)).width / webpSize(frameFile(slug, n)).height - 1.5) < 0.05);

/** An entry whose first frame is not 3:2: the ones a fixed 3:2 box used to crop. */
const odd = entries.find((e) => {
  const { width, height } = webpSize(frameFile(e.slug, 1));
  return Math.abs(width / height - 1.5) >= 0.05;
});
if (!odd) throw new Error('The committed catalogue has no entry whose first frame is not 3:2.');
/** An ordinary one, for the pictures that must keep working. */
const plain = entries.find((e) => isThreeByTwo(e.slug));
if (!plain) throw new Error('The committed catalogue has no 3:2 entry.');

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/exercises');
  await page.getByTestId('add-from-library').click();
  await expect(page.getByTestId('library-search')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Pictures that are not 3:2

test.describe('catalogue photographs that are not 3:2', () => {
  test('the library rows and the Exercises list show the whole photograph, and a diagram is drawn as before', async ({ page }) => {
    // Premise: the photograph really is not 3:2, so a fixed 3:2 box can only fit it by cutting it or by letterboxing it.
    expect(Math.abs(webpSize(frameFile(odd.slug, 1)).width / webpSize(frameFile(odd.slug, 1)).height - 1.5)).toBeGreaterThanOrEqual(0.05);

    await fresh(page);
    await openLibrary(page);
    await page.getByTestId('library-search').fill(odd.name);
    const row = page.getByTestId(`library-cat:${odd.slug}`);
    const thumb = row.locator('img');
    // The row for this very entry is on screen, with its own frame, before its fit is read.
    await expect(thumb).toHaveAttribute('src', frameUrl(odd.slug, 1));
    await expect(thumb).toHaveCSS('object-fit', 'contain');
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    // Its box is still the 3:2 of every other row, so the list stays aligned.
    const box = await thumb.boundingBox();
    expect(Math.abs(box!.width / box!.height - 1.5)).toBeLessThan(0.05);

    // Controls: line art has always been shown whole, and inverted for the light theme; a bundled square photograph fills its square.
    await page.getByTestId('library-search').fill('arnold press');
    const lineArt = page.getByTestId('library-arnold-press').locator('img');
    await expect(lineArt).toHaveAttribute('src', /^\/exercises\/arnold-press\/1\.png$/);
    await expect(lineArt).toHaveCSS('object-fit', 'contain');
    await expect(lineArt).toHaveClass(/(^|\s)demo-frame(\s|$)/);
    await page.getByTestId('library-search').fill('neck');
    const neck = page.getByTestId('library-neck').locator('img');
    await expect(neck).toHaveAttribute('src', /^\/exercises\/neck\/1\.png$/);
    await expect(neck).toHaveCSS('object-fit', 'cover');

    // Added, it is in the Exercises list with the same whole-photograph thumbnail.
    await page.getByTestId('library-search').fill(odd.name);
    await thumb.click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill(odd.name);
    const listed = page.getByRole('button', { name: new RegExp(odd.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().locator('img');
    await expect(listed).toHaveAttribute('src', frameUrl(odd.slug, 1));
    await expect(listed).toHaveCSS('object-fit', 'contain');
  });

  test('the demo shows the whole photograph in its 3:2 box, and a diagram demo is drawn as before', async ({ page }) => {
    await fresh(page);
    await openLibrary(page);
    await page.getByTestId('library-search').fill(odd.name);
    await page.getByTestId(`library-cat:${odd.slug}`).click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);

    const frame = page.getByTestId('demo-frame');
    await expect(frame).toHaveAttribute('src', new RegExp(`^/catalogue/${odd.slug}/[12]\\.webp$`));
    await expect(frame).toHaveCSS('object-fit', 'contain');
    // The photograph that decoded is not 3:2 and its box still is: the letterbox is what shows it whole.
    await expect.poll(() => frame.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    const pause = await page.getByRole('button', { name: /^(Pause|Play)$/ }).boundingBox();
    expect(Math.abs(pause!.width / pause!.height - 1.5)).toBeLessThan(0.02);

    // Controls: a bundled line drawing and a bundled square photograph.
    await openLibrary(page);
    await page.getByTestId('library-search').fill('bench press');
    await page.getByTestId('library-bench-press').click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('demo-frame')).toHaveAttribute('src', /^\/exercises\/bench-press\/\d\.png$/);
    await expect(page.getByTestId('demo-frame')).toHaveCSS('object-fit', 'contain');

    await openLibrary(page);
    await page.getByTestId('library-search').fill('neck');
    await page.getByTestId('library-neck').click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('demo-frame')).toHaveAttribute('src', /^\/exercises\/neck\/\d\.png$/);
    await expect(page.getByTestId('demo-frame')).toHaveCSS('object-fit', 'cover');
  });
});

// ---------------------------------------------------------------------------
// A catalogue key with no picture

type Row = Record<string, unknown>;

async function seedExercises(page: Page, exercises: Row[]): Promise<void> {
  // Raw rows, before the app ever boots, so the library never had a say in what they point at.
  await page.goto('/icons/icon-192.png');
  const day = new Date().toISOString();
  await createRawIronDb(page, 30, IRON_SCHEMA_V3, {
    exercises: exercises.map((e) => ({
      kind: 'reps',
      muscleGroup: 'chest',
      isCompound: false,
      isLowerBody: false,
      defaultRestSec: 75,
      defaultIncrement: 2.5,
      unilateral: false,
      equipment: 'cable',
      createdAt: day,
      ...e,
    })),
    settings: [
      {
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
      },
    ],
  });
}

const GONE = { id: 'e-gone', name: 'Gone Press', demo: 'cat:no-such-entry' };
const KEPT = { id: 'e-kept', name: 'Kept Press', demo: `cat:${plain.slug}` };

test.describe('a catalogue key with no picture behind it', () => {
  test('the Exercises list shows a fallback in place of a broken thumbnail, and the exercises beside it keep theirs', async ({ page }) => {
    await seedExercises(page, [GONE, KEPT]);
    await page.goto('/exercises');

    // The signal that the failed picture was noticed: the fallback itself. Only one row has a broken key.
    await expect(page.getByTestId('demo-missing')).toHaveCount(1);
    await expect(page.getByTestId('demo-missing')).toBeVisible();
    // It stands in the broken picture's place: no image of the missing entry is left in the list.
    await expect(page.locator('img[src*="no-such-entry"]')).toHaveCount(0);
    // And the row next to it is untouched: its real photograph loaded.
    const kept = page.locator(`img[src="${frameUrl(plain.slug, 1)}"]`);
    await expect(kept).toHaveCount(1);
    await expect.poll(() => kept.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    // Both rows are still listed.
    await expect(page.getByRole('button', { name: /Gone Press/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Kept Press/ })).toBeVisible();
  });

  test('the exercise page drops the picture but keeps the Video link', async ({ page }) => {
    await seedExercises(page, [GONE]);
    await page.goto(`/exercises/${GONE.id}`);

    await expect(page.getByTestId('demo-missing')).toBeAttached();
    await expect(page.getByTestId('demo-frame')).toHaveCount(0);
    await expect(page.locator('img[src*="no-such-entry"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Video' })).toBeVisible();
    await expect(page.getByTestId('demo-steps')).toHaveCount(0);
  });

  test('the exercise page of a real entry has no fallback', async ({ page }) => {
    await seedExercises(page, [KEPT]);
    await page.goto(`/exercises/${KEPT.id}`);

    await expect(page.getByTestId('demo-frame')).toHaveAttribute('src', new RegExp(`^/catalogue/${plain.slug}/[12]\\.webp$`));
    await expect.poll(() => page.getByTestId('demo-frame').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    // The frames alternate for a while: a fallback that only a later frame could raise has had its chance.
    await expect.poll(() => page.getByTestId('demo-frame').getAttribute('src')).toMatch(/\/2\.webp$/);
    await expect.poll(() => page.getByTestId('demo-frame').getAttribute('src')).toMatch(/\/1\.webp$/);
    await expect(page.getByTestId('demo-missing')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// The catalogue chunk cannot be fetched

/** The lazy chunk holding the catalogue index; the steps are a separate one (exerciseCatalogueSteps-*). */
const CATALOGUE_CHUNK = /\/assets\/exerciseCatalogue-[^/]+\.js$/;
/** A word that names a catalogue entry and no bundled diagram, so only the catalogue can answer it. */
const CATALOGUE_ONLY = 'crossover';

test.describe('the library when the catalogue cannot be fetched', () => {
  // Playwright cannot see a request the service worker answers, and this is a test of the network failing.
  test.use({ serviceWorkers: 'block' });

  test('premise: the word is one only the catalogue holds', () => {
    expect(entries.some((e) => e.name.toLowerCase().includes(CATALOGUE_ONLY))).toBe(true);
    const diagrams = [read<{ name: string }[]>('../node_modules/@bryllim/workout-guide/manifest.json'), read<{ name: string }[]>('../assets/custom-demos/manifest.json')].flat();
    expect(diagrams.filter((d) => d.name.toLowerCase().includes(CATALOGUE_ONLY))).toEqual([]);
  });

  test('From library says the library is unavailable, not "No matches", and still lists a diagram', async ({ page }) => {
    let aborted = 0;
    await page.route(CATALOGUE_CHUNK, (route) => {
      aborted++;
      return route.abort();
    });
    await fresh(page);
    await openLibrary(page);

    await page.getByTestId('library-search').fill(CATALOGUE_ONLY);
    await expect(page.getByText('Library unavailable')).toBeVisible();
    // The request really was refused, and the wrong statement is not on screen beside the right one.
    expect(aborted).toBeGreaterThan(0);
    await expect(page.getByText('No matches')).toHaveCount(0);

    // What the diagrams can answer is still answered, with nothing said about the library.
    await page.getByTestId('library-search').fill('arnold press');
    await expect(page.getByTestId('library-arnold-press')).toBeVisible();
    await expect(page.getByText('Library unavailable')).toHaveCount(0);
    await expect(page.getByText('No matches')).toHaveCount(0);
  });

  test('the diagram picker on the exercise form says the same', async ({ page }) => {
    let aborted = 0;
    await page.route(CATALOGUE_CHUNK, (route) => {
      aborted++;
      return route.abort();
    });
    await fresh(page);
    await page.goto('/exercises/new');
    await page.getByTestId('pick-diagram').click();

    await page.getByTestId('diagram-search').fill(CATALOGUE_ONLY);
    await expect(page.getByText('Library unavailable')).toBeVisible();
    expect(aborted).toBeGreaterThan(0);
    await expect(page.getByText('No matches')).toHaveCount(0);

    await page.getByTestId('diagram-search').fill('arnold press');
    await expect(page.getByTestId('diagram-arnold-press')).toBeVisible();
    await expect(page.getByText('Library unavailable')).toHaveCount(0);
  });

  test('with the catalogue reachable, a search nothing matches still says "No matches"', async ({ page }) => {
    let requested = 0;
    // Not aborted: counted, so the test knows the catalogue really was fetched before it trusts what the sheet says.
    await page.route(CATALOGUE_CHUNK, (route) => {
      requested++;
      return route.continue();
    });
    await fresh(page);
    await openLibrary(page);

    await page.getByTestId('library-search').fill('zzzz no such exercise');
    await expect(page.getByText('No matches')).toBeVisible();
    expect(requested).toBeGreaterThan(0);
    await expect(page.getByText('Library unavailable')).toHaveCount(0);

    // The diagram picker agrees.
    await page.goto('/exercises/new');
    await page.getByTestId('pick-diagram').click();
    await page.getByTestId('diagram-search').fill('zzzz no such exercise');
    await expect(page.getByText('No matches')).toBeVisible();
    await expect(page.getByText('Library unavailable')).toHaveCount(0);
  });
});
