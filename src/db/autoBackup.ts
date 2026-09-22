/**
 * Automatic-backup IO: writes/lists/prunes files under Documents/Iron via @capacitor/filesystem,
 * and the small "did the last backup work" status Settings shows. Decisions (filename, when one is
 * due, which to prune) live in src/domain/backupPolicy.ts; this file is only IO.
 *
 * Deliberately holds no static import of src/db/backup.ts. backup.ts already imports
 * src/db/repo.ts (for `migrateSeed`), and repo.ts calls into this module before a destructive
 * operation, and backup.ts's own replace-mode restore does too — importing `exportBackup`
 * statically here as well would complete a require cycle across three files. TypeScript's
 * `import type` is erased at compile time so it carries no runtime edge; the one place that needs
 * the actual `exportBackup` function (src/db/historySafety.ts) is not part of that cycle at all.
 *
 * Runs on both native (Directory.Documents/Iron, survives an app update or uninstall — but see the
 * caveat on `listBackups`) and web (the Filesystem plugin's own IndexedDB-backed store, separate
 * from this app's `iron` database) — the same plugin call either way, so Playwright exercises the
 * real write/list/prune path rather than a stand-in for it.
 */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import {
  backupFilename,
  parseBackupFilename,
  selectPruneTargets,
  shouldAutoBackup,
  type BackupCounts,
  type BackupFileInfo,
  type BackupKind,
} from '@/domain/backupPolicy';
import { BUILD_LABEL } from '@/buildInfo';
import { db } from './db';
import type { Backup } from './backup';

const DIRECTORY = Directory.Documents;
const FOLDER = 'Iron';

const STATUS_KEY = 'iron.backupStatus.v1';

export interface BackupStatus {
  lastSuccessAt?: string;
  lastSuccessFilename?: string;
  lastFailure?: { at: string; reason: string } | null;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getBackupStatus(): BackupStatus {
  const s = storage();
  if (!s) return {};
  try {
    const raw = s.getItem(STATUS_KEY);
    return raw ? (JSON.parse(raw) as BackupStatus) : {};
  } catch {
    return {};
  }
}

function writeStatus(patch: Partial<BackupStatus>): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STATUS_KEY, JSON.stringify({ ...getBackupStatus(), ...patch }));
  } catch {
    /* best effort */
  }
}

function recordSuccess(filename: string, at: string): void {
  writeStatus({ lastSuccessAt: at, lastSuccessFilename: filename, lastFailure: null });
}

