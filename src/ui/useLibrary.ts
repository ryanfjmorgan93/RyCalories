import { useEffect, useMemo, useState } from 'react';
import { loadCatalogue } from '@/data/catalogue';
import { EXERCISE_DEMOS } from '@/data/exerciseDemos';
import type { CatalogueEntry } from '@/domain/catalogue';
import { buildExerciseList, listCounts, type CatalogueStatus, type ExerciseListRow } from '@/domain/library';
import type { Exercise } from '@/domain/types';
import { useExercises } from './hooks';

/** The catalogue once it has been fetched in this page, so a second screen or sheet starts with it. */
let fetched: CatalogueEntry[] | undefined;

/**
 * Every exercise the owner can use as one list (see `buildExerciseList`): their own, then the
 * bundled diagrams and the catalogue they have not added. The catalogue is fetched when `enabled`
 * first becomes true (a screen passes nothing, a sheet passes whether it is open) and never at app
 * start; until it arrives the list is the owner's exercises and the diagrams, and `status` says so,
 * so no caller states a total that has not loaded. If it cannot be fetched `status` is 'failed' and
 * the list stays what it is. `exercises` is undefined while the owner's own rows are loading, and
 * `rows` is empty until then.
 */
export function useLibrary(enabled = true): {
  rows: ExerciseListRow[];
  counts: { owned: number; library: number };
  status: CatalogueStatus;
  exercises: Exercise[] | undefined;
} {
  const exercises = useExercises();
  const [entries, setEntries] = useState<CatalogueEntry[] | null>(fetched ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || entries) return;
    let live = true;
    loadCatalogue().then(
      (all) => {
        fetched = all;
        if (!live) return;
        setFailed(false);
        setEntries(all);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, entries]);

  const rows = useMemo(() => (exercises ? buildExerciseList({ owned: exercises, demos: EXERCISE_DEMOS, entries: entries ?? [] }) : []), [exercises, entries]);
  const counts = useMemo(() => listCounts(rows), [rows]);
  const status: CatalogueStatus = entries ? 'ready' : failed ? 'failed' : 'loading';
  return { rows, counts, status, exercises };
}
