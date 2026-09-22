/**
 * Pure decisions about automatic backups: what a backup file is named (and what that name says
 * about it), when a new automatic one is due, and which old ones to prune. No IO — the writer,
 * reader and pruner live in src/db/autoBackup.ts.
 *
 * Everything a backup list needs to render (kind, time, row counts, db version, build) is encoded
 * in the FILENAME rather than read from the file. Two reasons: (1) Capacitor's Filesystem plugin
 * has no partial-read API, so showing a list would otherwise mean reading every backup in full —
 * fine for this app's data today, not fine to depend on as history grows; (2) a separate index
 * file would itself need to survive the exact failure modes backups exist to survive (reinstall
 * attribution, storage eviction) and could drift from what is actually on disk. A directory
 * listing (`readdir`) cannot drift from itself.
 */

export type BackupKind = 'auto' | 'premig' | 'predestr';

/** Automatic backups kept, newest first. */
export const KEEP_AUTO = 14;
/** Pre-migration and pre-destructive backups are one pool, kept separately from automatic ones. */
export const KEEP_SPECIAL = 5;

/** An automatic backup at boot is due once the newest one is this old, or none exists. */
export const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface BackupCounts {
  sessions: number;
  sets: number;
  exercises: number;
  routines: number;
  meals: number;
}

export interface BackupFileInfo {
  filename: string;
  kind: BackupKind;
  /** ISO timestamp (second precision) decoded from the filename. */
  at: string;
  counts: BackupCounts;
  dbVersion: number;
  buildSlug: string;
}

/** Filesystem-safe stand-in for BUILD_LABEL ("Iron 0.1.0 · build 127 · abc1234" → "Iron-0.1.0-build-127-abc1234"). */
export function slugifyBuildLabel(label: string): string {
  const slug = label
    .replace(/[^A-Za-z0-9.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (slug || 'unknown').slice(0, 60);
}

const FILENAME_RE =
  /^iron-(auto|premig|predestr)-(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})-s(\d+)-k(\d+)-e(\d+)-r(\d+)-m(\d+)-v(\d+)-b([A-Za-z0-9.-]*)\.json$/;

function stampOf(at: string): string {
  return at.slice(0, 19).replace(/[:T]/g, '-');
}

export function backupFilename(kind: BackupKind, at: string, counts: BackupCounts, dbVersion: number, buildLabel: string): string {
  const slug = slugifyBuildLabel(buildLabel);
  return `iron-${kind}-${stampOf(at)}-s${counts.sessions}-k${counts.sets}-e${counts.exercises}-r${counts.routines}-m${counts.meals}-v${dbVersion}-b${slug}.json`;
}

/** Parses a filename this app wrote back into its metadata; null for anything else (never touch a file we did not create). */
export function parseBackupFilename(filename: string): BackupFileInfo | null {
  const m = FILENAME_RE.exec(filename);
  if (!m) return null;
  const [, kind, stamp, s, k, e, r, meals, v, buildSlug] = m;
  const at = `${stamp.slice(0, 10)}T${stamp.slice(11).replace(/-/g, ':')}.000Z`;
  return {
    filename,
    kind: kind as BackupKind,
    at,
    counts: { sessions: Number(s), sets: Number(k), exercises: Number(e), routines: Number(r), meals: Number(meals) },
    dbVersion: Number(v),
    buildSlug,
  };
}

/** True when the newest automatic backup (its `at`, or null if there is none) is due for renewal. */
export function shouldAutoBackup(newestAutoAt: string | null, now: string): boolean {
  if (!newestAutoAt) return true;
  const age = Date.parse(now) - Date.parse(newestAutoAt);
  if (!Number.isFinite(age)) return true;
  return age > AUTO_BACKUP_INTERVAL_MS;
}

function newestFirst(a: BackupFileInfo, b: BackupFileInfo): number {
  return b.at.localeCompare(a.at) || b.filename.localeCompare(a.filename);
}

/**
 * Which of this app's own backup files to delete, keeping the newest `KEEP_AUTO` automatic ones
 * and the newest `KEEP_SPECIAL` pre-migration/pre-destructive ones as one combined pool (kept
 * separately FROM the automatic pool — pruning one never evicts the other).
 */
export function selectPruneTargets(files: BackupFileInfo[]): string[] {
  const auto = files.filter((f) => f.kind === 'auto').sort(newestFirst);
  const special = files.filter((f) => f.kind !== 'auto').sort(newestFirst);
  const keep = highWaterMarks(files);
  return [...auto.slice(KEEP_AUTO), ...special.slice(KEEP_SPECIAL)].map((f) => f.filename).filter((name) => !keep.has(name));
}

/**
 * The backup holding the most sessions and the one holding the most sets (newest on a tie),
 * whatever their age. Pruning by age alone would let the copies taken after a loss — one a day,
 * one per finished workout — push the last complete copy out of the newest 14 within two weeks,
 * which is exactly when it is needed.
 */
export function highWaterMarks(files: BackupFileInfo[]): Set<string> {
  const keep = new Set<string>();
  const byNewest = [...files].sort(newestFirst);
  const most = (pick: (f: BackupFileInfo) => number) =>
    byNewest.reduce<BackupFileInfo | null>((best, f) => (!best || pick(f) > pick(best) ? f : best), null);
  const sessions = most((f) => f.counts.sessions);
  const sets = most((f) => f.counts.sets);
  if (sessions) keep.add(sessions.filename);
  if (sets) keep.add(sets.filename);
  return keep;
}
