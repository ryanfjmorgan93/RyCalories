import { afterEach, describe, expect, it, vi } from 'vitest';
import { seededInput } from '../test/routineFixtures';
import type { ClaudeSummaryInput } from '../domain/claudeSummary';
import { buildCoachPrompt, buildCoachSystemPrompt, buildRoutineBlock, coachContextLadder, THREAD_TURNS } from '../domain/coach';
import type { QuickOptions } from '../domain/quickRequest';
import { parseQuickRequest } from '../domain/quickRequest';
import { buildRoutines, routineToText, type RoutineInput } from '../domain/routineBuilder';
import {
  COULD_NOT_READ,
  COUNT_TIMEOUT_MS,
  createCoachStore,
  lastRoutines,
  lastWasRoutine,
  QUIET_TIMEOUT_MS,
  REPLY_TOKENS,
  routeOf,
  type BuildEntry,
  type CoachBackend,
  type CoachIntent,
} from './coach';
import type { NanoStatus } from './nano';

const READY: NanoStatus = { state: 'ready', detail: 'AVAILABLE · nano-v4-full · 4000 tokens' };

const INPUT: ClaudeSummaryInput = {
  asOf: '2026-09-25',
  include: { training: true, food: true, bodyweight: true, routines: true },
  training: {
    days: 182,
    sessions: [
      {
        date: '2026-09-24',
        title: 'Push A',
        minutes: 55,
        exercises: [{ name: 'Bench Press (Barbell)', kind: 'reps', sets: [{ type: 'working', weight: 85, reps: 8 }] }],
      },
      {
        date: '2026-09-01',
        title: 'Push A',
        minutes: 50,
        exercises: [{ name: 'Bench Press (Barbell)', kind: 'reps', sets: [{ type: 'working', weight: 82.5, reps: 8 }] }],
      },
    ],
  },
  food: { days: 28, perDay: [{ date: '2026-09-24', macros: { kcal: 2400, protein: 160, carbs: 250, fat: 80 } }], calorieTarget: null, proteinTarget: null },
  bodyweight: { days: 56, readings: [{ id: 'a', date: '2026-09-24', kg: 82 }] },
  routines: [],
};

/** The owner's own 27 exercises and the real library, as the builder reads them. */
const BUILD_INPUT: RoutineInput = seededInput({ recency: { shoulders: 6, 'rear delts': 6 } });

const SHOULDERS = 'Give me a routine solely designed to build 3D shoulders';

/** A model that counts a character as a token and streams its reply in pieces. */
function fakeBackend(opts: { limit?: number; reply?: string[]; status?: NanoStatus; fail?: unknown } = {}) {
  const counted: string[] = [];
  const streamed: string[] = [];
  const systems: string[] = [];
  const calls = { status: 0, download: 0 };
  const limit = { value: opts.limit ?? 100_000 };
  const backend: CoachBackend = {
    status: async () => (calls.status++, opts.status ?? READY),
    download: async () => void calls.download++,
    countTokens: async (_system, prompt) => {
      counted.push(prompt);
      return { tokens: prompt.length, limit: limit.value };
    },
    stream: async (system, prompt, _max, onText) => {
      systems.push(system);
      streamed.push(prompt);
      if (opts.fail) throw opts.fail;
      for (const piece of opts.reply ?? ['Your bench ', 'went 82.5 → 85 kg.']) {
        await Promise.resolve();
        onText(piece);
      }
      return (opts.reply ?? ['Your bench ', 'went 82.5 → 85 kg.']).join('');
    },
  };
  return { backend, counted, streamed, systems, calls, limit };
}

/** A fake default model for the tap on "Read with assistant". */
function fakeIntent(over: { ready?: boolean; options?: Partial<QuickOptions> | null; error?: string | null } = {}) {
  const calls = { ready: 0, read: [] as string[] };
  const intent: CoachIntent = {
    ready: async () => (calls.ready++, over.ready ?? true),
    read: async (text) => (calls.read.push(text), { options: over.options === undefined ? { focus: ['shoulders'], count: 4 } : over.options, error: over.error ?? null }),
  };
  return { intent, calls };
}

/** A store on a fake model, the real builder over real data, and seeds that count up from 100. */
function setup(opts: Parameters<typeof fakeBackend>[0] = {}, intent: CoachIntent = fakeIntent().intent, input: RoutineInput = BUILD_INPUT) {
  const fake = fakeBackend(opts);
  const loads = { build: 0 };
  let seed = 100;
  const store = createCoachStore({
    backend: fake.backend,
    loadInput: async () => INPUT,
    loadBuildInput: async () => (loads.build++, input),
    intent,
    newSeed: () => ++seed,
  });
  return { store, ...fake, loads };
}

async function ready(store: ReturnType<typeof createCoachStore>) {
  await store.getState().refreshStatus();
  return store;
}

const builds = (store: ReturnType<typeof createCoachStore>): BuildEntry[] => store.getState().entries.filter((e): e is BuildEntry => e.mode === 'build');
const namesOf = (e: BuildEntry): string[] => e.routines.flatMap((r) => r.rows.map((x) => x.name));

