import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEED_EXERCISES, SEED_EXERCISE_IDS, SEED_ROUTINES, SEED_ROUTINE_EXERCISES, SEED_ROUTINE_IDS } from '../src/db/seed';
import { EXERCISE_DEMOS } from '../src/data/exerciseDemos';
import { equipmentFromDemo } from '../src/domain/library';
import { DEFAULT_SETTINGS } from '../src/domain/types';
import { createRawIronDb, fresh, IRON_SCHEMA_V3, readRawIron } from './fresh';

/**
 * The coach as one box, on the built app, against `window.__ironNanoFake` (the documented stand-in
 * for the native plugin; see coach.spec.ts). The owner's conversation from their screenshots, and
 * the rules that make a routine smarter than a list of exercises: everything from that seam inward
 * is real, the owner's data read from IndexedDB, the generator, the review and the save.
 *
 * The model's calls are logged at the seam. A claim of "no model call" is asserted only once the
 * thing the call would have been for is on screen and the box is idle again, and again at the end of
 * the conversation, so a call made late is caught too.
 */

const REPLY = ['Each part of the shoulder ', 'has an exercise.'];
const SHOULDERS = 'Give me a routine solely designed to build 3D shoulders';

interface ModelLog {
  generate: string[];
  counted: string[];
  streamed: string[];
}

interface FakeOptions {
  /** What an answer says, in pieces. */
  reply?: string[];
  /** What the default model answers when it is asked to read a typed line. */
  intent?: string;
  /** What the nth answer says, where it is not `reply`. */
  replies?: string[][];
  /** The first answer stops after its first piece and waits for `window.__release()`. */
  hold?: boolean;
  /** The first answer fails with "boom". */
  fail?: boolean;
  /** The model is not there: the status says so, and a question cannot be sent. */
  unavailable?: boolean;
}

/**
 * The fake default and full models: every prompt of every kind is recorded in `window.__modelLog`.
 * `window.__streamsFinished` counts the answers that have run to their end: a held answer adds one
 * only after `__release()`, so a test can wait for something that cannot have happened before it.
 */
async function fakeModel(page: Page, opts: FakeOptions = {}): Promise<void> {
  await page.addInitScript(
    (c: Required<Pick<FakeOptions, 'reply' | 'intent' | 'replies' | 'hold' | 'fail' | 'unavailable'>>) => {
      const w = window as unknown as Record<string, unknown>;
      const log = { generate: [] as string[], counted: [] as string[], streamed: [] as string[] };
      w.__modelLog = log;
      w.__streamsFinished = 0;
      let calls = 0;
      w.__ironNanoFake = {
        status: { state: 'ready', detail: 'AVAILABLE · default' },
        statusFull: c.unavailable ? { state: 'unavailable', detail: 'UNAVAILABLE · samsung SM-F971B' } : { state: 'ready', detail: 'AVAILABLE · nano-v4-full · 4000 tokens · samsung SM-F971B' },
        generate: async ({ prompt }: { prompt: string }) => {
          log.generate.push(prompt);
          return { text: c.intent };
        },
        countTokens: async ({ prompt }: { prompt: string }) => {
          log.counted.push(prompt);
          return { tokens: Math.ceil(prompt.length / 4), limit: 4000 };
        },
        generateStream: async ({ prompt }: { prompt: string }, emit: (t: string) => void) => {
          const n = calls++;
          log.streamed.push(prompt);
          if (c.fail && n === 0) throw new Error('boom');
          const reply = c.replies[n] ?? c.reply;
          emit(reply[0]!);
          if (c.hold && n === 0) await new Promise<void>((resolve) => (w.__release = resolve));
          for (const piece of reply.slice(1)) emit(piece);
          w.__streamsFinished = (w.__streamsFinished as number) + 1;
          return { text: reply.join('') };
        },
      };
    },
    { reply: opts.reply ?? REPLY, intent: opts.intent ?? '{}', replies: opts.replies ?? [], hold: opts.hold ?? false, fail: opts.fail ?? false, unavailable: opts.unavailable ?? false },
  );
}

const release = (page: Page) => page.evaluate(() => (window as unknown as { __release: () => void }).__release());
const streamsFinished = (page: Page) => page.evaluate(() => (window as unknown as { __streamsFinished: number }).__streamsFinished);

const modelLog = (page: Page) => page.evaluate(() => (window as unknown as { __modelLog: ModelLog }).__modelLog);
const NO_CALLS: ModelLog = { generate: [], counted: [], streamed: [] };

// ---------------------------------------------------------------------------
// The owner's data, raw, before the app boots

type Row = Record<string, unknown>;

