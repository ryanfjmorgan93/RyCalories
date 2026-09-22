import { describe, expect, it } from 'vitest';
import { bestsFor, newRecords, type RecordSession, type RecordSet } from './records';
import { e1rm } from './strength';

function session(sessionId: string, sets: RecordSet[], over: Partial<RecordSession> = {}): RecordSession {
  return { sessionId, startedAt: '2026-01-01T10:00:00.000Z', sets, ...over };
}

/** Most tests below are about the record-picking logic, not the history gate itself — assert it separately. */
const HIST = { hasPriorHistory: true };

describe('bestsFor', () => {
  it('is all null/empty with no prior sessions', () => {
    const b = bestsFor('reps', []);
    expect(b).toEqual({ weight: null, e1rm: null, setVolume: null, repsAtWeight: new Map() });
  });

  it('ignores warm-ups and drop sets entirely', () => {
    const b = bestsFor('reps', [
      session('s1', [
        { type: 'warmup', weight: 200, reps: 1 },
        { type: 'drop', weight: 150, reps: 20 },
        { type: 'working', weight: 100, reps: 5 },
      ]),
    ]);
    expect(b.weight).toBe(100);
  });

  it('tracks the best reps at each exact weight', () => {
    const b = bestsFor('reps', [
      session('s1', [
        { type: 'working', weight: 100, reps: 5 },
        { type: 'working', weight: 100, reps: 8 },
        { type: 'working', weight: 80, reps: 12 },
      ]),
    ]);
    expect(b.repsAtWeight.get(100)).toBe(8);
    expect(b.repsAtWeight.get(80)).toBe(12);
  });
});

describe('newRecords: gating', () => {
  // The two traps this exists to close: a first-ever session showing a PR on set 2 because it
  // beat set 1, and a calibrating attempt (weight not yet established) reading as a record.
  it('produces nothing when hasPriorHistory is not asserted, even when a later set beats an earlier one', () => {
    expect(
      newRecords('reps', [
        { type: 'working', weight: 60, reps: 5 },
        { type: 'working', weight: 80, reps: 5 },
      ], []),
    ).toEqual([]);
  });

  it('produces nothing without hasPriorHistory even when real prior sessions are passed', () => {
    // A caller must set the flag explicitly — the prior array alone is not enough, because a
    // caller may have already spliced same-session sets into it (see recordsQueries.ts).
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    expect(newRecords('reps', [{ type: 'working', weight: 200, reps: 1 }], prior)).toEqual([]);
    expect(newRecords('reps', [{ type: 'working', weight: 200, reps: 1 }], prior, { hasPriorHistory: false })).toEqual([]);
  });

  it('produces nothing while calibrating, even with real prior history and a beaten best', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    const recs = newRecords('reps', [{ type: 'working', weight: 150, reps: 5 }], prior, { hasPriorHistory: true, calibrating: true });
    expect(recs).toEqual([]);
  });

  it('reports records once hasPriorHistory is true and the slot is not calibrating', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    const recs = newRecords('reps', [{ type: 'working', weight: 105, reps: 5 }], prior, { hasPriorHistory: true, calibrating: false });
    expect(recs.find((r) => r.kind === 'weight')).toBeDefined();
  });
});

describe('newRecords: weight', () => {
  it('is a record for a heavier weight than ever lifted', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    const recs = newRecords('reps', [{ type: 'working', weight: 105, reps: 3 }], prior, HIST);
    const weightRec = recs.find((r) => r.kind === 'weight');
    expect(weightRec).toMatchObject({ value: 105, weight: 105, previous: 100, previousSource: 'app' });
  });

  it('a tie is not a record', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    const recs = newRecords('reps', [{ type: 'working', weight: 100, reps: 5 }], prior, HIST);
    expect(recs.find((r) => r.kind === 'weight')).toBeUndefined();
  });

  it('is a record with no prior best value, and previous/previousSource are null, when history is asserted', () => {
    // hasPriorHistory can be true with an empty `prior` — the flag and the sessions array are
    // deliberately independent (a caller may know history exists from elsewhere, e.g. Hevy, that
    // didn't produce a comparable best for this particular kind).
    const recs = newRecords('reps', [{ type: 'working', weight: 60, reps: 5 }], [], HIST);
    const weightRec = recs.find((r) => r.kind === 'weight');
    expect(weightRec).toMatchObject({ value: 60, previous: null, previousSource: null });
  });

  it('a drop set in the new sets never sets a record', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    const recs = newRecords('reps', [{ type: 'drop', weight: 200, reps: 20 }], prior, HIST);
    expect(recs.find((r) => r.kind === 'weight')).toBeUndefined();
  });

  it('a warm-up in the new sets never sets a record', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    const recs = newRecords('reps', [{ type: 'warmup', weight: 200, reps: 5 }], prior, HIST);
    expect(recs.find((r) => r.kind === 'weight')).toBeUndefined();
  });

  it('attributes the beaten best to hevy when that session came from hevy', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }], { source: 'hevy' })];
    const recs = newRecords('reps', [{ type: 'working', weight: 105, reps: 3 }], prior, HIST);
    expect(recs.find((r) => r.kind === 'weight')?.previousSource).toBe('hevy');
  });

  it('treats a backup session as app, not hevy', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }], { source: 'backup' })];
    const recs = newRecords('reps', [{ type: 'working', weight: 105, reps: 3 }], prior, HIST);
    expect(recs.find((r) => r.kind === 'weight')?.previousSource).toBe('app');
  });

  it('picks the best of several improving new sets, reporting the kind once', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    const recs = newRecords(
      'reps',
      [
        { type: 'working', weight: 102, reps: 5 },
        { type: 'working', weight: 110, reps: 5 },
        { type: 'working', weight: 106, reps: 5 },
      ],
      prior,
      HIST,
    );
    const weightRecs = recs.filter((r) => r.kind === 'weight');
    expect(weightRecs).toHaveLength(1);
    expect(weightRecs[0]).toMatchObject({ value: 110, setIndex: 1 });
  });
});

