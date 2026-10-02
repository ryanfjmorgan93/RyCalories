import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEED_EXERCISES, SEED_EXERCISE_IDS, SEED_ROUTINES, SEED_ROUTINE_EXERCISES, SEED_ROUTINE_IDS } from '../src/db/seed';
import { DEFAULT_SETTINGS } from '../src/domain/types';
import { createRawIronDb, IRON_SCHEMA_V3, readRawIron } from './fresh';

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

/** The fake default and full models: every prompt of every kind is recorded in `window.__modelLog`. */
async function fakeModel(page: Page, opts: { reply?: string[]; intent?: string } = {}): Promise<void> {
  await page.addInitScript(
    (c: { reply: string[]; intent: string }) => {
      const w = window as unknown as Record<string, unknown>;
      const log = { generate: [] as string[], counted: [] as string[], streamed: [] as string[] };
      w.__modelLog = log;
      w.__ironNanoFake = {
        status: { state: 'ready', detail: 'AVAILABLE · default' },
        statusFull: { state: 'ready', detail: 'AVAILABLE · nano-v4-full · 4000 tokens · samsung SM-F971B' },
        generate: async ({ prompt }: { prompt: string }) => {
          log.generate.push(prompt);
          return { text: c.intent };
        },
        countTokens: async ({ prompt }: { prompt: string }) => {
          log.counted.push(prompt);
          return { tokens: Math.ceil(prompt.length / 4), limit: 4000 };
        },
        generateStream: async ({ prompt }: { prompt: string }, emit: (t: string) => void) => {
          log.streamed.push(prompt);
          for (const piece of c.reply) emit(piece);
          return { text: c.reply.join('') };
        },
      };
    },
    { reply: opts.reply ?? REPLY, intent: opts.intent ?? '{}' },
  );
}

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

const library = new Map(
  (JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/exerciseCatalogue.json', import.meta.url)), 'utf8')) as { name: string; muscleGroup: string; equipment: string }[]).map((e) => [
    e.name,
    { name: e.name, group: e.muscleGroup, equipment: e.equipment } satisfies Known,
  ]),
);

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
    const rows = entry(page, 2).getByTestId('coach-row');
    for (let i = 0; i < shuffled.length; i++) {
      if ((await rows.nth(i).getByTestId('coach-new').count()) > 0) continue;
      await expect(review.getByTestId('paste-row-name').nth(i)).toHaveText(shuffled[i]!);
    }
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
    const { tables } = await readRawIron(page);
    const exercises = tables.exercises as { id: string; name: string }[];
    const nameOf = new Map(exercises.map((e) => [e.id, e.name]));
    const rx = tables.routineExercises as { routineId: string; exerciseId: string; order: number }[];
    const routines = (tables.routines as { id: string; name: string }[]).map((r) => ({
      name: r.name,
      rows: rx.filter((x) => x.routineId === r.id).sort((a, b) => a.order - b.order).map((x) => nameOf.get(x.exerciseId)),
    }));
    return { exercises, routines };
  };

  // Chest first, from under the second bubble; then the shoulders; then the shoulders again.
  const saves: [number, string, string[]][] = [
    [1, 'Chest', chest],
    [0, 'Shoulders and rear delts', shoulders],
    [0, 'Shoulders and rear delts', shoulders],
  ];
  for (const [i, [which, name, names]] of saves.entries()) {
    await entry(page, which).getByTestId('coach-review').click();
    const review = page.getByRole('dialog').filter({ hasText: 'Review routine' });
    await expect(review.getByTestId('paste-row')).toHaveCount(names.length);
    await expect(review.getByTestId('paste-row-name')).toHaveText(names);
    // An exercise the owner has now is matched as theirs: the third time, every row is.
    if (i === 2) await expect(review.getByTestId('paste-change')).toHaveCount(names.length);
    while ((await review.getByTestId('paste-add-new').count()) > 0) await review.getByTestId('paste-add-new').first().click();
    await review.getByTestId('paste-save').click();
    await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/);

    const { exercises, routines } = await saved();
    expect(routines.filter((r) => r.name === name).map((r) => r.rows)).toEqual(Array.from({ length: routines.filter((r) => r.name === name).length }, () => names));
    expect(routines).toHaveLength(i + 1);
    // The owner's four and one row for each library exercise held by any routine saved, however many hold it.
    const held = new Set(saves.slice(0, i + 1).flatMap(([, , n]) => n));
    expect(exercises).toHaveLength(4 + held.size);
    expect(new Set(exercises.map((e) => e.name.toLowerCase())).size).toBe(exercises.length);
    await page.goBack();
    await expect(page.getByTestId('coach-routine')).toHaveCount(2);
  }
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