export function recordBackupFailure(reason: string): void {
  writeStatus({ lastFailure: { at: new Date().toISOString(), reason } });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * List every backup this app recognises as its own (readdir + filename parsing, no file content
 * read — see backupPolicy.ts for why the filename alone is enough). A missing folder (never
 * backed up yet) and any other readdir failure both come back as an empty list; the caller cannot
 * tell those apart from JS, which is deliberate — see the native "cannot list" fallback in
 * lossDetection.ts.
 */
export async function listBackups(): Promise<BackupFileInfo[]> {
  try {
    const res = await Filesystem.readdir({ path: FOLDER, directory: DIRECTORY });
    return res.files
      .filter((f) => f.type === 'file')
      .map((f) => parseBackupFilename(f.name))
      .filter((x): x is BackupFileInfo => x !== null);
  } catch {
    return [];
  }
}

async function pruneOldBackups(): Promise<void> {
  const files = await listBackups();
  const toDelete = selectPruneTargets(files);
  for (const filename of toDelete) {
    try {
      await Filesystem.deleteFile({ path: `${FOLDER}/${filename}`, directory: DIRECTORY });
    } catch {
      /* best effort — a file we failed to delete just gets picked up by the next prune */
    }
  }
}

export function countsFromBackup(backup: Pick<Backup, 'tables'>): BackupCounts {
  return {
    sessions: backup.tables.sessions?.length ?? 0,
    sets: backup.tables.setLogs?.length ?? 0,
    exercises: backup.tables.exercises?.length ?? 0,
    routines: backup.tables.routines?.length ?? 0,
    meals: backup.tables.meals?.length ?? 0,
  };
}

export interface BackupWriteResult {
  ok: boolean;
  filename?: string;
  error?: string;
}

const WRITE_TIMEOUT_MS = 10_000;

/**
 * Write one backup file and prune old ones. `content` is the exact JSON to write — callers
 * produce it (`JSON.stringify(await exportBackup())` for 'auto'/'predestr', the raw dump for
 * 'premig') because this module does not depend on how a Backup is built, only on writing and
 * bookkeeping the result. Never throws; always records success/failure via `getBackupStatus`.
 */
export async function writeBackupContent(kind: BackupKind, content: string, counts: BackupCounts, dbVersion: number, buildLabel: string): Promise<BackupWriteResult> {
  try {
    const at = new Date().toISOString();
    const filename = backupFilename(kind, at, counts, dbVersion, buildLabel);
    await withTimeout(
      Filesystem.writeFile({ path: `${FOLDER}/${filename}`, data: content, directory: DIRECTORY, encoding: Encoding.UTF8, recursive: true }),
      WRITE_TIMEOUT_MS,
      'Backup write',
    );
    await pruneOldBackups();
    recordSuccess(filename, at);
    return { ok: true, filename };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    recordBackupFailure(reason);
    return { ok: false, error: reason };
  }
}

/** Reads one backup file's raw text back, for a restore. Null if it cannot be read. */
export async function readBackupFile(filename: string): Promise<string | null> {
  try {
    const res = await Filesystem.readFile({ path: `${FOLDER}/${filename}`, directory: DIRECTORY, encoding: Encoding.UTF8 });
    return typeof res.data === 'string' ? res.data : await (res.data as Blob).text();
  } catch {
    return null;
  }
}

/**
 * Best-effort `navigator.storage.persist()` — asks Android not to evict this origin's storage
 * under pressure. Guarded: the API may be entirely absent (older WebView, some browsers), and a
 * denial is a normal, silent outcome, not a failure to report as a backup error.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

/** Live persisted-storage status for display, independent of when `requestPersistentStorage` last ran. */
export async function isStoragePersisted(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

/**
 * Build and write a backup of kind `kind`. Loads `exportBackup` with a dynamic import rather than
 * a static one at the top of this file — see the note there on why (breaks a require cycle:
 * backup.ts and repo.ts both call this function, and backup.ts is also where `exportBackup` lives).
 * Never throws — failures are recorded via `getBackupStatus`.
 */
export async function backupNow(kind: BackupKind): Promise<BackupWriteResult> {
  try {
    const { exportBackup } = await import('./backup');
    const backup = await exportBackup();
    const counts = countsFromBackup(backup);
    return await writeBackupContent(kind, JSON.stringify(backup), counts, Math.round(db.verno), BUILD_LABEL);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    recordBackupFailure(reason);
    return { ok: false, error: reason };
  }
}

/**
 * Fire-and-forget backup after a session finishes — must not slow down or block the finish flow,
 * so the caller never awaits this. `backupNow` already catches everything internally.
 */
export function backupAfterSessionFinish(): void {
  void backupNow('auto');
}

/**
 * At boot, after the app has rendered: back up now if the newest automatic backup is more than 24h
 * old or none exists. Never throws.
 */
export async function maybeAutoBackupAtBoot(): Promise<void> {
  try {
    const files = await listBackups();
    const newestAuto = files
      .filter((f) => f.kind === 'auto')
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (shouldAutoBackup(newestAuto?.at ?? null, new Date().toISOString())) {
      await backupNow('auto');
    }
  } catch (e) {
    recordBackupFailure(e instanceof Error ? e.message : String(e));
  }
}

/** Backs up before a destructive in-app operation (reset/wipe/replace-restore). Never throws or blocks the operation on failure. */
export async function backupBeforeDestructiveOp(): Promise<void> {
  await backupNow('predestr');
}
