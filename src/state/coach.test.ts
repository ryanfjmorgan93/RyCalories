import { afterEach, describe, expect, it, vi } from 'vitest';
import { seededInput } from '../test/routineFixtures';
import type { CoachTurn } from '../domain/coach';
import { builtTurn } from '../domain/coachBuild';
import { parseQuickRequest } from '../domain/quickRequest';
import { routineToText, type RoutineInput } from '../domain/routineBuilder';
import {
  ASK_TIMEOUT_MS,
  COULD_NOT_READ,
  createCoachStore,
  lastWasRoutine,
  NO_BACKEND_REPLY,
  routeOf,
  subjectOf,
  type BuildEntry,
  type CoachBackend,
} from './coach';

/** The owner's own 27 exercises and the real library, as the builder reads them. */
const BUILD_INPUT: RoutineInput = seededInput({ recency: { shoulders: 6, 'rear delts': 6 } });

const SHOULDERS = 'Give me a routine solely designed to build 3D shoulders';

/** A backend that answers every question with `reply` (or fails with `fail`), and records what it was asked. */
function fakeBackend(opts: { reply?: string; fail?: unknown } = {}) {
  const asked: { question: string; thread: CoachTurn[] }[] = [];
  const backend: CoachBackend = {
    ask: async (question, thread) => {
      asked.push({ question, thread: [...thread] });
      if (opts.fail) throw opts.fail;
      return opts.reply ?? 'Your bench went 82.5 → 85 kg.';
    },
  };
  return { backend, asked };
}

/** A store on a fake backend (or none), the real builder over real data, and seeds that count up from 100. */
function setup(opts: { reply?: string; fail?: unknown; backend?: boolean } = {}, input: RoutineInput = BUILD_INPUT) {
  const fake = fakeBackend(opts);
  const loads = { build: 0 };
  let seed = 100;
  const store = createCoachStore({
    backend: opts.backend === false ? undefined : fake.backend,
    loadBuildInput: async () => (loads.build++, input),
    newSeed: () => ++seed,
  });
  return { store, ...fake, loads };
}

const builds = (store: ReturnType<typeof createCoachStore>): BuildEntry[] => store.getState().entries.filter((e): e is BuildEntry => e.mode === 'build');
const namesOf = (e: BuildEntry): string[] => e.routines.flatMap((r) => r.rows.map((x) => x.name));

describe('coach store: asking', () => {
  it('keeps the answer with the question, and is pending while it is coming', async () => {
    const { store, asked } = setup();
    const seen: unknown[] = [];
    const unsub = store.subscribe((s) => {
      if (s.pending) seen.push(s.pending);
    });
    expect(await store.getState().ask('Why has my bench stalled?')).toBe('sent');
    unsub();
    expect(seen).toEqual([{ mode: 'ask', question: 'Why has my bench stalled?' }]);
    expect(asked).toEqual([{ question: 'Why has my bench stalled?', thread: [] }]);
    const [entry] = store.getState().entries;
    expect(entry).toMatchObject({ mode: 'ask', question: 'Why has my bench stalled?', answer: 'Your bench went 82.5 → 85 kg.' });
    expect(store.getState()).toMatchObject({ pending: null, error: null });
  });

  it('carries the last exchange into the next question', async () => {
    const { store, asked } = setup({ reply: 'Fine.' });
    await store.getState().ask('How was last week?');
    await store.getState().ask('And the week before?');
    expect(asked[1]).toEqual({
      question: 'And the week before?',
      thread: [
        { role: 'user', text: 'How was last week?' },
        { role: 'coach', text: 'Fine.' },
      ],
    });
  });

  it("shows the backend's own reason when it fails, or a plain line when it gives none", async () => {
    const own = setup({ fail: new Error('Claude is busy.') });
    await own.store.getState().ask('How was last week?');
    expect(own.store.getState().error).toBe('Claude is busy.');
    expect(own.store.getState().pending).toBeNull();
    expect(own.store.getState().entries).toEqual([]);

    const none = setup({ fail: 'boom' });
    await none.store.getState().ask('How was last week?');
    expect(none.store.getState().error).toBe('Could not answer.');
  });

  it('an empty answer is an error, and keeps nothing', async () => {
    const { store } = setup({ reply: '   ' });
    expect(await store.getState().ask('How was last week?')).toBe('error');
    expect(store.getState()).toMatchObject({ entries: [], pending: null, error: 'The model did not answer.' });
  });

  it('asks nothing while an answer is still coming', async () => {
    const { store, asked } = setup();
    const first = store.getState().ask('one');
    expect(await store.getState().ask('two')).toBe('ignored');
    await first;
    expect(asked).toHaveLength(1);
  });

  it('with no backend plugged in, a question is answered with one plain line, and nothing is pending', async () => {
    const { store } = setup({ backend: false });
    expect(await store.getState().send('Why has my bench stalled?')).toBe('sent');
    expect(store.getState().entries).toEqual([expect.objectContaining({ mode: 'ask', question: 'Why has my bench stalled?', answer: NO_BACKEND_REPLY })]);
    expect(NO_BACKEND_REPLY).toBe("Questions go to Claude, which isn't set up yet.");
    expect(store.getState()).toMatchObject({ pending: null, error: null });
  });

  it('building and changing a routine need no backend', async () => {
    const { store } = setup({ backend: false });
    expect(await store.getState().send(SHOULDERS)).toBe('sent');
    expect(await store.getState().send('add biceps')).toBe('sent');
    expect(store.getState().entries.map((e) => e.mode)).toEqual(['build', 'build']);
  });
});

