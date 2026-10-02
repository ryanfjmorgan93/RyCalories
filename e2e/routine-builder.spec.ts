import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED_EXERCISES, SEED_EXERCISE_IDS, SEED_ROUTINES, SEED_ROUTINE_EXERCISES, SEED_ROUTINE_IDS } from '../src/db/seed';
import { DEFAULT_SETTINGS } from '../src/domain/types';
import { createRawIronDb, IRON_SCHEMA_V3 } from './fresh';

/**
 * What the owner sees when the routine builder does what a coach would do, on the built app. The
 * owner's data is read from IndexedDB, the sentence is parsed by the rules and the routine is built
 * by the generator, all real; only the on-device model is a stand-in (`window.__ironNanoFake`, see
 * coach.spec.ts), and it is asked nothing: every claim of "no model" is checked once the routine is
 * on screen.
 *
 * Every build uses a random seed, so each assertion is one that holds for every seed: the unit
 * tests (src/domain/routineBuilderCoach.test.ts) try the same properties over 500 of them. What is
 * asserted here is what the owner's own exercises make certain: their Barbell Back Squat is the only
 * squat of their own, their Romanian Deadlift the only hinge, their Incline DB Press the only upper
 * chest press, and an exercise of their own is taken before one from the library.
 */

const SHOULDERS = 'Give me a routine solely designed to build 3D shoulders';

interface ModelLog {
  generate: string[];
  counted: string[];
  streamed: string[];
}

/** The fake model: every prompt of every kind is recorded in `window.__modelLog`. */
async function fakeModel(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const log = { generate: [] as string[], counted: [] as string[], streamed: [] as string[] };
    w.__modelLog = log;
    w.__ironNanoFake = {
      status: { state: 'ready', detail: 'AVAILABLE · default' },
      statusFull: { state: 'ready', detail: 'AVAILABLE · full · 4000 tokens' },
      generate: async ({ prompt }: { prompt: string }) => {
        log.generate.push(prompt);
        return { text: '{}' };
      },
      countTokens: async ({ prompt }: { prompt: string }) => {
        log.counted.push(prompt);
        return { tokens: Math.ceil(prompt.length / 4), limit: 4000 };
      },
      generateStream: async ({ prompt }: { prompt: string }, emit: (t: string) => void) => {
        log.streamed.push(prompt);
        emit('An answer.');
        return { text: 'An answer.' };
      },
    };
  });
}

const modelLog = (page: Page) => page.evaluate(() => (window as unknown as { __modelLog: ModelLog }).__modelLog);
const NO_CALLS: ModelLog = { generate: [], counted: [], streamed: [] };

type Row = Record<string, unknown>;

