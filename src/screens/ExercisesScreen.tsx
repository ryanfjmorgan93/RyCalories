import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { emptyListText, filterExerciseList, groupsInList, libraryCountsLine, listHeading, LIST_PAGE_SIZE, type ExerciseListRow } from '@/domain/library';
import type { MuscleGroup } from '@/domain/types';
import { Button } from '@/ui/components/Button';
import { Card, EmptyState, SectionTitle } from '@/ui/components/Card';
import { Chip, Segmented } from '@/ui/components/Chip';
import { TextInput } from '@/ui/components/NumberField';
import { TopBar } from '@/ui/components/TopBar';
import { LibraryPreviewSheet } from '@/ui/LibraryPreviewSheet';
import { LibraryRow } from '@/ui/LibraryRow';
import { leaveExercises, viewRestored, viewToRestore } from '@/ui/exercisesView';
import { MoreRows, usePaged } from '@/ui/usePaged';
import { useLibrary } from '@/ui/useLibrary';

export { exerciseSubtitle } from '@/ui/LibraryRow';

type Filter = 'all' | MuscleGroup;
type Scope = 'yours' | 'all';

const SCOPES = [
  { value: 'yours' as const, label: 'Yours', testId: 'exercise-scope-yours' },
  { value: 'all' as const, label: 'All', testId: 'exercise-scope-all' },
];

/**
 * Every exercise the owner can use, with no typing: theirs first, then the whole library (the
 * bundled diagrams and the catalogue they have not added). The muscle chips, the search and the
 * Yours / All toggle filter that one list. A library row opens a preview with Add; an exercise of
 * theirs opens as it always has. Rows are drawn a page at a time as the list is scrolled.
 *
 * Leaving for an exercise (opening one, or adding one from the preview) and coming Back finds the
 * list as it was: the same scope, chip, search and scroll, with the rows that scroll belongs to drawn.
 */
export function ExercisesScreen() {
  const nav = useNavigate();
  const { rows, counts, status, exercises } = useLibrary();
  // Where the list was left, if it was left for an exercise; read once, offered once.
  const [start] = useState(viewToRestore);
  useEffect(() => {
    viewRestored();
  }, []);
  const [q, setQ] = useState(start?.q ?? '');
  const [filter, setFilter] = useState<Filter>(start?.filter ?? 'all');
  const [scope, setScope] = useState<Scope>(start?.scope ?? 'all');
  const [preview, setPreview] = useState<ExerciseListRow | null>(null);

  const groups = useMemo(() => groupsInList(rows), [rows]);
  const list = useMemo(() => filterExerciseList(rows, { scope, muscle: filter, query: q }), [rows, scope, filter, q]);
  const { shown, more, loadMore, sentinelRef, pages } = usePaged(list.length, `${scope}|${filter}|${q}`, LIST_PAGE_SIZE, start?.pages);
  const visible = useMemo(() => list.slice(0, shown), [list, shown]);

  const loading = exercises === undefined;

  // Back at the scroll the list was left at, once the rows it belongs to are on the page. After the
  // route's own scroll-to-top, which runs first, and only once.
  const scrolled = useRef(false);
  useEffect(() => {
    if (loading || scrolled.current) return;
    scrolled.current = true;
    if (start && start.scrollY > 0) window.scrollTo(0, start.scrollY);
  }, [loading, start]);

  // The handlers the rows hold must not change as the list does, or every row is drawn again for it:
  // what they remember is read from a ref at the moment of the tap.
  const where = useRef({ scope, filter, q, pages });
  useLayoutEffect(() => {
    where.current = { scope, filter, q, pages };
  });
  const leaveFor = useCallback(
    (path: string) => {
      leaveExercises({ ...where.current, scrollY: window.scrollY });
      nav(path);
    },
    [nav],
  );
  const openOwned = useCallback((id: string) => leaveFor(`/exercises/${id}`), [leaveFor]);

  const emptyText = emptyListText({ status, scope, owned: counts.owned, query: q, muscle: filter });

  return (
    <div>
      <TopBar
        title="Exercises"
        back="/routines"
        right={
          <Button size="md" variant="ghost" className="mr-1" onClick={() => leaveFor('/exercises/new')} data-testid="add-exercise">
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

        <SectionTitle>{loading ? 'Exercises' : listHeading(list.length, status, scope)}</SectionTitle>
        {loading ? (
          <div className="py-4 text-sm text-muted">Loading…</div>
        ) : list.length === 0 ? (
          <EmptyState>{emptyText}</EmptyState>
        ) : (
          <Card>
            {visible.map((row, i) => (
              <LibraryRow key={row.key} row={row} first={i === 0} onOpenOwned={openOwned} onPreview={setPreview} />
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
          leaveFor(`/exercises/${exercise.id}`);
        }}
      />
    </div>
  );
}
