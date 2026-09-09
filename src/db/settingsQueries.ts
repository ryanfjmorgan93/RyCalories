/**
 * Settings-screen data helpers that repo.ts does not provide.
 */
import { db, DB_VERSION } from './db';
import type { Settings } from '@/domain/types';

export type RestDefaults = Pick<Settings, 'restCompoundSec' | 'restIsolationSec' | 'restCarrySec'>;

/** Rest seconds an exercise should get from the settings defaults, by its tags. */
export function restDefaultFor(e: { kind: string; isCompound: boolean }, s: RestDefaults): number {
  if (e.kind === 'carry') return s.restCarrySec;
  return e.isCompound ? s.restCompoundSec : s.restIsolationSec;
}

/** Overwrite every exercise's defaultRestSec from the settings defaults. Returns rows changed. */
export async function applyRestDefaults(s: RestDefaults): Promise<number> {
  let changed = 0;
  await db.transaction('rw', db.exercises, async () => {
    const all = await db.exercises.toArray();
    for (const e of all) {
      const sec = restDefaultFor(e, s);
      if (e.defaultRestSec === sec) continue;
      await db.exercises.update(e.id, { defaultRestSec: sec });
      changed++;
    }
  });
  return changed;
}

export interface DataCounts {
  exercises: number;
  routines: number;
  sessions: number;
  sets: number;
  meals: number;
  /** The schema version the database is actually open at, not the one this build declares. */
  dbVersion: number;
  /** True when the open database is behind the build — a migration that has not completed. */
  behind: boolean;
}

/**
 * Row counts and the live schema version, for confirming on the phone that a schema upgrade
 * completed and took the training history with it. The sandbox cannot prove that: fake-indexeddb
 * will happily pass an upgrade pattern that fails on a real WebView.
 */
export async function dataCounts(): Promise<DataCounts> {
  const [exercises, routines, sessions, sets, meals] = await Promise.all([
    db.exercises.count(),
    db.routines.filter((r) => !r.archived).count(),
    db.sessions.count(),
    db.setLogs.count(),
    db.meals.count(),
  ]);
  // Dexie reports the on-disk version in its own units (1 version = 10).
  const dbVersion = Math.round(db.verno);
  return { exercises, routines, sessions, sets, meals, dbVersion, behind: dbVersion < DB_VERSION };
}
