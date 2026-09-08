import Papa from 'papaparse';
import { db, TABLE_NAMES, type TableName } from './db';
import { nowIso } from '@/domain/dates';
import type {
  Bodyweight,
  Exercise,
  ProgressionDecision,
  Routine,
  RoutineExercise,
  Session,
  SetLog,
  Settings,
} from '@/domain/types';

export interface Backup {
  app: 'iron';
  version: 1;
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
  };
}

/** Full JSON backup of every table. */
export async function exportBackup(): Promise<Backup> {
  const [exercises, routines, routineExercises, sessions, setLogs, decisions, bodyweight, settings] = await Promise.all([
    db.exercises.toArray(),
    db.routines.toArray(),
    db.routineExercises.toArray(),
    db.sessions.toArray(),
    db.setLogs.toArray(),
    db.decisions.toArray(),
    db.bodyweight.toArray(),
    db.settings.toArray(),
  ]);
  return {
    app: 'iron',
    version: 1,
    exportedAt: nowIso(),
    tables: { exercises, routines, routineExercises, sessions, setLogs, decisions, bodyweight, settings },
  };
}

export function isBackup(x: unknown): x is Backup {
  if (!x || typeof x !== 'object') return false;
  const b = x as Partial<Backup>;
  return b.app === 'iron' && typeof b.tables === 'object' && b.tables !== null;
}

export type RestoreMode = 'merge' | 'replace';

/**
 * Restore a JSON backup. `merge` upserts rows by id (idempotent: restoring the same file twice
 * changes nothing); `replace` wipes every table first.
 */
export async function importBackup(backup: Backup, mode: RestoreMode): Promise<Record<TableName, number>> {
  const counts = {} as Record<TableName, number>;
  await db.transaction('rw', db.tables, async () => {
    if (mode === 'replace') for (const t of db.tables) await t.clear();
    for (const name of TABLE_NAMES) {
      const rows = (backup.tables[name] ?? []) as { id: string }[];
      counts[name] = rows.length;
      if (rows.length) await db.table(name).bulkPut(rows);
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
export async function deliverFile(filename: string, text: string, mime: string): Promise<'shared' | 'downloaded'> {
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
        if ((e as Error)?.name === 'AbortError') return 'shared';
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
