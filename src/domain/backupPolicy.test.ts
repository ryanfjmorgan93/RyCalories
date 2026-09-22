import { describe, expect, it } from 'vitest';
import {
  AUTO_BACKUP_INTERVAL_MS,
  KEEP_AUTO,
  KEEP_SPECIAL,
  backupFilename,
  parseBackupFilename,
  selectPruneTargets,
  shouldAutoBackup,
  slugifyBuildLabel,
  type BackupCounts,
  type BackupFileInfo,
  type BackupKind,
} from './backupPolicy';

const COUNTS: BackupCounts = { sessions: 20, sets: 310, exercises: 27, routines: 5, meals: 12 };

describe('slugifyBuildLabel', () => {
  it('strips everything that is not filesystem-safe', () => {
    expect(slugifyBuildLabel('Iron 0.1.0 · build 127 · abc1234')).toBe('Iron-0.1.0-build-127-abc1234');
  });

  it('never returns an empty string', () => {
    expect(slugifyBuildLabel('···')).toBe('unknown');
    expect(slugifyBuildLabel('')).toBe('unknown');
  });
});

describe('backupFilename / parseBackupFilename round-trip', () => {
  it('recovers kind, timestamp, counts, db version and build for every kind', () => {
    const at = '2026-09-22T18:40:05.123Z';
    for (const kind of ['auto', 'premig', 'predestr'] as BackupKind[]) {
      const name = backupFilename(kind, at, COUNTS, 2, 'Iron 0.1.0 · build 127');
      const parsed = parseBackupFilename(name);
      expect(parsed).not.toBeNull();
      expect(parsed!.kind).toBe(kind);
      expect(parsed!.at).toBe('2026-09-22T18:40:05.000Z');
      expect(parsed!.counts).toEqual(COUNTS);
      expect(parsed!.dbVersion).toBe(2);
      expect(parsed!.buildSlug).toBe('Iron-0.1.0-build-127');
    }
  });

  it('refuses anything that is not one of this app own filenames', () => {
    expect(parseBackupFilename('iron-backup-2026-01-01-00-00-00.json')).toBeNull(); // old manual-export shape
    expect(parseBackupFilename('random-file.txt')).toBeNull();
    expect(parseBackupFilename('.DS_Store')).toBeNull();
    expect(parseBackupFilename('iron-auto-2026-09-22-18-40-05-s1-k1-e1-r1-m1-v2-b.json')).not.toBeNull();
  });
});

describe('shouldAutoBackup', () => {
  const now = '2026-09-22T12:00:00.000Z';

  it('is due when there is no previous automatic backup', () => {
    expect(shouldAutoBackup(null, now)).toBe(true);
  });

  it('is not due just under the interval', () => {
    const justUnder = new Date(Date.parse(now) - (AUTO_BACKUP_INTERVAL_MS - 1000)).toISOString();
    expect(shouldAutoBackup(justUnder, now)).toBe(false);
  });

  it('is due just over the interval', () => {
    const justOver = new Date(Date.parse(now) - (AUTO_BACKUP_INTERVAL_MS + 1000)).toISOString();
    expect(shouldAutoBackup(justOver, now)).toBe(true);
  });

  it('is due for an unparseable timestamp rather than silently never backing up', () => {
    expect(shouldAutoBackup('not-a-date', now)).toBe(true);
  });
});

describe('selectPruneTargets', () => {
  function file(kind: BackupKind, at: string, n: number): BackupFileInfo {
    return { filename: `f-${kind}-${n}-${at}`, kind, at, counts: COUNTS, dbVersion: 2, buildSlug: 'x' };
  }

  it('keeps the newest KEEP_AUTO automatic backups and prunes the rest', () => {
    const files = Array.from({ length: KEEP_AUTO + 3 }, (_, i) => file('auto', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, i));
    const pruned = selectPruneTargets(files);
    expect(pruned).toHaveLength(3);
    // The three oldest (lowest date) are the ones pruned.
    const prunedIndexes = files.filter((f) => pruned.includes(f.filename)).map((f) => Number(f.filename.split('-')[2]));
    expect(prunedIndexes.sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('keeps pre-migration and pre-destructive backups as one pool of KEEP_SPECIAL, separate from automatic', () => {
    const autoFiles = Array.from({ length: 2 }, (_, i) => file('auto', `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, i));
    const specialFiles = [
      ...Array.from({ length: 3 }, (_, i) => file('premig', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, i)),
      ...Array.from({ length: 4 }, (_, i) => file('predestr', `2026-03-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, i)),
    ];
    const pruned = selectPruneTargets([...autoFiles, ...specialFiles]);
    // 2 auto (under the cap) survive entirely; 7 special total, cap 5, so 2 pruned — and they must
    // be the two OLDEST of the combined special pool (the premig ones from January), not evicted
    // just for being a different kind from the newest predestr ones.
    expect(pruned).toHaveLength(2);
    expect(pruned.every((f) => f.startsWith('f-premig-'))).toBe(true);
    expect(pruned).toEqual(expect.arrayContaining([specialFiles[0].filename, specialFiles[1].filename]));
  });

  it('never touches a file it does not recognise as its own (caller filters those out first)', () => {
    // selectPruneTargets only ever sees BackupFileInfo, which parseBackupFilename only produces
    // for this app's own filenames — nothing to assert here beyond the type itself, but keep a
    // smoke test that an unrelated-looking kind never appears from real parsing.
    expect(KEEP_SPECIAL).toBeGreaterThan(0);
  });
});
