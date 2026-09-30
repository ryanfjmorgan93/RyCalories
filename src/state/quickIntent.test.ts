/**
 * @vitest-environment jsdom
 *
 * jsdom (not the default `node` environment) because the production pairing at the bottom goes
 * through the real web plugin, which reads the global `window` for the Playwright test hook
 * (`window.__ironNanoFake`) — see nano.ts. Everything above it injects a fake backend.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildIntentPrompt } from '../domain/quickRequest';
import { createAssistantStore, useAssistant } from './assistant';
import type { NanoStatus } from './nano';
import { createQuickIntentStore, INTENT_MAX_TOKENS, INTENT_TIMEOUT_MS, useQuickIntent, type QuickIntentBackend } from './quickIntent';

const READY: NanoStatus = { state: 'ready', detail: 'AVAILABLE · default' };
const TEXT = 'four light exercises for my fancy bits';

/** A model that answers with `reply` and keeps every (system, prompt) it was given. */
function fakeModel(reply: string | (() => Promise<string>) = '{"focus":["biceps"]}') {
  const calls: { system: string; prompt: string }[] = [];
  const backend: QuickIntentBackend = {
    generate: async (system, prompt) => {
      calls.push({ system, prompt });
      return typeof reply === 'function' ? reply() : reply;
    },
  };
  return { backend, calls };
}

const storeOn = (backend: QuickIntentBackend, status: NanoStatus | null = READY) => createQuickIntentStore(backend, () => status);

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { __quickIntentTimeoutMs?: number }).__quickIntentTimeoutMs;
  delete (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake;
  useAssistant.setState({ status: null });
});