describe('coach store: building', () => {
  it('a request for a routine is built at once with no call to a backend', async () => {
    const { store, asked, loads } = setup();
    await store.getState().send(SHOULDERS);
    expect(asked).toEqual([]);
    expect(loads.build).toBe(1);
    expect(store.getState()).toMatchObject({ pending: null, error: null });
    const [entry] = builds(store);
    expect(entry).toMatchObject({ mode: 'build', question: SHOULDERS, unread: [], seed: 101, request: { focus: ['shoulders', 'rear delts'] } });
    expect(entry!.routines).toHaveLength(1);
  });

  it('the routine has distinct exercises across both muscle groups, and the line says what was read', async () => {
    const { store } = setup();
    await store.getState().send(SHOULDERS);
    const [entry] = builds(store);
    const rows = entry!.routines[0]!.rows;
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.name)).size).toBe(6);
    expect(new Set(rows.map((r) => r.muscleGroup))).toEqual(new Set(['shoulders', 'rear delts']));
    expect(entry!.read).toBe('shoulders, rear delts · 6 exercises');
    expect(entry!.routines[0]!.reasonLines.length).toBeGreaterThan(0);
  });

  it('the seed comes from the edge: the same seed gives the same routine, another seed another', async () => {
    const a = setup();
    const b = setup();
    await a.store.getState().send(SHOULDERS);
    await b.store.getState().send(SHOULDERS);
    expect(namesOf(builds(a.store)[0]!)).toEqual(namesOf(builds(b.store)[0]!));
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const c = createCoachStore({ backend: a.backend, loadBuildInput: async () => BUILD_INPUT, newSeed: () => 7 + i });
      await c.getState().send(SHOULDERS);
      seen.add(namesOf(builds(c)[0]!).join('|'));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('a message the first of a deep link, even one that reads like a question, is a build', async () => {
    const { store, asked } = setup();
    expect(routeOf('Why is my chest weak?', [], false)).toBe('ask');
    expect(routeOf('Why is my chest weak?', [], true)).toBe('build');
    await store.getState().send('Why is my chest weak?', { build: true });
    expect(builds(store)).toHaveLength(1);
    expect(builds(store)[0]!.request.focus).toEqual(['chest']);
    expect(asked).toEqual([]);
    // The next one is routed as usual.
    await store.getState().send('Why is my chest weak?');
    expect(store.getState().entries.map((e) => e.mode)).toEqual(['build', 'ask']);
  });

  it('a request with nothing in it builds by need, says so, and says which words were not read', async () => {
    const { store } = setup();
    const text = 'give me a routine that makes me look like thor';
    await store.getState().send(text);
    const residue = parseQuickRequest(text).residue;
    expect(residue.length).toBeGreaterThan(0);
    const [entry] = builds(store);
    expect(entry!.read).toBe('nothing specific · full body by need');
    expect(entry!.unread).toEqual(residue);
    expect(entry!.routines[0]!.name).toBe('Full body');
    expect(entry!.routines[0]!.rows.length).toBeGreaterThan(0);
  });

  it('a request the rules read leaves nothing unread, however many words are left over', async () => {
    const { store } = setup();
    // "doesn't" and "matter" are not read, and "3d shoulders" is: the rules have what they need.
    const text = "Doesn't matter, I want 3d shoulders";
    expect(parseQuickRequest(text).residue.length).toBeGreaterThan(0);
    await store.getState().send(text);
    expect(builds(store)[0]!.unread).toEqual([]);
  });

  it('a split is one routine a day, and the line names them', async () => {
    const { store } = setup();
    await store.getState().send('give me a push pull legs routine');
    const [entry] = builds(store);
    expect(entry!.routines.map((r) => r.name)).toEqual(['Push', 'Pull', 'Legs']);
    expect(entry!.read).toMatch(/^push, pull, legs · 3 routines · \d+ exercises$/);
  });

  it('a loader that fails leaves an error, no entry, and nothing pending', async () => {
    const store = createCoachStore({ backend: fakeBackend().backend, loadBuildInput: async () => Promise.reject(new Error('no db')) });
    await store.getState().send(SHOULDERS);
    expect(store.getState()).toMatchObject({ entries: [], pending: null, error: COULD_NOT_READ });
  });

  it('builds nothing twice at once', async () => {
    const { store, loads } = setup();
    await Promise.all([store.getState().send(SHOULDERS), store.getState().send(SHOULDERS)]);
    expect(builds(store)).toHaveLength(1);
    expect(loads.build).toBe(1);
  });
});

