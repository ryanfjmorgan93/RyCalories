import { useMemo, useState } from 'react';
import { Sheet } from './components/Sheet';
import { Button } from './components/Button';
import { TextInput } from './components/NumberField';
import { useExercises } from './hooks';
import type { Exercise } from '@/domain/types';

/** Searchable exercise list in a bottom sheet. */
export function ExercisePicker({
  open,
  onClose,
  onPick,
  exclude = [],
  onCreate,
  title = 'Add exercise',
}: {
  open: boolean;
  onClose: () => void;
  onPick: (exercise: Exercise) => void;
  exclude?: string[];
  onCreate?: () => void;
  title?: string;
}) {
  const exercises = useExercises();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const key = q.trim().toLowerCase();
    return (exercises ?? [])
      .filter((e) => !exclude.includes(e.id))
      .filter((e) => !key || e.name.toLowerCase().includes(key) || e.muscleGroup.includes(key) || (e.aliases ?? []).some((a) => a.toLowerCase().includes(key)));
  }, [exercises, q, exclude]);

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <TextInput value={q} onChange={setQ} placeholder="Search" />
      <div className="mt-3 max-h-[55dvh] overflow-y-auto rounded-xl border border-line">
        {list.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => {
              onPick(e);
              setQ('');
            }}
            className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 active:bg-surface-2 min-h-14"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{e.name}</div>
              <div className="text-xs text-muted">
                {e.muscleGroup} · {e.isCompound ? 'compound' : 'isolation'}
                {e.kind !== 'reps' ? ` · ${e.kind.replace('_', ' ')}` : ''}
              </div>
            </div>
          </button>
        ))}
        {list.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted">No matches</div>}
      </div>
      {onCreate && (
        <Button className="mt-3" full variant="outline" onClick={onCreate}>
          New exercise
        </Button>
      )}
    </Sheet>
  );
}