/** Local noon, `daysAgo` days back: the day a session was started, in the zone the page will read it in. */
function at(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

/** "29 Sep": how the builder says the day of a niggle. */
function dayWords(daysAgo: number): string {
  const d = new Date(at(daysAgo));
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
}

const exercise = (id: string, name: string, over: Row): Row => ({
  id,
  name,
  kind: 'reps',
  isCompound: false,
  isLowerBody: false,
  defaultRestSec: 75,
  defaultIncrement: 2.5,
  unilateral: false,
  createdAt: at(200),
  ...over,
});

interface Owner {
  /** The owner's exercises. Default: the seeded 27. */
  exercises?: Row[];
  /** The five seeded routines. Default: yes. */
  routines?: boolean;
  /** Finished sessions beyond the history every owner has. */
  sessions?: Row[];
  setLogs?: Row[];
  decisions?: Row[];
}

/**
 * Seeds `iron` as raw IndexedDB: the owner's exercises and their five routines (less any row that
 * points at an exercise they do not have), and a finished session a month back with a set on every
 * exercise, which is what makes the equipment they use theirs. Run on a page the app has never
 * booted (see e2e/fresh.ts).
 */
async function seedOwner(page: Page, owner: Owner = {}): Promise<void> {
  await page.goto('/icons/icon-192.png');
  const exercises: Row[] = owner.exercises ?? SEED_EXERCISES.map((e) => ({ ...e, createdAt: at(200) }));
  const have = new Set(exercises.map((e) => e.id as string));
  const withRoutines = owner.routines !== false;
  const routineExercises = withRoutines ? SEED_ROUTINE_EXERCISES.filter((rx) => have.has(rx.exerciseId)) : [];
  await createRawIronDb(page, 30, IRON_SCHEMA_V3, {
    exercises,
    routines: withRoutines ? SEED_ROUTINES : [],
    routineExercises,
    sessions: [{ id: 'history', routineId: '', title: 'Past', startedAt: at(40), endedAt: at(40), durationSec: 3600 }, ...(owner.sessions ?? [])],
    setLogs: [
      ...exercises.map((e, i) => ({ id: `history-${i}`, sessionId: 'history', routineExerciseId: null, exerciseId: e.id, index: 0, type: 'working', weight: 10, reps: 8, completedAt: at(40) })),
      ...(owner.setLogs ?? []),
    ],
    decisions: owner.decisions ?? [],
    settings: [{ id: 'settings', ...DEFAULT_SETTINGS, createdAt: at(200) }],
  });
}

// ---------------------------------------------------------------------------
// What a name is: the owner's own row, else the library's entry

interface Known {
  name: string;
  group: string;
  equipment?: string;
}

/** The library as the builder draws on it: the catalogue's entries and the bundled diagrams, by name. */
const library = new Map<string, Known>([
  ...(JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/exerciseCatalogue.json', import.meta.url)), 'utf8')) as { name: string; muscleGroup: string; equipment: string }[]).map(
    (e): [string, Known] => [e.name, { name: e.name, group: e.muscleGroup, equipment: e.equipment }],
  ),
  ...EXERCISE_DEMOS.map((d): [string, Known] => [d.name, { name: d.name, group: d.muscleGroup ?? 'other', equipment: equipmentFromDemo(d.equipment) }]),
]);

async function lookup(page: Page, names: string[]): Promise<Known[]> {
  const owned = new Map(
    ((await readRawIron(page)).tables.exercises as { name: string; muscleGroup: string; equipment?: string }[]).map((e) => [e.name, { name: e.name, group: e.muscleGroup, equipment: e.equipment } satisfies Known]),
  );
  return names.map((n) => {
    const known = owned.get(n) ?? library.get(n);
    expect(known, `${n} is neither the owner's exercise nor in the library`).toBeTruthy();
    return known!;
  });
}

const groupsOf = async (page: Page, names: string[]): Promise<string[]> => (await lookup(page, names)).map((k) => k.group);

/** What a shoulder niggle rules out, said in the words of a name and an equipment, not in the builder's own terms. */
function ruledOutByShoulder(k: Known): boolean {
  return (
    /upright .*row|high pull/i.test(k.name) ||
    /behind (the )?neck|neck press/i.test(k.name) ||
    /\bdips?\b/i.test(k.name) ||
    (k.equipment === 'barbell' && /(shoulder|overhead|military|arnold|push) press|\bohp\b/i.test(k.name) && !/landmine/i.test(k.name))
  );
}

/** What is saved, read raw: every exercise, and each routine with the names and ids of its rows in order. */
async function savedState(page: Page) {
  const { tables } = await readRawIron(page);
  const exercises = tables.exercises as { id: string; name: string; demo?: string; muscleGroup?: string; equipment?: string }[];
  const nameOf = new Map(exercises.map((e) => [e.id, e.name]));
  const rx = tables.routineExercises as { routineId: string; exerciseId: string; order: number }[];
  const routines = (tables.routines as { id: string; name: string }[]).map((r) => {
    const rows = rx.filter((x) => x.routineId === r.id).sort((a, b) => a.order - b.order);
    return { name: r.name, rows: rows.map((x) => nameOf.get(x.exerciseId)), exerciseIds: rows.map((x) => x.exerciseId) };
  });
  return { exercises, routines };
}

// ---------------------------------------------------------------------------
// The screen

async function openCoach(page: Page, url = '/coach'): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId('coach-input')).toBeVisible();
}

async function say(page: Page, text: string): Promise<void> {
  await page.getByTestId('coach-input').fill(text);
  await page.getByTestId('coach-send').click();
}

/** The box idle again: Send says Send, which it does only once the message has been answered or built. */
const idle = (page: Page) => expect(page.getByTestId('coach-send')).toHaveText('Send');

const entry = (page: Page, n: number) => page.getByTestId('coach-entry').nth(n);
const rowNames = (where: Pick<Locator, 'getByTestId'>) => where.getByTestId('coach-row-name').allTextContents();

async function whyLines(where: Locator): Promise<string[]> {
  await where.getByTestId('coach-why').first().click();
  const lines = where.getByTestId('coach-why-lines').first().locator('div');
  await expect(lines.first()).toBeVisible();
  return lines.allTextContents();
}

// ---------------------------------------------------------------------------