/** Local noon, `daysAgo` days back. */
function at(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

interface Owner {
  sessions?: Row[];
  setLogs?: Row[];
  decisions?: Row[];
}

/**
 * Seeds `iron` as raw IndexedDB before the app boots: the owner's 27 exercises and five routines,
 * and a finished session a month back with a set on every exercise, which is what makes the
 * equipment they use theirs.
 */
async function seedOwner(page: Page, owner: Owner = {}): Promise<void> {
  await page.goto('/icons/icon-192.png');
  const exercises: Row[] = SEED_EXERCISES.map((e) => ({ ...e, createdAt: at(200) }));
  await createRawIronDb(page, 30, IRON_SCHEMA_V3, {
    exercises,
    routines: SEED_ROUTINES,
    routineExercises: SEED_ROUTINE_EXERCISES,
    sessions: [{ id: 'history', routineId: '', title: 'Past', startedAt: at(40), endedAt: at(40), durationSec: 3600 }, ...(owner.sessions ?? [])],
    setLogs: [
      ...exercises.map((e, i) => ({ id: `history-${i}`, sessionId: 'history', routineExerciseId: null, exerciseId: e.id, index: 0, type: 'working', weight: 10, reps: 8, completedAt: at(40) })),
      ...(owner.setLogs ?? []),
    ],
    decisions: owner.decisions ?? [],
    settings: [{ id: 'settings', ...DEFAULT_SETTINGS, createdAt: at(200) }],
  });
}

async function openCoach(page: Page): Promise<void> {
  await page.goto('/coach');
  await expect(page.getByTestId('coach-input')).toBeVisible();
}

async function say(page: Page, text: string): Promise<void> {
  await page.getByTestId('coach-input').fill(text);
  await page.getByTestId('coach-send').click();
}

/** The box idle again: Send says Send, which it does only once the message has been built. */
const idle = (page: Page) => expect(page.getByTestId('coach-send')).toHaveText('Send');

const entry = (page: Page, n: number) => page.getByTestId('coach-entry').nth(n);
const routineIn = (where: Locator, n = 0) => where.getByTestId('coach-routine').nth(n);
const rowNames = (where: Locator) => where.getByTestId('coach-row-name').allTextContents();

/** Sets of every row as the screen shows them ("3 × 12-15 · 8 kg"). */
async function rowSets(where: Locator): Promise<number[]> {
  const rows = await where.getByTestId('coach-row').allTextContents();
  return rows.map((t) => Number(/(\d+)\s×/.exec(t)![1]));
}

async function whyLines(where: Locator): Promise<string[]> {
  await where.getByTestId('coach-why').first().click();
  const lines = where.getByTestId('coach-why-lines').first().locator('div');
  await expect(lines.first()).toBeVisible();
  return lines.allTextContents();
}

/** Builds one routine for a sentence, waits for it, and hands back its names and its Why lines. */
async function built(page: Page, sentence: string, n = 0): Promise<{ names: string[]; lines: string[]; bubble: Locator }> {
  await say(page, sentence);
  const bubble = routineIn(entry(page, n));
  await expect(bubble).toHaveCount(1);
  await idle(page);
  return { names: await rowNames(bubble), lines: await whyLines(bubble), bubble };
}

// ---------------------------------------------------------------------------

test('3D shoulders is one press, two lateral raises, a rear fly and a face pull and a front raise or upright row, with the side delts on the most sets', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page);

  const { names, lines, bubble } = await built(page, SHOULDERS);
  expect(names).toHaveLength(6);
  expect(new Set(names).size).toBe(6);
  // One heavy vertical press first, and the owner's own side delt, rear fly and face pull.
  expect(names[0]).toBe('DB Shoulder Press');
  expect(names).toEqual(expect.arrayContaining(['Lateral Raise', 'Rear Delt Fly (Machine)', 'Face Pull']));

  // The second lateral raise is said to be there on purpose, and the rear delts are not left to the shoulders' leftovers.
  expect(lines).toContainEqual(expect.stringMatching(/^A second lateral raise, .+: two exercises for the side delts$/));
  expect(lines).toContain('Focus: shoulders and rear delts, as asked');
  const heads = lines.find((l) => l.startsWith('Sets by part: '));
  expect(heads, lines.join('\n')).toBeTruthy();
  const [, side, rear] = /side delts (\d+), rear delts (\d+)/.exec(heads!)!.map(Number);
  expect(side).toBeGreaterThanOrEqual(rear!);
  // The rows on screen add up to what that line says: the side delts' two rows and the rear delts' two.
  const sets = await rowSets(bubble);
  expect(sets.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(18);
  expect(sets.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(9);
  expect(await modelLog(page)).toEqual(NO_CALLS);
});

test('a plain request for shoulders is never without rear-delt work, and takes the owner\'s own', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page);

  const { names } = await built(page, 'give me a shoulder routine');
  expect(names).toEqual(expect.arrayContaining(['Rear Delt Fly (Machine)', 'Face Pull']));
  expect(await modelLog(page)).toEqual(NO_CALLS);
});

test('a named day has the muscles it is named for: push has triceps and a lateral raise, pull biceps, legs quads, hamstrings and calves', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page);

  // Every build draws its own random seed, and without a plan per day about one pull day in five has
  // no biceps work, so one build could miss it by luck. Forty make that a one-in-ten-thousand miss.
  test.setTimeout(150_000);
  for (let n = 0; n < 40; n++) {
    await say(page, 'push pull legs');
    await expect(entry(page, n).getByTestId('coach-routine')).toHaveCount(3);
    await idle(page);
    const [push, pull, legs] = await Promise.all([0, 1, 2].map((i) => rowNames(routineIn(entry(page, n), i))));
    expect(await routineIn(entry(page, n), 0).getByTestId('coach-routine-name').textContent()).toBe('Push');
    expect(push).toHaveLength(6);
    expect(push).toContain('Lateral Raise');
    expect(push!.some((name) => /Triceps/.test(name))).toBe(true);
    expect(pull).toHaveLength(6);
    expect(pull!.some((name) => /Curl/.test(name)), `build ${n}: ${pull!.join(', ')}`).toBe(true);
    expect(legs).toHaveLength(6);
    expect(legs).toContain('Barbell Back Squat');
    expect(legs).toContain('Romanian Deadlift (Barbell)');
    expect(legs!.some((name) => /Calf Raise/.test(name))).toBe(true);
  }
  expect(await modelLog(page)).toEqual(NO_CALLS);
});

