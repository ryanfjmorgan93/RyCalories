import { useEffect, useMemo, useState } from 'react';
import { loadCatalogue } from '@/data/catalogue';
import { searchDemos, type ExerciseDemo } from '@/data/exerciseDemos';
import { catalogueDemoKey, searchCatalogue, type CatalogueEntry } from '@/domain/catalogue';
import { LIBRARY_RESULT_CAP, mergeLibraryResults, type LibraryResult } from '@/domain/library';

export interface LibraryRow {
  /** The picture key an exercise made from this row carries: the diagram's slug, or 'cat:<slug>'. */
  key: string;
  name: string;
  /** "muscle · equipment". */
  detail: string;
  result: LibraryResult<ExerciseDemo, CatalogueEntry>;
}

const lower = (s: string) => s.toLowerCase();

/**
 * The library search behind "From library" and the diagram picker: the bundled diagrams and the
 * catalogue, at most LIBRARY_RESULT_CAP rows, none for an empty query. The catalogue is fetched the
 * first time `open` is true and never before; if it cannot be fetched the diagrams still search.
 * `settled` is false until that fetch has finished either way, so a caller does not call the list
 * empty while half of it is still on its way. `failed` is true when it finished by failing: an
 * empty result is then only what the diagrams hold, and the caller must not say "No matches" for a
 * term the catalogue might have answered. Opening the sheet again asks the loader again, but
 * Chromium keeps a failed module import for the life of the page, so in practice it takes a reload.
 */
export function useLibrarySearch(open: boolean, query: string): { rows: LibraryRow[]; settled: boolean; failed: boolean } {
  const [entries, setEntries] = useState<CatalogueEntry[] | null>(null);
  const [settled, setSettled] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    loadCatalogue().then(
      (all) => {
        if (!live) return;
        setEntries(all);
        setFailed(false);
        setSettled(true);
      },
      () => {
        if (!live) return;
        setFailed(true);
        setSettled(true);
      },
    );
    return () => {
      live = false;
    };
  }, [open]);

  const rows = useMemo(() => {
    const merged = mergeLibraryResults(searchDemos(query, LIBRARY_RESULT_CAP), searchCatalogue(entries ?? [], query, LIBRARY_RESULT_CAP), LIBRARY_RESULT_CAP);
    return merged.map((result): LibraryRow => {
      if (result.kind === 'demo') {
        const d = result.demo;
        return { key: d.slug, name: d.name, detail: `${d.muscleGroup ?? lower(d.primaryMuscle)} · ${lower(d.equipment)}`, result };
      }
      const e = result.entry;
      return { key: catalogueDemoKey(e.slug), name: e.name, detail: `${e.muscleGroup} · ${e.equipment}`, result };
    });
  }, [query, entries]);

  return { rows, settled, failed };
}