describe('coach store: asking', () => {
  it('shows the answer as it arrives, then keeps it with what it read', async () => {
    const { store } = setup();
    await ready(store);
    const partials: string[] = [];
    const unsub = store.subscribe((s) => {
      if (s.pending?.partial) partials.push(s.pending.partial);
    });
    await store.getState().ask('Why has my bench stalled?');
    unsub();
    expect(partials).toEqual(['Your bench ', 'Your bench went 82.5 → 85 kg.']);
    const [entry] = store.getState().entries;
    expect(entry).toMatchObject({ mode: 'ask', question: 'Why has my bench stalled?', answer: 'Your bench went 82.5 → 85 kg.' });
    expect(entry!.mode === 'ask' && entry!.label).toContain('Bench Press (Barbell) 26 weeks');
    expect(store.getState().pending).toBeNull();
  });

  it('answers with the question prompt, which never asks the model to write a routine', async () => {
    const { store, systems } = setup();
    await ready(store);
    await store.getState().ask('Why has my bench stalled?');
    expect(systems).toEqual([buildCoachSystemPrompt('ask')]);
    expect(systems[0]).not.toMatch(/reply with the routine|write gym routines/i);
  });

  it('sends the fullest context that fits, counting each rung in order until one does', async () => {
    const ladder = coachContextLadder(INPUT, 'How was last week?', 'ask');
    const prompts = ladder.map((r) => buildCoachPrompt(r.text, [], 'How was last week?'));
    // Room for the third rung and its reply, not the second.
    const limit = prompts[2]!.length + REPLY_TOKENS;
    expect(prompts[1]!.length + REPLY_TOKENS).toBeGreaterThan(limit);
    const { store, counted, streamed } = setup({ limit });
    await ready(store);
    await store.getState().ask('How was last week?');
    expect(counted).toEqual(prompts.slice(0, 3));
    expect(streamed).toEqual([prompts[2]]);
    const [entry] = store.getState().entries;
    expect(entry!.mode === 'ask' && entry!.label).toBe(ladder[2]!.label);
  });

  it('a question too long for even an empty context is refused, not sent', async () => {
    const { store, streamed } = setup({ limit: 10 });
    await ready(store);
    await store.getState().ask('How was last week?');
    expect(streamed).toEqual([]);
    expect(store.getState().error).toBe('Question too long for the model.');
  });

  it('carries the last exchange into the next question', async () => {
    const { store, streamed } = setup({ reply: ['Fine.'] });
    await ready(store);
    await store.getState().ask('How was last week?');
    await store.getState().ask('And the week before?');
    expect(streamed[1]).toContain('User: How was last week?\n\nCoach: Fine.\n\nUser: And the week before?');
    const entry = store.getState().entries[1]!;
    expect(entry.mode === 'ask' && entry.label).toContain('last exchange');
  });

  it("shows the plugin's own reason when the model fails", async () => {
    const { store } = setup({ fail: { message: 'x', data: { genAiError: 'BUSY' } } });
    await ready(store);
    await store.getState().ask('How was last week?');
    expect(store.getState().error).toBe('BUSY');
    expect(store.getState().pending).toBeNull();
    expect(store.getState().entries).toEqual([]);
  });

  it('asks nothing while an answer is still coming', async () => {
    const { store, streamed } = setup();
    await ready(store);
    const first = store.getState().ask('one');
    await store.getState().ask('two');
    await first;
    expect(streamed).toHaveLength(1);
  });

  it('when the model is not there, says why and sends nothing', async () => {
    const { store, counted } = setup({ status: { state: 'unavailable', detail: 'UNAVAILABLE · samsung SM-F971B' } });
    await ready(store);
    await store.getState().ask('How was last week?');
    expect(store.getState().error).toBe('UNAVAILABLE · samsung SM-F971B');
    expect(counted).toEqual([]);
  });
});

