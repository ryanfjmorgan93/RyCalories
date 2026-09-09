import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MUSCLE_GROUPS, type Exercise, type MuscleGroup } from '@/domain/types';
import { IconButton } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row, SectionTitle } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { TextInput } from '@/ui/components/NumberField';
import { ChevronIcon, PlusIcon, TopBar } from '@/ui/components/TopBar';
import { useExercises } from '@/ui/hooks';

type Filter = 'all' | MuscleGroup;

/** Row subtitle: "muscle group · compound|isolation · kind label · per side". */
export function exerciseSubtitle(e: Exercise): string {
  const parts: string[] = [e.muscleGroup, e.isCompound ? 'compound' : 'isolation'];
  if (e.kind === 'bodyweight_plus') parts.push('bodyweight +kg');
  else if (e.kind === 'carry') parts.push('carry');
  else if (e.kind === 'timed') parts.push('timed');
  if (e.unilateral) parts.push('per side');
  return parts.join(' · ');
}

function matches(e: Exercise, key: string): boolean {
  if (!key) return true;
  return e.name.toLowerCase().includes(key) || e.muscleGroup.includes(key) || (e.aliases ?? []).some((a) => a.toLowerCase().includes(key));
}

export function ExercisesScreen() {
  const nav = useNavigate();
  const exercises = useExercises();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const groups = useMemo(() => {
    const present = new Set((exercises ?? []).map((e) => e.muscleGroup));
    return MUSCLE_GROUPS.filter((g) => present.has(g));
  }, [exercises]);

  const list = useMemo(() => {
    const key = q.trim().toLowerCase();
    return (exercises ?? [])
      .filter((e) => filter === 'all' || e.muscleGroup === filter)
      .filter((e) => matches(e, key))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [exercises, q, filter]);

  return (
    <div>
      <TopBar
        title="Exercises"
        right={
          <IconButton label="Add" onClick={() => nav('/exercises/new')} data-testid="add-exercise">
            <PlusIcon />
          </IconButton>
        }
      />
      <div className="px-4">
        <TextInput value={q} onChange={setQ} placeholder="Search" testId="exercise-search" />

        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          <Chip className="min-h-11" active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </Chip>
          {groups.map((g) => (
            <Chip key={g} className="min-h-11" active={filter === g} onClick={() => setFilter(filter === g ? 'all' : g)}>
              {g}
            </Chip>
          ))}
        </div>

        <SectionTitle>{exercises === undefined ? 'Exercises' : `${list.length} ${list.length === 1 ? 'exercise' : 'exercises'}`}</SectionTitle>
        {exercises === undefined ? (
          <div className="py-4 text-sm text-muted">Loading…</div>
        ) : list.length === 0 ? (
          <EmptyState>{exercises.length === 0 ? 'No exercises.' : 'No matches.'}</EmptyState>
        ) : (
          <Card>
            {list.map((e, i) => (
              <div key={e.id}>
                {i > 0 && <Divider />}
                <Row onClick={() => nav(`/exercises/${e.id}`)} title={e.name} subtitle={exerciseSubtitle(e)} right={<ChevronIcon />} />
              </div>
            ))}
          </Card>
        )}
        <div className="h-6" />
      </div>
    </div>
  );
}
