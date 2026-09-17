import { useMemo, useState } from 'react';
import type { Exercise, MuscleGroup } from '@/domain/types';
import { Sheet } from './components/Sheet';
import { TextInput } from './components/NumberField';
import { useExercises } from './hooks';

/** Substitute-exercise picker for a session-only swap: same muscle group, current exercise excluded. */
export function SwapExerciseSheet({
  open,
  onClose,
  muscleGroup,
  excludeExerciseId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  muscleGroup: MuscleGroup;
  excludeExerciseId: string;
  onPick: (exercise: Exercise) => void;
}) {
  const exercises = useExercises();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const key = q.trim().toLowerCase();
    return (exercises ?? [])
      .filter((e) => e.id !== excludeExerciseId && e.muscleGroup === muscleGroup)
      .filter((e) => !key || e.name.toLowerCase().includes(key));
  }, [exercises, q, muscleGroup, excludeExerciseId]);

  return (
    <Sheet open={open} onClose={onClose} title="Swap exercise">
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
              <div className="text-xs text-muted">{e.muscleGroup}</div>
            </div>
          </button>
        ))}
        {list.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted">No matches</div>}
      </div>
    </Sheet>
  );
}
