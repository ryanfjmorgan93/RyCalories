/**
 * What the Short session sheet reads: the owner's exercises, routines, history and catalogue,
 * gathered into the generator's input. Read-only; the mapping itself is pure (`@/domain/quickInput`).
 */
import { db } from './db';
import { muscleRecency, weeklySetsByMuscle } from './volumeQueries';
import { loadCatalogue } from '@/data/catalogue';
import type { CatalogueEntry } from '@/domain/catalogue';
import { mondayOf } from '@/domain/dates';
import { buildQuickInput } from '@/domain/quickInput';
import type { QuickInput } from '@/domain/quickSession';
import type { Settings } from '@/domain/types';

/**
 * The generator's input as of `today` (a local YYYY-MM-DD). `includeNew` adds catalogue exercises
 * the owner could try, and returns the entries behind them so Start can turn the chosen ones into
 * exercises; without it the catalogue is not even loaded.
 */
export async function loadQuickInput(opts: { today: string; settings: Settings; includeNew: boolean }): Promise<{ input: QuickInput; catalogueEntries: CatalogueEntry[] }> {
  // Before the transaction: a Dexie transaction cannot wait on anything that is not a Dexie call.
  const catalogue = opts.includeNew ? await loadCatalogue() : undefined;
  // One read transaction, so the tables and the recency and weekly sets drawn from them agree.
  const source = await db.transaction('r', [db.exercises, db.routines, db.routineExercises, db.sessions, db.setLogs], async () => {
    const [exercises, routines, routineExercises, sessions, setLogs, recency, weeklySets] = await Promise.all([
      db.exercises.toArray(),
      db.routines.toArray(),
      db.routineExercises.toArray(),
      db.sessions.toArray(),
      db.setLogs.toArray(),
      muscleRecency(opts.today),
      weeklySetsByMuscle(mondayOf(opts.today)),
    ]);
    return { exercises, routines, routineExercises, sessions, setLogs, recency, weeklySets };
  });
  return buildQuickInput({ ...source, catalogue }, opts.settings, opts.today);
}
