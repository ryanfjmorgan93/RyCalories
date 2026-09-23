import { describe, expect, it } from 'vitest';
import { mergeStableSlots } from './mergeStableSlots';
import type { SetLog } from './types';

function set(id: string, patch: Partial<SetLog> = {}): SetLog {
  return {
    id,
    sessionId: 's1',
    routineExerciseId: 'rx1',
    exerciseId: 'e1',
    index: 0,
    type: 'working',
    weight: 100,
    reps: 8,
    completedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('mergeStableSlots', () => {
  it('reuses the previous array for a slot whose sets are byte-for-byte the same', () => {
    const prevArr = [set('1'), set('2')];
    const prev = new Map([['A', prevArr]]);
    // A fresh array, same contents — the shape `setsBySlot`'s memo rebuilds every render.
    const next = new Map([['A', [set('1'), set('2')]]]);
    const out = mergeStableSlots(prev, next);
    expect(out.get('A')).toBe(prevArr);
  });

  it('gives a new array to a slot whose sets actually changed (one more set)', () => {
    const prevArr = [set('1')];
    const prev = new Map([['A', prevArr]]);
    const nextArr = [set('1'), set('2')];
    const next = new Map([['A', nextArr]]);
    const out = mergeStableSlots(prev, next);
    expect(out.get('A')).toBe(nextArr);
    expect(out.get('A')).not.toBe(prevArr);
  });

  it('does not touch an untouched slot when a DIFFERENT slot changes', () => {
    const untouchedArr = [set('1')];
    const prev = new Map([
      ['A', untouchedArr],
      ['B', [set('2')]],
    ]);
    const next = new Map([
      ['A', [set('1')]], // fresh array, same contents
      ['B', [set('2'), set('3')]], // B actually changed
    ]);
    const out = mergeStableSlots(prev, next);
    expect(out.get('A')).toBe(untouchedArr);
    expect(out.get('B')).not.toBe(prev.get('B'));
  });

  it('detects a field change even with the same id and array length (a retyped or edited set)', () => {
    const prev = new Map([['A', [set('1', { type: 'working', rir: 3 })]]]);
    const next = new Map([['A', [set('1', { type: 'failure', rir: undefined })]]]);
    const out = mergeStableSlots(prev, next);
    expect(out.get('A')).toBe(next.get('A'));
  });

  it('gives a brand-new slot its own array (nothing to compare against)', () => {
    const prev = new Map<string, SetLog[]>();
    const nextArr = [set('1')];
    const next = new Map([['A', nextArr]]);
    const out = mergeStableSlots(prev, next);
    expect(out.get('A')).toBe(nextArr);
  });

  it('drops a slot missing from `next` (e.g. a removed extra) — never carries over from `prev`', () => {
    const prev = new Map([['A', [set('1')]]]);
    const next = new Map<string, SetLog[]>();
    const out = mergeStableSlots(prev, next);
    expect(out.has('A')).toBe(false);
  });

  it('is order-sensitive: the same sets in a different order count as changed', () => {
    const prev = new Map([['A', [set('1'), set('2')]]]);
    const next = new Map([['A', [set('2'), set('1')]]]);
    const out = mergeStableSlots(prev, next);
    expect(out.get('A')).toBe(next.get('A'));
  });
});
