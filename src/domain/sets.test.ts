import { describe, expect, it } from 'vitest';
import {
  SET_TYPES,
  countsForProgression,
  countsForRecords,
  countsForVolume,
  effortOptions,
  effortRir,
  formatEffort,
  rirFromRpe,
  rpeFromRir,
  setBadges,
} from './sets';

describe('set types', () => {
  it('names every type once', () => {
    expect(SET_TYPES).toEqual(['warmup', 'working', 'failure', 'drop']);
  });

  it('working and failure sets drive progression; drops and warm-ups never do', () => {
    expect(countsForProgression('working')).toBe(true);
    expect(countsForProgression('failure')).toBe(true);
    expect(countsForProgression('drop')).toBe(false);
    expect(countsForProgression('warmup')).toBe(false);
  });

  it('everything but a warm-up counts for volume', () => {
    expect(countsForVolume('warmup')).toBe(false);
    expect(countsForVolume('working')).toBe(true);
    expect(countsForVolume('failure')).toBe(true);
    expect(countsForVolume('drop')).toBe(true);
  });

  it('records come from the same sets as progression', () => {
    for (const t of SET_TYPES) expect(countsForRecords(t)).toBe(countsForProgression(t));
  });

  it('a failure set with no RIR reads as RIR 0; a logged RIR always wins', () => {
    expect(effortRir({ type: 'failure' })).toBe(0);
    expect(effortRir({ type: 'failure', rir: 1 })).toBe(1);
    expect(effortRir({ type: 'working' })).toBeUndefined();
    expect(effortRir({ type: 'working', rir: 3 })).toBe(3);
    expect(effortRir({ type: 'working', rir: Number.NaN })).toBeUndefined();
  });

  it('numbers only the sets that count, in order', () => {
    const sets = [{ type: 'warmup' }, { type: 'warmup' }, { type: 'working' }, { type: 'drop' }, { type: 'failure' }, { type: 'working' }] as const;
    expect(setBadges([...sets])).toEqual(['W', 'W', 1, 'D', 2, 3]);
    expect(setBadges([])).toEqual([]);
  });

  it('converts RIR and RPE both ways in halves', () => {
    expect(rpeFromRir(0)).toBe(10);
    expect(rpeFromRir(2)).toBe(8);
    expect(rpeFromRir(0.5)).toBe(9.5);
    expect(rirFromRpe(7.5)).toBe(2.5);
    for (const rir of [0, 0.5, 1, 1.5, 2, 3, 4, 5]) expect(rirFromRpe(rpeFromRir(rir))).toBe(rir);
  });

  it('offers RIR 0–5 or RPE 10 down to 6, storing RIR either way', () => {
    expect(effortOptions('rir').map((o) => o.label)).toEqual(['0', '1', '2', '3', '4', '5']);
    const rpe = effortOptions('rpe');
    expect(rpe.map((o) => o.label)).toEqual(['10', '9.5', '9', '8.5', '8', '7.5', '7', '6.5', '6']);
    expect(rpe.map((o) => o.rir)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
  });

  it('formats effort in the chosen scale', () => {
    expect(formatEffort(2, 'rir')).toBe('RIR 2');
    expect(formatEffort(2, 'rpe')).toBe('RPE 8');
    expect(formatEffort(0.5, 'rpe')).toBe('RPE 9.5');
  });
});