describe('coach store: the conversation', () => {
  it("the owner's screenshots: a routine, why, then the same ask again", async () => {
    const { store, asked } = setup({ reply: 'Each part of the shoulder has an exercise.' });

    await store.getState().send(SHOULDERS);
    expect(asked).toEqual([]);
    expect(lastWasRoutine(store.getState().entries)).toBe(true);

    await store.getState().send('Why have you chosen this?');
    // One call, and not another routine; the routine built stands as the coach's turn in the conversation it is told.
    expect(asked).toHaveLength(1);
    expect(store.getState().entries.map((e) => e.mode)).toEqual(['build', 'ask']);
    expect(asked[0]).toEqual({
      question: 'Why have you chosen this?',
      thread: [
        { role: 'user', text: SHOULDERS },
        { role: 'coach', text: 'Routine built: Shoulders and rear delts' },
      ],
    });

    await store.getState().send("Doesn't matter, I want 3d shoulders");
    expect(asked).toHaveLength(1);
    expect(store.getState().entries.map((e) => e.mode)).toEqual(['build', 'ask', 'build']);
    expect(builds(store)[1]!.request.focus).toEqual(['shoulders', 'rear delts']);
  });

  it('a question is told every exchange so far, builds among them, in order', async () => {
    const { store, asked } = setup({ reply: 'Fine.' });
    await store.getState().send('Question one?');
    await store.getState().send(SHOULDERS);
    await store.getState().send('Question three?');
    const thread = asked[asked.length - 1]!.thread;
    expect(thread.map((t) => `${t.role}: ${t.text}`)).toEqual([
      'user: Question one?',
      'coach: Fine.',
      `user: ${SHOULDERS}`,
      'coach: Routine built: Shoulders and rear delts',
    ]);
  });
});

