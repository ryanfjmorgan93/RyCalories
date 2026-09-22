import { describe, expect, it } from 'vitest';
import type { BackupFileInfo } from './backupPolicy';
import { decideHistoryNotice, detectLoss, pickRestoreCandidate, type LossBaseline } from './lossDetection';

const NOW = '2026-09-22T12:00:00.000Z';
const BASELINE: LossBaseline = { sessions: 20, sets: 310, build: 'Iron 0.1.0', dbVersion: 2, at: '2026-09-20T08:00:00.000Z' };

function backup(filename: string, at: string, sessions: number, sets: number): BackupFileInfo {
  return { filename, kind: 'auto', at, counts: { sessions, sets, exercises: 27, routines: 5, meals: 0 }, dbVersion: 2, buildSlug: 'x' };
}

describe('detectLoss', () => {
  it('is null with no baseline yet', () => {
    expect(detectLoss(null, { sessions: 0, sets: 0 }, false, NOW)).toBeNull();
  });

  it('is null when an in-app deletion is pending, however low the counts', () => {
    expect(detectLoss(BASELINE, { sessions: 0, sets: 0 }, true, NOW)).toBeNull();
  });

  it('is null when current counts meet or exceed the baseline', () => {
    expect(detectLoss(BASELINE, { sessions: 20, sets: 310 }, false, NOW)).toBeNull();
    expect(detectLoss(BASELINE, { sessions: 25, sets: 400 }, false, NOW)).toBeNull();
  });

  it('fires on a session drop even if sets alone would not have', () => {
    const rec = detectLoss(BASELINE, { sessions: 4, sets: 310 }, false, NOW);
    expect(rec).toEqual({ fromSessions: 20, toSessions: 4, fromSets: 310, toSets: 310, detectedAt: NOW });
  });

  it('fires on a set drop even if sessions alone would not have', () => {
    const rec = detectLoss(BASELINE, { sessions: 20, sets: 66 }, false, NOW);
    expect(rec).not.toBeNull();
    expect(rec!.fromSets).toBe(310);
    expect(rec!.toSets).toBe(66);
  });
});

describe('pickRestoreCandidate', () => {
  const current = { sessions: 4, sets: 66 };

  it('is null when no backup holds more than the current data', () => {
    expect(pickRestoreCandidate([backup('a', '2026-09-21T00:00:00.000Z', 4, 66)], current)).toBeNull();
  });

  it('picks the newest backup that holds more, ignoring older bigger ones', () => {
    const older = backup('older', '2026-09-19T00:00:00.000Z', 20, 310);
    const newer = backup('newer', '2026-09-21T00:00:00.000Z', 18, 300);
    const candidate = pickRestoreCandidate([older, newer], current);
    expect(candidate?.filename).toBe('newer');
  });

  it('qualifies on sets alone even with fewer sessions', () => {
    const candidate = pickRestoreCandidate([backup('b', '2026-09-21T00:00:00.000Z', 2, 200)], current);
    expect(candidate?.filename).toBe('b');
  });
});

describe('decideHistoryNotice — fresh install', () => {
  const base = { wasFreshInstall: true, baseline: null, deletionPending: false, current: { sessions: 0, sets: 0 }, now: NOW };

  it('offers the backup when a fresh install finds one with data', () => {
    const backups = [backup('iron-auto-x', '2026-09-20T00:00:00.000Z', 20, 310)];
    const notice = decideHistoryNotice({ ...base, backups, isNative: false });
    expect(notice?.kind).toBe('fresh_install');
    expect(notice?.restoreCandidate?.filename).toBe('iron-auto-x');
  });

  it('says nothing on the web when no backup is listed — the ordinary fresh-install case', () => {
    expect(decideHistoryNotice({ ...base, backups: [], isNative: false })).toBeNull();
  });

  it('offers a file-picker fallback on native when nothing can be listed', () => {
    const notice = decideHistoryNotice({ ...base, backups: [], isNative: true });
    expect(notice?.kind).toBe('fresh_install_no_listing');
  });

  it('says nothing on native when backups are listed but none hold data', () => {
    // e.g. only pre-migration/pre-destructive backups of an already-empty database.
    const backups = [backup('iron-auto-empty', '2026-09-20T00:00:00.000Z', 0, 0)];
    expect(decideHistoryNotice({ ...base, backups, isNative: true })).toBeNull();
  });
});

describe('decideHistoryNotice — ordinary boot', () => {
  const base = { wasFreshInstall: false, current: { sessions: 4, sets: 66 }, isNative: false, now: NOW, backups: [] as BackupFileInfo[] };

  it('says nothing with no baseline yet (a build before this feature existed)', () => {
    expect(decideHistoryNotice({ ...base, baseline: null, deletionPending: false })).toBeNull();
  });

  it('says nothing when a deletion is pending', () => {
    expect(decideHistoryNotice({ ...base, baseline: BASELINE, deletionPending: true })).toBeNull();
  });

  it('says nothing when current counts are not below baseline', () => {
    expect(decideHistoryNotice({ ...base, baseline: BASELINE, deletionPending: false, current: { sessions: 20, sets: 310 } })).toBeNull();
  });

  it('reports loss with the exact before/after counts and no candidate when none qualifies', () => {
    const notice = decideHistoryNotice({ ...base, baseline: BASELINE, deletionPending: false });
    expect(notice).toEqual({
      kind: 'loss',
      detectedAt: NOW,
      fromSessions: 20,
      toSessions: 4,
      fromSets: 310,
      toSets: 66,
      restoreCandidate: null,
    });
  });

  it('attaches the newest qualifying backup as the restore candidate', () => {
    const backups = [backup('iron-auto-x', '2026-09-21T00:00:00.000Z', 20, 310)];
    const notice = decideHistoryNotice({ ...base, baseline: BASELINE, deletionPending: false, backups });
    expect(notice?.restoreCandidate?.filename).toBe('iron-auto-x');
  });
});