describe('newRecords: e1rm', () => {
  it('is a record for a higher estimated max', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    const recs = newRecords('reps', [{ type: 'working', weight: 100, reps: 8 }], prior, HIST);
    const rec = recs.find((r) => r.kind === 'e1rm');
    expect(rec?.value).toBe(e1rm(100, 8));
    expect(rec?.previous).toBe(e1rm(100, 5));
  });

  it('bodyweight_plus without a bodyweight never produces an e1rm record — not zero, skipped', () => {
    const prior = [session('s1', [{ type: 'working', weight: 10, reps: 5 }])];
    const recs = newRecords('bodyweight_plus', [{ type: 'working', weight: 15, reps: 5 }], prior, HIST);
    expect(recs.find((r) => r.kind === 'e1rm')).toBeUndefined();
    // the weight record still fires independently
    expect(recs.find((r) => r.kind === 'weight')).toBeDefined();
  });

  it('bodyweight_plus with a bodyweight produces an e1rm record', () => {
    const prior = [session('s1', [{ type: 'working', weight: 10, reps: 5 }])];
    const recs = newRecords('bodyweight_plus', [{ type: 'working', weight: 15, reps: 5 }], prior, {
      ...HIST,
      bodyweightKg: 80,
    });
    const rec = recs.find((r) => r.kind === 'e1rm');
    expect(rec?.value).toBe(e1rm(95, 5));
  });

  it('carry and timed exercises never produce records of any kind', () => {
    const prior = [session('s1', [{ type: 'working', weight: 20, reps: 5 }])];
    expect(newRecords('carry', [{ type: 'working', weight: 30, reps: 5 }], prior, HIST)).toEqual([]);
    expect(newRecords('timed', [{ type: 'working', weight: 0, reps: 5 }], prior, HIST)).toEqual([]);
  });
});

describe('newRecords: set_volume', () => {
  it('is a record for higher weight×reps in one set', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])]; // 500
    const recs = newRecords('reps', [{ type: 'working', weight: 80, reps: 8 }], prior, HIST); // 640
    const rec = recs.find((r) => r.kind === 'set_volume');
    expect(rec).toMatchObject({ value: 640, previous: 500 });
  });

  it('a drop set counts for volume elsewhere but never sets a volume record', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])]; // 500
    const recs = newRecords('reps', [{ type: 'drop', weight: 90, reps: 10 }], prior, HIST); // would be 900
    expect(recs.find((r) => r.kind === 'set_volume')).toBeUndefined();
  });

  it('a tie in set volume is not a record', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])]; // 500
    const recs = newRecords('reps', [{ type: 'working', weight: 50, reps: 10 }], prior, HIST); // 500
    expect(recs.find((r) => r.kind === 'set_volume')).toBeUndefined();
  });
});

describe('newRecords: reps_at_weight', () => {
  it('is a record for more reps at a weight lifted before', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    const recs = newRecords('reps', [{ type: 'working', weight: 100, reps: 7 }], prior, HIST);
    const rec = recs.find((r) => r.kind === 'reps_at_weight');
    expect(rec).toMatchObject({ value: 7, weight: 100, previous: 5 });
  });

  it('is not reported for a weight never lifted before — that is a weight record instead', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    const recs = newRecords('reps', [{ type: 'working', weight: 120, reps: 3 }], prior, HIST);
    expect(recs.find((r) => r.kind === 'reps_at_weight')).toBeUndefined();
    expect(recs.find((r) => r.kind === 'weight')).toBeDefined();
  });

  it('a tie in reps at the same weight is not a record', () => {
    const prior = [session('s1', [{ type: 'working', weight: 100, reps: 5 }])];
    const recs = newRecords('reps', [{ type: 'working', weight: 100, reps: 5 }], prior, HIST);
    expect(recs.find((r) => r.kind === 'reps_at_weight')).toBeUndefined();
  });
});