test('the owner\'s conversation: a routine built with no model, why answered from it, a new routine, a shuffle, a review and a save', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page);

  let first: string[] = [];
  let firstReasons: string[] = [];
  await test.step('Give me a routine solely designed to build 3D shoulders', async () => {
    await say(page, SHOULDERS);
    const bubble = entry(page, 0).getByTestId('coach-routine');
    await expect(bubble).toHaveCount(1);
    await idle(page);

    first = await rowNames(bubble);
    expect(first).toHaveLength(6);
    // The model gave DB Shoulder Press three times and Lateral Raise twice: each is here once.
    expect(new Set(first).size).toBe(first.length);
    const groups = await groupsOf(page, first);
    expect(groups).toContain('shoulders');
    expect(groups).toContain('rear delts');
    await expect(entry(page, 0).getByTestId('coach-read')).toHaveText('Read: shoulders, rear delts · 6 exercises');
    await expect(bubble.getByTestId('coach-minutes')).toHaveText(/^about \d+ min$/);
    // Why is behind a tap, as How to is.
    await expect(bubble.getByTestId('coach-why')).toBeVisible();
    await expect(bubble.getByTestId('coach-why-lines')).toHaveCount(0);
    firstReasons = await whyLines(bubble);
    expect(firstReasons).toContain('Focus: shoulders and rear delts, as asked');
    expect(await modelLog(page)).toEqual(NO_CALLS);
  });

  await test.step('Why have you chosen this? is one call, with the routine and its reasons, and answers without another routine', async () => {
    await say(page, 'Why have you chosen this?');
    await expect(entry(page, 1).getByTestId('coach-answer')).toHaveText(REPLY.join(''));
    await idle(page);
    // Counted after the answer is on screen, so a second routine or a second call would be here.
    await expect(page.getByTestId('coach-routine')).toHaveCount(1);
    const log = await modelLog(page);
    expect(log.streamed).toHaveLength(1);
    expect(log.generate).toEqual([]);
    const prompt = log.streamed[0]!;
    for (const name of first) expect(prompt).toContain(name);
    expect(firstReasons.some((line) => prompt.includes(line))).toBe(true);
    expect(prompt).toContain(`User: ${SHOULDERS}`);
    expect(prompt.endsWith('User: Why have you chosen this?')).toBe(true);
    // The line under the answer says what the model was given.
    await expect(entry(page, 1).getByTestId('coach-read')).toHaveText(/^Read: .*routine and reasons · last exchange$/);
  });

  let second: string[] = [];
  await test.step("Doesn't matter, I want 3d shoulders builds again, with no call to the model", async () => {
    await say(page, "Doesn't matter, I want 3d shoulders");
    await expect(page.getByTestId('coach-routine')).toHaveCount(2);
    await idle(page);
    second = await rowNames(entry(page, 2));
    expect(second).toHaveLength(6);
    expect(new Set(second).size).toBe(6);
    expect(await groupsOf(page, second)).toEqual(expect.arrayContaining(['shoulders', 'rear delts']));
    expect((await modelLog(page)).streamed).toHaveLength(1);
    expect((await modelLog(page)).generate).toEqual([]);
  });

  let shuffled: string[] = [];
  await test.step('Shuffle replaces that routine in place with another', async () => {
    const before = second.join('|');
    const target = entry(page, 2);
    for (let press = 0; press < 5; press++) {
      await target.getByTestId('coach-shuffle').click();
      const changed = await expect
        .poll(async () => (await rowNames(target)).join('|'), { timeout: 3000 })
        .not.toBe(before)
        .then(
          () => true,
          () => false,
        );
      if (changed) break;
    }
    shuffled = await rowNames(target);
    expect(shuffled.join('|')).not.toBe(before);
    expect(shuffled).toHaveLength(6);
    expect(new Set(shuffled).size).toBe(6);
    expect(await groupsOf(page, shuffled)).toEqual(expect.arrayContaining(['shoulders', 'rear delts']));
    // In place: still two routines, the first untouched, and the model was not asked.
    await expect(page.getByTestId('coach-routine')).toHaveCount(2);
    expect(await rowNames(entry(page, 0))).toEqual(first);
    await expect(entry(page, 2).getByTestId('coach-read')).toHaveText('Read: shoulders, rear delts · 6 exercises');
    expect((await modelLog(page)).streamed).toHaveLength(1);
    expect((await modelLog(page)).generate).toEqual([]);
  });

  await test.step('Review routine opens what is on screen: a row for each, and the owner\'s own exercises under their own names', async () => {
    await entry(page, 2).getByTestId('coach-review').click();
    const review = page.getByRole('dialog').filter({ hasText: 'Review routine' });
    await expect(review.getByTestId('paste-row')).toHaveCount(shuffled.length);
    // A row of the routine that is not a library one is the owner's own exercise, and the review reads it as that exercise.
    // One that is a library one is matched to the library's entry: the Library mark is on exactly those rows.
    const rows = entry(page, 2).getByTestId('coach-row');
    let fromLibrary = 0;
    for (let i = 0; i < shuffled.length; i++) {
      if ((await rows.nth(i).getByTestId('coach-new').count()) > 0) {
        fromLibrary++;
        continue;
      }
      await expect(review.getByTestId('paste-row-name').nth(i)).toHaveText(shuffled[i]!);
    }
    await expect(review.getByTestId('library-label')).toHaveCount(fromLibrary);
    await expect(review.getByTestId('paste-add-new')).toHaveCount(0);
    await review.getByRole('button', { name: 'Cancel' }).click();
    await expect(review).toBeHidden();
    expect((await modelLog(page)).streamed).toHaveLength(1);
    expect((await modelLog(page)).generate).toEqual([]);
  });
});

/** An owner with exercises of four kinds of equipment and nothing for the shoulders, under names no library exercise shares a word with. */
function bareOwner(): Owner {
  const mine = (id: string, name: string, equipment: string) => exercise(id, name, { muscleGroup: 'calves', equipment });
  return { exercises: [mine('o1', 'Aardvark', 'barbell'), mine('o2', 'Bonobo', 'dumbbell'), mine('o3', 'Cheetah', 'cable'), mine('o4', 'Dingo', 'machine')], routines: false };
}

test('Review routine opens the routine it sits under and saves it, the library exercises made once however often it is saved', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page, bareOwner());
  await openCoach(page);

  // Two routines in one conversation, so a Review that opened the wrong one would show.
  await say(page, 'give me a routine for 3d shoulders');
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await idle(page);
  await say(page, 'give me a chest routine');
  await expect(page.getByTestId('coach-routine')).toHaveCount(2);
  await idle(page);
  const shoulders = await rowNames(entry(page, 0));
  const chest = await rowNames(entry(page, 1));
  // Nothing of the owner's is for either muscle: every row is from the library, and says so.
  for (const [n, names] of [[0, shoulders], [1, chest]] as const) {
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(new Set(names).size).toBe(names.length);
    await expect(entry(page, n).getByTestId('coach-new')).toHaveCount(names.length);
    await expect(entry(page, n).getByTestId('coach-minutes')).toHaveText(/^about \d+ min$/);
  }
  expect(shoulders).not.toEqual(chest);
  expect(await modelLog(page)).toEqual(NO_CALLS);

  const saved = async () => {
    const { exercises, routines } = await savedState(page);
    return { exercises, routines: routines.map(({ name, rows }) => ({ name, rows })) };
  };

  const review = page.getByRole('dialog').filter({ hasText: 'Review routine' });

  // From under the second bubble the review is the chest routine, not the first one: opened, read, and put away unsaved.
  await entry(page, 1).getByTestId('coach-review').click();
  await expect(review.getByTestId('paste-row')).toHaveCount(chest.length);
  await expect(review.getByTestId('paste-row-name')).toHaveText(chest);
  await review.getByRole('button', { name: 'Cancel' }).click();
  await expect(review).toBeHidden();
  expect((await saved()).routines).toEqual([]);

  // The shoulders routine, saved twice. Saved once, its exercises are the owner's own and the second review matches every row to them.
  for (const save of [1, 2]) {
    await entry(page, 0).getByTestId('coach-review').click();
    await expect(review.getByTestId('paste-row')).toHaveCount(shoulders.length);
    await expect(review.getByTestId('paste-row-name')).toHaveText(shoulders);
    if (save === 2) await expect(review.getByTestId('paste-change')).toHaveCount(shoulders.length);
    // Every row is matched before anything is chosen, and none is offered as a blank "new exercise": the first time to the library's entry
    // (the Library mark is only on a row matched to one), the second to the owner's own copy of it. A row left unmatched would be
    // clicked into a blank exercise of the same name by hand, and everything below would still be true of it.
    await expect(review.getByTestId('paste-add-new')).toHaveCount(0);
    await expect(review.getByTestId('library-label')).toHaveCount(save === 1 ? shoulders.length : 0);
    await review.getByTestId('paste-save').click();
    await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/);

    const { exercises, routines } = await saved();
    // Made from the library's entry, not blank: its picture key, its muscle group and its equipment.
    for (const name of shoulders) {
      const made = (exercises as { name: string; demo?: string; muscleGroup?: string; equipment?: string }[]).find((e) => e.name === name);
      expect(made?.demo, `${name}: picture key`).toBeTruthy();
      expect(made?.muscleGroup, `${name}: muscle group`).toBe(library.get(name)?.group);
      if (library.get(name)?.equipment) expect(made?.equipment, `${name}: equipment`).toBe(library.get(name)!.equipment);
    }
    expect(routines).toEqual(Array.from({ length: save }, () => ({ name: 'Shoulders and rear delts', rows: shoulders })));
    // The owner's four and one row for each library exercise, however many routines hold it.
    expect(exercises).toHaveLength(4 + shoulders.length);
    expect(new Set(exercises.map((e) => e.name.toLowerCase())).size).toBe(exercises.length);
    await page.goBack();
    await expect(page.getByTestId('coach-routine')).toHaveCount(2);
  }
});

