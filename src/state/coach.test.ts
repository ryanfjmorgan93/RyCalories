import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeSummaryInput } from '../domain/claudeSummary';
import { buildCoachPrompt, buildCoachSystemPrompt, coachContextLadder } from '../domain/coach';
import { COUNT_TIMEOUT_MS, createCoachStore, QUIET_TIMEOUT_MS, REPLY_TOKENS, type CoachBackend } from './coach';
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

/** A model that counts a character as a token and streams its reply in pieces. */
function fakeBackend(opts: { limit?: number; reply?: string[]; status?: NanoStatus; fail?: unknown } = {}) {
  const counted: string[] = [];
  const streamed: string[] = [];
  const backend: CoachBackend = {
    status: async () => opts.status ?? READY,
    download: async () => undefined,
    countTokens: async (_system, prompt) => {
      counted.push(prompt);
      return { tokens: prompt.length, limit: opts.limit ?? 100_000 };
    },
    stream: async (_system, prompt, _max, onText) => {
      streamed.push(prompt);
      if (opts.fail) throw opts.fail;
      for (const piece of opts.reply ?? ['Your bench ', 'went 82.5 → 85 kg.']) {
        await Promise.resolve();
        onText(piece);
      }
      return (opts.reply ?? ['Your bench ', 'went 82.5 → 85 kg.']).join('');
    },
  };
  return { backend, counted, streamed };
}

async function ready(store: ReturnType<typeof createCoachStore>) {
  await store.getState().refreshStatus();
  return store;
}

describe('coach store', () => {
  it('shows the answer as it arrives, then keeps it with what it read', async () => {
    const { backend } = fakeBackend();
    const store = await ready(createCoachStore(backend, async () => INPUT));
    const partials: string[] = [];
    const unsub = store.subscribe((s) => {
      if (s.pending?.partial) partials.push(s.pending.partial);
    });
    await store.getState().ask('Why has my bench stalled?', 'ask');
    unsub();
    expect(partials).toEqual(['Your bench ', 'Your bench went 82.5 → 85 kg.']);
    const [entry] = store.getState().entries;
    expect(entry).toMatchObject({ mode: 'ask', question: 'Why has my bench stalled?', answer: 'Your bench went 82.5 → 85 kg.' });
    expect(entry!.label).toContain('Bench Press (Barbell) 26 weeks');
    expect(store.getState().pending).toBeNull();
  });

  it('sends the fullest context that fits, counting each rung in order until one does', async () => {
    const ladder = coachContextLadder(INPUT, 'How was last week?', 'ask');
    const prompts = ladder.map((r) => buildCoachPrompt(r.text, [], 'How was last week?'));
    // Room for the third rung and its reply, not the second.
    const limit = prompts[2]!.length + REPLY_TOKENS.ask;
    expect(prompts[1]!.length + REPLY_TOKENS.ask).toBeGreaterThan(limit);
    const { backend, counted, streamed } = fakeBackend({ limit });
    const store = await ready(createCoachStore(backend, async () => INPUT));
    await store.getState().ask('How was last week?', 'ask');
    expect(counted).toEqual(prompts.slice(0, 3));
    expect(streamed).toEqual([prompts[2]]);
    expect(store.getState().entries[0]!.label).toBe(ladder[2]!.label);
  });

  it('a question too long for even an empty context is refused, not sent', async () => {
    const { backend, streamed } = fakeBackend({ limit: 10 });
    const store = await ready(createCoachStore(backend, async () => INPUT));
    await store.getState().ask('How was last week?', 'ask');
    expect(streamed).toEqual([]);
    expect(store.getState().error).toBe('Question too long for the model.');
  });

  it('carries the last exchange of the same mode into the next question', async () => {
    const { backend, streamed } = fakeBackend({ reply: ['Fine.'] });
    const store = await ready(createCoachStore(backend, async () => INPUT));
    await store.getState().ask('How was last week?', 'ask');
    await store.getState().ask('And the week before?', 'ask');
    expect(streamed[1]).toContain('User: How was last week?\n\nCoach: Fine.\n\nUser: And the week before?');
  });

  it('shows the plugin\'s own reason when the model fails', async () => {
    const { backend } = fakeBackend({ fail: { message: 'x', data: { genAiError: 'BUSY' } } });
    const store = await ready(createCoachStore(backend, async () => INPUT));
    await store.getState().ask('How was last week?', 'ask');
    expect(store.getState().error).toBe('BUSY');
    expect(store.getState().pending).toBeNull();
    expect(store.getState().entries).toEqual([]);
  });

  it('asks nothing while an answer is still coming', async () => {
    const { backend, streamed } = fakeBackend();
    const store = await ready(createCoachStore(backend, async () => INPUT));
    const first = store.getState().ask('one', 'ask');
    await store.getState().ask('two', 'ask');
    await first;
    expect(streamed).toHaveLength(1);
  });

  it('when the model is not there, says why and sends nothing', async () => {
    const { backend, counted } = fakeBackend({ status: { state: 'unavailable', detail: 'UNAVAILABLE · samsung SM-F971B' } });
    const store = await ready(createCoachStore(backend, async () => INPUT));
    await store.getState().ask('How was last week?', 'ask');
    expect(store.getState().error).toBe('UNAVAILABLE · samsung SM-F971B');
    expect(counted).toEqual([]);
  });

  it('a drafted routine is recognised as one; prose is not', async () => {
    const routine = fakeBackend({ reply: ['Upper A\nBench press 3x8 @ 80kg\n', 'Row 3x10'] });
    const store = await ready(createCoachStore(routine.backend, async () => INPUT));
    await store.getState().ask('3 days upper/lower', 'routine');
    expect(store.getState().entries[0]).toMatchObject({ mode: 'routine', hasRoutine: true });
    expect(routine.streamed[0]).toContain('WORKING WEIGHTS');

    const prose = fakeBackend({ reply: ['I cannot help with that.'] });
    const store2 = await ready(createCoachStore(prose.backend, async () => INPUT));
    await store2.getState().ask('3 days upper/lower', 'routine');
    expect(store2.getState().entries[0]).toMatchObject({ hasRoutine: false });
  });

  it('uses the routine prompt in routine mode and the question prompt otherwise', async () => {
    const system: string[] = [];
    const { backend } = fakeBackend();
    const spy: CoachBackend = { ...backend, stream: (s, p, m, on) => (system.push(s), backend.stream(s, p, m, on)) };
    const store = await ready(createCoachStore(spy, async () => INPUT));
    await store.getState().ask('q', 'ask');
    await store.getState().ask('r', 'routine');
    expect(system).toEqual([buildCoachSystemPrompt('ask'), buildCoachSystemPrompt('routine')]);
  });
});

