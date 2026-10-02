import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clickIfPresent, expectClass, fresh, readRawIron } from './fresh';

/**
 * The whole exercise library on show (src/screens/ExercisesScreen.tsx, src/ui/ExercisePicker.tsx,
 * src/ui/PasteRoutineSheet.tsx), against the built app, its real data and its real pictures.
 *
 * Nothing about the data is written here: the catalogue is read from the committed JSON, the
 * diagrams from the two manifests the build reads, and the owner's own exercises from the raw
 * IndexedDB the app seeded. Seeds are random in places, so names are read, never assumed.
 *
 * Every wait is on something only the event it guards can produce: the counts line's exact text (a
 * line that says "so far" does not satisfy it), a chip's class, a row count that moves, a routine row
 * that did not exist. An image that did not load still passes toBeVisible, so pictures are checked by
 * naturalWidth. An absence is asserted only after a presence that proves the page got that far.
 */

interface CatalogueEntry {
  slug: string;
  name: string;
  muscleGroup: string;
  equipment: string;
}
interface Diagram {
  slug: string;
  name: string;
}
type RawExercise = { id: string; name: string; demo?: string; aliases?: string[] };

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = <T>(rel: string): T => JSON.parse(readFileSync(here(rel), 'utf8')) as T;
const catalogue = read<CatalogueEntry[]>('../src/data/exerciseCatalogue.json');
const diagrams = [...read<Diagram[]>('../node_modules/@bryllim/workout-guide/manifest.json'), ...read<Diagram[]>('../assets/custom-demos/manifest.json')];

/** The app's own match key, written out again here: a bug in the app's copy must not pass its own test. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9()+]+/g, ' ')
    .trim();

const frameUrl = (slug: string, n: 1 | 2) => `/catalogue/${slug}/${n}.webp`;
const keyOf = (e: CatalogueEntry) => `cat:${e.slug}`;

async function exercisesInDb(page: Page): Promise<RawExercise[]> {
  return (await readRawIron(page)).tables.exercises as RawExercise[];
}

/** What the list should say, from the owner's rows and the data files, by the dedupe rule written out independently. */
function expectedCounts(owned: RawExercise[]): { owned: number; library: number } {
  const keys = new Set(owned.flatMap((e) => (e.demo ? [e.demo] : [])));
  const names = new Set(owned.flatMap((e) => [e.name, ...(e.aliases ?? [])]).map(norm).filter(Boolean));
  const taken = (key: string, name: string) => keys.has(key) || names.has(norm(name));
  return {
    owned: owned.length,
    library: diagrams.filter((d) => !taken(d.slug, d.name)).length + catalogue.filter((e) => !taken(keyOf(e), e.name)).length,
  };
}
const countsText = (c: { owned: number; library: number }) => `${c.owned} yours · ${c.library} in the library`;

