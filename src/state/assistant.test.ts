import { describe, expect, it, vi } from 'vitest';
import type { AssistantContext } from '../domain/assistant';
import { createAssistantStore, type AssistantBackend } from './assistant';
import type { NanoStatus } from './nano';

const ctx: AssistantContext = { today: '2026-09-16' };

function fakeBackend(overrides: Partial<AssistantBackend> = {}): AssistantBackend {
  return {
    kind: 'nano',
    status: vi.fn(async (): Promise<NanoStatus> => ({ state: 'ready', detail: 'AVAILABLE' })),
    ask: vi.fn(async () => 'Fine.'),
    ...overrides,
  };
}

describe('useAssistant (via createAssistantStore)', () => {
  it('appends both turns to the thread on a successful ask', async () => {
    const backend = fakeBackend({ ask: vi.fn(async () => 'You lifted 100 kg for 3x8.') });
    const store = createAssistantStore(backend);
    await store.getState().refreshStatus();

    await store.getState().ask('What did I lift last time?', ctx);

    const { thread, busy, error } = store.getState();
    expect(busy).toBe(false);
    expect(error).toBeNull();
    expect(thread).toEqual([
      { role: 'user', text: 'What did I lift last time?' },
      { role: 'assistant', text: 'You lifted 100 kg for 3x8.' },
    ]);
  });

  it('grows the thread further on a second question', async () => {
    const backend = fakeBackend();
    const store = createAssistantStore(backend);
    await store.getState().refreshStatus();

    await store.getState().ask('First question?', ctx);
    await store.getState().ask('Second question?', ctx);

    expect(store.getState().thread).toHaveLength(4);
    expect(store.getState().thread[2]).toEqual({ role: 'user', text: 'Second question?' });
  });

  it('does not send an empty or whitespace-only question', async () => {
    const backend = fakeBackend();
    const store = createAssistantStore(backend);
    await store.getState().refreshStatus();

    await store.getState().ask('   ', ctx);

    expect(backend.ask).not.toHaveBeenCalled();
    expect(store.getState().thread).toEqual([]);
  });

  it('busy latch prevents a second concurrent send', async () => {
    let resolveAsk!: (text: string) => void;
    const askPromise = new Promise<string>((resolve) => {
      resolveAsk = resolve;
    });
    const ask = vi.fn(() => askPromise);
    const backend = fakeBackend({ ask });
    const store = createAssistantStore(backend);
    await store.getState().refreshStatus();

    const first = store.getState().ask('Question one?', ctx);
    expect(store.getState().busy).toBe(true);

    // Fired while the first call is still in flight: must be a no-op.
    const second = store.getState().ask('Question two?', ctx);

    resolveAsk('Answer.');
    await Promise.all([first, second]);

    expect(ask).toHaveBeenCalledTimes(1);
    expect(store.getState().thread).toHaveLength(2);
    expect(store.getState().thread[0]).toEqual({ role: 'user', text: 'Question one?' });
  });

  it('reports "On-device model unavailable." when status is unavailable, without calling the backend', async () => {
    const backend = fakeBackend({ status: vi.fn(async (): Promise<NanoStatus> => ({ state: 'unavailable', detail: 'UNAVAILABLE' })) });
    const store = createAssistantStore(backend);
    await store.getState().refreshStatus();

    await store.getState().ask('Anything?', ctx);

    expect(backend.ask).not.toHaveBeenCalled();
    expect(store.getState().error).toBe('On-device model unavailable.');
    expect(store.getState().thread).toEqual([]);
  });

  it('reports "Model not downloaded." when status is downloadable or downloading', async () => {
    for (const state of ['downloadable', 'downloading'] as const) {
      const backend = fakeBackend({ status: vi.fn(async (): Promise<NanoStatus> => ({ state, detail: state })) });
      const store = createAssistantStore(backend);
      await store.getState().refreshStatus();

      await store.getState().ask('Anything?', ctx);

      expect(backend.ask).not.toHaveBeenCalled();
      expect(store.getState().error).toBe('Model not downloaded.');
    }
  });

  it('reports "The model did not answer." when the backend throws', async () => {
    const backend = fakeBackend({
      ask: vi.fn(async () => {
        throw new Error('generate_failed: empty');
      }),
    });
    const store = createAssistantStore(backend);
    await store.getState().refreshStatus();

    await store.getState().ask('Anything?', ctx);

    expect(store.getState().error).toBe('The model did not answer.');
    expect(store.getState().busy).toBe(false);
    expect(store.getState().thread).toEqual([]);
  });

  it('reports "The model did not answer." when the reply trims to nothing', async () => {
    const backend = fakeBackend({ ask: vi.fn(async () => '   ') });
    const store = createAssistantStore(backend);
    await store.getState().refreshStatus();

    await store.getState().ask('Anything?', ctx);

    expect(store.getState().error).toBe('The model did not answer.');
    expect(store.getState().thread).toEqual([]);
  });

  it('reset() clears the thread and any error but keeps the last known status', async () => {
    const backend = fakeBackend({
      ask: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const store = createAssistantStore(backend);
    await store.getState().refreshStatus();
    await store.getState().ask('Anything?', ctx);
    expect(store.getState().error).not.toBeNull();

    store.getState().reset();

    expect(store.getState().thread).toEqual([]);
    expect(store.getState().error).toBeNull();
    expect(store.getState().status).toEqual({ state: 'ready', detail: 'AVAILABLE' });
  });
});