describe('coach store: shuffle', () => {
  it('Shuffle builds the same request again with a new seed, in place, with no call to a backend', async () => {
    const { store, asked } = setup();
    await store.getState().send(SHOULDERS);
    await store.getState().send('Why have you chosen this?');
    await store.getState().send('give me a chest routine');
    const [shoulders, chest] = builds(store);
    const entriesBefore = store.getState().entries;
    const calls = asked.length;

    await store.getState().shuffle(shoulders!.id);

    const after = builds(store);
    expect(store.getState().entries.map((e) => e.id)).toEqual(entriesBefore.map((e) => e.id));
    expect(after[0]!.seed).not.toBe(shoulders!.seed);
    expect(after[0]!.request).toEqual(shoulders!.request);
    expect(routineToText(after[0]!.routines)).not.toBe(routineToText(shoulders!.routines));
    expect(after[0]!.read).toBe('shoulders, rear delts · 6 exercises');
    // The other build, and the answer between them, are as they were.
    expect(after[1]).toEqual(chest);
    expect(store.getState().entries[1]).toEqual(entriesBefore[1]);
    expect(asked).toHaveLength(calls);
    expect(store.getState().working).toBeNull();
    // What a question is now told is the routine on screen, not the one it replaced.
    await store.getState().send('Why?');
    expect(asked[asked.length - 1]!.thread[1]).toEqual({ role: 'coach', text: builtTurn(after[0]!.routines, after[0]!.edit) });
  });

  it('Shuffle gives another routine each time it can, and the same one only where there is no other', async () => {
    const { store } = setup();
    await store.getState().send(SHOULDERS);
    const id = builds(store)[0]!.id;
    let before = routineToText(builds(store)[0]!.routines);
    for (let i = 0; i < 5; i++) {
      await store.getState().shuffle(id);
      const now = routineToText(builds(store)[0]!.routines);
      expect(now).not.toBe(before);
      before = now;
    }
  });

  it('Shuffle of an entry that is not a build, or one that is gone, does nothing', async () => {
    const { store, loads } = setup();
    await store.getState().send('How was last week?');
    const ask = store.getState().entries[0]!;
    await store.getState().shuffle(ask.id);
    await store.getState().shuffle(999);
    expect(loads.build).toBe(0);
    expect(store.getState().entries).toEqual([ask]);
  });
});

describe('coach store: routing', () => {
  const routine = (store: ReturnType<typeof setup>['store']) => store.getState().entries;
  it('knows when a routine is the subject: the latest build has exercises, and no one has cleared the conversation', async () => {
    const { store } = setup();
    expect(lastWasRoutine(routine(store))).toBe(false);
    await store.getState().send('give me a chest routine');
    expect(lastWasRoutine(routine(store))).toBe(true);
    // "more rear delts" changes a routine after one, and is a question before one. (Was 'build' before edits.)
    expect(routeOf('more rear delts', routine(store))).toBe('edit');
    expect(routeOf('more rear delts', [])).toBe('ask');
    // A question about the routine does not end it as the subject: finding 6. (This was `false` here.)
    await store.getState().send('Why?');
    expect(lastWasRoutine(routine(store))).toBe(true);
    expect(routeOf('add biceps', routine(store))).toBe('edit');
    store.getState().reset();
    expect(lastWasRoutine(routine(store))).toBe(false);
  });

  it('the follow-up reads the same after a question as straight after the build: build, why, then a change, in the owner\'s own order', async () => {
    const { store, asked } = setup({ reply: 'Fine.' });
    await store.getState().send(SHOULDERS);
    for (const text of ['add biceps', 'more rear delts', 'give me another one', 'make it shorter']) {
      const straight = routeOf(text, store.getState().entries);
      await store.getState().send('Why have you chosen this?');
      expect(store.getState().entries[store.getState().entries.length - 1]!.mode, text).toBe('ask');
      expect(routeOf(text, store.getState().entries), text).toBe(straight);
      expect(straight, text).toBe('edit');
    }
    expect(asked.length).toBe(4);
    const before = store.getState().entries.length;
    await store.getState().send('add biceps');
    expect(store.getState().entries).toHaveLength(before + 1);
    expect(store.getState().entries[before]!.mode).toBe('build');
    // The change was made by the app: the four questions are the only calls the backend had.
    expect(asked.length).toBe(4);
  });

  it('an empty build does not take the routine from one that is still on screen', async () => {
    let loads = 0;
    const store = createCoachStore({
      backend: fakeBackend().backend,
      // The second routine asked for has nothing to be made of.
      loadBuildInput: async () => (loads++ === 0 ? BUILD_INPUT : { ...BUILD_INPUT, candidates: [] }),
      newSeed: () => 5,
    });
    await store.getState().send(SHOULDERS);
    const first = builds(store)[0]!;
    await store.getState().send('give me a chest routine');
    expect(builds(store)[1]!.routines[0]!.rows).toEqual([]);
    expect(lastWasRoutine(store.getState().entries)).toBe(false);
    expect(subjectOf(store.getState().entries)).toBe(first);
  });
});

