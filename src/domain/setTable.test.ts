import { describe, expect, it } from 'vitest';
import { fmtSetsLine } from './format';
import { DEFAULT_PLATES } from './plates';
import { completionOf, justCompleted, planRows, type LoggedRow, type PendingRow, type PlanRowsInput, type SetTableRx } from './setTable';
import type { SetLog, SetType } from './types';

let seq = 0;
function mkSet(over: Partial<SetLog> & { index: number }): SetLog {
  seq += 1;
  return {
    id: `set-${seq}`,
    sessionId: 'sess-1',
    routineExerciseId: 'rx-1',
    exerciseId: 'ex-1',
    type: 'working',
    weight: 100,
    completedAt: '2026-01-01T10:00:00.000Z',
    ...over,
  };
}

const baseRx: SetTableRx = {
  targetSets: 3,
  repMin: 6,
  repMax: 8,
  mode: 'normal',
  increment: 2.5,
  distanceMinM: 30,
  distanceMaxM: 40,
};

function baseInput(over: Partial<PlanRowsInput> = {}): PlanRowsInput {
  return {
    kind: 'reps',
    equipment: 'barbell',
    rx: baseRx,
    loggedSets: [],
    previousSets: [],
    prescribedWeight: 100,
    warmup: DEFAULT_PLATES,
    extraRows: 0,
    ...over,
  };
}

function pendingRows(rows: ReturnType<typeof planRows>): PendingRow[] {
  return rows.filter((r): r is PendingRow => r.kind === 'target' || r.kind === 'extra');
}

function loggedRows(rows: ReturnType<typeof planRows>): LoggedRow[] {
  return rows.filter((r): r is LoggedRow => r.kind === 'logged');
}