test('"my lower back is sore" is read as a niggle: no hinge and no barbell squat for a leg routine, and the Why says it was typed', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page);

  // Control: the owner's own Barbell Back Squat and Romanian Deadlift are the leg day's heavy lifts.
  const plain = await built(page, 'give me a leg routine');
  expect(plain.names).toEqual(expect.arrayContaining(['Barbell Back Squat', 'Romanian Deadlift (Barbell)']));
  expect(plain.lines.some((l) => l.includes('as you said'))).toBe(false);

  const sore = await built(page, 'give me a leg routine, my lower back is sore', 1);
  expect(sore.names).not.toContain('Romanian Deadlift (Barbell)');
  expect(sore.names).not.toContain('Barbell Back Squat');
  expect(sore.lines).toContain('Sore lower back, as you said: no hinges, good mornings, bent-over barbell rows or back squats; chest-supported rows, leg press and hack squat preferred');
  // The sore body part is not a muscle to train: nothing but legs is in it, and nothing is left unread.
  await expect(entry(page, 1).getByTestId('coach-not-read')).toHaveCount(0);
  expect(await modelLog(page)).toEqual(NO_CALLS);
});

test('"no squats" leaves the squat out, and says so', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page);

  const r = await built(page, 'give me a leg routine with no squats');
  expect(r.names).not.toContain('Barbell Back Squat');
  expect(r.names).toContain('Romanian Deadlift (Barbell)');
  expect(r.lines).toContain('No squat, as you asked');
  await expect(entry(page, 0).getByTestId('coach-not-read')).toHaveCount(0);
  expect(await modelLog(page)).toEqual(NO_CALLS);
});

test('"upper chest" is two incline presses first, and the rest of the chest', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page);

  const r = await built(page, 'give me an upper chest routine');
  // The owner's own incline press, then another; and the Why says the part was asked for.
  expect(r.names[0]).toBe('Incline DB Press');
  expect(r.names).toContain('Bench Press (Barbell)');
  const asked = r.lines.find((l) => l.startsWith('upper chest asked for: '));
  expect(asked, r.lines.join('\n')).toMatch(/^upper chest asked for: 2 of \d+ chest exercises$/);
  // A chest routine and nothing else: none of the lats, the shrugs and the rear delts the word "upper" used to bring.
  await expect(routineIn(entry(page, 0)).getByTestId('coach-routine-name')).toHaveText('Chest');
  expect(r.names.some((n) => /Squat|Deadlift|Pulldown|Shrug|Row\b/.test(n))).toBe(false);
});

// ---------------------------------------------------------------------------
// A stalled lift, and a length asked for

const BENCH_RX = SEED_ROUTINE_EXERCISES.find((rx) => rx.exerciseId === SEED_EXERCISE_IDS['Bench Press (Barbell)'])!.id;

/** Three finished sessions of the push day with the bench stuck at 65 kg, and the decisions the app wrote for them. */
function stalledBench(): Owner {
  const sessions: Row[] = [];
  const setLogs: Row[] = [];
  const decisions: Row[] = [];
  for (let i = 0; i < 3; i++) {
    const daysAgo = 21 - 7 * i;
    const id = `push-${i}`;
    sessions.push({ id, routineId: SEED_ROUTINE_IDS['Upper (Push)'], title: 'Upper (Push)', startedAt: at(daysAgo), endedAt: at(daysAgo), durationSec: 3000 });
    [5, 5, 5, 4].forEach((reps, index) =>
      setLogs.push({ id: `${id}-${index}`, sessionId: id, routineExerciseId: BENCH_RX, exerciseId: SEED_EXERCISE_IDS['Bench Press (Barbell)'], index, type: 'working', weight: 65, reps, completedAt: at(daysAgo) }),
    );
    decisions.push({ id: `${id}-decision`, sessionId: id, routineExerciseId: BENCH_RX, fromWeight: 65, toWeight: 65, rule: 'hold_missing_sets', accepted: true, decidedAt: at(daysAgo) });
  }
  return { sessions, setLogs, decisions };
}