describe('coach store: a backend that goes quiet, and Clear', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const storeOn = (backend: CoachBackend, loadBuildInput: () => Promise<RoutineInput> = async () => BUILD_INPUT) => createCoachStore({ backend, loadBuildInput });
  const never: CoachBackend = { ask: () => new Promise(() => undefined) };

  it('an answer that never comes is given up after a while, keeping nothing', async () => {
    vi.useFakeTimers();
    const store = storeOn(never);
    const asked = store.getState().ask('How was last week?');
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS - 1);
    expect(store.getState().pending).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await asked;
    expect(store.getState()).toMatchObject({ pending: null, error: 'The model did not answer.', entries: [] });
  });

  it('Clear while an answer is coming drops it: nothing reappears when it finishes', async () => {
    let finish: (text: string) => void = () => undefined;
    const store = storeOn({ ask: () => new Promise((resolve) => (finish = resolve)) });
    const asked = store.getState().ask('How was last week?');
    await vi.waitFor(() => expect(store.getState().pending?.mode).toBe('ask'));
    store.getState().reset();
    expect(store.getState().pending).toBeNull();
    finish('An answer.');
    await asked;
    expect(store.getState()).toMatchObject({ pending: null, entries: [], error: null });
  });

  it('Clear empties the conversation, builds and answers alike, and the next question carries nothing from before', async () => {
    const { store, asked } = setup({ reply: 'Fine.' });
    await store.getState().send(SHOULDERS);
    await store.getState().send('How was last week?');
    expect(store.getState().entries).toHaveLength(2);
    store.getState().reset();
    expect(store.getState()).toMatchObject({ entries: [], pending: null, working: null, error: null });
    expect(lastWasRoutine(store.getState().entries)).toBe(false);
    await store.getState().send('And the week before?');
    expect(asked[asked.length - 1]).toEqual({ question: 'And the week before?', thread: [] });
  });

  it('Clear while a routine is being built drops it: nothing reappears when it finishes', async () => {
    let release: (input: RoutineInput) => void = () => undefined;
    const store = storeOn(never, () => new Promise<RoutineInput>((resolve) => (release = resolve)));
    const building = store.getState().send(SHOULDERS);
    await vi.waitFor(() => expect(store.getState().pending?.mode).toBe('build'));
    store.getState().reset();
    release(BUILD_INPUT);
    await building;
    expect(store.getState()).toMatchObject({ entries: [], pending: null, error: null });
  });

  it('Clear while a routine is being shuffled drops the shuffle', async () => {
    const calls = { n: 0 };
    let release: (input: RoutineInput) => void = () => undefined;
    const store = storeOn(never, () => {
      if (calls.n++ === 0) return Promise.resolve(BUILD_INPUT);
      return new Promise<RoutineInput>((resolve) => (release = resolve));
    });
    await store.getState().send(SHOULDERS);
    const id = builds(store)[0]!.id;
    const shuffling = store.getState().shuffle(id);
    await vi.waitFor(() => expect(store.getState().working).toBe(id));
    store.getState().reset();
    release(BUILD_INPUT);
    await shuffling;
    expect(store.getState()).toMatchObject({ entries: [], working: null });
  });
});

// ---------------------------------------------------------------------------
// Findings: a follow-up changes THE routine, and the conversation is robust