describe('coach store — a model that goes quiet, and Clear', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const base = (): CoachBackend => ({
    status: async () => READY,
    download: async () => undefined,
    countTokens: async (_s, prompt) => ({ tokens: prompt.length, limit: 100_000 }),
    stream: async () => 'unused',
  });

  it('a count that never comes back ends in an error, not "Answering…" for ever', async () => {
    vi.useFakeTimers();
    const backend: CoachBackend = { ...base(), countTokens: () => new Promise(() => undefined) };
    const store = await ready(createCoachStore(backend, async () => INPUT));
    const asked = store.getState().ask('How was last week?', 'ask');
    await vi.advanceTimersByTimeAsync(COUNT_TIMEOUT_MS - 1);
    expect(store.getState().pending).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await asked;
    expect(store.getState()).toMatchObject({ pending: null, error: 'The model did not answer.' });
  });

  it('an answer that stops arriving is given up after a quiet spell, keeping nothing', async () => {
    vi.useFakeTimers();
    const backend: CoachBackend = {
      ...base(),
      stream: (_s, _p, _m, onText) => {
        onText('Your bench');
        return new Promise(() => undefined);
      },
    };
    const store = await ready(createCoachStore(backend, async () => INPUT));
    const asked = store.getState().ask('How was last week?', 'ask');
    await vi.advanceTimersByTimeAsync(QUIET_TIMEOUT_MS);
    await asked;
    expect(store.getState()).toMatchObject({ pending: null, error: 'The model did not answer.', entries: [] });
  });

  it('a slow answer that keeps arriving is not cut off, however long it takes in all', async () => {
    vi.useFakeTimers();
    const backend: CoachBackend = {
      ...base(),
      stream: async (_s, _p, _m, onText) => {
        for (const piece of ['one ', 'two ', 'three']) {
          await new Promise((r) => setTimeout(r, QUIET_TIMEOUT_MS - 1000));
          onText(piece);
        }
        return 'one two three';
      },
    };
    const store = await ready(createCoachStore(backend, async () => INPUT));
    const asked = store.getState().ask('How was last week?', 'ask');
    await vi.advanceTimersByTimeAsync(3 * QUIET_TIMEOUT_MS);
    await asked;
    expect(store.getState().error).toBeNull();
    expect(store.getState().entries[0]!.answer).toBe('one two three');
  });

  it('Clear while an answer is coming drops it: nothing reappears when it finishes', async () => {
    let finish: (text: string) => void = () => undefined;
    const backend: CoachBackend = {
      ...base(),
      stream: (_s, _p, _m, onText) =>
        new Promise((resolve) => {
          onText('Half');
          finish = resolve;
        }),
    };
    const store = await ready(createCoachStore(backend, async () => INPUT));
    const asked = store.getState().ask('How was last week?', 'ask');
    await vi.waitFor(() => expect(store.getState().pending?.partial).toBe('Half'));
    store.getState().reset();
    expect(store.getState().pending).toBeNull();
    finish('Half an answer.');
    await asked;
    expect(store.getState()).toMatchObject({ pending: null, entries: [], error: null });
  });
});