describe('coach store: building', () => {
  it('a request for a routine is built at once with no call to the model, whatever the model is doing', async () => {
    for (const status of [READY, { state: 'unavailable', detail: 'UNAVAILABLE · samsung SM-F971B' } as NanoStatus, undefined]) {
      const { store, counted, streamed, calls, loads } = setup({ status });
      // The status is read only where the case says so: a build never needs it.
      if (status) await ready(store);
      calls.status = 0;
      await store.getState().send(SHOULDERS);
      expect(counted, JSON.stringify(status)).toEqual([]);
      expect(streamed).toEqual([]);
      expect(calls).toEqual({ status: 0, download: 0 });
      expect(loads.build).toBe(1);
      expect(store.getState()).toMatchObject({ pending: null, error: null });
      const [entry] = builds(store);
      expect(entry).toMatchObject({ mode: 'build', question: SHOULDERS, by: 'rules', unread: [], assist: null, seed: 101, request: { focus: ['shoulders', 'rear delts'] } });
      expect(entry!.routines).toHaveLength(1);
    }
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
      const c = createCoachStore({ backend: a.backend, loadInput: async () => INPUT, loadBuildInput: async () => BUILD_INPUT, newSeed: () => 7 + i });
      await c.getState().send(SHOULDERS);
      seen.add(namesOf(builds(c)[0]!).join('|'));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('a message the first of a deep link, even one that reads like a question, is a build', async () => {
    const { store, streamed } = setup();
    await ready(store);
    expect(routeOf('Why is my chest weak?', [], false)).toBe('ask');
    expect(routeOf('Why is my chest weak?', [], true)).toBe('build');
    await store.getState().send('Why is my chest weak?', { build: true });
    expect(builds(store)).toHaveLength(1);
    expect(builds(store)[0]!.request.focus).toEqual(['chest']);
    expect(streamed).toEqual([]);
    // The next one is routed as usual.
    await store.getState().send('Why is my chest weak?');
    expect(store.getState().entries.map((e) => e.mode)).toEqual(['build', 'ask']);
  });

  it('a request with nothing in it builds by need and says so, offering no assistant while the model is not ready', async () => {
    const { intent, calls } = fakeIntent({ ready: false });
    const { store } = setup({}, intent);
    await store.getState().send('give me a routine that makes me look like thor');
    expect(parseQuickRequest('give me a routine that makes me look like thor').residue.length).toBeGreaterThan(0);
    const [entry] = builds(store);
    expect(entry!.read).toBe('nothing specific · full body by need');
    expect(entry!.unread).toEqual([]);
    expect(entry!.routines[0]!.name).toBe('Full body');
    expect(entry!.routines[0]!.rows.length).toBeGreaterThan(0);
    expect(calls.ready).toBe(1);
    expect(calls.read).toEqual([]);
  });

  it('with the model ready the unread words are offered, and nothing is sent to it until the owner taps', async () => {
    const { intent, calls } = fakeIntent({ ready: true });
    const { store, counted, streamed } = setup({}, intent);
    const text = 'give me a routine that makes me look like thor';
    await store.getState().send(text);
    const [entry] = builds(store);
    expect(entry!.unread).toEqual(parseQuickRequest(text).residue);
    expect(entry!.routines[0]!.rows.length).toBeGreaterThan(0);
    expect(calls.read).toEqual([]);
    expect(counted).toEqual([]);
    expect(streamed).toEqual([]);
  });

  it('a request the rules read is never offered to the assistant, however many words are left over', async () => {
    const { intent, calls } = fakeIntent({ ready: true });
    const { store } = setup({}, intent);
    // "doesn't" and "matter" are not read, and "3d shoulders" is: the rules have what they need.
    const text = "Doesn't matter, I want 3d shoulders";
    expect(parseQuickRequest(text).residue.length).toBeGreaterThan(0);
    await store.getState().send(text);
    expect(builds(store)[0]!.unread).toEqual([]);
    expect(calls.ready).toBe(0);
    expect(calls.read).toEqual([]);
  });

  it('a split is one routine a day, and the line names them', async () => {
    const { store } = setup();
    await store.getState().send('give me a push pull legs routine');
    const [entry] = builds(store);
    expect(entry!.routines.map((r) => r.name)).toEqual(['Push', 'Pull', 'Legs']);
    expect(entry!.read).toMatch(/^push, pull, legs · 3 routines · \d+ exercises$/);
  });

  it('a loader that fails leaves an error, no entry, and nothing pending', async () => {
    const store = createCoachStore({ backend: fakeBackend().backend, loadInput: async () => INPUT, loadBuildInput: async () => Promise.reject(new Error('no db')) });
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
    const { store, counted, streamed } = setup({ reply: ['Each part of the shoulder has an exercise.'] });
    await ready(store);

    await store.getState().send(SHOULDERS);
    expect(streamed).toEqual([]);
    const first = builds(store)[0]!;
    expect(lastWasRoutine(store.getState().entries)).toBe(true);

    await store.getState().send('Why have you chosen this?');
    // One call, and not another routine: the model is given the routine and its reasons.
    expect(streamed).toHaveLength(1);
    expect(store.getState().entries.map((e) => e.mode)).toEqual(['build', 'ask']);
    const prompt = streamed[0]!;
    for (const row of first.routines[0]!.rows) expect(prompt).toContain(`${row.name}: ${row.reason}`);
    for (const line of first.routines[0]!.reasonLines) expect(prompt).toContain(line);
    expect(prompt).toContain(`Routine the app built:\n${routineToText(first.routines)}`);
    expect(prompt).toContain('Why:');
    expect(prompt.endsWith('User: Why have you chosen this?')).toBe(true);
    // The routine built stands as the coach's turn in the conversation.
    expect(prompt).toContain(`User: ${SHOULDERS}\n\nCoach: Routine built: Shoulders and rear delts\n\nUser: Why have you chosen this?`);
    const answer = store.getState().entries[1]!;
    expect(answer.mode === 'ask' && answer.label).toContain('routine and reasons');
    expect(counted.length).toBeGreaterThan(0);

    const modelCalls = streamed.length;
    await store.getState().send("Doesn't matter, I want 3d shoulders");
    expect(streamed).toHaveLength(modelCalls);
    expect(store.getState().entries.map((e) => e.mode)).toEqual(['build', 'ask', 'build']);
    expect(builds(store)[1]!.request.focus).toEqual(['shoulders', 'rear delts']);
  });

  it('a question carries the last routine built even when questions have come since', async () => {
    const { store, streamed } = setup({ reply: ['Fine.'] });
    await ready(store);
    await store.getState().send(SHOULDERS);
    await store.getState().send('How was last week?');
    await store.getState().send('And the week before?');
    expect(streamed[1]).toContain('Routine the app built:');
    expect(streamed[1]).toContain(namesOf(builds(store)[0]!)[0]);
    expect(lastRoutines(store.getState().entries)).toEqual(builds(store)[0]!.routines);
  });

  it('a question with no routine built carries none', async () => {
    const { store, streamed } = setup();
    await ready(store);
    await store.getState().send('How was last week?');
    expect(streamed[0]).not.toContain('Routine the app built');
  });

  it('carries the last three exchanges, builds among them, and no more', async () => {
    const { store, streamed } = setup({ reply: ['Fine.'] });
    await ready(store);
    await store.getState().send('Question one?');
    await store.getState().send(SHOULDERS);
    await store.getState().send('Question three?');
    await store.getState().send('Question four?');
    await store.getState().send('Question five?');
    const prompt = streamed[streamed.length - 1]!;
    expect(THREAD_TURNS).toBe(6);
    expect(prompt).not.toContain('Question one?');
    for (const kept of [SHOULDERS, 'Question three?', 'Question four?']) expect(prompt).toContain(`User: ${kept}`);
    expect(prompt.endsWith('User: Question five?')).toBe(true);
  });

  it('over the limit, the oldest turns go first, then the data; the routine and its reasons stay', async () => {
    const talk = async () => {
      const s = setup({ reply: ['Fine.'] });
      await ready(s.store);
      for (const m of ['Question one?', SHOULDERS, 'Question three?', 'Question four?', 'Question five?']) await s.store.getState().send(m);
      s.counted.length = 0;
      s.streamed.length = 0;
      return s;
    };

    // The same conversation twice: the first measures the fullest prompt for the next question.
    const probe = await talk();
    await probe.store.getState().ask('Question six?');
    expect(probe.counted).toHaveLength(1);
    const fullest = probe.counted[0]!;

    // Room for one exchange fewer and no less.
    const { store, counted, streamed, limit } = await talk();
    limit.value = fullest.length - 1 + REPLY_TOKENS;
    await store.getState().ask('Question six?');
    expect(counted.length).toBeGreaterThan(1);
    // The first attempt held the last three exchanges; the one sent dropped the oldest of them.
    expect(counted[0]).toBe(fullest);
    expect(counted[0]).toContain('User: Question three?');
    expect(streamed).toHaveLength(1);
    const sent = streamed[0]!;
    expect(sent).toBe(counted[counted.length - 1]);
    expect(sent).toContain('User: Question four?');
    expect(sent).toContain('User: Question five?');
    expect(sent).not.toContain('User: Question three?');
    // The data is the fullest rung still; only turns went.
    expect(sent).toContain('Your data');
    expect(sent).toContain('Routine the app built:');
    expect(sent).toContain('Why:');
    const answered = store.getState().entries[store.getState().entries.length - 1]!;
    expect(answered.mode === 'ask' && answered.label).toContain('routine and reasons');
    expect(answered.mode === 'ask' && answered.label).toContain('last 2 exchanges');
  });

  it('far over the limit the data shrinks and the reasons go, but never the routine itself', async () => {
    const { store, counted, streamed, limit } = setup({ reply: ['Fine.'] });
    await ready(store);
    await store.getState().send(SHOULDERS);
    const first = builds(store)[0]!;
    const block = buildRoutineBlock(first.routines, 'text');
    counted.length = 0;
    // Room for the routine and the question and very little else.
    limit.value = block.length + 'User: Why?'.length + 400 + REPLY_TOKENS;
    await store.getState().ask('Why?');
    expect(streamed).toHaveLength(1);
    expect(streamed[0]).toContain(routineToText(first.routines));
    expect(streamed[0]).not.toContain('Why:\n');
    expect(streamed[0]).not.toContain('Your data');
    const last = store.getState().entries[store.getState().entries.length - 1]!;
    expect(last.mode === 'ask' && last.label).toContain('routine only');
  });
});

describe('coach store: shuffle and the assistant', () => {
  it('Shuffle builds the same request again with a new seed, in place, with no call to the model', async () => {
    const { store, counted, streamed } = setup();
    await ready(store);
    await store.getState().send(SHOULDERS);
    await store.getState().send('Why have you chosen this?');
    await store.getState().send('give me a chest routine');
    const [shoulders, chest] = builds(store);
    const entriesBefore = store.getState().entries;
    const model = { counted: counted.length, streamed: streamed.length };

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
    expect({ counted: counted.length, streamed: streamed.length }).toEqual(model);
    expect(store.getState().working).toBeNull();
    // What a question is now told is the routine on screen, not the one it replaced.
    await store.getState().send('Why?');
    expect(lastRoutines(store.getState().entries)).toEqual(after[1]!.routines);
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
    await ready(store);
    await store.getState().send('How was last week?');
    const ask = store.getState().entries[0]!;
    await store.getState().shuffle(ask.id);
    await store.getState().shuffle(999);
    expect(loads.build).toBe(0);
    expect(store.getState().entries).toEqual([ask]);
  });

  it('a tap on Read with assistant sends the typed line once, fills the options, and builds again with them', async () => {
    const { intent, calls } = fakeIntent({ options: { focus: ['shoulders'], count: 4 } });
    const { store, streamed } = setup({}, intent);
    const text = 'give me a routine that makes me look like thor';
    await store.getState().send(text);
    const [before] = builds(store);
    expect(before!.unread.length).toBeGreaterThan(0);

    await store.getState().readWithAssistant(before!.id);

    expect(calls.read).toEqual([text]);
    const [after] = builds(store);
    expect(after).toMatchObject({ by: 'assistant', unread: [], assist: null, seed: before!.seed, read: 'shoulders · 4 exercises' });
    expect(after!.request).toEqual({ focus: ['shoulders'], count: 4 });
    expect(after!.routines[0]!.rows).toHaveLength(4);
    // Built with the seed the entry already had, and not another: the routine is the builder's for that seed and request.
    expect(routineToText(after!.routines)).toBe(routineToText(buildRoutines(BUILD_INPUT, after!.request, before!.seed)));
    // Only options came back from it: every exercise is the builder's.
    expect(after!.routines[0]!.rows.every((r) => r.muscleGroup === 'shoulders')).toBe(true);
    expect(streamed).toEqual([]);
    expect(store.getState().working).toBeNull();
  });

  it('the assistant fills the five options it may and no other: a muscle ruled out is not one of them, and nothing it says adds an exercise', async () => {
    // `exclude` is not an option the assistant may set (only the rules read a muscle ruled out), so a reply that holds one is read without it.
    const { intent } = fakeIntent({ options: { focus: ['calves'], count: 2, minutes: 20, exclude: ['chest'] } });
    const { store } = setup({}, intent);
    // Nothing the rules can use ("six" would be a count): the words are residue.
    await store.getState().send('give me a routine that makes me look like thor');
    await store.getState().readWithAssistant(builds(store)[0]!.id);
    const entry = builds(store)[0]!;
    expect(entry.request.focus).toEqual(['calves']);
    expect(entry.request.count).toBe(2);
    expect(entry.request.exclude).toBeUndefined();
    expect(entry.routines[0]!.rows.length).toBeLessThanOrEqual(2);
    // The library may add a calf raise; whatever is chosen is from the owner's rows or the library, with the builder's weights.
    for (const row of entry.routines[0]!.rows) expect(row.muscleGroup).toBe('calves');
  });

  it('a reply with nothing in it leaves the routine and says nothing more was read, and the button goes', async () => {
    for (const reply of [{ options: null, error: null }, { options: { effort: 'light' as const }, error: null }]) {
      const { intent, calls } = fakeIntent(reply);
      const { store } = setup({}, intent);
      await store.getState().send('give me a routine that makes me look like thor');
      const [before] = builds(store);
      await store.getState().readWithAssistant(before!.id);
      const [after] = builds(store);
      expect(after!.assist).toEqual({ kind: 'nothing' });
      expect(after!.routines).toEqual(before!.routines);
      expect(after!.unread).toEqual(before!.unread);
      // A second tap is not another call.
      await store.getState().readWithAssistant(before!.id);
      expect(calls.read).toHaveLength(1);
    }
  });

  it('a model that fails says why, keeps the routine, and may be asked again', async () => {
    const { intent, calls } = fakeIntent({ options: null, error: 'BUSY' });
    const { store } = setup({}, intent);
    await store.getState().send('give me a routine that makes me look like thor');
    const [before] = builds(store);
    await store.getState().readWithAssistant(before!.id);
    expect(builds(store)[0]!.assist).toEqual({ kind: 'error', message: 'BUSY' });
    await store.getState().readWithAssistant(before!.id);
    expect(calls.read).toHaveLength(2);
  });

  it('there is nothing to read with the assistant on a routine the rules read', async () => {
    const { intent, calls } = fakeIntent();
    const { store } = setup({}, intent);
    await store.getState().send(SHOULDERS);
    await store.getState().readWithAssistant(builds(store)[0]!.id);
    expect(calls.read).toEqual([]);
  });
});

describe('coach store: routing', () => {
  const routine = (store: ReturnType<typeof setup>['store']) => store.getState().entries;
  it('knows when a routine is the subject: the latest build has exercises, and no one has cleared the conversation', async () => {
    const { store } = setup();
    await ready(store);
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
    const { store, streamed } = setup({ reply: ['Fine.'] });
    await ready(store);
    await store.getState().send(SHOULDERS);
    for (const text of ['add biceps', 'more rear delts', 'give me another one', 'make it shorter']) {
      const straight = routeOf(text, store.getState().entries);
      await store.getState().send('Why have you chosen this?');
      expect(store.getState().entries[store.getState().entries.length - 1]!.mode, text).toBe('ask');
      expect(routeOf(text, store.getState().entries), text).toBe(straight);
      expect(straight, text).toBe('edit');
    }
    expect(streamed.length).toBe(4);
    const before = store.getState().entries.length;
    await store.getState().send('add biceps');
    expect(store.getState().entries).toHaveLength(before + 1);
    expect(store.getState().entries[before]!.mode).toBe('build');
    // The change was made by the app: the four questions are the only calls the model had.
    expect(streamed.length).toBe(4);
  });

  it('an empty build does not take the routine from one that is still on screen: a question is still about the older one', async () => {
    let loads = 0;
    const fake = fakeBackend({ reply: ['Fine.'] });
    const store = createCoachStore({
      backend: fake.backend,
      loadInput: async () => INPUT,
      // The second routine asked for has nothing to be made of.
      loadBuildInput: async () => (loads++ === 0 ? BUILD_INPUT : { ...BUILD_INPUT, candidates: [] }),
      newSeed: () => 5,
    });
    await ready(store);
    await store.getState().send(SHOULDERS);
    const first = builds(store)[0]!;
    await store.getState().send('give me a chest routine');
    expect(builds(store)[1]!.routines[0]!.rows).toEqual([]);
    expect(lastWasRoutine(store.getState().entries)).toBe(false);
    expect(lastRoutines(store.getState().entries)).toEqual(first.routines);
    await store.getState().send('Why have you chosen this?');
    expect(fake.streamed[0]).toContain(`Routine the app built:\n${routineToText(first.routines)}`);
  });
});

describe('coach store: a model that goes quiet, and Clear', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const base = (): CoachBackend => ({
    status: async () => READY,
    download: async () => undefined,
    countTokens: async (_s, prompt) => ({ tokens: prompt.length, limit: 100_000 }),
    stream: async () => 'unused',
  });
  const storeOn = (backend: CoachBackend, loadBuildInput: () => Promise<RoutineInput> = async () => BUILD_INPUT) =>
    createCoachStore({ backend, loadInput: async () => INPUT, loadBuildInput });

  it('a count that never comes back ends in an error, not "Answering…" for ever', async () => {
    vi.useFakeTimers();
    const store = await ready(storeOn({ ...base(), countTokens: () => new Promise(() => undefined) }));
    const asked = store.getState().ask('How was last week?');
    await vi.advanceTimersByTimeAsync(COUNT_TIMEOUT_MS - 1);
    expect(store.getState().pending).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await asked;
    expect(store.getState()).toMatchObject({ pending: null, error: 'The model did not answer.' });
  });

  it('an answer that stops arriving is given up after a quiet spell, keeping nothing', async () => {
    vi.useFakeTimers();
    const store = await ready(
      storeOn({
        ...base(),
        stream: (_s, _p, _m, onText) => {
          onText('Your bench');
          return new Promise(() => undefined);
        },
      }),
    );
    const asked = store.getState().ask('How was last week?');
    await vi.advanceTimersByTimeAsync(QUIET_TIMEOUT_MS);
    await asked;
    expect(store.getState()).toMatchObject({ pending: null, error: 'The model did not answer.', entries: [] });
  });

  it('a slow answer that keeps arriving is not cut off, however long it takes in all', async () => {
    vi.useFakeTimers();
    const store = await ready(
      storeOn({
        ...base(),
        stream: async (_s, _p, _m, onText) => {
          for (const piece of ['one ', 'two ', 'three']) {
            await new Promise((r) => setTimeout(r, QUIET_TIMEOUT_MS - 1000));
            onText(piece);
          }
          return 'one two three';
        },
      }),
    );
    const asked = store.getState().ask('How was last week?');
    await vi.advanceTimersByTimeAsync(3 * QUIET_TIMEOUT_MS);
    await asked;
    expect(store.getState().error).toBeNull();
    const [entry] = store.getState().entries;
    expect(entry!.mode === 'ask' && entry!.answer).toBe('one two three');
  });

  it('Clear while an answer is coming drops it: nothing reappears when it finishes', async () => {
    let finish: (text: string) => void = () => undefined;
    const store = await ready(
      storeOn({
        ...base(),
        stream: (_s, _p, _m, onText) =>
          new Promise((resolve) => {
            onText('Half');
            finish = resolve;
          }),
      }),
    );
    const asked = store.getState().ask('How was last week?');
    await vi.waitFor(() => expect(store.getState().pending?.partial).toBe('Half'));
    store.getState().reset();
    expect(store.getState().pending).toBeNull();
    finish('Half an answer.');
    await asked;
    expect(store.getState()).toMatchObject({ pending: null, entries: [], error: null });
  });

  it('Clear empties the conversation, builds and answers alike, and the next question carries nothing from before', async () => {
    const fake = fakeBackend({ reply: ['Fine.'] });
    const store = createCoachStore({ backend: fake.backend, loadInput: async () => INPUT, loadBuildInput: async () => BUILD_INPUT });
    await ready(store);
    await store.getState().send(SHOULDERS);
    await store.getState().send('How was last week?');
    expect(store.getState().entries).toHaveLength(2);
    store.getState().reset();
    expect(store.getState()).toMatchObject({ entries: [], pending: null, working: null, error: null });
    expect(lastWasRoutine(store.getState().entries)).toBe(false);
    await store.getState().send('And the week before?');
    const prompt = fake.streamed[fake.streamed.length - 1]!;
    expect(prompt).not.toContain('Routine the app built');
    expect(prompt).not.toContain('How was last week?');
    expect(prompt).not.toContain(SHOULDERS);
  });

  it('Clear while a routine is being built drops it: nothing reappears when it finishes', async () => {
    let release: (input: RoutineInput) => void = () => undefined;
    const store = storeOn(base(), () => new Promise<RoutineInput>((resolve) => (release = resolve)));
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
    const store = storeOn(base(), () => {
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
  it('"add biceps" after the 3D shoulders routine is that routine with biceps, kept exercises and all, and no call to the model', async () => {
    const { store, counted, streamed } = setup();
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
    expect(counted).toEqual([]);
    expect(streamed).toEqual([]);
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
    const { store, streamed } = setup();
    await store.getState().send(SHOULDERS);
    await store.getState().send(text);
    const second = builds(store)[1]!;
    expect(second).toBeDefined();
    if (read !== null) expect(second.read).toBe(read);
    // Nothing is "full body by need" or "nothing specific": the shoulders request is carried into it.
    expect(second.read).not.toMatch(/by need|nothing specific/);
    expect(streamed).toEqual([]);
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

  it('another one is a new routine for the same request, with a new seed and no call to the model', async () => {
    const { store, streamed } = setup();
    await store.getState().send(SHOULDERS);
    const first = builds(store)[0]!;
    await store.getState().send('give me another one');
    const second = builds(store)[1]!;
    expect(second.seed).not.toBe(first.seed);
    expect(second.request).toEqual(first.request);
    expect(routineToText(second.routines)).not.toBe(routineToText(first.routines));
    expect(streamed).toEqual([]);
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

  it('a question after a change is about the changed routine, which the model is told changed', async () => {
    const { store, streamed } = setup({ reply: ['Fine.'] });
    await ready(store);
    await store.getState().send(SHOULDERS);
    await store.getState().send('add biceps');
    const now = builds(store)[1]!;
    await store.getState().send('Why have you chosen this?');
    const prompt = streamed[0]!;
    expect(prompt).toContain(`Routine the app built:\n${routineToText(now.routines)}`);
    expect(prompt).not.toContain(routineToText(builds(store)[0]!.routines));
    expect(prompt).toContain(`Coach: Routine changed (Shoulders, rear delts and biceps): ${now.edit}`);
    for (const line of now.routines[0]!.reasonLines) expect(prompt).toContain(line);
  });

  it('while something is being shuffled a change is not taken', async () => {
    let release: (input: RoutineInput) => void = () => undefined;
    let loads = 0;
    const store = createCoachStore({
      backend: fakeBackend().backend,
      loadInput: async () => INPUT,
      loadBuildInput: () => (loads++ === 0 ? Promise.resolve(BUILD_INPUT) : new Promise<RoutineInput>((resolve) => (release = resolve))),
    });
    await store.getState().send(SHOULDERS);
    const id = builds(store)[0]!.id;
    const shuffling = store.getState().shuffle(id);
    await vi.waitFor(() => expect(store.getState().working).toBe(id));
    // Taken out of the guard in `send`, this builds a second routine while the first is being shuffled.
    const outcome = await store.getState().send('add biceps');
    expect(outcome).toBe('ignored');
    expect(store.getState().entries).toHaveLength(1);
    expect(loads).toBe(2);
    release(BUILD_INPUT);
    await shuffling;
    expect(store.getState().entries).toHaveLength(1);
  });
});

describe('coach store: what send comes to', () => {
  it('says whether the message was taken, failed, stopped or ignored', async () => {
    const { store } = setup({ reply: ['Fine.'] });
    await ready(store);
    expect(await store.getState().send('   ')).toBe('ignored');
    expect(await store.getState().send(SHOULDERS)).toBe('sent');
    expect(await store.getState().send('How was last week?')).toBe('sent');
    expect(await store.getState().send('swap the zzz')).toBe('error');
    const failing = setup({ fail: { message: 'x', data: { genAiError: 'BUSY' } } });
    await ready(failing.store);
    expect(await failing.store.getState().send('How was last week?')).toBe('error');
  });

  it('an error is cleared by the next message sent', async () => {
    const { store } = setup({ reply: ['Fine.'] });
    await ready(store);
    await store.getState().send(SHOULDERS);
    await store.getState().send('swap the zzz');
    expect(store.getState().error).toBe('No exercise called zzz in this routine');
    await store.getState().send('How was last week?');
    expect(store.getState().error).toBeNull();
  });
});

describe('coach store: an empty build is a fact (finding 11)', () => {
  it('is told to the model as nothing built, never as "Routine built", and the model gets no routine to explain', async () => {
    const fake = fakeBackend({ reply: ['Fine.'] });
    const store = createCoachStore({ backend: fake.backend, loadInput: async () => INPUT, loadBuildInput: async () => ({ ...BUILD_INPUT, candidates: [] }) });
    await ready(store);
    await store.getState().send('give me a chest routine');
    const [entry] = builds(store);
    expect(entry!.routines[0]!.rows).toEqual([]);
    await store.getState().send('Why have you chosen this?');
    const prompt = fake.streamed[0]!;
    expect(prompt).not.toContain('Routine built');
    expect(prompt).not.toContain('Routine the app built');
    expect(prompt).toContain('Coach: Built nothing: Nothing to choose from for chest');
  });
});

describe('coach store: a build the rules cannot read does not wait on the phone for ever (finding 9)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up on a status call that never returns, and builds the routine with no assistant offered', async () => {
    vi.useFakeTimers();
    const intent: CoachIntent = { ready: () => new Promise(() => undefined), read: async () => ({ options: null, error: null }) };
    const store = createCoachStore({ backend: fakeBackend().backend, loadInput: async () => INPUT, loadBuildInput: async () => BUILD_INPUT, intent });
    const sending = store.getState().send('give me a bench routine');
    await vi.advanceTimersByTimeAsync(COUNT_TIMEOUT_MS - 1);
    expect(store.getState().pending).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await sending;
    expect(store.getState()).toMatchObject({ pending: null, error: null });
    const [entry] = builds(store);
    expect(entry).toMatchObject({ unread: [], by: 'rules' });
    expect(entry!.routines[0]!.rows.length).toBeGreaterThan(0);
  });

  it('a status call that fails is no offer either, and no error', async () => {
    const intent: CoachIntent = { ready: () => Promise.reject(new Error('binder died')), read: async () => ({ options: null, error: null }) };
    const store = createCoachStore({ backend: fakeBackend().backend, loadInput: async () => INPUT, loadBuildInput: async () => BUILD_INPUT, intent });
    await store.getState().send('give me a bench routine');
    expect(store.getState().error).toBeNull();
    expect(builds(store)[0]!.unread).toEqual([]);
  });
});

describe('coach store: an answer given up on leaves nothing behind (finding 10)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("late pieces of an answer that timed out never reach the next answer's bubble", async () => {
    vi.useFakeTimers();
    const pieces: ((piece: string) => void)[] = [];
    let call = 0;
    let finish: (text: string) => void = () => undefined;
    const backend: CoachBackend = {
      status: async () => READY,
      download: async () => undefined,
      countTokens: async (_s, prompt) => ({ tokens: prompt.length, limit: 100_000 }),
      stream: (_s, _p, _m, onText) => {
        pieces.push(onText);
        if (call++ === 0) {
          onText('old-');
          return new Promise(() => undefined);
        }
        onText('new-');
        return new Promise((resolve) => (finish = resolve));
      },
    };
    const store = await ready(createCoachStore({ backend, loadInput: async () => INPUT, loadBuildInput: async () => BUILD_INPUT }));
    const first = store.getState().ask('How was last week?');
    await vi.advanceTimersByTimeAsync(QUIET_TIMEOUT_MS);
    await first;
    expect(store.getState().error).toBe('The model did not answer.');
    const second = store.getState().ask('And the week before?');
    await vi.waitFor(() => expect(store.getState().pending?.partial).toBe('new-'));
    // AICore resumes the first answer.
    pieces[0]!('LATE');
    expect(store.getState().pending?.partial).toBe('new-');
    finish('new-done');
    await second;
    const [entry] = store.getState().entries;
    expect(entry!.mode === 'ask' && entry!.answer).toBe('new-done');
  });
});

describe('coach store: Stop and Clear while it is busy', () => {
  /** A model that says "Half" and then waits to be told to finish. */
  const held = () => {
    const state = { onText: (_p: string): void => undefined, finish: (_t: string): void => undefined, calls: 0 };
    const backend: CoachBackend = {
      status: async () => READY,
      download: async () => undefined,
      countTokens: async (_s, prompt) => ({ tokens: prompt.length, limit: 100_000 }),
      stream: (_s, _p, _m, onText) =>
        new Promise((resolve) => {
          state.calls++;
          state.onText = onText;
          state.finish = resolve;
          onText('Half');
        }),
    };
    return { backend, state };
  };

  it('Stop while an answer is coming drops it and keeps the conversation, and the message is reported stopped', async () => {
    const { backend, state } = held();
    const store = await ready(createCoachStore({ backend, loadInput: async () => INPUT, loadBuildInput: async () => BUILD_INPUT }));
    await store.getState().send(SHOULDERS);
    const asking = store.getState().send('Why have you chosen this?');
    await vi.waitFor(() => expect(store.getState().pending?.partial).toBe('Half'));
    store.getState().cancel();
    expect(store.getState().pending).toBeNull();
    state.onText(' and more');
    state.finish('Half and more.');
    expect(await asking).toBe('stopped');
    expect(store.getState().entries.map((e) => e.mode)).toEqual(['build']);
    expect(store.getState()).toMatchObject({ pending: null, error: null });
  });

  it('what a stopped answer says later never reaches the answer that follows it', async () => {
    const { backend, state } = held();
    const store = await ready(createCoachStore({ backend, loadInput: async () => INPUT, loadBuildInput: async () => BUILD_INPUT }));
    const first = store.getState().send('How was last week?');
    await vi.waitFor(() => expect(store.getState().pending?.partial).toBe('Half'));
    const firstPieces = state.onText;
    const firstFinish = state.finish;
    store.getState().cancel();
    await first;
    const second = store.getState().send('And the week before?');
    await vi.waitFor(() => expect(state.calls).toBe(2));
    await vi.waitFor(() => expect(store.getState().pending?.partial).toBe('Half'));
    firstPieces('LATE');
    firstFinish('Old answer.');
    expect(store.getState().pending?.partial).toBe('Half');
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
      loadInput: async () => INPUT,
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
      loadInput: async () => INPUT,
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
