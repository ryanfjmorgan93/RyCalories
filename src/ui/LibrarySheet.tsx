import { useState } from 'react';
import { Sheet } from './components/Sheet';
import { TextInput } from './components/NumberField';
import { DemoThumb } from './DemoThumb';
import { useExercises } from './hooks';
import { useLibrarySearch, type LibraryRow } from './useLibrarySearch';
import { addCatalogueExercise, addDemoExercise } from '@/db/catalogueRepo';
import { findExistingExercise } from '@/domain/library';
import type { Exercise } from '@/domain/types';

/**
 * "From library": searches the bundled diagrams and the catalogue, and adds the chosen one to the
 * owner's exercises (once: an exercise they already have comes back as that row). Nothing of the
 * catalogue is fetched until the sheet opens; an empty search lists nothing. `exclude` holds the
 * exercise ids the caller cannot take again; a result that is one of them is shown as added and
 * cannot be chosen.
 */
export function LibrarySheet({
  open,
  onClose,
  onPick,
  exclude = [],
}: {
  open: boolean;
  onClose: () => void;
  onPick: (exercise: Exercise) => void;
  exclude?: string[];
}) {
  const exercises = useExercises();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const { rows, settled, failed } = useLibrarySearch(open, q);

  const close = () => {
    setQ('');
    onClose();
  };

  const choose = async (row: LibraryRow) => {
    if (busy) return;
    setBusy(true);
    try {
      const exercise = row.result.kind === 'demo' ? await addDemoExercise(row.result.demo) : await addCatalogueExercise(row.result.entry);
      setQ('');
      onPick(exercise);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close} title="From library">
      <TextInput value={q} onChange={setQ} placeholder="Search" testId="library-search" />
      <div className="mt-3 grid max-h-[55dvh] gap-2 overflow-y-auto">
        {rows.map((row) => {
          const have = exclude.length > 0 ? findExistingExercise(exercises ?? [], row.key, row.name) : undefined;
          const added = have !== undefined && exclude.includes(have.id);
          return (
            <button
              key={row.key}
              type="button"
              disabled={added || busy}
              onClick={() => void choose(row)}
              className="flex min-h-14 items-center gap-3 rounded-xl border border-line px-3 py-2 text-left active:bg-surface-2 disabled:opacity-50"
              data-testid={`library-${row.key}`}
            >
              <DemoThumb demo={row.key} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{row.name}</div>
                <div className="text-xs text-muted">{row.detail}</div>
              </div>
              {added && <div className="shrink-0 text-xs text-muted">Added</div>}
            </button>
          );
        })}
        {settled && q.trim() && rows.length === 0 && <div className="py-6 text-center text-sm text-muted">{failed ? 'Library unavailable' : 'No matches'}</div>}
      </div>
    </Sheet>
  );
}
