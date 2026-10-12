/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatReply } from '../ai/chat';
import { resetToSeed, startSession } from '../db/repo';
import { SEED_ROUTINE_IDS } from '../db/seed';
import { configureClaudeCoach, createClaudeCoachStore, getClaudeCoachActions } from './claudeCoach';

const reply = (over: Partial<ChatReply> = {}): ChatReply => ({ ok: true, text: 'Fine.', actions: [], draft: null, stored: true, ...over });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('the coach store', () => {
  it('is busy while a message is out, and clear when the reply arrives', async () => {
    const gate = deferred<ChatReply>();
    const store = createClaudeCoachStore({ send: () => gate.promise });
    const pending = store.getState().send('hello');
    expect(store.getState().busy).toBe(true);
    gate.resolve(reply());
    expect(await pending).toMatchObject({ ok: true });
    expect(store.getState()).toMatchObject({ busy: false, lastError: null });
  });

  it('ignores an empty message and a second one while the first is out', async () => {
    const gate = deferred<ChatReply>();
    const send = vi.fn(() => gate.promise);
    const store = createClaudeCoachStore({ send });
    expect(await store.getState().send('   ')).toBeNull();
    const first = store.getState().send('one');
    expect(await store.getState().send('two')).toBeNull();
    gate.resolve(reply());
    await first;
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('one');
  });

  it('holds an error as the one plain line, until the next send or until cleared', async () => {
    const send = vi.fn<(t: string) => Promise<ChatReply>>().mockResolvedValueOnce(reply({ ok: false, text: 'No connection. The coach needs the internet.', error: 'offline' })).mockResolvedValueOnce(reply());
    const store = createClaudeCoachStore({ send });
    await store.getState().send('a');
    expect(store.getState().lastError).toBe('No connection. The coach needs the internet.');
    store.getState().clearError();
    expect(store.getState().lastError).toBeNull();
    await store.getState().send('b');
    expect(store.getState().lastError).toBeNull();
  });

  it('clears the previous error as soon as a new message goes out', async () => {
    const gate = deferred<ChatReply>();
    const send = vi.fn<(t: string) => Promise<ChatReply>>().mockResolvedValueOnce(reply({ ok: false, text: 'Claude is busy at the moment. Try again in a minute.', error: 'busy' })).mockReturnValueOnce(gate.promise);
    const store = createClaudeCoachStore({ send });
    await store.getState().send('a');
    const second = store.getState().send('b');
    expect(store.getState().lastError).toBeNull();
    gate.resolve(reply());
    await second;
  });

  it('keeps a drafted routine until it is dismissed, replaced by a newer one, but not lost to a plain reply', async () => {
    const draftA = { routines: [], text: 'Push\nBench 3x8' };
    const draftB = { routines: [], text: 'Pull\nRow 3x8' };
    const send = vi
      .fn<(t: string) => Promise<ChatReply>>()
      .mockResolvedValueOnce(reply({ draft: draftA }))
      .mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(reply({ draft: draftB }));
    const store = createClaudeCoachStore({ send });
    await store.getState().send('build a push day');
    expect(store.getState().draft).toBe(draftA);
    await store.getState().send('thanks');
    expect(store.getState().draft).toBe(draftA);
    await store.getState().send('now a pull day');
    expect(store.getState().draft).toBe(draftB);
    store.getState().dismissDraft();
    expect(store.getState().draft).toBeNull();
  });

  it('turns an unexpected throw into a plain line and is not left busy', async () => {
    const store = createClaudeCoachStore({ send: async () => Promise.reject(new Error('IndexedDB exploded')) });
    expect(await store.getState().send('hi')).toBeNull();
    expect(store.getState()).toMatchObject({ busy: false, lastError: 'Something went wrong talking to Claude. Try again.' });
  });
});

describe('configuring the coach', () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetToSeed();
  });

  it('hands the app\'s setPlanOverride to the coach\'s session edits', async () => {
    const setPlanOverride = vi.fn(async () => undefined);
    configureClaudeCoach({ setPlanOverride });
    const session = await startSession(SEED_ROUTINE_IDS['Upper (Push)']);
    const out = await getClaudeCoachActions().editSession({ exercise: 'bench', change: 'sets', sets: 3 });
    expect(out.ok).toBe(true);
    expect(setPlanOverride).toHaveBeenCalledWith(session.id, expect.any(String), { targetSets: 3 });
  });
});
