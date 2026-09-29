import { describe, expect, it } from 'vitest';
import type { StateStorage } from 'zustand/middleware';
import { createSessionDraftStore, draftSlotKey, hasTypedValue, readSlotDraft, SESSION_DRAFT_KEY } from './sessionDraft';

/** A Storage stand-in: vitest runs in node, which has no localStorage. */
function fakeStorage(): StateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('session draft store', () => {
  it('sets, merges and reads a slot draft', () => {
    const store = createSessionDraftStore(() => fakeStorage());
    store.getState().setDraft('s1', 'rx1', { weight: 82.5, reps: 6 });
    store.getState().setDraft('s1', 'rx1', { reps: 7, extraRows: 2 });
    expect(store.getState().sessions).toEqual({ s1: { rx1: { weight: 82.5, reps: 7, extraRows: 2 } } });
  });

  it('keeps a cleared field as null but drops a field patched to undefined', () => {
    const store = createSessionDraftStore(() => fakeStorage());
    store.getState().setDraft('s1', 'rx1', { weight: 82.5, reps: 6 });
    store.getState().setDraft('s1', 'rx1', { weight: null, reps: undefined });
    expect(store.getState().sessions.s1.rx1).toEqual({ weight: null });
  });

  it('leaves no trace once every field of a slot is removed', () => {
    const store = createSessionDraftStore(() => fakeStorage());
    store.getState().setDraft('s1', 'rx1', { weight: 60 });
    store.getState().setDraft('s1', 'rx2', { reps: 5 });
    store.getState().setDraft('s1', 'rx1', { weight: undefined });
    expect(store.getState().sessions).toEqual({ s1: { rx2: { reps: 5 } } });
    store.getState().setDraft('s1', 'rx2', { reps: undefined });
    expect(store.getState().sessions).toEqual({});
  });

  it('clearSlot forgets one removed extra and leaves the rest of the session', () => {
    const store = createSessionDraftStore(() => fakeStorage());
    const extra = draftSlotKey(null, 'leg-press');
    store.getState().setDraft('s1', extra, { weight: 140, reps: 12, extraRows: 1 });
    store.getState().setDraft('s1', 'rx1', { weight: 60 });
    store.getState().clearSlot('s1', extra);
    expect(store.getState().sessions).toEqual({ s1: { rx1: { weight: 60 } } });
    store.getState().clearSlot('s1', 'rx1');
    expect(store.getState().sessions).toEqual({});
  });

  it('clearSession forgets that session only', () => {
    const store = createSessionDraftStore(() => fakeStorage());
    store.getState().setDraft('s1', 'rx1', { weight: 60 });
    store.getState().setDraft('s2', 'rx1', { weight: 70 });
    store.getState().clearSession('s1');
    expect(store.getState().sessions).toEqual({ s2: { rx1: { weight: 70 } } });
  });

  it('survives a fresh store built over the same storage (the reload round trip)', () => {
    const storage = fakeStorage();
    const first = createSessionDraftStore(() => storage);
    first.getState().setDraft('s1', 'rx1', { weight: 82.5, reps: 6, extraRows: 1 });
    expect(storage.data.get(SESSION_DRAFT_KEY)).toContain('82.5');

    const second = createSessionDraftStore(() => storage);
    expect(readSlotDraft(second.getState().sessions, 's1', 'rx1')).toEqual({ weight: 82.5, reps: 6, extraRows: 1 });
  });

  it('a session cleared before the reload stays cleared after it', () => {
    const storage = fakeStorage();
    const first = createSessionDraftStore(() => storage);
    first.getState().setDraft('s1', 'rx1', { weight: 82.5 });
    first.getState().clearSession('s1');
    const second = createSessionDraftStore(() => storage);
    expect(second.getState().sessions).toEqual({});
  });

  it('does not notify subscribers when a patch changes nothing', () => {
    const store = createSessionDraftStore(() => fakeStorage());
    store.getState().setDraft('s1', 'rx1', { weight: 60 });
    let notified = 0;
    store.subscribe(() => notified++);
    store.getState().setDraft('s1', 'rx1', { weight: 60 });
    store.getState().setDraft('s1', 'rx1', { reps: undefined });
    expect(notified).toBe(0);
    store.getState().setDraft('s1', 'rx1', { weight: 61 });
    expect(notified).toBe(1);
  });
});

describe('readSlotDraft', () => {
  it('ignores malformed stored values rather than trusting them', () => {
    const bad = { s1: { rx1: { weight: 'heavy', reps: Number.NaN, distanceM: 20, seconds: null, extraRows: -1 } } } as never;
    expect(readSlotDraft(bad, 's1', 'rx1')).toEqual({ distanceM: 20, seconds: null });
    expect(readSlotDraft(bad, 's1', 'missing')).toBeUndefined();
    expect(readSlotDraft(undefined, 's1', 'rx1')).toBeUndefined();
  });

  it('tells a typed value from open extra rows alone', () => {
    expect(hasTypedValue({ extraRows: 2 })).toBe(false);
    expect(hasTypedValue({ weight: null })).toBe(true);
    expect(hasTypedValue(undefined)).toBe(false);
  });
});

describe('draftSlotKey', () => {
  it('uses the routine-exercise, else the exercise for a session-only extra', () => {
    expect(draftSlotKey('rx1', 'ex1')).toBe('rx1');
    expect(draftSlotKey(null, 'ex1')).toBe('extra:ex1');
    expect(draftSlotKey(undefined, 'ex1')).toBe('extra:ex1');
  });
});
