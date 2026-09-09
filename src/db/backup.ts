import Papa from 'papaparse';
import { db, TABLE_NAMES, type TableName } from './db';
import { nowIso } from '@/domain/dates';
import { DEFAULT_SETTINGS } from '@/domain/types';
import { isNative, shareTextFile } from '@/state/native';
import type {
  Bodyweight,
  Exercise,
  FoodMemory,
  Meal,
  MealItem,
  Phase,
  ProductCacheEntry,
  ProgressionDecision,
  Routine,
  RoutineExercise,
  Session,
  SetLog,
  Settings,
} from '@/domain/types';

/** Bumped whenever the set of tables changes, so a restore can reason about what it is holding. */
export const BACKUP_VERSION = 2;

export interface Backup {
  app: 'iron';
  /** 1 = workouts only (pre-merge). 2 = workouts and nutrition. */
  version: number;
  exportedAt: string;
  tables: {
    exercises: Exercise[];
    routines: Routine[];
    routineExercises: RoutineExercise[];
    sessions: Session[];
    setLogs: SetLog[];
    decisions: ProgressionDecision[];
    bodyweight: Bodyweight[];
    settings: Settings[];
    // Nutrition. Optional so a version 1 backup still satisfies the type and can be restored.
    meals?: Meal[];
    mealItems?: MealItem[];
    foods?: FoodMemory[];
    productCache?: ProductCacheEntry[];
    phases?: Phase[];
  };
}

/** Full JSON backup of every table. */
export async function exportBackup(): Promise<Backup> {
  const [exercises, routines, routineExercises, sessions, setLogs, decisions, bodyweight, settings, meals, mealItems, foods, productCache, phases] =
    await Promise.all([
      db.exercises.toArray(),
      db.routines.toArray(),
      db.routineExercises.toArray(),
      db.sessions.toArray(),
      db.setLogs.toArray(),
      db.decisions.toArray(),
      db.bodyweight.toArray(),
      db.settings.toArray(),
      db.meals.toArray(),
      db.mealItems.toArray(),
      db.foods.toArray(),
      db.productCache.toArray(),
      db.phases.toArray(),
    ]);
  return {
    app: 'iron',
    version: BACKUP_VERSION,
    exportedAt: nowIso(),
    tables: {
      exercises,
      routines,
      routineExercises,
      sessions,
      setLogs,
      decisions,
      bodyweight,
      settings,
      meals,
      mealItems,
      foods,
      productCache,
      phases,
    },
  };
}

export function isBackup(x: unknown): x is Backup {
  if (!x || typeof x !== 'object') return false;
  const b = x as Partial<Backup>;
  if (b.app !== 'iron' || typeof b.tables !== 'object' || b.tables === null) return false;
  // The version field was previously declared and then ignored. Read it, and refuse anything
  // newer than this build understands rather than silently dropping the tables it does not know.
  const v = typeof b.version === 'number' ? b.version : 1;
  return v >= 1 && v <= BACKUP_VERSION;
}

/** Which tables a given backup actually carries rows for. */
export function tablesInBackup(backup: Backup): TableName[] {
  return TABLE_NAMES.filter((n) => Array.isArray(backup.tables[n]));
}

export type RestoreMode = 'merge' | 'replace';

/**
 * Restore a JSON backup. `merge` upserts rows by id (idempotent: restoring the same file twice
 * changes nothing); `replace` wipes every table first.
 */