/** Catalogue entries the owner does not have yet, by name, in the order a person would look for them. */
function libraryEntries(owned: RawExercise[], muscle?: string): CatalogueEntry[] {
  const keys = new Set(owned.flatMap((e) => (e.demo ? [e.demo] : [])));
  const names = new Set(owned.flatMap((e) => [e.name, ...(e.aliases ?? [])]).map(norm));
  return catalogue
    .filter((e) => !keys.has(keyOf(e)) && !names.has(norm(e.name)) && (muscle === undefined || e.muscleGroup === muscle))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function routineId(page: Page, name: string): Promise<string> {
  const routine = (await readRawIron(page)).tables.routines.find((r: { name: string }) => r.name === name);
  if (!routine) throw new Error(`No routine named ${name}`);
  return routine.id as string;
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

/** Open Exercises and wait for the counts line to show the loaded totals for these owned rows. */
async function openExercises(page: Page, owned: RawExercise[]): Promise<void> {
  await page.goto('/exercises');
  await expect(page.getByTestId('exercise-counts')).toHaveText(countsText(expectedCounts(owned)));
}

const rowsOf = (page: Page) => page.locator('[data-testid^="exercise-row-"]');

test.describe('the Exercises screen', () => {
  test('shows every exercise with nothing typed, and the counts line states the loaded totals', async ({ page }) => {
    await fresh(page);
    const owned = await exercisesInDb(page);
    const expected = expectedCounts(owned);
    // Premise: there is a library to show, and the owner's own rows are not all of it.
    expect(expected.library).toBeGreaterThan(700);

    await page.goto('/exercises');
    // The exact text: the "so far" line shown while the catalogue loads does not satisfy it.
    await expect(page.getByTestId('exercise-counts')).toHaveText(countsText(expected));
    await expect(page.getByTestId('exercise-search')).toHaveValue('');
    await expect(page.getByRole('heading', { name: `${expected.owned + expected.library} exercises` })).toBeVisible();

    // Rows from the library are on screen, labelled, with no search and no chip.
    const rows = rowsOf(page);
    await expect.poll(() => rows.count()).toBeGreaterThan(owned.length);
    await expect(page.getByTestId('library-label').first()).toBeVisible();
    // Hers come first: the first row is one of the owner's, and has no Library label.
    await expect(rows.first()).toContainText(owned.map((e) => e.name).sort((a, b) => a.localeCompare(b))[0]!);
    await expect(rows.first().getByTestId('library-label')).toHaveCount(0);

    // Yours: only what the owner has.
    await page.getByTestId('exercise-scope-yours').click();
    await expect(rows).toHaveCount(owned.length);
    await expect(page.getByTestId('library-label')).toHaveCount(0);
    // All again: the library is back.
    await page.getByTestId('exercise-scope-all').click();
    await expect.poll(() => rows.count()).toBeGreaterThan(owned.length);
    await expect(page.getByTestId('library-label').first()).toBeVisible();
  });

  test('a muscle chip lists library entries with nothing typed', async ({ page }) => {
    await fresh(page);
    const owned = await exercisesInDb(page);
    await openExercises(page, owned);

    const target = libraryEntries(owned, 'rear delts')[0]!;
    expect(target, 'the catalogue has a rear delts entry the seed does not').toBeDefined();
    const chip = page.getByRole('button', { name: 'rear delts', exact: true });
    await chip.click();
    await expectClass(chip, 'bg-fg');

    // The list is that muscle's: the entry read from the catalogue file is on it, labelled, with its muscle and equipment.
    const row = page.getByTestId(`exercise-row-${keyOf(target)}`);
    await expect(row).toContainText(target.name);
    await expect(row).toContainText(`rear delts · ${target.equipment}`);
    await expect(row.getByTestId('library-label')).toBeVisible();
    const texts = await rowsOf(page).allTextContents();
    expect(texts.length).toBeGreaterThanOrEqual(libraryEntries(owned, 'rear delts').length);
    for (const t of texts) expect(t).toContain('rear delts');
    // The search narrows the same list further: the chip stays on, and the entry is still there.
    await page.getByTestId('exercise-search').fill(target.name);
    await expect(rowsOf(page).first()).toContainText(target.name);
    await expect(row).toBeVisible();
  });

  test('the All list is drawn a page at a time as it is scrolled, and only the drawn rows have a picture', async ({ page }) => {
    await fresh(page);
    const owned = await exercisesInDb(page);
    const expected = expectedCounts(owned);
    const total = expected.owned + expected.library;
    await openExercises(page, owned);

    const rows = rowsOf(page);
    await expect.poll(() => rows.count()).toBeGreaterThan(owned.length);
    const first = await rows.count();
    // Premise: the first page is not the whole list.
    expect(first).toBeLessThan(total);
    // Only the rows drawn ask for a picture, and each asks lazily.
    const thumbs = page.locator('[data-testid^="exercise-row-"] img');
    expect(await thumbs.count()).toBeLessThan(total);
    await expect(page.locator('[data-testid^="exercise-row-"] img:not([loading="lazy"])')).toHaveCount(0);

    // Scrolling to the bottom brings the next page, and the next, until the list is whole.
    const scrollDown = async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      return rows.count();
    };
    await expect.poll(scrollDown, { intervals: [150] }).toBeGreaterThan(first);
    await expect.poll(scrollDown, { intervals: [150], timeout: 30_000 }).toBe(total);
    // Nothing is drawn twice.
    const keys = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(new Set(keys).size).toBe(total);
    // And at the end there is nothing more to ask for.
    await expect(page.getByTestId('exercise-more')).toHaveCount(0);
  });

  test('where scrolling cannot bring the next page, the More button does', async ({ page }) => {
    // No IntersectionObserver: the case the button exists for.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'IntersectionObserver', { value: undefined, configurable: true });
    });
    await fresh(page);
    const owned = await exercisesInDb(page);
    await openExercises(page, owned);

    const rows = rowsOf(page);
    await expect.poll(() => rows.count()).toBeGreaterThan(owned.length);
    const first = await rows.count();
    await page.getByTestId('exercise-more').click();
    await expect.poll(() => rows.count()).toBeGreaterThan(first);
  });

  test('a library row opens a preview with both pictures; Add makes it the owner\'s once, and the counts move by one each way', async ({ page }) => {
    await fresh(page);
    const owned = await exercisesInDb(page);
    const base = expectedCounts(owned);
    const entry = libraryEntries(owned, 'rear delts')[0]!;
    const key = keyOf(entry);
    await openExercises(page, owned);

    await page.getByTestId('exercise-search').fill(entry.name);
    await page.getByTestId(`exercise-row-${key}`).click();
    const preview = page.getByTestId('library-preview');
    await expect(preview).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText(entry.name);
    await expect(preview.getByTestId('library-label')).toBeVisible();

    // Both photographs load, and the demo alternates between them.
    expect(await imageLoads(page, frameUrl(entry.slug, 1))).toBe(true);
    expect(await imageLoads(page, frameUrl(entry.slug, 2))).toBe(true);
    await expect.poll(() => demoShowsLoadedFrame(page, 1)).toBe(true);
    await expect.poll(() => demoShowsLoadedFrame(page, 2)).toBe(true);
    // Looking is not adding.
    expect((await exercisesInDb(page)).filter((e) => e.demo === key)).toHaveLength(0);

    // Escape (what the Android back gesture sends) closes the preview and nothing else: still on the list, nothing added.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('library-preview')).toHaveCount(0);
    await expect(page).toHaveURL(/\/exercises$/);
    expect((await exercisesInDb(page)).filter((e) => e.demo === key)).toHaveLength(0);
    await page.getByTestId(`exercise-row-${key}`).click();
    await expect(page.getByTestId('library-preview')).toBeVisible();

    await page.getByTestId('library-add').click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop()!;
    // Stored once, under the catalogue key, as the owner's.
    const stored = (await exercisesInDb(page)).filter((e) => e.demo === key);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(id);
    expect(stored[0]!.name).toBe(entry.name);
    expect(await exercisesInDb(page)).toHaveLength(base.owned + 1);

    // The count moved by one each way: one more of hers, one fewer in the library.
    await openExercises(page, await exercisesInDb(page));
    await expect(page.getByTestId('exercise-counts')).toHaveText(countsText({ owned: base.owned + 1, library: base.library - 1 }));
    // It is hers now: no library row for it, and an owned row with no label.
    await page.getByTestId('exercise-search').fill(entry.name);
    await expect(page.getByTestId(`exercise-row-${id}`)).toBeVisible();
    await expect(page.getByTestId(`exercise-row-${key}`)).toHaveCount(0);
    await expect(page.getByTestId(`exercise-row-${id}`).getByTestId('library-label')).toHaveCount(0);

    // And back: deleting it returns it to the library, and the counts return.
    await page.goto(`/exercises/${id}/edit`);
    await page.getByTestId('delete-exercise').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL(/\/exercises$/);
    await expect(page.getByTestId('exercise-counts')).toHaveText(countsText(base));
    expect((await exercisesInDb(page)).filter((e) => e.demo === key)).toHaveLength(0);
    await page.getByTestId('exercise-search').fill(entry.name);
    await expect(page.getByTestId(`exercise-row-${key}`).getByTestId('library-label')).toBeVisible();
  });

  test('adding a bundled diagram from its preview makes one exercise too', async ({ page }) => {
    await fresh(page);
    const owned = await exercisesInDb(page);
    const base = expectedCounts(owned);
    const ownedKeys = new Set(owned.flatMap((e) => (e.demo ? [e.demo] : [])));
    const ownedNames = new Set(owned.map((e) => norm(e.name)));
    const diagram = diagrams.find((d) => !ownedKeys.has(d.slug) && !ownedNames.has(norm(d.name)) && /^[A-Za-z ]{8,}$/.test(d.name))!;
    expect(diagram, 'a diagram the seed does not carry').toBeDefined();
    await openExercises(page, owned);

    await page.getByTestId('exercise-search').fill(diagram.name);
    await page.getByTestId(`exercise-row-${diagram.slug}`).click();
    await expect(page.getByTestId('library-preview')).toBeVisible();
    await expect.poll(() => page.getByTestId('demo-frame').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await page.getByTestId('library-add').click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);

    const stored = (await exercisesInDb(page)).filter((e) => e.demo === diagram.slug);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe(diagram.name);
    await openExercises(page, await exercisesInDb(page));
    await expect(page.getByTestId('exercise-counts')).toHaveText(countsText({ owned: base.owned + 1, library: base.library - 1 }));
  });
});

