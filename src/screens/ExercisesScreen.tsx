import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { filterExerciseList, groupsInList, libraryCountsLine, type ExerciseListRow } from '@/domain/library';
import type { Exercise, MuscleGroup } from '@/domain/types';
import { Button } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row, SectionTitle } from '@/ui/components/Card';
import { Chip, Segmented } from '@/ui/components/Chip';
import { TextInput } from '@/ui/components/NumberField';
import { ChevronIcon, TopBar } from '@/ui/components/TopBar';
import { DemoThumb } from '@/ui/DemoThumb';
import { LibraryLabel } from '@/ui/LibraryLabel';
import { LibraryPreviewSheet } from '@/ui/LibraryPreviewSheet';
import { MoreRows, usePaged } from '@/ui/usePaged';
import { useLibrary } from '@/ui/useLibrary';

type Filter = 'all' | MuscleGroup;
type Scope = 'yours' | 'all';

const SCOPES = [
  { value: 'yours' as const, label: 'Yours', testId: 'exercise-scope-yours' },
  { value: 'all' as const, label: 'All', testId: 'exercise-scope-all' },
];

/** Row subtitle: "muscle group · compound|isolation · kind label · per side". */
export function exerciseSubtitle(e: Exercise): string {
  const parts: string[] = [e.muscleGroup, e.isCompound ? 'compound' : 'isolation'];
  if (e.kind === 'bodyweight_plus') parts.push('bodyweight +kg');
  else if (e.kind === 'carry') parts.push('carry');
  else if (e.kind === 'timed') parts.push('timed');
  if (e.unilateral) parts.push('per side');
  return parts.join(' · ');
}

/**
 * Every exercise the owner can use, with no typing: theirs first, then the whole library (the
 * bundled diagrams and the catalogue they have not added). The muscle chips, the search and the
 * Yours / All toggle filter that one list. A library row opens a preview with Add; an exercise of
 * theirs opens as it always has. Rows are drawn a page at a time as the list is scrolled.
 */
export function ExercisesScreen() {
  const nav = useNavigate();
  const { rows, counts, status, exercises } = useLibrary();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [scope, setScope] = useState<Scope>('all');
  const [preview, setPreview] = useState<ExerciseListRow | null>(null);

  const groups = useMemo(() => groupsInList(rows), [rows]);
  const list = useMemo(() => filterExerciseList(rows, { scope, muscle: filter, query: q }), [rows, scope, filter, q]);
  const { shown, more, loadMore, sentinelRef } = usePaged(list.length, `${scope}|${filter}|${q}`);
  const visible = useMemo(() => list.slice(0, shown), [list, shown]);

  const loading = exercises === undefined;
  const emptyText = status === 'failed' ? 'Library unavailable' : status === 'loading' ? 'Loading…' : counts.owned === 0 && scope === 'yours' && !q.trim() && filter === 'all' ? 'No exercises.' : 'No matches.';

  return (
    <div>
      <TopBar
        title="Exercises"
        back="/routines"
        right={
          <Button size="md" variant="ghost" className="mr-1" onClick={() => nav('/exercises/new')} data-testid="add-exercise">
            New exercise
          </Button>
        }
      />
      <div className="px-4">
        <div className="px-1 pb-2 pt-1 text-sm text-muted" data-testid="exercise-counts">
          {loading ? 'Loading…' : libraryCountsLine(counts, status)}
        </div>
        <TextInput value={q} onChange={setQ} placeholder="Search" testId="exercise-search" />
        <Segmented className="mt-3" value={scope} onChange={setScope} options={SCOPES} />

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

        <SectionTitle>{loading ? 'Exercises' : `${list.length} ${list.length === 1 ? 'exercise' : 'exercises'}${status === 'loading' ? ' so far' : ''}`}</SectionTitle>
        {loading ? (
          <div className="py-4 text-sm text-muted">Loading…</div>
        ) : list.length === 0 ? (
          <EmptyState>{emptyText}</EmptyState>
        ) : (
          <Card>
            {visible.map((row, i) => (
              <div key={row.key}>
                {i > 0 && <Divider />}
                {row.exercise ? (
                  <Row
                    testId={`exercise-row-${row.key}`}
                    onClick={() => nav(`/exercises/${row.exercise!.id}`)}
                    left={<DemoThumb demo={row.pictureKey} size="sm" />}
                    title={row.name}
                    subtitle={exerciseSubtitle(row.exercise)}
                    right={<ChevronIcon />}
                  />
                ) : (
                  <Row
                    testId={`exercise-row-${row.key}`}
                    onClick={() => setPreview(row)}
                    left={<DemoThumb demo={row.pictureKey} size="sm" />}
                    title={
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate">{row.name}</span>
                        <LibraryLabel />
                      </span>
                    }
                    subtitle={`${row.muscleLabel} · ${row.equipment}`}
                    right={<ChevronIcon />}
                  />
                )}
              </div>
            ))}
            {more && <MoreRows sentinelRef={sentinelRef} onMore={loadMore} />}
          </Card>
        )}
        <div className="h-6" />
      </div>

      <LibraryPreviewSheet
        row={preview}
        onClose={() => setPreview(null)}
        onAdded={(exercise) => {
          setPreview(null);
          nav(`/exercises/${exercise.id}`);
        }}
      />
    </div>
  );
}