describe('coach store: a change asked for after a routine changes that routine (finding 1)', () => {
  it('"add biceps" after the 3D shoulders routine is that routine with biceps, kept exercises and all, and no call to a backend', async () => {
    const { store, asked } = setup();
    await store.getState().send(SHOULDERS);
    const first = builds(store)[0]!;
    await store.getState().send('add biceps');
    const second = builds(store)[1]!;
    expect(store.getState().entries.map((e) => e.mode)).toEqual(['build', 'build']);
    expect(second.question).toBe('add biceps');
    expect(second.request.focus).toEqual(['shoulders', 'rear delts', 'biceps']);
    expect(second.read).toBe('shoulders, rear delts, biceps · 8 exercises');
    for (const name of namesOf(first)) expect(namesOf(second)).toContain(name);
    expect(second.routines[0]!.rows.filter((r) => r.muscleGroup === 'biceps').length).toBeGreaterThanOrEqual(2);
    expect(second.edit).toMatch(/^Added /);
    expect(first.edit).toBeNull();
    // The seed it was built with is the routine's own, so what is kept stays.
    expect(second.seed).toBe(first.seed);
    expect(asked).toEqual([]);
  });

  it.each([
    ['make it 5 exercises', 'shoulders, rear delts · 5 exercises'],
    ['more rear delts', 'shoulders, rear delts · 7 exercises'],
    ['no legs', 'shoulders, rear delts · 6 exercises · no quads, hamstrings, glutes, adductors, calves'],
    ['make this routine harder', 'shoulders, rear delts · 6 exercises · harder'],
    ['make it shorter', null],
    ['swap the front raise', 'shoulders, rear delts · 6 exercises'],
    ['give me another one', 'shoulders, rear delts · 6 exercises'],
    ['make it a push day', 'push · 6 exercises'],
  ])('%j reads from the shoulders routine, not from its own words alone', async (text, read) => {
    const { store, asked } = setup();
    await store.getState().send(SHOULDERS);
    await store.getState().send(text);
    const second = builds(store)[1]!;
    expect(second).toBeDefined();
    if (read !== null) expect(second.read).toBe(read);
    // Nothing is "full body by need" or "nothing specific": the shoulders request is carried into it.
    expect(second.read).not.toMatch(/by need|nothing specific/);
    expect(asked).toEqual([]);
  });

  it('a chain of changes each starts from the routine the one before made', async () => {
    const { store } = setup();
    await store.getState().send(SHOULDERS);
    await store.getState().send('add biceps');
    await store.getState().send('swap the front raise');
    await store.getState().send('make it shorter');
    const [first, added, swapped, shorter] = builds(store);
    expect(namesOf(swapped!).filter((n) => !namesOf(added!).includes(n))).toHaveLength(1);
    expect(shorter!.routines[0]!.rows.length).toBeLessThan(swapped!.routines[0]!.rows.length);
    expect(shorter!.routines[0]!.estimateMinutes).toBeLessThan(swapped!.routines[0]!.estimateMinutes);
    expect(shorter!.request.focus).toEqual(['shoulders', 'rear delts', 'biceps']);
    for (const name of namesOf(shorter!)) expect(namesOf(swapped!)).toContain(name);
    expect(first!.routines[0]!.rows.length).toBe(6);
  });

  it('the Shuffle button after a change builds the changed request, not the one before it', async () => {
    const { store } = setup();
    await store.getState().send(SHOULDERS);
    await store.getState().send('add biceps');
    const id = builds(store)[1]!.id;
    await store.getState().shuffle(id);
    const after = builds(store)[1]!;
    expect(after.request.focus).toEqual(['shoulders', 'rear delts', 'biceps']);
    expect(after.routines[0]!.rows).toHaveLength(8);
    expect(after.routines[0]!.rows.some((r) => r.muscleGroup === 'biceps')).toBe(true);
  });

  it('another one is a new routine for the same request, with a new seed and no call to a backend', async () => {
    const { store, asked } = setup();
    await store.getState().send(SHOULDERS);
    const first = builds(store)[0]!;
    await store.getState().send('give me another one');
    const second = builds(store)[1]!;
    expect(second.seed).not.toBe(first.seed);
    expect(second.request).toEqual(first.request);
    expect(routineToText(second.routines)).not.toBe(routineToText(first.routines));
    expect(asked).toEqual([]);
  });

  it('a row that is not in the routine is a fact in the error, and nothing is added', async () => {
    const { store } = setup();
    await store.getState().send(SHOULDERS);
    const outcome = await store.getState().send('swap the leg press');
    expect(outcome).toBe('error');
    expect(store.getState().error).toBe('No exercise called leg press in this routine');
    expect(store.getState().entries).toHaveLength(1);
    expect(store.getState().pending).toBeNull();
  });

  it('a question after a change is told the changed routine, and that it changed', async () => {
    const { store, asked } = setup({ reply: 'Fine.' });
    await store.getState().send(SHOULDERS);
    await store.getState().send('add biceps');
    const now = builds(store)[1]!;
    await store.getState().send('Why have you chosen this?');
    const thread = asked[0]!.thread;
    expect(thread[3]).toEqual({ role: 'coach', text: `Routine changed (Shoulders, rear delts and biceps): ${now.edit}` });
    expect(thread[3]!.text).toBe(builtTurn(now.routines, now.edit));
  });

  it('while something is being shuffled a change is not taken', async () => {
    let release: (input: RoutineInput) => void = () => undefined;
    let loads = 0;
    const store = createCoachStore({
      backend: fakeBackend().backend,
      loadBuildInput: () => (loads++ === 0 ? Promise.resolve(BUILD_INPUT) : new Promise<RoutineInput>((resolve) => (release = resolve))),
    });
    await store.getState().send(SHOULDERS);
    const id = builds(store)[0]!.id;
    const shuffling = store.getState().shuffle(id);
    await vi.waitFor(() => expect(store.getState().working).toBe(id));
    // Each kind of message is put off by the guard in `send`, not by the one in the action it goes to: a build has none of its own.
    expect(await store.getState().send('add biceps')).toBe('ignored');
    expect(await store.getState().send('give me a chest routine')).toBe('ignored');
    expect(await store.getState().send('How was last week?')).toBe('ignored');
    expect(store.getState().entries).toHaveLength(1);
    expect(loads).toBe(2);
    release(BUILD_INPUT);
    await shuffling;
    expect(store.getState().entries).toHaveLength(1);
    expect(store.getState().pending).toBeNull();
  });
});