// ---------------------------------------------------------------------------
// The diagrams, and the identity of a built row

/** The diagrams the adductors have: no catalogue entry is for them, and the owner of bareOwner() has none. */
const ADDUCTOR_DIAGRAMS = ['cable-standing-hip-adduction', 'hip-adduction-machine'].map((slug) => EXERCISE_DEMOS.find((d) => d.slug === slug)!);

test('a routine built from the diagrams: Review has every row matched already, Save makes one exercise from each diagram and points the routine at it, and building and saving it again makes no second one', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page, bareOwner());
  await openCoach(page);
  expect(ADDUCTOR_DIAGRAMS).toHaveLength(2);

  // Nothing the owner has is for the adductors, and the library has only these two diagrams for them: the pool is the same every time.
  await say(page, 'give me an adductor routine');
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await idle(page);
  const built = await rowNames(entry(page, 0));
  expect([...built].sort()).toEqual(ADDUCTOR_DIAGRAMS.map((d) => d.name).sort());
  await expect(entry(page, 0).getByTestId('coach-new')).toHaveCount(2);
  expect(await modelLog(page)).toEqual(NO_CALLS);

  const review = page.getByRole('dialog').filter({ hasText: 'Review routine' });

  // Review: both rows are there, and each is already the diagram the builder took. The Library mark
  // is only on a row that has been matched to a library entry, so it is what shows the matching has been done.
  await entry(page, 0).getByTestId('coach-review').click();
  await expect(review.getByTestId('paste-row')).toHaveCount(2);
  await expect(review.getByTestId('library-label')).toHaveCount(2);
  await expect(review.getByTestId('paste-choose')).toHaveCount(0);
  await expect(review.getByTestId('paste-add-new')).toHaveCount(0);
  await expect(review.getByTestId('paste-facts')).toHaveCount(0);
  await expect(review.getByTestId('paste-row-name')).toHaveText(built);
  await expect(review.getByTestId('paste-save')).toBeEnabled();
  expect((await savedState(page)).routines).toEqual([]);

  await review.getByTestId('paste-save').click();
  await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/);

  // Exactly one new exercise per diagram, carrying its slug, and the routine's rows point at them.
  const first = await savedState(page);
  expect(first.exercises).toHaveLength(4 + 2);
  const madeIds: string[] = [];
  for (const d of ADDUCTOR_DIAGRAMS) {
    const made = first.exercises.filter((e) => e.demo === d.slug);
    expect(made, d.slug).toHaveLength(1);
    expect(made[0]).toMatchObject({ name: d.name, muscleGroup: 'adductors', equipment: equipmentFromDemo(d.equipment) });
    madeIds.push(made[0]!.id);
  }
  expect(first.routines).toEqual([{ name: 'Adductors', rows: built, exerciseIds: built.map((n) => madeIds[ADDUCTOR_DIAGRAMS.findIndex((d) => d.name === n)]) }]);

  // The same bubble reviewed and saved again: the exercises are the owner's now, and every row is matched to them.
  await page.goBack();
  await expect(entry(page, 0).getByTestId('coach-routine')).toHaveCount(1);
  await entry(page, 0).getByTestId('coach-review').click();
  await expect(review.getByTestId('paste-row')).toHaveCount(2);
  await expect(review.getByTestId('paste-change')).toHaveCount(2);
  await expect(review.getByTestId('library-label')).toHaveCount(0);
  await expect(review.getByTestId('paste-choose')).toHaveCount(0);
  await review.getByTestId('paste-save').click();
  await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/);
  const second = await savedState(page);
  expect(second.exercises.map((e) => e.id).sort()).toEqual(first.exercises.map((e) => e.id).sort());
  expect(second.routines).toHaveLength(2);
  expect(second.routines.map((r) => r.exerciseIds)).toEqual([first.routines[0]!.exerciseIds, first.routines[0]!.exerciseIds]);

  // Built afresh, the routine is made of the owner's own two exercises: no New mark, nothing from the library, and saved it adds none.
  await page.goBack();
  await say(page, 'give me an adductor routine');
  await expect(page.getByTestId('coach-routine')).toHaveCount(2);
  await idle(page);
  expect([...(await rowNames(entry(page, 1)))].sort()).toEqual([...built].sort());
  await expect(entry(page, 1).getByTestId('coach-new')).toHaveCount(0);
  expect(await whyLines(entry(page, 1))).not.toContainEqual(expect.stringMatching(/^From the library/));
  await entry(page, 1).getByTestId('coach-review').click();
  await expect(review.getByTestId('paste-row')).toHaveCount(2);
  await expect(review.getByTestId('paste-change')).toHaveCount(2);
  await review.getByTestId('paste-save').click();
  await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/);
  const third = await savedState(page);
  expect(third.exercises.map((e) => e.id).sort()).toEqual(first.exercises.map((e) => e.id).sort());
  for (const d of ADDUCTOR_DIAGRAMS) expect(third.exercises.filter((e) => e.demo === d.slug), d.slug).toHaveLength(1);
  expect(third.routines).toHaveLength(3);
  expect(await modelLog(page)).toEqual(NO_CALLS);
});

