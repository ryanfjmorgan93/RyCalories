import { useMemo, useState } from 'react';
import { Sheet } from './components/Sheet';
import { Button } from './components/Button';
import { TextInput } from './components/NumberField';
import { useExercises } from './hooks';
import { createExercise } from '@/db/repo';
import { demoFrameUrl, searchDemos, type ExerciseDemo } from '@/data/exerciseDemos';
import type { Equipment, Exercise, MuscleGroup } from '@/domain/types';

const LOWER_BODY_GROUPS = new Set<MuscleGroup>(['quads', 'hamstrings', 'glutes', 'calves', 'adductors']);

function equipmentFromDemo(raw: string): Equipment {
  switch (raw) {
    case 'Barbell':
      return 'barbell';
    case 'Dumbbell':
      return 'dumbbell';
    case 'Machine':
      return 'machine';
    case 'Cable':
      return 'cable';
    case 'Bodyweight':
    case 'Pull-up Bar':
      return 'bodyweight';
    case 'Kettlebell':
      return 'kettlebell';
    default:
      return 'other';
  }
}

function incrementFor(equipment: Equipment): number {
  if (equipment === 'barbell') return 2.5;
  if (equipment === 'dumbbell') return 2;
  if (equipment === 'machine' || equipment === 'cable') return 5;
  return 2.5;
}

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
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const list = useMemo(() => {
    const key = q.trim().toLowerCase();
    return (exercises ?? [])
      .filter((e) => !exclude.includes(e.id))
      .filter((e) => !key || e.name.toLowerCase().includes(key) || e.muscleGroup.includes(key) || (e.aliases ?? []).some((a) => a.toLowerCase().includes(key)));
  }, [exercises, q, exclude]);

  const pickFromLibrary = async (d: ExerciseDemo) => {
    const equipment = equipmentFromDemo(d.equipment);
    const muscleGroup: MuscleGroup = d.muscleGroup ?? 'other';
    const isCompound = d.equipment === 'Barbell';
    const e = await createExercise({
      name: d.name,
      kind: 'reps',
      muscleGroup,
      isCompound,
      isLowerBody: LOWER_BODY_GROUPS.has(muscleGroup),
      unilateral: false,
      defaultRestSec: isCompound ? 150 : 75,
      defaultIncrement: incrementFor(equipment),
      equipment,
      demo: d.slug,
    });
    setLibraryOpen(false);
    setLibraryQuery('');
    onPick(e);
  };

  return (
    <>
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
        <div className="mt-3 grid gap-2">
          <Button full variant="outline" onClick={() => setLibraryOpen(true)} data-testid="from-library">
            From library
          </Button>
          {onCreate && (
            <Button full variant="outline" onClick={onCreate}>
              New exercise
            </Button>
          )}
        </div>
      </Sheet>

      <Sheet
        open={libraryOpen}
        onClose={() => {
          setLibraryOpen(false);
          setLibraryQuery('');
        }}
        title="From library"
      >
        <TextInput value={libraryQuery} onChange={setLibraryQuery} placeholder="Search" testId="library-search" />
        <div className="mt-3 grid max-h-[55dvh] gap-2 overflow-y-auto">
          {searchDemos(libraryQuery).map((d) => (
            <button
              key={d.slug}
              type="button"
              onClick={() => void pickFromLibrary(d)}
              className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-left active:bg-surface-2"
              data-testid={`library-${d.slug}`}
            >
              <img src={demoFrameUrl(d.slug, 1)} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-surface-2 object-contain" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{d.name}</div>
                <div className="text-xs text-muted">{d.equipment}</div>
              </div>
            </button>
          ))}
          {libraryQuery.trim() && searchDemos(libraryQuery).length === 0 && <div className="py-6 text-center text-sm text-muted">No matches</div>}
        </div>
      </Sheet>
    </>
  );
}
