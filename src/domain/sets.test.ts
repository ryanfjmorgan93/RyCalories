import { describe, expect, it } from 'vitest';
import {
  FEEL_OPTIONS,
  SET_TYPES,
  countsForProgression,
  countsForRecords,
  countsForVolume,
  effortRir,
  feelLabel,
  feelOf,
  sessionCountsForRecords,
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
});

describe('feel', () => {
  it('offers three chips, Easy/Good/Hard, at RIR 3/2/1', () => {
    expect(FEEL_OPTIONS).toEqual([
      { rir: 3, label: 'Easy' },
      { rir: 2, label: 'Good' },
      { rir: 1, label: 'Hard' },
    ]);
  });

  it('labels a logged RIR as the matching feel word', () => {
    expect(feelLabel(1)).toBe('Hard');
    expect(feelLabel(2)).toBe('Good');
    expect(feelLabel(3)).toBe('Easy');
  });

  it('reads the retired Maxed answer (RIR 0, or Hevy\'s 0) as Hard: Maxed merged into Hard', () => {
    expect(feelLabel(0)).toBe('Hard');
    expect(feelLabel(-1)).toBe('Hard');
  });

  it('reads a Hevy 4 or 5 as Easy, not a fifth chip', () => {
    expect(feelLabel(4)).toBe('Easy');
    expect(feelLabel(5)).toBe('Easy');
  });

  it('is null for an unlogged RIR, never a guess', () => {
    expect(feelLabel(undefined)).toBeNull();
  });

  it('feelOf reads the shared RIR of the slot\'s counted, non-failure sets', () => {
    const sets = [
      { type: 'warmup' as const, rir: 5 }, // ignored: never counted
      { type: 'working' as const, rir: 3 },
      { type: 'drop' as const, rir: 3 }, // ignored: not counted
      { type: 'working' as const, rir: 3 },
    ];
    expect(feelOf(sets)).toBe(3);
  });

  it('feelOf excludes failure sets from the agreement, even when they would agree', () => {
    const sets = [
      { type: 'working' as const, rir: 3 },
      { type: 'working' as const, rir: 3 },
      { type: 'failure' as const, rir: 3 }, // excluded regardless of its own rir
    ];
    expect(feelOf(sets)).toBe(3);
  });

  it('feelOf is null when the counted non-failure sets disagree', () => {
    const sets = [
      { type: 'working' as const, rir: 3 },
      { type: 'working' as const, rir: 1 },
    ];
    expect(feelOf(sets)).toBeNull();
  });

  it('feelOf is null when none of the counted non-failure sets carry an RIR', () => {
    expect(feelOf([{ type: 'working' as const }, { type: 'working' as const }])).toBeNull();
  });

  it('feelOf is null when a counted non-failure set is missing its RIR while another has one', () => {
    expect(feelOf([{ type: 'working' as const, rir: 3 }, { type: 'working' as const }])).toBeNull();
  });

  it('feelOf is null with no sets at all, or only sets that never count', () => {
    expect(feelOf([])).toBeNull();
    expect(feelOf([{ type: 'warmup' as const, rir: 3 }, { type: 'drop' as const, rir: 3 }])).toBeNull();
  });
});

describe('sessionCountsForRecords', () => {
  it('a light quick session is submaximal by design and feeds no record or strength figure', () => {
    expect(sessionCountsForRecords({ quick: 'light' })).toBe(false);
  });

  it('a normal quick session, and every other session, counts in full', () => {
    expect(sessionCountsForRecords({ quick: 'normal' })).toBe(true);
    expect(sessionCountsForRecords({})).toBe(true);
  });
});