test('a fresh install, with nothing logged yet, is offered the library\'s cable exercises, because its routines use cables', async ({ page }) => {
  await fakeModel(page);
  // The app's own seed: 27 exercises and five routines on barbells, dumbbells, machines and cables, and not one set logged.
  await fresh(page);
  expect((await readRawIron(page)).tables.setLogs).toEqual([]);
  await openCoach(page);

  await say(page, 'give me a cable routine for 3d shoulders');
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await idle(page);
  const names = await rowNames(entry(page, 0));
  // Their one cable exercise for these muscles is the Face Pull. Counted on equipment they had logged,
  // that was all of it: cable was not theirs, and the library had no cable exercise to add.
  expect(names).toContain('Face Pull');
  expect(names).toHaveLength(4);
  await expect(entry(page, 0).getByTestId('coach-new')).toHaveCount(3);
  for (const known of await lookup(page, names)) expect(known.equipment, known.name).toBe('cable');
  expect(await groupsOf(page, names)).toEqual(expect.arrayContaining(['shoulders', 'rear delts']));
  expect(await modelLog(page)).toEqual(NO_CALLS);
});

test('Review saves the very exercise the builder took, and not another of the owner\'s with the same name', async ({ page }) => {
  await fakeModel(page);
  // Two exercises of one name, as an import or two adds can leave: only the dumbbell one can be in a dumbbell routine.
  const twin = (id: string, equipment: string) => exercise(id, 'Twin Raise', { muscleGroup: 'calves', equipment });
  await seedOwner(page, { exercises: [twin('twin-a', 'barbell'), twin('twin-b', 'dumbbell')], routines: false });
  await openCoach(page);

  await say(page, 'give me a dumbbell calf routine');
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await idle(page);
  const built = await rowNames(entry(page, 0));
  expect(built.filter((n) => n === 'Twin Raise')).toHaveLength(1);

  const review = page.getByRole('dialog').filter({ hasText: 'Review routine' });
  await entry(page, 0).getByTestId('coach-review').click();
  await expect(review.getByTestId('paste-row')).toHaveCount(built.length);
  // Every row resolved, with no row left to choose: each library row says so, and the owner's own is a row that can be changed.
  await expect(review.getByTestId('library-label')).toHaveCount(built.length - 1);
  await expect(review.getByTestId('paste-change')).toHaveCount(built.length);
  await expect(review.getByTestId('paste-choose')).toHaveCount(0);
  await review.getByTestId('paste-save').click();
  await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/);

  const { exercises, routines } = await savedState(page);
  // The row for Twin Raise is the dumbbell one the builder took, and no third exercise of that name was made.
  const twins = routines[0]!.exerciseIds.filter((id) => id === 'twin-a' || id === 'twin-b');
  expect(twins).toEqual(['twin-b']);
  expect(exercises.filter((e) => e.name === 'Twin Raise').map((e) => e.id).sort()).toEqual(['twin-a', 'twin-b']);
  expect(exercises).toHaveLength(2 + (built.length - 1));
});

test('Clear empties the conversation, a build and an answer alike', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page);
  await say(page, 'Give me a chest routine');
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await say(page, 'Why have you chosen this?');
  await expect(page.getByTestId('coach-answer')).toHaveCount(1);
  await idle(page);
  await page.getByTestId('coach-clear').click();
  await expect(page.getByTestId('coach-entry')).toHaveCount(0);
  await expect(page.getByTestId('coach-clear')).toHaveCount(0);

  // The routine that was built is not carried into a question asked after Clear.
  await say(page, 'How was last week?');
  await expect(page.getByTestId('coach-answer')).toHaveCount(1);
  const { streamed } = await modelLog(page);
  expect(streamed).toHaveLength(2);
  expect(streamed[1]).not.toContain('Routine the app built');
  expect(streamed[1]).not.toContain('Give me a chest routine');
});

test('Draft with coach: the first message is a build even when it reads like a question, and the next is routed as usual', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page, '/coach?mode=routine');

  await say(page, 'Why is my chest weak?');
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await idle(page);
  await expect(entry(page, 0).getByTestId('coach-read')).toHaveText(/^Read: chest · \d+ exercises$/);
  expect(await modelLog(page)).toEqual(NO_CALLS);

  await say(page, 'Why have you chosen this?');
  await expect(page.getByTestId('coach-answer')).toHaveText(REPLY.join(''));
  await idle(page);
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  expect((await modelLog(page)).streamed).toHaveLength(1);
});

test('the box has no example text and no toggle', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page);
  await expect(page.getByTestId('coach-input')).toHaveAttribute('placeholder', 'Message');
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Ask|Build a routine)$/ })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// The conversation carried on: a change is made to the routine on screen

/** "about 38 min" as 38. */
async function minutesOf(where: Pick<Locator, 'getByTestId'>): Promise<number> {
  const text = await where.getByTestId('coach-minutes').first().textContent();
  return Number(/^about (\d+) min$/.exec(text ?? '')![1]);
}