describe('planRows: no history', () => {
  it('every pending row falls back to repMin reps and has no Previous text', () => {
    const rows = planRows(baseInput({ previousSets: [], loggedSets: [] }));
    const pending = pendingRows(rows);
    expect(pending).toHaveLength(3);
    for (const row of pending) {
      expect(row.previous).toBeNull();
      expect(row.previousText).toBe('');
      expect(row.ghostReps).toBe(6); // repMin, never repMax
      expect(row.ghostWeight).toBe(100); // prescribedWeight
    }
    expect(pending.map((r) => r.status)).toEqual(['next', 'later', 'later']);
    expect(pending.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it('with no history, reps just logged in this session carry down to the rows below', () => {
    const logged = [mkSet({ type: 'working', weight: 100, reps: 8, index: 0 })];
    const rows = planRows(baseInput({ previousSets: [], loggedSets: logged }));
    const pending = pendingRows(rows);
    expect(pending.map((r) => r.ghostReps)).toEqual([8, 8]);
  });

  it('last time still wins over the set just done, when there is a last time', () => {
    const logged = [mkSet({ type: 'working', weight: 100, reps: 8, index: 0 })];
    const previous = [mkSet({ type: 'working', weight: 100, reps: 7, index: 0 }), mkSet({ type: 'working', weight: 100, reps: 6, index: 1 })];
    const rows = planRows(baseInput({ previousSets: previous, loggedSets: logged }));
    expect(pendingRows(rows)[0].ghostReps).toBe(6);
  });

  it('a calibrating slot with no history at all has a null ghost weight', () => {
    const rows = planRows(
      baseInput({ rx: { ...baseRx, mode: 'calibrating' }, prescribedWeight: null, previousSets: [], loggedSets: [] }),
    );
    for (const row of pendingRows(rows)) expect(row.ghostWeight).toBeNull();
  });
});

describe('planRows: history shorter than target (clamp)', () => {
  it('clamps every position past the end of history to the last previous counted set', () => {
    const previousSets = [
      mkSet({ index: 0, type: 'working', weight: 95, reps: 8 }),
      mkSet({ index: 1, type: 'working', weight: 92.5, reps: 7 }),
    ];
    const rows = planRows(
      baseInput({ rx: { ...baseRx, targetSets: 4, mode: 'calibrating' }, prescribedWeight: null, previousSets, loggedSets: [] }),
    );
    const pending = pendingRows(rows);
    expect(pending).toHaveLength(4);
    expect(pending.map((r) => r.previous?.weight)).toEqual([95, 92.5, 92.5, 92.5]);
    expect(pending.map((r) => r.ghostReps)).toEqual([8, 7, 7, 7]);
    expect(pending.map((r) => r.ghostWeight)).toEqual([95, 92.5, 92.5, 92.5]);
    expect(pending.map((r) => r.previousText)).toEqual(['95 × 8', '92.5 × 7', '92.5 × 7', '92.5 × 7']);
  });
});

describe('planRows: history longer than target', () => {
  it('only the first targetSets positions are used; the rest of the history is ignored', () => {
    const previousSets = [
      mkSet({ index: 0, type: 'working', weight: 100, reps: 8 }),
      mkSet({ index: 1, type: 'working', weight: 102.5, reps: 8 }),
      mkSet({ index: 2, type: 'working', weight: 105, reps: 7 }),
      mkSet({ index: 3, type: 'working', weight: 107.5, reps: 6 }),
      mkSet({ index: 4, type: 'working', weight: 110, reps: 5 }),
    ];
    const rows = planRows(
      baseInput({ rx: { ...baseRx, targetSets: 3, mode: 'calibrating' }, prescribedWeight: null, previousSets, loggedSets: [] }),
    );
    const pending = pendingRows(rows);
    expect(pending).toHaveLength(3);
    expect(pending.map((r) => r.previous?.weight)).toEqual([100, 102.5, 105]);
    expect(pending.map((r) => r.ghostReps)).toEqual([8, 8, 7]);
  });
});

describe('planRows: calibrating ghost weight — no prescribed weight, so it falls back', () => {
  it('null when nothing was carried this session and there is no history', () => {
    const rows = planRows(baseInput({ rx: { ...baseRx, mode: 'calibrating' }, prescribedWeight: null, loggedSets: [], previousSets: [] }));
    expect(pendingRows(rows)[0].ghostWeight).toBeNull();
  });

  it('carries the weight of the last counted set logged this session, ahead of history', () => {
    const loggedSets = [mkSet({ index: 0, type: 'working', weight: 45, reps: 10 })];
    const previousSets = [mkSet({ index: 0, type: 'working', weight: 50, reps: 8 })];
    const rows = planRows(
      baseInput({ rx: { ...baseRx, mode: 'calibrating' }, prescribedWeight: null, loggedSets, previousSets }),
    );
    const nextPending = pendingRows(rows)[0];
    expect(nextPending.status).toBe('next');
    expect(nextPending.ghostWeight).toBe(45); // carried, not the 50 kg previous session
  });

  it('falls back to the previous session weight when nothing was logged this session yet', () => {
    const previousSets = [mkSet({ index: 0, type: 'working', weight: 60, reps: 5 })];
    const rows = planRows(baseInput({ rx: { ...baseRx, mode: 'calibrating' }, prescribedWeight: null, loggedSets: [], previousSets }));
    expect(pendingRows(rows)[0].ghostWeight).toBe(60);
  });
});

describe('planRows: a deload-adjusted prescribed weight always wins', () => {
  it('beats both the weight carried this session and the previous session', () => {
    const loggedSets = [mkSet({ index: 0, type: 'working', weight: 100, reps: 6 })];
    const previousSets = [mkSet({ index: 0, type: 'working', weight: 110, reps: 6 })];
    const rows = planRows(baseInput({ prescribedWeight: 85, loggedSets, previousSets }));
    const nextPending = pendingRows(rows)[0];
    expect(nextPending.ghostWeight).toBe(85);
  });
});

describe('planRows: warm-up ghosts', () => {
  it('show the full ramp before the first counted set of the slot', () => {
    const rows = planRows(baseInput({ loggedSets: [], previousSets: [] }));
    const ghosts = rows.filter((r) => r.kind === 'warmup-ghost');
    expect(ghosts).toEqual([
      { kind: 'warmup-ghost', weight: 20, reps: 10 },
      { kind: 'warmup-ghost', weight: 50, reps: 5 },
      { kind: 'warmup-ghost', weight: 70, reps: 3 },
      { kind: 'warmup-ghost', weight: 90, reps: 1 },
    ]);
  });

  it('a logged warm-up consumes the next ramp step', () => {
    const loggedSets = [mkSet({ index: 0, type: 'warmup', weight: 20, reps: 10 }), mkSet({ index: 1, type: 'warmup', weight: 50, reps: 5 })];
    const rows = planRows(baseInput({ loggedSets, previousSets: [] }));
    const ghosts = rows.filter((r) => r.kind === 'warmup-ghost');
    expect(ghosts).toEqual([
      { kind: 'warmup-ghost', weight: 70, reps: 3 },
      { kind: 'warmup-ghost', weight: 90, reps: 1 },
    ]);
    // The logged warm-ups still show as their own logged rows, badged 'W'.
    expect(loggedRows(rows).map((r) => r.badge)).toEqual(['W', 'W']);
  });

  it('disappear entirely once the first counted set is logged, however many ramp steps were done', () => {
    const loggedSets = [mkSet({ index: 0, type: 'working', weight: 100, reps: 6 })];
    const rows = planRows(baseInput({ loggedSets, previousSets: [] }));
    expect(rows.some((r) => r.kind === 'warmup-ghost')).toBe(false);
  });

  it('never appear for carry or timed kinds, even with a prescribed weight', () => {
    const carryRows = planRows(baseInput({ kind: 'carry', prescribedWeight: 24, loggedSets: [], previousSets: [] }));
    expect(carryRows.some((r) => r.kind === 'warmup-ghost')).toBe(false);
    const timedRows = planRows(baseInput({ kind: 'timed', rx: { ...baseRx, repMin: 30, repMax: 60 }, loggedSets: [], previousSets: [] }));
    expect(timedRows.some((r) => r.kind === 'warmup-ghost')).toBe(false);
  });

  it('never appear when there is no prescribed weight (calibrating) or it is 0', () => {
    const calibrating = planRows(baseInput({ rx: { ...baseRx, mode: 'calibrating' }, prescribedWeight: null, loggedSets: [], previousSets: [] }));
    expect(calibrating.some((r) => r.kind === 'warmup-ghost')).toBe(false);
    const zero = planRows(baseInput({ kind: 'bodyweight_plus', prescribedWeight: 0, loggedSets: [], previousSets: [] }));
    expect(zero.some((r) => r.kind === 'warmup-ghost')).toBe(false);
  });
});

describe('planRows: a drop or warm-up set never advances the counted position', () => {
  it('the next target row still lands at position 0 after a drop and a warm-up are logged', () => {
    const loggedSets = [mkSet({ index: 0, type: 'drop', weight: 80, reps: 10 }), mkSet({ index: 1, type: 'warmup', weight: 50, reps: 5 })];
    const rows = planRows(baseInput({ loggedSets, previousSets: [] }));
    expect(loggedRows(rows).map((r) => r.badge)).toEqual(['D', 'W']);
    const pending = pendingRows(rows);
    expect(pending).toHaveLength(3); // target 3 − 0 counted
    expect(pending[0].position).toBe(0);
    expect(pending[0].status).toBe('next');
  });
});

describe('planRows: extra rows', () => {
  it('appended after completion, continuing the position sequence, first one "next"', () => {
    const loggedSets = [
      mkSet({ index: 0, type: 'working', weight: 100, reps: 6 }),
      mkSet({ index: 1, type: 'working', weight: 100, reps: 6 }),
      mkSet({ index: 2, type: 'working', weight: 100, reps: 6 }),
    ];
    const rows = planRows(baseInput({ loggedSets, previousSets: [], extraRows: 2 }));
    const pending = pendingRows(rows);
    expect(pending).toHaveLength(2); // target already met, only the extras are pending
    expect(pending.every((r) => r.kind === 'extra')).toBe(true);
    expect(pending.map((r) => r.position)).toEqual([3, 4]);
    expect(pending.map((r) => r.status)).toEqual(['next', 'later']);
  });
});

describe('planRows: carry kind', () => {
  const carryRx: SetTableRx = { ...baseRx, targetSets: 2, distanceMinM: 30, distanceMaxM: 40 };

  it('ghost distance falls back to the rx minimum with no history', () => {
    const rows = planRows(baseInput({ kind: 'carry', rx: carryRx, prescribedWeight: 24, loggedSets: [], previousSets: [] }));
    const pending = pendingRows(rows);
    expect(pending[0].ghostDistanceM).toBe(30);
    expect(pending[0].ghostSeconds).toBeNull(); // no rx minimum for carry seconds
    expect(pending[0].ghostReps).toBeNull();
  });

  it('ghost distance and seconds come from the previous session when there is one', () => {
    const previousSets = [mkSet({ index: 0, type: 'working', weight: 24, distanceM: 35, seconds: 42 })];
    const rows = planRows(baseInput({ kind: 'carry', rx: carryRx, prescribedWeight: 24, loggedSets: [], previousSets }));
    const pending = pendingRows(rows);
    expect(pending[0].ghostDistanceM).toBe(35);
    expect(pending[0].ghostSeconds).toBe(42);
    expect(pending[0].previousText).toBe(fmtSetsLine([previousSets[0]], 'carry'));
  });
});

describe('planRows: timed kind', () => {
  const timedRx: SetTableRx = { ...baseRx, targetSets: 2, repMin: 30, repMax: 60 };

  it('ghost seconds falls back to repMin (the seconds minimum) with no history, never repMax', () => {
    const rows = planRows(baseInput({ kind: 'timed', rx: timedRx, prescribedWeight: null, loggedSets: [], previousSets: [] }));
    const pending = pendingRows(rows);
    expect(pending[0].ghostSeconds).toBe(30);
    expect(pending[0].ghostReps).toBeNull();
    expect(pending[0].ghostDistanceM).toBeNull();
  });

  it('ghost seconds comes from the previous session when there is one', () => {
    const previousSets = [mkSet({ index: 0, type: 'working', weight: 0, seconds: 45 })];
    const rows = planRows(baseInput({ kind: 'timed', rx: timedRx, prescribedWeight: null, loggedSets: [], previousSets }));
    const pending = pendingRows(rows);
    expect(pending[0].ghostSeconds).toBe(45);
    expect(pending[0].previousText).toBe('45 s');
  });
});

describe('planRows: bodyweight_plus with 0 kg added', () => {
  it('a prescribed weight of exactly 0 is a real value, not "missing" — it is never overridden', () => {
    const previousSets = [mkSet({ index: 0, type: 'working', weight: 5, reps: 10 })];
    const rows = planRows(baseInput({ kind: 'bodyweight_plus', prescribedWeight: 0, loggedSets: [], previousSets }));
    const pending = pendingRows(rows);
    expect(pending[0].ghostWeight).toBe(0);
    // 0 kg is not > 0, so no warm-up ramp is shown even though it's a weighted kind with no counted sets yet.
    expect(rows.some((r) => r.kind === 'warmup-ghost')).toBe(false);
  });
});

describe('completionOf', () => {
  it('counts only working/failure sets against the target', () => {
    const sets: { type: SetType }[] = [{ type: 'warmup' }, { type: 'drop' }, { type: 'working' }, { type: 'failure' }];
    expect(completionOf(sets, 3)).toEqual({ countedDone: 2, target: 3, complete: false });
  });

  it('complete once counted sets reach the target', () => {
    const sets: { type: SetType }[] = [{ type: 'working' }, { type: 'working' }, { type: 'working' }];
    expect(completionOf(sets, 3)).toEqual({ countedDone: 3, target: 3, complete: true });
  });

  it('stays complete past the target (extras)', () => {
    const sets: { type: SetType }[] = [{ type: 'working' }, { type: 'working' }, { type: 'working' }, { type: 'working' }];
    expect(completionOf(sets, 3).complete).toBe(true);
  });
});

describe('justCompleted', () => {
  it('true only on the log that crosses the target', () => {
    expect(justCompleted(2, 3, 3)).toBe(true);
  });

  it('false while still under target', () => {
    expect(justCompleted(1, 2, 3)).toBe(false);
  });

  it('false when already complete before this log — a reload never replays the celebration', () => {
    expect(justCompleted(3, 4, 3)).toBe(false);
  });

  it('false when nothing changed', () => {
    expect(justCompleted(3, 3, 3)).toBe(false);
  });
});
