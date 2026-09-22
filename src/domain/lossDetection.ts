/**
 * Pure decisions for "history that cannot be lost silently": whether the current row counts look
 * like loss against a remembered baseline, and what (if anything) to offer the user about it.
 * No IO — the baseline is read/written in src/db/lossGuard.ts, backups are read/written in
 * src/db/autoBackup.ts, and src/db/historySafety.ts wires the two to this module's decisions.
 */
import type { BackupFileInfo } from './backupPolicy';

export interface LossBaseline {
  sessions: number;
  sets: number;
  build: string;
  dbVersion: number;
  at: string;
}

export interface LossCurrent {
  sessions: number;
  sets: number;
}

export interface LossRecord {
  fromSessions: number;
  toSessions: number;
  fromSets: number;
  toSets: number;
  detectedAt: string;
}

/**
 * Below-baseline counts are loss UNLESS an in-app deletion is pending (mid-flight when the app
 * stopped, or one this same boot has not yet accounted for) or there is no baseline yet (a build
 * before this feature existed, or a fresh install — both handled by the caller before comparing).
 */
export function detectLoss(baseline: LossBaseline | null, current: LossCurrent, deletionPending: boolean, now: string): LossRecord | null {
  if (!baseline || deletionPending) return null;
  if (current.sessions < baseline.sessions || current.sets < baseline.sets) {
    return {
      fromSessions: baseline.sessions,
      toSessions: current.sessions,
      fromSets: baseline.sets,
      toSets: current.sets,
      detectedAt: now,
    };
  }
  return null;
}

export interface RestoreCandidateSummary {
  filename: string;
  at: string;
  sessions: number;
  sets: number;
}

function toSummary(f: BackupFileInfo): RestoreCandidateSummary {
  return { filename: f.filename, at: f.at, sessions: f.counts.sessions, sets: f.counts.sets };
}

/** The newest backup that holds more than the current data, or null if none does. */
export function pickRestoreCandidate(backups: BackupFileInfo[], current: LossCurrent): RestoreCandidateSummary | null {
  const candidates = backups.filter((b) => b.counts.sessions > current.sessions || b.counts.sets > current.sets);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.at.localeCompare(a.at) || b.filename.localeCompare(a.filename));
  return toSummary(candidates[0]);
}

export type HistoryNoticeKind = 'loss' | 'fresh_install' | 'fresh_install_no_listing';

/** What Home shows: a fact, a restore action when one is possible, and dismiss. Never prose. */
export interface HistoryNotice {
  kind: HistoryNoticeKind;
  detectedAt: string;
  fromSessions?: number;
  toSessions?: number;
  fromSets?: number;
  toSets?: number;
  restoreCandidate?: RestoreCandidateSummary | null;
}

export interface BootHistoryCheckInput {
  /** True when no settings row existed before this boot's seeding ran. */
  wasFreshInstall: boolean;
  baseline: LossBaseline | null;
  deletionPending: boolean;
  current: LossCurrent;
  backups: BackupFileInfo[];
  isNative: boolean;
  now: string;
}

/**
 * What to tell the user at boot, if anything. Null means: nothing to say, the caller should
 * (re)establish the baseline from the current counts.
 */
export function decideHistoryNotice(input: BootHistoryCheckInput): HistoryNotice | null {
  if (input.wasFreshInstall) {
    const candidate = pickRestoreCandidate(input.backups, input.current);
    if (candidate) return { kind: 'fresh_install', detectedAt: input.now, restoreCandidate: candidate };
    // Only on native is "no backups listed" ambiguous (a reinstall can leave the new install
    // unable to list the previous install's files even though they are still on disk) — on the
    // web an empty listing reliably means no backup was ever taken, so no notice.
    if (input.isNative && input.backups.length === 0) {
      return { kind: 'fresh_install_no_listing', detectedAt: input.now };
    }
    return null;
  }
  const loss = detectLoss(input.baseline, input.current, input.deletionPending, input.now);
  if (!loss) return null;
  const candidate = pickRestoreCandidate(input.backups, input.current);
  return {
    kind: 'loss',
    detectedAt: input.now,
    fromSessions: loss.fromSessions,
    toSessions: loss.toSessions,
    fromSets: loss.fromSets,
    toSets: loss.toSets,
    restoreCandidate: candidate,
  };
}