test('the owner\'s conversation carried on: "add biceps", "swap the front raise" and "make it shorter" change that routine with no model, and "why" is about the one on screen', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page);

  await say(page, SHOULDERS);
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await idle(page);
  const first = await rowNames(entry(page, 0));
  expect(first).toHaveLength(6);

  let added: string[] = [];
  await test.step('add biceps: the shoulder work is still there, and biceps is now in it', async () => {
    await say(page, 'add biceps');
    await expect(page.getByTestId('coach-routine')).toHaveCount(2);
    await idle(page);
    added = await rowNames(entry(page, 1));
    // Not a biceps routine, and not a second routine from the new words alone: the first, with biceps in it.
    for (const name of first) expect(added, `${name} kept`).toContain(name);
    expect(await groupsOf(page, added)).toEqual(expect.arrayContaining(['shoulders', 'rear delts', 'biceps']));
    expect(added).toHaveLength(first.length + 2);
    expect(new Set(added).size).toBe(added.length);
    await expect(entry(page, 1).getByTestId('coach-read')).toHaveText('Read: shoulders, rear delts, biceps · 8 exercises');
    await expect(entry(page, 1).getByTestId('coach-edit')).toHaveText(/^Added .+/);
    expect(await modelLog(page)).toEqual(NO_CALLS);
  });

  let swapped: string[] = [];
  let replaced = '';
  await test.step('swap the front raise: that row is replaced, in its place, and every other row is as it was', async () => {
    await say(page, 'swap the front raise');
    await expect(page.getByTestId('coach-routine')).toHaveCount(3);
    await idle(page);
    swapped = await rowNames(entry(page, 2));
    expect(swapped).toHaveLength(added.length);
    const changed = swapped.map((name, i) => (name === added[i] ? -1 : i)).filter((i) => i >= 0);
    expect(changed).toHaveLength(1);
    replaced = added[changed[0]!]!;
    expect(new Set(swapped).size).toBe(swapped.length);
    // The row that went was the front raise, by what the routine itself said of it, and what took its place is for the same part of the shoulder.
    const reasons = await whyLines(entry(page, 1));
    expect(reasons.find((line) => line.startsWith(`${replaced}: `)), reasons.join('\n')).toMatch(/front raise/);
    await expect(entry(page, 2).getByTestId('coach-edit')).toHaveText(`Swapped ${replaced} for ${swapped[changed[0]!]}`);
    expect(await modelLog(page)).toEqual(NO_CALLS);
  });

  let shorter: string[] = [];
  await test.step('make it shorter: fewer exercises, and less time', async () => {
    const was = await minutesOf(entry(page, 2));
    await say(page, 'make it shorter');
    await expect(page.getByTestId('coach-routine')).toHaveCount(4);
    await idle(page);
    shorter = await rowNames(entry(page, 3));
    const now = await minutesOf(entry(page, 3));
    expect(now).toBeLessThan(was);
    expect(shorter.length).toBeLessThan(swapped.length);
    for (const name of shorter) expect(swapped).toContain(name);
    expect(await modelLog(page)).toEqual(NO_CALLS);
  });

  await test.step('why have you chosen this? is one call, and its prompt holds the routine on screen now', async () => {
    await say(page, 'Why have you chosen this?');
    await expect(entry(page, 4).getByTestId('coach-answer')).toHaveText(REPLY.join(''));
    await idle(page);
    await expect(page.getByTestId('coach-routine')).toHaveCount(4);
    const log = await modelLog(page);
    expect(log.streamed).toHaveLength(1);
    expect(log.generate).toEqual([]);
    const prompt = log.streamed[0]!;
    const block = prompt.slice(prompt.indexOf('Routine the app built:'), prompt.indexOf('\n\nWhy:'));
    for (const name of shorter) expect(block, name).toContain(name);
    // Nothing of the earlier routines that the later ones dropped or replaced.
    for (const gone of [replaced, ...swapped.filter((n) => !shorter.includes(n))]) expect(block, gone).not.toContain(gone);
    // And the model is told what the coach did.
    expect(prompt).toContain(`Coach: Routine changed (Shoulders, rear delts and biceps): ${await entry(page, 3).getByTestId('coach-edit').textContent()}`);
    expect(prompt.endsWith('User: Why have you chosen this?')).toBe(true);
  });
});

