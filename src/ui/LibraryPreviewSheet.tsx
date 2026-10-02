import { useState } from 'react';
import { Button } from './components/Button';
import { Sheet } from './components/Sheet';
import { ExerciseDemo } from './ExerciseDemo';
import { LibraryLabel } from './LibraryLabel';
import { addCatalogueExercise, addDemoExercise } from '@/db/catalogueRepo';
import type { ExerciseListRow } from '@/domain/library';
import type { Exercise } from '@/domain/types';

/**
 * A library exercise, looked at before it is the owner's: its pictures and how-to (the same demo
 * the exercise page shows) and an Add button. Add makes the exercise once (one they already have
 * for that movement comes back as that row, never a second) and hands it to `onAdded`. `row` is the
 * library row being looked at; null closes the sheet.
 */
export function LibraryPreviewSheet({ row, onClose, onAdded }: { row: ExerciseListRow | null; onClose: () => void; onAdded: (exercise: Exercise) => void }) {
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!row || busy) return;
    setBusy(true);
    try {
      const exercise = row.entry ? await addCatalogueExercise(row.entry) : row.demo ? await addDemoExercise(row.demo) : undefined;
      if (exercise) onAdded(exercise);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={row !== null}
      onClose={onClose}
      title={row?.name}
      footer={
        <Button full size="lg" variant="primary" disabled={busy} onClick={() => void add()} data-testid="library-add">
          Add
        </Button>
      }
    >
      {row && (
        <div data-testid="library-preview">
          <div className="mb-3 flex items-center gap-2 text-sm text-muted">
            <span>
              {row.muscleLabel} · {row.equipment}
            </span>
            <LibraryLabel />
          </div>
          <ExerciseDemo key={row.key} slug={row.pictureKey ?? ''} name={row.name} />
        </div>
      )}
    </Sheet>
  );
}