describe('quick intent store — what it sends and what it returns', () => {
  it('sends the typed line once, in the strict-options prompt, and returns what the reply names', async () => {
    const { backend, calls } = fakeModel('{"focus":["biceps"],"count":6}');
    const store = storeOn(backend);
    const result = await store.getState().read(TEXT);
    expect(result).toEqual({ focus: ['biceps'], count: 6 });
    expect(calls).toEqual([buildIntentPrompt(TEXT)]);
    expect(calls[0]!.prompt).toContain(TEXT);
    expect(store.getState()).toMatchObject({ busy: false, error: null });
  });

  it('reads a reply in a code fence, or with prose around it', async () => {
    const fenced = storeOn(fakeModel('Here you go:\n```json\n{"effort":"light","minutes":30}\n```').backend);
    expect(await fenced.getState().read(TEXT)).toEqual({ effort: 'light', minutes: 30 });
    const prose = storeOn(fakeModel('Sure. {"equipment":["dumbbell"]} Anything else?').backend);
    expect(await prose.getState().read(TEXT)).toEqual({ equipment: ['dumbbell'] });
  });

  it('keeps what was right in a half-right reply', async () => {
    const store = storeOn(fakeModel('{"count":99,"effort":"light","focus":["wings"]}').backend);
    expect(await store.getState().read(TEXT)).toEqual({ effort: 'light' });
  });

  it('never returns an exercise, a weight, an exclusion or Include new, whatever the reply holds', async () => {
    const reply = JSON.stringify({
      exercises: ['Bench Press (Barbell)'],
      weights: [100],
      sets: 5,
      reps: 5,
      exclude: ['quads'],
      includeNew: true,
      count: 5,
    });
    const store = storeOn(fakeModel(reply).backend);
    const result = await store.getState().read(TEXT);
    expect(result).toEqual({ count: 5 });
    expect(Object.keys(result!)).toEqual(['count']);
  });

  it('a reply holding only exercises and weights reads as nothing', async () => {
    const store = storeOn(fakeModel('{"exercises":["Bench"],"weights":[100]}').backend);
    expect(await store.getState().read(TEXT)).toBeNull();
    expect(store.getState().error).toBeNull();
  });

  it('a reply that is not options at all reads as nothing, and is not an error', async () => {
    for (const reply of ['I cannot help with that.', '', '{}', '[1,2,3]', '{"focus":[]}']) {
      const store = storeOn(fakeModel(reply).backend);
      expect(await store.getState().read(TEXT)).toBeNull();
      expect(store.getState()).toMatchObject({ busy: false, error: null });
    }
  });

  it('is stateless between calls: the second call carries nothing of the first', async () => {
    const { backend, calls } = fakeModel('{"count":5}');
    const store = storeOn(backend);
    await store.getState().read(TEXT);
    await store.getState().read('some other words entirely');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(buildIntentPrompt('some other words entirely'));
    expect(calls[1]!.prompt).not.toContain('fancy');
    expect(calls[1]!.system).toBe(calls[0]!.system);
  });

  it('sends nothing for a line with nothing in it', async () => {
    const { backend, calls } = fakeModel();
    const store = storeOn(backend);
    expect(await store.getState().read('')).toBeNull();
    expect(await store.getState().read('   \n ')).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('quick intent store — only when the model is ready', () => {
  it('asks nothing of a model whose state has not been checked', async () => {
    const { backend, calls } = fakeModel();
    const store = storeOn(backend, null);
    expect(await store.getState().read(TEXT)).toBeNull();
    expect(calls).toEqual([]);
    expect(store.getState()).toMatchObject({ busy: false, error: 'Status not checked yet.' });
  });

  it('asks nothing of a model that is unavailable, and says why as the phone said it', async () => {
    const { backend, calls } = fakeModel();
    const store = storeOn(backend, { state: 'unavailable', detail: 'UNAVAILABLE · samsung SM-F971B' });
    expect(await store.getState().read(TEXT)).toBeNull();
    expect(calls).toEqual([]);
    expect(store.getState().error).toBe('UNAVAILABLE · samsung SM-F971B');
  });

  it.each(['downloadable', 'downloading'] as const)('asks nothing of a model that is %s', async (state) => {
    const { backend, calls } = fakeModel();
    const store = storeOn(backend, { state, detail: state });
    expect(await store.getState().read(TEXT)).toBeNull();
    expect(calls).toEqual([]);
    expect(store.getState().error).toBe('Model not downloaded.');
  });

  it('follows the assistant store\'s own status, read live at each call', async () => {
    const assistant = createAssistantStore({
      kind: 'nano',
      status: async () => READY,
      ask: async () => 'unused',
    });
    const { backend, calls } = fakeModel('{"count":4}');
    const store = createQuickIntentStore(backend, () => assistant.getState().status);

    expect(await store.getState().read(TEXT)).toBeNull();
    expect(calls).toEqual([]);

    await assistant.getState().refreshStatus();
    expect(await store.getState().read(TEXT)).toEqual({ count: 4 });
    expect(calls).toHaveLength(1);

    assistant.setState({ status: { state: 'unavailable', detail: 'gone' } });
    expect(await store.getState().read(TEXT)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(store.getState().error).toBe('gone');
  });

  it('an empty line starts nothing and clears the last call\'s error', async () => {
    const { backend } = fakeModel('{"count":4}');
    const store = storeOn(backend, null);
    await store.getState().read(TEXT);
    expect(store.getState().error).toBe('Status not checked yet.');
    await store.getState().read('  ');
    expect(store.getState().error).toBeNull();
  });
});

describe('quick intent store — a call at a time', () => {
  it('ignores a second tap while the first is running, and the first still lands', async () => {
    let answer: (text: string) => void = () => undefined;
    let asked = 0;
    // The first call is held; any other would be answered at once, so a second call that got through would show.
    const { backend, calls } = fakeModel(() => (++asked === 1 ? new Promise<string>((resolve) => (answer = resolve)) : Promise.resolve('{"count":2}')));
    const store = storeOn(backend);

    const first = store.getState().read(TEXT);
    expect(store.getState().busy).toBe(true);
    // Fired while the first is in flight: a no-op that does not reach the model and does not touch the error.
    expect(await store.getState().read('something else')).toBeNull();
    expect(calls).toHaveLength(1);
    expect(store.getState()).toMatchObject({ busy: true, error: null });

    answer('{"count":5}');
    expect(await first).toEqual({ count: 5 });
    expect(calls).toHaveLength(1);
    expect(store.getState().busy).toBe(false);
  });

  it('can be used again once a call has finished', async () => {
    const { backend, calls } = fakeModel('{"count":5}');
    const store = storeOn(backend);
    await store.getState().read(TEXT);
    await store.getState().read(TEXT);
    expect(calls).toHaveLength(2);
  });
});

describe('quick intent store — a model that fails or goes quiet', () => {
  it('a model that throws ends the call with its own message, and the latch is released', async () => {
    const store = storeOn({ generate: async () => Promise.reject(new Error('bad_request: prompt too long')) });
    expect(await store.getState().read(TEXT)).toBeNull();
    expect(store.getState()).toMatchObject({ busy: false, error: 'bad_request: prompt too long' });
  });

  it('a named ML Kit failure is shown as that name', async () => {
    const store = storeOn({ generate: async () => Promise.reject(Object.assign(new Error('x'), { data: { genAiError: 'RESPONSE_GENERATION_ERROR' } })) });
    await store.getState().read(TEXT);
    expect(store.getState().error).toBe('RESPONSE_GENERATION_ERROR');
  });

  it('a model that fails with nothing to say reads as the plain fact', async () => {
    const store = storeOn({ generate: async () => Promise.reject(new Error('')) });
    expect(await store.getState().read(TEXT)).toBeNull();
    expect(store.getState().error).toBe('The model did not answer.');
  });

  it('an error does not outlive the next call', async () => {
    let fail = true;
    const store = storeOn({ generate: async () => (fail ? Promise.reject(new Error('boom')) : '{"count":5}') });
    await store.getState().read(TEXT);
    expect(store.getState().error).toBe('boom');
    fail = false;
    expect(await store.getState().read(TEXT)).toEqual({ count: 5 });
    expect(store.getState().error).toBeNull();
  });

  it('a model that never answers is given up on after 20 seconds, with the plain fact', async () => {
    vi.useFakeTimers();
    expect(INTENT_TIMEOUT_MS).toBe(20_000);
    const store = storeOn({ generate: () => new Promise<string>(() => undefined) });
    const asked = store.getState().read(TEXT);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(store.getState()).toMatchObject({ busy: true, error: null });
    await vi.advanceTimersByTimeAsync(1);
    expect(await asked).toBeNull();
    expect(store.getState()).toMatchObject({ busy: false, error: 'The model did not answer.' });
  });

  it('a timeout for a test is honoured when one is set, and only then', async () => {
    vi.useFakeTimers();
    (globalThis as { __quickIntentTimeoutMs?: number }).__quickIntentTimeoutMs = 300;
    const store = storeOn({ generate: () => new Promise<string>(() => undefined) });
    const asked = store.getState().read(TEXT);
    await vi.advanceTimersByTimeAsync(299);
    expect(store.getState().busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await asked;
    expect(store.getState().error).toBe('The model did not answer.');
  });

  it('an answer that arrives after the limit is dropped, and does not disturb the next call', async () => {
    vi.useFakeTimers();
    const late: ((text: string) => void)[] = [];
    let held = false;
    const backend: QuickIntentBackend = {
      generate: () => new Promise<string>((resolve) => (held ? resolve('{"count":5}') : late.push(resolve))),
    };
    const store = storeOn(backend);
    const first = store.getState().read(TEXT);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await first).toBeNull();

    held = true;
    const second = store.getState().read(TEXT);
    late[0]!('{"count":3}');
    expect(await second).toEqual({ count: 5 });
    expect(store.getState()).toMatchObject({ busy: false, error: null });
  });
});

describe('quick intent — the app\'s own pairing, through the real plugin and the real assistant store', () => {
  it('asks the default model, for a short and unvarying reply, once the assistant store has seen it ready', async () => {
    const asked: Record<string, unknown>[] = [];
    (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
      status: READY,
      generate: async (opts: Record<string, unknown>) => {
        asked.push(opts);
        return { text: '{"focus":["biceps"]}' };
      },
    };

    // Not yet seen ready: nothing is sent.
    expect(await useQuickIntent.getState().read(TEXT)).toBeNull();
    expect(asked).toEqual([]);

    await useAssistant.getState().refreshStatus();
    expect(await useQuickIntent.getState().read(TEXT)).toEqual({ focus: ['biceps'] });
    expect(asked).toEqual([{ ...buildIntentPrompt(TEXT), maxOutputTokens: INTENT_MAX_TOKENS, temperature: 0 }]);
    expect(INTENT_MAX_TOKENS).toBe(120);
    // The default model: no `model` key at all, which the plugin reads as the default.
    expect(asked[0]).not.toHaveProperty('model');
  });

  it('an assistant that is not ready sends nothing', async () => {
    const asked: unknown[] = [];
    (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = {
      status: { state: 'downloadable', detail: 'DOWNLOADABLE' },
      generate: async (opts: unknown) => {
        asked.push(opts);
        return { text: '{}' };
      },
    };
    await useAssistant.getState().refreshStatus();
    expect(await useQuickIntent.getState().read(TEXT)).toBeNull();
    expect(asked).toEqual([]);
  });
});