test('Clear while an answer is held mid-stream empties the screen, and the answer does not come back when it finishes', async ({ page }) => {
  await fakeModel(page, { hold: true, replies: [REPLY, ['A fresh answer.']] });
  await seedOwner(page);
  await openCoach(page);
  await say(page, SHOULDERS);
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await idle(page);

  await say(page, 'Why have you chosen this?');
  await expect(page.getByTestId('coach-partial')).toHaveText(REPLY[0]!);
  await expect(page.getByTestId('coach-send')).toHaveText('Answering…');
  await expect(page.getByTestId('coach-send')).toBeDisabled();

  // Clear is there while it is busy, and it works.
  await page.getByTestId('coach-clear').click();
  await expect(page.getByTestId('coach-entry')).toHaveCount(0);
  await expect(page.getByTestId('coach-pending')).toHaveCount(0);
  await expect(page.getByTestId('coach-send')).toHaveText('Send');
  await expect(page.getByTestId('coach-clear')).toHaveCount(0);

  // The held answer runs to its end. Only once it has is anything asserted about it: a check made before would pass whatever the app did with it.
  await release(page);
  await expect.poll(() => streamsFinished(page)).toBe(1);

  // The next question is answered alone: nothing of the cleared one, and not its second half.
  await say(page, 'How was last week?');
  await expect(page.getByTestId('coach-answer')).toHaveText('A fresh answer.');
  await expect(page.getByTestId('coach-answer')).toHaveCount(1);
  await expect(page.getByTestId('coach-entry')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText(REPLY[1]!);
  const { streamed } = await modelLog(page);
  expect(streamed).toHaveLength(2);
  expect(streamed[1]).not.toContain('Routine the app built');
});

test('while an answer is held, Shuffle and Read with assistant are off and Stop is there; Stop keeps what is on screen and puts the question back in the box', async ({ page }) => {
  await fakeModel(page, { hold: true, intent: '{"focus":["biceps"]}' });
  await seedOwner(page);
  await openCoach(page);
  // A routine the rules could not read, so that Read with assistant is offered under it.
  await say(page, 'give me a routine that makes me look like thor');
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await idle(page);
  const shuffle = entry(page, 0).getByTestId('coach-shuffle');
  const assist = entry(page, 0).getByTestId('coach-read-assistant');
  await expect(shuffle).toBeEnabled();
  await expect(assist).toBeEnabled();
  await expect(page.getByTestId('coach-stop')).toHaveCount(0);
  const before = await rowNames(entry(page, 0));

  const question = 'Why have you chosen this?';
  await say(page, question);
  await expect(page.getByTestId('coach-partial')).toHaveText(REPLY[0]!);
  // Both would do nothing now, and say so by being off.
  await expect(shuffle).toBeDisabled();
  await expect(assist).toBeDisabled();
  await expect(page.getByTestId('coach-stop')).toBeVisible();

  await page.getByTestId('coach-stop').click();
  await expect(page.getByTestId('coach-pending')).toHaveCount(0);
  await expect(page.getByTestId('coach-send')).toHaveText('Send');
  // What was on screen stays, and the question is in the box to be sent again, not retyped.
  await expect(page.getByTestId('coach-entry')).toHaveCount(1);
  expect(await rowNames(entry(page, 0))).toEqual(before);
  await expect(page.getByTestId('coach-input')).toHaveValue(question);
  await expect(shuffle).toBeEnabled();
  await expect(assist).toBeEnabled();
  await expect(page.getByTestId('coach-stop')).toHaveCount(0);

  await release(page);
  await expect.poll(() => streamsFinished(page)).toBe(1);
  // Stopped for good: the second half of the answer is nowhere, and no entry was made of it.
  await page.getByTestId('coach-send').click();
  await expect(entry(page, 1).getByTestId('coach-answer')).toHaveText(REPLY.join(''));
  await expect(page.getByTestId('coach-entry')).toHaveCount(2);
});

test('an error keeps what was typed in the box, can be cleared, and goes with the next message', async ({ page }) => {
  await fakeModel(page, { fail: true, replies: [REPLY, ['Fine.']] });
  await seedOwner(page);
  await openCoach(page);
  const question = 'How was last week, in some detail please?';
  await say(page, question);
  await expect(page.getByTestId('coach-error')).toHaveText('boom');
  // Not lost: it is in the box, and nothing was made of it.
  await expect(page.getByTestId('coach-input')).toHaveValue(question);
  await expect(page.getByTestId('coach-entry')).toHaveCount(0);
  await expect(page.getByTestId('coach-pending')).toHaveCount(0);
  // With nothing else on screen, Clear is how the error goes.
  await page.getByTestId('coach-clear').click();
  await expect(page.getByTestId('coach-error')).toHaveCount(0);
  await expect(page.getByTestId('coach-input')).toHaveValue(question);

  // The same words sent again are answered, and the box is empty after them.
  await page.getByTestId('coach-send').click();
  await expect(page.getByTestId('coach-answer')).toHaveText('Fine.');
  await expect(page.getByTestId('coach-error')).toHaveCount(0);
  await expect(page.getByTestId('coach-input')).toHaveValue('');
});

test('an error goes with the next message sent, whatever kind it is', async ({ page }) => {
  await fakeModel(page, { fail: true, replies: [REPLY, ['Fine.']] });
  await seedOwner(page);
  await openCoach(page);
  await say(page, 'How was last week?');
  await expect(page.getByTestId('coach-error')).toHaveText('boom');
  // A new message, of another kind: the build is made, and the error is gone with it.
  await page.getByTestId('coach-input').fill('Give me a chest routine');
  await page.getByTestId('coach-send').click();
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await expect(page.getByTestId('coach-error')).toHaveCount(0);
});

test('a routine that comes to nothing is said to be nothing: the fact, no minutes, no Why, and the model is not told a routine was built', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page, bareOwner());
  await openCoach(page);

  await say(page, 'give me a neck routine with a barbell');
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await idle(page);
  await expect(entry(page, 0).getByTestId('coach-row')).toHaveCount(0);
  await expect(entry(page, 0).getByTestId('coach-nothing')).toHaveText('Nothing to choose from for neck');
  // No "about 0 min", anywhere: not as a pill and not among the reasons.
  await expect(entry(page, 0).getByTestId('coach-minutes')).toHaveCount(0);
  await expect(entry(page, 0).getByTestId('coach-why')).toHaveCount(0);
  await expect(entry(page, 0)).not.toContainText(/\b0 min\b/);
  await expect(entry(page, 0).getByTestId('coach-shuffle')).toHaveCount(0);
  await expect(entry(page, 0).getByTestId('coach-review')).toHaveCount(0);

  await say(page, 'Why have you chosen this?');
  await expect(entry(page, 1).getByTestId('coach-answer')).toHaveText(REPLY.join(''));
  const { streamed } = await modelLog(page);
  expect(streamed).toHaveLength(1);
  expect(streamed[0]).toContain('Coach: Built nothing: Nothing to choose from for neck');
  expect(streamed[0]).not.toContain('Routine built');
  expect(streamed[0]).not.toContain('Routine the app built');
});

test('with the model not there, a change to the routine is made, and a question is not sent', async ({ page }) => {
  await fakeModel(page, { unavailable: true });
  await seedOwner(page);
  await openCoach(page);
  await say(page, SHOULDERS);
  await expect(page.getByTestId('coach-routine')).toHaveCount(1);
  await idle(page);
  const first = await rowNames(entry(page, 0));

  await page.getByTestId('coach-input').fill('add biceps');
  await expect(page.getByTestId('coach-send')).toBeEnabled();
  await page.getByTestId('coach-send').click();
  await expect(page.getByTestId('coach-routine')).toHaveCount(2);
  await idle(page);
  for (const name of first) expect(await rowNames(entry(page, 1))).toContain(name);

  await page.getByTestId('coach-input').fill('Why have you chosen this?');
  await expect(page.getByTestId('coach-send')).toBeDisabled();
  expect(await modelLog(page)).toEqual(NO_CALLS);
});

// ---------------------------------------------------------------------------
// Nothing the rules can read

test('words the rules cannot read build a routine by need, offer the assistant, and call it only on a tap, which fills options and nothing else', async ({ page }) => {
  await fakeModel(page, { intent: '{"focus":["biceps"],"count":3}' });
  await seedOwner(page);
  await openCoach(page);

  const text = 'give me a routine that makes me look like thor';
  await say(page, text);
  const bubble = entry(page, 0).getByTestId('coach-routine');
  await expect(bubble).toHaveCount(1);
  await expect(entry(page, 0).getByTestId('coach-read')).toHaveText('Read: nothing specific · full body by need');
  await expect(entry(page, 0).getByTestId('coach-not-read')).toHaveText('Not read: makes, look, thor');
  await expect(entry(page, 0).getByTestId('coach-read-assistant')).toBeVisible();
  await idle(page);
  const before = await rowNames(bubble);
  expect(before.length).toBeGreaterThan(0);
  expect(await modelLog(page)).toEqual(NO_CALLS);

  await entry(page, 0).getByTestId('coach-read-assistant').click();
  await expect(entry(page, 0).getByTestId('coach-read')).toHaveText('Read with assistant: biceps · 3 exercises');
  await expect(entry(page, 0).getByTestId('coach-not-read')).toHaveCount(0);
  const log = await modelLog(page);
  expect(log.generate).toHaveLength(1);
  expect(log.generate[0]).toContain(text);
  expect(log.streamed).toEqual([]);
  expect(log.counted).toEqual([]);
  // Only options came back: the exercises are the builder's, for the muscle the options named.
  const after = await rowNames(bubble);
  expect(after).toHaveLength(3);
  expect(await groupsOf(page, after)).toEqual(['biceps', 'biceps', 'biceps']);
});