describe('coach store: what send comes to', () => {
  it('says whether the message was taken, failed, stopped or ignored', async () => {
    const { store } = setup({ reply: 'Fine.' });
    expect(await store.getState().send('   ')).toBe('ignored');
    expect(await store.getState().send(SHOULDERS)).toBe('sent');
    expect(await store.getState().send('How was last week?')).toBe('sent');
    expect(await store.getState().send('swap the zzz')).toBe('error');
    const failing = setup({ fail: new Error('BUSY') });
    expect(await failing.store.getState().send('How was last week?')).toBe('error');
  });

  it('an error is cleared by the next message sent', async () => {
    const { store } = setup({ reply: 'Fine.' });
    await store.getState().send(SHOULDERS);
    await store.getState().send('swap the zzz');
    expect(store.getState().error).toBe('No exercise called zzz in this routine');
    await store.getState().send('How was last week?');
    expect(store.getState().error).toBeNull();
  });
});

describe('coach store: an empty build is a fact (finding 11)', () => {
  it('is told to the backend as nothing built, never as "Routine built"', async () => {
    const { store, asked } = setup({ reply: 'Fine.' }, { ...BUILD_INPUT, candidates: [] });
    await store.getState().send('give me a chest routine');
    const [entry] = builds(store);
    expect(entry!.routines[0]!.rows).toEqual([]);
    await store.getState().send('Why have you chosen this?');
    const told = asked[0]!.thread[1]!.text;
    expect(told).not.toContain('Routine built');
    expect(told).toContain('Built nothing: Nothing to choose from for chest');
  });
});

describe('coach store: an answer given up on leaves nothing behind (finding 10)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a late answer to a question that timed out never reaches the next one's entry", async () => {
    vi.useFakeTimers();
    let call = 0;
    let lateFinish: (text: string) => void = () => undefined;
    const backend: CoachBackend = {
      ask: () => (call++ === 0 ? new Promise((resolve) => (lateFinish = resolve)) : Promise.resolve('new-done')),
    };
    const store = createCoachStore({ backend, loadBuildInput: async () => BUILD_INPUT });
    const first = store.getState().ask('How was last week?');
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS);
    await first;
    expect(store.getState().error).toBe('The model did not answer.');
    await store.getState().ask('And the week before?');
    // The first answer finally arrives.
    lateFinish('LATE');
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().entries).toHaveLength(1);
    const [entry] = store.getState().entries;
    expect(entry!.mode === 'ask' && entry!.answer).toBe('new-done');
  });
});

