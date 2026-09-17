import { useMemo, useState } from 'react';
import type { Exercise, MuscleGroup } from '@/domain/types';
import { Sheet } from './components/Sheet';
import { TextInput } from './components/NumberField';
import { useExercises } from './hooks';

/** Substitute-exercise picker for a session-only swap: same muscle group, exercises already in the session excluded. */
export function SwapExerciseSheet({
  open,
  onClose,
  muscleGroup,
  exclude,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  muscleGroup: MuscleGroup;
  /** Every exercise id already occupying a slot in this session (the one being replaced included). */
  exclude: string[];
  onPick: (exercise: Exercise) => void;
}) {
  const exercises = useExercises();
  const [q, setQ] = useState('');
  const candidates = useMemo(() => {
    const excluded = new Set(exclude);
    return (exercises ?? []).filter((e) => !excluded.has(e.id) && e.muscleGroup === muscleGroup);
  }, [exercises, muscleGroup, exclude]);
  const list = useMemo(() => {
    const key = q.trim().toLowerCase();
    return candidates.filter((e) => !key || e.name.toLowerCase().includes(key));
  }, [candidates, q]);

  return (
    <Sheet open={open} onClose={onClose} title="Swap exercise">
      {candidates.length === 0 ? (
        <div className="px-1 py-4 text-sm text-muted">No other {muscleGroup} exercise to swap in.</div>
      ) : (
        <>
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
        </>
      )}
    </Sheet>
  );
}
