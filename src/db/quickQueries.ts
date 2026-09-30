/**
 * What the Short session sheet reads: the owner's exercises, routines, history and catalogue,
 * gathered into the generator's input. Read-only; the mapping itself is pure (`@/domain/quickInput`).
 */
import { db } from './db';
import { muscleSetRowsFrom } from './volumeQueries';
import { loadCatalogue } from '@/data/catalogue';
import type { CatalogueEntry } from '@/domain/catalogue';
import { mondayOf } from '@/domain/dates';
import { buildQuickInput } from '@/domain/quickInput';
import type { QuickInput } from '@/domain/quickSession';
import type { Settings } from '@/domain/types';
import { muscleRecency, weeklySetsByMuscle } from '@/domain/volume';

/**
 * The generator's input as of `today` (a local YYYY-MM-DD). `includeNew` adds catalogue exercises
 * the owner could try, and returns the entries behind them so Start can turn the chosen ones into
 * exercises; without it the catalogue is not even loaded.
 */
export async function loadQuickInput(opts: { today: string; settings: Settings; includeNew: boolean }): Promise<{ input: QuickInput; catalogueEntries: CatalogueEntry[] }> {
  // Before the transaction: a Dexie transaction cannot wait on anything that is not a Dexie call.
  const catalogue = opts.includeNew ? await loadCatalogue() : undefined;
  // One read transaction, one read of each table: the recency and weekly sets are drawn from the
  // rows already in hand (the set logs are the big table), so they agree with them by construction.
  const tables = await db.transaction('r', [db.exercises, db.routines, db.routineExercises, db.sessions, db.setLogs], async () => {
    const [exercises, routines, routineExercises, sessions, setLogs] = await Promise.all([
      db.exercises.toArray(),
      db.routines.toArray(),
      db.routineExercises.toArray(),
      db.sessions.toArray(),
      db.setLogs.toArray(),
    ]);
    return { exercises, routines, routineExercises, sessions, setLogs };
  });
  const rows = muscleSetRowsFrom(tables.setLogs, tables.sessions, tables.exercises);
  const recency = muscleRecency(rows, opts.today);
  const weeklySets = weeklySetsByMuscle(rows, mondayOf(opts.today));
  return buildQuickInput({ ...tables, recency, weeklySets, catalogue }, opts.settings, opts.today);
}