describe('coach store: Stop and Clear while it is busy', () => {
  /** A backend that waits to be told the answer. */
  const held = () => {
    const state = { finish: (_t: string): void => undefined, calls: 0 };
    const backend: CoachBackend = {
      ask: () =>
        new Promise((resolve) => {
          state.calls++;
          state.finish = resolve;
        }),
    };
    return { backend, state };
  };

  it('Stop while an answer is coming drops it and keeps the conversation, and the message is reported stopped', async () => {
    const { backend, state } = held();
    const store = createCoachStore({ backend, loadBuildInput: async () => BUILD_INPUT });
    await store.getState().send(SHOULDERS);
    const asking = store.getState().send('Why have you chosen this?');
    await vi.waitFor(() => expect(store.getState().pending?.mode).toBe('ask'));
    store.getState().cancel();
    expect(store.getState().pending).toBeNull();
    state.finish('An answer.');
    expect(await asking).toBe('stopped');
    expect(store.getState().entries.map((e) => e.mode)).toEqual(['build']);
    expect(store.getState()).toMatchObject({ pending: null, error: null });
  });

  it('what a stopped answer says later never reaches the answer that follows it', async () => {
    const { backend, state } = held();
    const store = createCoachStore({ backend, loadBuildInput: async () => BUILD_INPUT });
    const first = store.getState().send('How was last week?');
    await vi.waitFor(() => expect(state.calls).toBe(1));
    const firstFinish = state.finish;
    store.getState().cancel();
    await first;
    const second = store.getState().send('And the week before?');
    await vi.waitFor(() => expect(state.calls).toBe(2));
    firstFinish('Old answer.');
    expect(store.getState().pending?.mode).toBe('ask');
    state.finish('New answer.');
    await second;
    expect(store.getState().entries).toHaveLength(1);
    const [entry] = store.getState().entries;
    expect(entry!.mode === 'ask' && entry!.answer).toBe('New answer.');
  });

  it('Stop while a routine is being changed drops it', async () => {
    let release: (input: RoutineInput) => void = () => undefined;
    let loads = 0;
    const store = createCoachStore({
      backend: held().backend,
      loadBuildInput: () => (loads++ === 0 ? Promise.resolve(BUILD_INPUT) : new Promise<RoutineInput>((resolve) => (release = resolve))),
    });
    await store.getState().send(SHOULDERS);
    const changing = store.getState().send('add biceps');
    await vi.waitFor(() => expect(store.getState().pending?.mode).toBe('build'));
    store.getState().cancel();
    release(BUILD_INPUT);
    expect(await changing).toBe('stopped');
    expect(store.getState().entries).toHaveLength(1);
    expect(store.getState()).toMatchObject({ pending: null, error: null });
  });

  it('Clear while a change is being built empties the conversation, and nothing of it reappears', async () => {
    let release: (input: RoutineInput) => void = () => undefined;
    let loads = 0;
    const store = createCoachStore({
      backend: held().backend,
      loadBuildInput: () => (loads++ === 0 ? Promise.resolve(BUILD_INPUT) : new Promise<RoutineInput>((resolve) => (release = resolve))),
    });
    await store.getState().send(SHOULDERS);
    const changing = store.getState().send('make it shorter');
    await vi.waitFor(() => expect(store.getState().pending).not.toBeNull());
    store.getState().reset();
    release(BUILD_INPUT);
    await changing;
    expect(store.getState()).toMatchObject({ entries: [], pending: null, error: null });
  });

  it('Stop with nothing busy does nothing', async () => {
    const { store } = setup();
    await store.getState().send(SHOULDERS);
    const before = store.getState().entries;
    store.getState().cancel();
    expect(store.getState().entries).toBe(before);
  });
});