test.describe("a routine's exercise picker", () => {
  test('adds a library exercise to the routine in one tap, as a new exercise of the owner\'s', async ({ page }) => {
    await fresh(page);
    const owned = await exercisesInDb(page);
    const entry = libraryEntries(owned, 'rear delts')[0]!;
    const key = keyOf(entry);
    const routine = await routineId(page, 'Upper (Push)');
    await page.goto(`/routines/${routine}`);
    await page.getByTestId('add-exercise').click();
    const picker = page.getByRole('dialog');

    await picker.getByTestId('picker-search').fill(entry.name);
    const row = picker.getByTestId(`pick-${key}`);
    await expect(row).toContainText(entry.name);
    await expect(row.getByTestId('library-label')).toBeVisible();
    // Nothing is added by looking.
    expect((await exercisesInDb(page)).filter((e) => e.demo === key)).toHaveLength(0);

    await row.click();
    // The routine row is what only this pick produces.
    await expect
      .poll(async () => {
        const raw = await readRawIron(page);
        const ids = new Set((raw.tables.exercises as RawExercise[]).filter((e) => e.demo === key).map((e) => e.id));
        return (raw.tables.routineExercises as { exerciseId: string }[]).filter((r) => ids.has(r.exerciseId)).length;
      })
      .toBe(1);

    const raw = await readRawIron(page);
    const made = (raw.tables.exercises as RawExercise[]).filter((e) => e.demo === key);
    expect(made).toHaveLength(1);
    expect(made[0]!.name).toBe(entry.name);
    expect(raw.tables.exercises).toHaveLength(owned.length + 1);
    const rx = (raw.tables.routineExercises as { exerciseId: string; routineId: string }[]).filter((r) => r.exerciseId === made[0]!.id);
    expect(rx).toHaveLength(1);
    expect(rx[0]!.routineId).toBe(routine);
  });

  test("a live session's Add exercise takes a library exercise in one tap", async ({ page }) => {
    await fresh(page);
    const owned = await exercisesInDb(page);
    const entry = libraryEntries(owned, 'rear delts')[0]!;
    const key = keyOf(entry);
    await page.getByTestId('start-Upper (Push)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await expect(page).toHaveURL(/\/session\//);

    await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
    const picker = page.getByRole('dialog');
    await picker.getByTestId('picker-search').fill(entry.name);
    await picker.getByTestId(`pick-${key}`).click();
    // The card is what only this pick can produce.
    await expect(page.getByTestId(`exercise-card-${entry.name}`)).toBeVisible();
    const made = (await exercisesInDb(page)).filter((e) => e.demo === key);
    expect(made).toHaveLength(1);
    expect(made[0]!.name).toBe(entry.name);
    expect(await exercisesInDb(page)).toHaveLength(owned.length + 1);
  });

  test('lists the owner\'s exercises ahead of the library, unlabelled, and leaves out what the routine already has', async ({ page }) => {
    await fresh(page);
    const routine = await routineId(page, 'Upper (Push)');
    const raw = await readRawIron(page);
    const inRoutine = new Set((raw.tables.routineExercises as { routineId: string; exerciseId: string }[]).filter((r) => r.routineId === routine).map((r) => r.exerciseId));
    const exercises = raw.tables.exercises as RawExercise[];
    const have = exercises.find((e) => inRoutine.has(e.id))!;
    const free = exercises.find((e) => !inRoutine.has(e.id))!;

    await page.goto(`/routines/${routine}`);
    await page.getByTestId('add-exercise').click();
    const picker = page.getByRole('dialog');
    // An exercise of hers that is not in the routine is offered, with no label.
    await expect(picker.getByTestId(`pick-${free.id}`)).toBeVisible();
    await expect(picker.getByTestId(`pick-${free.id}`).getByTestId('library-label')).toHaveCount(0);
    // The first row is hers; library rows come after every one of hers.
    const labels = await picker.locator('[data-testid^="pick-"]').evaluateAll((els) => els.map((e) => e.querySelector('[data-testid="library-label"]') !== null));
    expect(labels[0]).toBe(false);
    expect(labels.some(Boolean)).toBe(true);
    expect(labels.indexOf(true)).toBe(exercises.length - inRoutine.size);
    expect(labels.slice(labels.indexOf(true)).every(Boolean)).toBe(true);
    // The one the routine already has is not offered. The search is its name without the bracketed
    // part; the first row showing that name is the signal the search has been applied, and it is a
    // row that is not the excluded one.
    const term = have.name.replace(/\s*\(.*\)/, '');
    await picker.getByTestId('picker-search').fill(term);
    await expect(picker.locator('[data-testid^="pick-"]').first()).toContainText(term);
    await expect(picker.getByTestId(`pick-${have.id}`)).toHaveCount(0);
  });
});

test.describe('Paste a routine', () => {
  /** A catalogue name the paste parser reads as a plain exercise line and the matcher can only answer with that entry. */
  function pasteTargets(owned: RawExercise[]): CatalogueEntry[] {
    const all = [...diagrams.map((d) => norm(d.name)), ...catalogue.map((e) => norm(e.name))];
    const count = (n: string) => all.filter((x) => x === n).length;
    return libraryEntries(owned).filter((e) => /^[A-Za-z][A-Za-z ]{8,40}$/.test(e.name) && !/warm|rest|superset|cool|note|set|rep|day|week|round|circuit/i.test(e.name) && count(norm(e.name)) === 1);
  }

  test('a line naming a catalogue exercise is matched as Library, the owner\'s own win, and Save makes the exercise', async ({ page }) => {
    await fresh(page);
    const owned = await exercisesInDb(page);
    const [entry, chosen] = pasteTargets(owned);
    expect(entry && chosen, 'two catalogue entries the paste can name').toBeTruthy();
    await page.goto('/routines');
    await page.getByTestId('new-routine').click();
    await page.getByTestId('paste-routine').click();
    await page.getByTestId('paste-text').fill(['Library day', `${entry!.name} 3x10-12`, 'Bench press 4x6-8 @ 80kg', 'Zzzq qqqx 3x8'].join('\n'));

    const rows = page.getByTestId('paste-row');
    await expect(rows).toHaveCount(3);
    // The catalogue line is the entry, marked Library; it waited for the catalogue to load to say so.
    await expect(rows.nth(0).getByTestId('paste-row-name')).toHaveText(entry!.name);
    await expect(rows.nth(0).getByTestId('library-label')).toBeVisible();
    // The owner's Bench Press wins its line: no label (the catalogue is in by now, so a library entry could have taken it).
    await expect(rows.nth(1).getByTestId('paste-row-name')).toHaveText('Bench Press (Barbell)');
    await expect(rows.nth(1).getByTestId('library-label')).toHaveCount(0);
    // The line nothing matches still waits for a choice.
    await expect(rows.nth(2).getByTestId('paste-choose')).toBeVisible();
    await expect(page.getByTestId('paste-save')).toBeDisabled();
    // Matching made nothing.
    expect((await exercisesInDb(page)).filter((e) => e.demo === keyOf(entry!))).toHaveLength(0);

    // Choose a library entry for the third line from the picker: it is marked Library too, and still not made.
    await rows.nth(2).getByTestId('paste-choose').click();
    const picker = page.getByRole('dialog').filter({ hasText: 'Choose exercise' });
    await picker.getByTestId('picker-search').fill(chosen!.name);
    await picker.getByTestId(`pick-${keyOf(chosen!)}`).click();
    await expect(rows.nth(2).getByTestId('paste-row-name')).toHaveText(chosen!.name);
    await expect(rows.nth(2).getByTestId('library-label')).toBeVisible();
    expect((await exercisesInDb(page)).filter((e) => e.demo === keyOf(chosen!))).toHaveLength(0);

    await expect(page.getByTestId('paste-save')).toBeEnabled();
    await page.getByTestId('paste-save').click();
    await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/);

    // Both library exercises exist now, once each, and the routine uses them.
    const after = await readRawIron(page);
    const exercises = after.tables.exercises as RawExercise[];
    const made = (e: CatalogueEntry) => exercises.filter((x) => x.demo === keyOf(e));
    expect(made(entry!)).toHaveLength(1);
    expect(made(chosen!)).toHaveLength(1);
    expect(exercises).toHaveLength(owned.length + 2);
    const routine = (after.tables.routines as { id: string; name: string }[]).find((r) => r.name === 'Library day')!;
    const used = (after.tables.routineExercises as { routineId: string; exerciseId: string; order: number }[])
      .filter((r) => r.routineId === routine.id)
      .sort((a, b) => a.order - b.order)
      .map((r) => r.exerciseId);
    expect(used).toHaveLength(3);
    expect(used[0]).toBe(made(entry!)[0]!.id);
    expect(used[2]).toBe(made(chosen!)[0]!.id);
    await expect(page.getByTestId(`rx-card-${entry!.name}`)).toBeVisible();
  });

  test('a paste that is cancelled adds nothing', async ({ page }) => {
    await fresh(page);
    const owned = await exercisesInDb(page);
    const entry = pasteTargets(owned)[0]!;
    await page.goto('/routines');
    await page.getByTestId('new-routine').click();
    await page.getByTestId('paste-routine').click();
    await page.getByTestId('paste-text').fill(`Cancelled day\n${entry.name} 3x10-12`);
    // Matched as Library, which needs the catalogue: from here on it has had its chance to add something.
    await expect(page.getByTestId('paste-row').first().getByTestId('library-label')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('paste-text')).toHaveCount(0);

    const raw = await readRawIron(page);
    expect(raw.tables.exercises).toHaveLength(owned.length);
    expect((raw.tables.routines as { name: string }[]).some((r) => r.name === 'Cancelled day')).toBe(false);
  });
});