export async function importBackup(backup: Backup, mode: RestoreMode): Promise<Record<TableName, number>> {
  const counts = {} as Record<TableName, number>;
  const present = tablesInBackup(backup);
  await db.transaction('rw', db.tables, async () => {
    // Replace clears only what this file can put back. Clearing every table and repopulating a
    // subset would mean restoring a workouts-only backup silently destroyed all nutrition data
    // while the restore sheet reported success.
    if (mode === 'replace') for (const name of present) await db.table(name).clear();
    for (const name of present) {
      const rows = (backup.tables[name] ?? []) as unknown[];
      counts[name] = rows.length;
      if (rows.length) await db.table(name).bulkPut(rows);
    }
    // A backup without a settings row must not leave the app looking unseeded (boot would reseed on top).
    if (!(await db.settings.get('settings'))) {
      await db.settings.put({ id: 'settings', ...DEFAULT_SETTINGS, createdAt: nowIso() });
    }
  });
  return counts;
}

/** Flat CSV: one row per set, with session and exercise context. */
export async function exportCsv(): Promise<string> {
  const [sessions, sets, exercises, routines, rxs] = await Promise.all([
    db.sessions.toArray(),
    db.setLogs.toArray(),
    db.exercises.toArray(),
    db.routines.toArray(),
    db.routineExercises.toArray(),
  ]);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const routineById = new Map(routines.map((r) => [r.id, r]));
  const rxById = new Map(rxs.map((r) => [r.id, r]));
  sets.sort((a, b) => {
    const sa = sessionById.get(a.sessionId)?.startedAt ?? '';
    const sb = sessionById.get(b.sessionId)?.startedAt ?? '';
    return sa.localeCompare(sb) || a.completedAt.localeCompare(b.completedAt) || a.index - b.index;
  });
  const rows = sets.map((s) => {
    const session = sessionById.get(s.sessionId);
    const ex = exById.get(s.exerciseId);
    const rx = s.routineExerciseId ? rxById.get(s.routineExerciseId) : undefined;
    const routine = session?.routineId ? routineById.get(session.routineId) : undefined;
    return {
      session_id: s.sessionId,
      session_start: session?.startedAt ?? '',
      session_end: session?.endedAt ?? '',
      session_duration_sec: session?.durationSec ?? '',
      routine: routine?.name ?? session?.title ?? '',
      exercise: ex?.name ?? '',
      exercise_kind: ex?.kind ?? '',
      set_index: s.index,
      set_type: s.type,
      weight_kg: s.weight,
      reps: s.reps ?? '',
      distance_m: s.distanceM ?? '',
      seconds: s.seconds ?? '',
      rir: s.rir ?? '',
      rep_min: rx?.repMin ?? '',
      rep_max: rx?.repMax ?? '',
      completed_at: s.completedAt,
      source: session?.source ?? 'iron',
    };
  });
  return Papa.unparse(rows, { newline: '\n' });
}

/** Bodyweight as CSV (date, kg, note). */
export async function exportBodyweightCsv(): Promise<string> {
  const rows = (await db.bodyweight.toArray()).sort((a, b) => a.date.localeCompare(b.date));
  return Papa.unparse(
    rows.map((r) => ({ date: r.date, weight_kg: r.kg, note: r.note ?? '' })),
    { newline: '\n' },
  );
}

function stamp(): string {
  return nowIso().slice(0, 19).replace(/[:T]/g, '-');
}

export function backupFilename(): string {
  return `iron-backup-${stamp()}.json`;
}

export function csvFilename(): string {
  return `iron-sets-${stamp()}.csv`;
}

/**
 * Hand a file to the user. On Android PWAs the share sheet is the fastest route to Drive/Files;
 * fall back to a download link elsewhere.
 */
export async function deliverFile(filename: string, text: string, mime: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  // Inside the Android shell, write to the app cache and hand it to the system share sheet.
  if (isNative()) return shareTextFile(filename, text);
  const blob = new Blob([text], { type: mime });
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && 'share' in nav && typeof File !== 'undefined') {
    const file = new File([blob], filename, { type: mime });
    const canShare = typeof nav.canShare === 'function' ? nav.canShare({ files: [file] }) : false;
    if (canShare) {
      try {
        await nav.share({ files: [file], title: filename });
        return 'shared';
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return 'cancelled';
        // fall through to download
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
