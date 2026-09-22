/**
 * "History that cannot be lost silently" — the boot-time checks and user actions that tie
 * together automatic backups (autoBackup.ts), the loss baseline (lossGuard.ts) and the pure
 * decision of what to tell the user (domain/lossDetection.ts).
 *
 * The notice itself is persisted here (localStorage, same reasoning as the baseline: must survive
 * a reload without depending on the database that may be the thing in question) as the single
 * source of truth; src/state/historyNotice.ts holds a reactive copy for React and is seeded from
 * `getStoredNotice()` so a notice from an earlier boot shows immediately. This module does not
 * import that store back — every function here returns its result and leaves updating the store to
 * the caller (main.tsx at boot, HomeScreen.tsx on Restore/Dismiss) — so there is no cycle between
 * the data layer and the UI-reactive layer.
 */
import {
  backupAfterSessionFinish as scheduleAutoBackupAfterFinish,
  listBackups,
  maybeAutoBackupAtBoot,
  readBackupFile,
  recordBackupFailure,
  requestPersistentStorage,
  writeBackupContent,
} from './autoBackup';
import { db, DB_NAME, DB_VERSION } from './db';
import { getBaseline, isPendingDeletion, writeBaseline } from './lossGuard';
import { isBackup, importBackup } from './backup';
import { dumpRaw } from '@/boot/recovery';
import { BUILD_LABEL } from '@/buildInfo';
import { nowIso } from '@/domain/dates';
import { decideHistoryNotice, type HistoryNotice } from '@/domain/lossDetection';
import { DEFAULT_SETTINGS } from '@/domain/types';
import { isNative } from '@/state/native';

export { maybeAutoBackupAtBoot, requestPersistentStorage };
export const backupAfterSessionFinish = scheduleAutoBackupAfterFinish;

const NOTICE_KEY = 'iron.historyNotice.v1';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getStoredNotice(): HistoryNotice | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(NOTICE_KEY);
    return raw ? (JSON.parse(raw) as HistoryNotice) : null;
  } catch {
    return null;
  }
}

function setStoredNotice(notice: HistoryNotice): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(NOTICE_KEY, JSON.stringify(notice));
  } catch {
    /* best effort */
  }
}

function clearStoredNotice(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(NOTICE_KEY);
  } catch {
    /* ignore */
  }
}

async function currentSessionSetCounts(): Promise<{ sessions: number; sets: number }> {
  const [sessions, sets] = await Promise.all([db.sessions.count(), db.setLogs.count()]);
  return { sessions, sets };
}

async function rebaseline(): Promise<void> {
  const { sessions, sets } = await currentSessionSetCounts();
  writeBaseline({ sessions, sets, build: BUILD_LABEL, dbVersion: Math.round(db.verno), at: nowIso() });
}

/**
 * Point 2 — pre-migration raw backup. Called from main.tsx BEFORE Dexie ever opens the database
 * (before `ensureSeeded`/`migrateSeed`), so it talks to IndexedDB directly, the same way
 * src/boot/recovery.ts does, and closes its connection before returning so Dexie's own open is
 * free to run its upgrade. Bounded by a timeout and never throws — a failure here must not stop
 * the app from booting, only be recorded so Settings can say a backup failed.
 */
export async function backupBeforeMigrationIfNeeded(): Promise<void> {
  const TIMEOUT_MS = 8000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      doBackupBeforeMigration(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Pre-migration backup timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    recordBackupFailure(e instanceof Error ? e.message : String(e));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function doBackupBeforeMigration(): Promise<void> {
  // `indexedDB.open(name)` with no version CREATES an empty database at version 1 if none already
  // exists — exactly the corruption a fresh install must not risk. `databases()` answers "does it
  // exist, and at what version" without opening anything, so this only proceeds when there is
  // something to protect.
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return;
  const existing = (await indexedDB.databases()).find((d) => d.name === DB_NAME);
  if (!existing) return;

  const json = await dumpRaw();
  const dumped = JSON.parse(json) as { tables: Record<string, unknown[]>; dbVersion?: number };
  const rawVersion = dumped.dbVersion ?? existing.version ?? 0;
  const settingsRow = (dumped.tables.settings?.[0] ?? null) as { seedVersion?: number } | null;
  const seedVersion = settingsRow?.seedVersion ?? 1;

  const migrationComing = rawVersion < DB_VERSION * 10;
  const seedComing = seedVersion < DEFAULT_SETTINGS.seedVersion;
  if (!migrationComing && !seedComing) return;

  const counts = {
    sessions: dumped.tables.sessions?.length ?? 0,
    sets: dumped.tables.setLogs?.length ?? 0,
    exercises: dumped.tables.exercises?.length ?? 0,
    routines: dumped.tables.routines?.length ?? 0,
    meals: dumped.tables.meals?.length ?? 0,
  };
  await writeBackupContent('premig', json, counts, Math.round(rawVersion / 10), BUILD_LABEL);
}

/**
 * Point 3 — the boot loss check. Only runs the decision when no notice is already pending: once
 * shown, a notice stays exactly as detected until the user restores or dismisses it (re-running
 * the comparison every boot could let ordinary new sessions quietly raise the current counts back
 * above a stale baseline, making the notice vanish without anything having actually been restored
 * — the opposite of "cannot be lost silently"). When nothing is wrong, this establishes the
 * baseline for next time.
 */
export async function checkForHistoryLoss(wasFreshInstall: boolean): Promise<HistoryNotice | null> {
  const existing = getStoredNotice();
  if (existing) return existing;

  const current = await currentSessionSetCounts();
  const baseline = getBaseline();
  const deletionPending = isPendingDeletion();
  const backups = await listBackups();

  const notice = decideHistoryNotice({
    wasFreshInstall,
    baseline,
    deletionPending,
    current,
    backups,
    isNative: isNative(),
    now: nowIso(),
  });

  if (notice) {
    setStoredNotice(notice);
    return notice;
  }
  await rebaseline();
  return null;
}

export async function dismissHistoryNotice(): Promise<void> {
  clearStoredNotice();
  await rebaseline();
}

/** Reads the named backup file, validates it, restores it (merge), then clears the notice and re-baselines. */
export async function restoreHistoryNotice(filename: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const text = await readBackupFile(filename);
    if (!text) throw new Error('Backup file could not be read');
    const parsed: unknown = JSON.parse(text);
    if (!isBackup(parsed)) throw new Error('Not a valid Iron backup');
    await importBackup(parsed, 'merge');
    clearStoredNotice();
    await rebaseline();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The file-picker fallback offered on native when no backup could be listed (point 3's second
 * bullet). Whatever the outcome, treat the prompt as acted on — the underlying data is either now
 * restored, or the user chose not to use a file — so it is not shown again.
 */
export async function acknowledgeFilePickerNotice(): Promise<void> {
  clearStoredNotice();
  await rebaseline();
}