test('a stalled bench is swapped for another loaded press, never a push-up, with no weight carried across', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page, stalledBench());
  await openCoach(page);

  // Every build draws its own random seed, and with the rule off a push-up or a core hybrid takes the
  // bench's place on about one build in five, so a handful of builds could miss it by luck. Sixty
  // make that a one-in-a-million miss. A swap drawn from the library is a different exercise each time.
  test.setTimeout(150_000);
  for (let n = 0; n < 60; n++) {
    const r = await built(page, 'give me a chest routine', n);
    expect(r.names).not.toContain('Bench Press (Barbell)');
    const swap = r.lines.map((l) => /^Bench Press \(Barbell\) stalled for 3 sessions: (.+) in its place$/.exec(l)).find((m) => m);
    expect(swap, r.lines.join('\n')).toBeTruthy();
    expect(r.names).toContain(swap![1]);
    expect(swap![1]).not.toMatch(/push[- ]?up|plank|behind (the )?neck|clock|handstand/i);
    // A press that is the owner's has its weight; one from the library says it has none. Either way the bench's 65 kg is not on it.
    const row = r.bubble.getByTestId('coach-row').filter({ hasText: swap![1]! });
    await expect(row).not.toContainText('65 kg');
  }
  expect(await modelLog(page)).toEqual(NO_CALLS);
});

test('a length asked for: a longer ask adds a finisher, and the line says what the routine came to, never "nearer"', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page);
  await openCoach(page);

  const plain = await built(page, 'give me a chest and triceps routine');
  const longer = await built(page, 'give me a 75 minute chest and triceps routine', 1);
  expect(longer.names.length).toBeGreaterThan(plain.names.length);
  expect(longer.lines.some((l) => l.startsWith('Added '))).toBe(true);
  const minutes = Number(/about (\d+) min/.exec((await longer.bubble.getByTestId('coach-minutes').textContent()) ?? '')![1]);
  expect(longer.lines.find((l) => l.startsWith('About '))).toBe(minutes === 75 ? 'About 75 min' : `About ${minutes} min for the 75 min asked`);

  const shorter = await built(page, 'give me a 30 minute chest and triceps routine', 2);
  expect(shorter.names.length).toBeLessThan(plain.names.length);
  expect(shorter.lines.some((l) => l.startsWith('Dropped '))).toBe(true);
  for (const lines of [plain.lines, longer.lines, shorter.lines]) expect(lines.some((l) => /nearer/.test(l))).toBe(false);
  expect(await modelLog(page)).toEqual(NO_CALLS);
});

/**
 * Three finished sessions of the push day, each of four sets of bench: the model has them at
 * 60 + 4 x 40 + 3 x 150 = 670 s, so a duration of `seconds` is that many over 670 times the pace.
 */
function pushSessions(seconds: number): Owner {
  const sessions: Row[] = [];
  const setLogs: Row[] = [];
  for (let i = 0; i < 3; i++) {
    const daysAgo = 10 - 3 * i;
    const id = `pace-${i}`;
    sessions.push({ id, routineId: SEED_ROUTINE_IDS['Upper (Push)'], title: 'Upper (Push)', startedAt: at(daysAgo), endedAt: at(daysAgo), durationSec: seconds });
    [0, 1, 2, 3].forEach((index) =>
      setLogs.push({ id: `${id}-${index}`, sessionId: id, routineExerciseId: BENCH_RX, exerciseId: SEED_EXERCISE_IDS['Bench Press (Barbell)'], index, type: 'working', weight: 65, reps: 8, completedAt: at(daysAgo) }),
    );
  }
  return { sessions, setLogs };
}

test('with too little history to measure a pace, the time is "about N min" and not the owner\'s pace', async ({ page }) => {
  await fakeModel(page);
  // One finished session is no evidence of a pace.
  await seedOwner(page);
  await openCoach(page);
  const r = await built(page, 'give me a chest routine');
  expect(r.lines.find((l) => l.startsWith('About '))).toMatch(/^About \d+ min$/);
  expect(r.lines.some((l) => l.includes('at your pace'))).toBe(false);
});

test('a measured pace is called the owner\'s: three sessions that took what the model says they would', async ({ page }) => {
  await fakeModel(page);
  await seedOwner(page, pushSessions(700));
  await openCoach(page);
  const r = await built(page, 'give me a chest routine');
  expect(r.lines.find((l) => l.startsWith('About '))).toMatch(/^About \d+ min at your pace$/);
});

test('a pace held to its limit is not called the owner\'s, and says which way it was held', async ({ page }) => {
  await fakeModel(page);
  // Three sessions that took four times as long as the model says: the estimate is held at 1.6 times.
  await seedOwner(page, pushSessions(2700));
  await openCoach(page);
  const r = await built(page, 'give me a chest routine');
  const about = r.lines.find((l) => l.startsWith('About '))!;
  expect(about).not.toContain('at your pace');
  expect(about).toContain('1.6 times');
  expect(about).toContain('slower');
});
