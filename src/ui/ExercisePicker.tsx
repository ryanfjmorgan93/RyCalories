import { useMemo, useState } from 'react';
import { Sheet } from './components/Sheet';
import { Button } from './components/Button';
import { TextInput } from './components/NumberField';
import { DemoThumb } from './DemoThumb';
import { LibraryLabel } from './LibraryLabel';
import { MoreRows, usePaged } from './usePaged';
import { useLibrary } from './useLibrary';
import { addCatalogueExercise, addDemoExercise } from '@/db/catalogueRepo';
import { filterExerciseList, type ExerciseListRow } from '@/domain/library';
import type { Exercise } from '@/domain/types';

function rowDetail(row: ExerciseListRow): string {
  const e = row.exercise;
  if (!e) return `${row.muscleLabel} · ${row.equipment}`;
  return `${e.muscleGroup} · ${e.isCompound ? 'compound' : 'isolation'}${e.kind !== 'reps' ? ` · ${e.kind.replace('_', ' ')}` : ''}`;
}

/**
 * Searchable list of every exercise in a bottom sheet: the owner's own first, then the whole
 * library (the diagrams and the catalogue they have not added, labelled as such). Choosing a
 * library row adds it to their exercises (once: one they already have for that movement comes
 * back as that row) and hands the resulting exercise to `onPick`, in the same tap. A caller that
 * wants to decide for itself what a library row becomes passes `onPickLibrary`: it gets the row,
 * and nothing is added. `exclude` holds the ids of exercises that cannot be chosen again.
 */
export function ExercisePicker({
  open,
  onClose,
  onPick,
  onPickLibrary,
  exclude = [],
  onCreate,
  title = 'Add exercise',
}: {
  open: boolean;
  onClose: () => void;
  onPick: (exercise: Exercise) => void;
  onPickLibrary?: (row: ExerciseListRow) => void;
  exclude?: string[];
  onCreate?: () => void;
  title?: string;
}) {
  const { rows, status } = useLibrary(open);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  // The caller builds `exclude` afresh each render, so what the list depends on is its content.
  const excludeKey = exclude.join(',');
  const list = useMemo(() => filterExerciseList(rows, { query: q, excludeIds: excludeKey ? excludeKey.split(',') : [] }), [rows, q, excludeKey]);
  const { shown, more, loadMore, sentinelRef } = usePaged(list.length, `${q}|${excludeKey}`);
  const visible = useMemo(() => list.slice(0, shown), [list, shown]);

  const choose = async (row: ExerciseListRow) => {
    if (busy) return;
    if (row.exercise) {
      onPick(row.exercise);
      setQ('');
      return;
    }
    if (onPickLibrary) {
      onPickLibrary(row);
      setQ('');
      return;
    }
    setBusy(true);
    try {
      const exercise = row.entry ? await addCatalogueExercise(row.entry) : await addDemoExercise(row.demo!);
      // The row said it was not theirs yet. If the add found it was (made elsewhere since), and the
      // caller cannot take it twice, there is nothing to hand over.
      if (exclude.includes(exercise.id)) return;
      onPick(exercise);
      setQ('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <TextInput value={q} onChange={setQ} placeholder="Search" testId="picker-search" />
      {status === 'failed' && (
        <div className="mt-2 px-1 text-sm text-muted" data-testid="picker-status">
          Catalogue not loaded
        </div>
      )}
      <div className="mt-3 max-h-[55dvh] overflow-y-auto rounded-xl border border-line" data-testid="picker-list">
        {visible.map((row) => (
          <button
            key={row.key}
            type="button"
            disabled={busy}
            data-testid={`pick-${row.key}`}
            onClick={() => void choose(row)}
            className="flex min-h-14 w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 active:bg-surface-2 disabled:opacity-50"
          >
            <DemoThumb demo={row.pictureKey} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{row.name}</div>
              <div className="text-xs text-muted">{rowDetail(row)}</div>
            </div>
            {!row.owned && <LibraryLabel />}
          </button>
        ))}
        {more && <MoreRows sentinelRef={sentinelRef} onMore={loadMore} />}
        {list.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted">{status === 'loading' ? 'Loading…' : 'No matches'}</div>}
      </div>
      {onCreate && (
        <div className="mt-3 grid gap-2">
          <Button full variant="outline" onClick={onCreate}>
            New exercise
          </Button>
        </div>
      )}
    </Sheet>
  );
}