// ---------------------------------------------------------------------------
// The smart rules, on the real path: the owner's own sessions, read from IndexedDB

/** An owner whose only vertical press and only side-delt exercise are the two a shoulder niggle rules out. */
function shoulderOwner(): Row[] {
  const gone = new Set([SEED_EXERCISE_IDS['DB Shoulder Press'], SEED_EXERCISE_IDS['Lateral Raise']] as string[]);
  return [
    ...SEED_EXERCISES.filter((e) => !gone.has(e.id)).map((e) => ({ ...e, createdAt: at(200) })),
    exercise('own-ohp', 'Overhead Press (Barbell)', { muscleGroup: 'shoulders', isCompound: true, defaultRestSec: 150, equipment: 'barbell' }),
    exercise('own-upright', 'Upright Row (Barbell)', { muscleGroup: 'shoulders', equipment: 'barbell' }),
  ];
}

const HURT: Row = { id: 'hurt', routineId: '', title: 'Upper (Push)', startedAt: at(3), endedAt: at(3), durationSec: 3000, niggles: [{ tag: 'shoulder', severity: 2 }] };

test.describe('a shoulder niggle three days ago', () => {
  test('control: with no niggle, the owner\'s upright row and barbell overhead press are in a 3D shoulders routine', async ({ page }) => {
    await fakeModel(page);
    await seedOwner(page, { exercises: shoulderOwner() });
    await openCoach(page);
    await say(page, 'give me a routine for 3d shoulders');
    await expect(page.getByTestId('coach-routine')).toHaveCount(1);
    const names = await rowNames(page);
    expect(names).toContain('Overhead Press (Barbell)');
    expect(names).toContain('Upright Row (Barbell)');
    // The same words that find nothing in the niggle test find both of them here.
    expect((await lookup(page, names)).filter(ruledOutByShoulder).map((k) => k.name).sort()).toEqual(['Overhead Press (Barbell)', 'Upright Row (Barbell)']);
    expect(await whyLines(entry(page, 0))).not.toContainEqual(expect.stringMatching(/niggle/i));
  });

  test('steers a 3D shoulders routine off the upright row and the barbell overhead press, and Why says so', async ({ page }) => {
    await fakeModel(page);
    await seedOwner(page, { exercises: shoulderOwner(), sessions: [HURT] });
    await openCoach(page);
    await say(page, 'give me a routine for 3d shoulders');
    await expect(page.getByTestId('coach-routine')).toHaveCount(1);
    await idle(page);

    const names = await rowNames(entry(page, 0));
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(new Set(names).size).toBe(names.length);
    // Each name looked up, in the owner's rows and the library file: none is an upright row, a barbell overhead press or a dip.
    for (const known of await lookup(page, names)) expect(ruledOutByShoulder(known), `${known.name} (${known.equipment})`).toBe(false);

    const lines = await whyLines(entry(page, 0));
    expect(lines).toContainEqual(expect.stringMatching(new RegExp(`^Shoulder niggle on ${dayWords(3)}: no upright row`)));
  });
});

const BENCH_RX = SEED_ROUTINE_EXERCISES.find((rx) => rx.exerciseId === SEED_EXERCISE_IDS['Bench Press (Barbell)'])!.id;

/**
 * Three finished sessions of the push day, the bench at 65 kg each time with the reps missed, and
 * the progression decision each one wrote: what the app itself records. `rules` are the three
 * decisions, oldest first, as [rule, from, to].
 */
function benchSessions(rules: [string, number, number][]): Owner {
  const sessions: Row[] = [];
  const setLogs: Row[] = [];
  const decisions: Row[] = [];
  rules.forEach(([rule, from, to], i) => {
    const daysAgo = 21 - 7 * i;
    const id = `push-${i}`;
    sessions.push({ id, routineId: SEED_ROUTINE_IDS['Upper (Push)'], title: 'Upper (Push)', startedAt: at(daysAgo), endedAt: at(daysAgo), durationSec: 3000 });
    [5, 5, 5, 4].forEach((reps, index) =>
      setLogs.push({ id: `${id}-${index}`, sessionId: id, routineExerciseId: BENCH_RX, exerciseId: SEED_EXERCISE_IDS['Bench Press (Barbell)'], index, type: 'working', weight: 65, reps, completedAt: at(daysAgo) }),
    );
    decisions.push({ id: `${id}-decision`, sessionId: id, routineExerciseId: BENCH_RX, fromWeight: from, toWeight: to, rule, accepted: true, decidedAt: at(daysAgo) });
  });
  return { sessions, setLogs, decisions };
}

const STALLED: [string, number, number][] = [['hold_missing_sets', 65, 65], ['hold_missing_sets', 65, 65], ['hold_missing_sets', 65, 65]];
const MOVING: [string, number, number][] = [['increase', 60, 62.5], ['increase', 62.5, 65], ['hold_missing_sets', 65, 65]];

test.describe('a bench press stalled for three sessions', () => {
  test('control: the same three sessions with the weight moving are not a stall, and a chest routine has the bench', async ({ page }) => {
    await fakeModel(page);
    await seedOwner(page, benchSessions(MOVING));
    await openCoach(page);
    await say(page, 'give me a chest routine');
    await expect(page.getByTestId('coach-routine')).toHaveCount(1);
    expect(await rowNames(page)).toContain('Bench Press (Barbell)');
    expect(await whyLines(entry(page, 0))).not.toContainEqual(expect.stringMatching(/stalled/));
  });

  test('is swapped for a variation in a chest routine, and Why names what took its place', async ({ page }) => {
    await fakeModel(page);
    await seedOwner(page, benchSessions(STALLED));
    await openCoach(page);
    await say(page, 'give me a chest routine');
    await expect(page.getByTestId('coach-routine')).toHaveCount(1);
    await idle(page);

    const names = await rowNames(entry(page, 0));
    expect(names.length).toBeGreaterThanOrEqual(4);
    expect(names).not.toContain('Bench Press (Barbell)');
    const lines = await whyLines(entry(page, 0));
    const swap = lines.map((l) => /^Bench Press \(Barbell\) stalled for 3 sessions: (.+) in its place$/.exec(l)).find((m) => m);
    expect(swap, lines.join('\n')).toBeTruthy();
    expect(names).toContain(swap![1]);
    // The model was never asked: the swap is the builder's.
    expect(await modelLog(page)).toEqual(NO_CALLS);
  });
});
