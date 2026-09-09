/**
 * Settings-screen data helpers that repo.ts does not provide.
 */
import { db } from './db';
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
}

/** Row counts for the Developer section. */
export async function dataCounts(): Promise<DataCounts> {
  const [exercises, routines, sessions, sets] = await Promise.all([
    db.exercises.count(),
    db.routines.filter((r) => !r.archived).count(),
    db.sessions.count(),
    db.setLogs.count(),
  ]);
  return { exercises, routines, sessions, sets };
}
