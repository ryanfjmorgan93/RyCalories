import { memo } from 'react';
import type { ExerciseListRow } from '@/domain/library';
import type { Exercise } from '@/domain/types';
import { Divider, Row } from './components/Card';
import { ChevronIcon } from './components/TopBar';
import { DemoThumb } from './DemoThumb';
import { LibraryLabel } from './LibraryLabel';

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
 * One line of the Exercises list: an exercise of the owner's (opens its page) or a library entry
 * (opens its preview). Memoised, because the list can hold the whole library, some eight hundred
 * rows with a picture each, and every state change of the screen (the preview opening, a search
 * keystroke, a scope toggle) used to draw all of them again. A row is drawn again only when its
 * own row, its place in the list or one of the two handlers changes, so the handlers must be stable.
 */
export const LibraryRow = memo(function LibraryRow({
  row,
  first,
  onOpenOwned,
  onPreview,
}: {
  row: ExerciseListRow;
  /** The first row has no divider above it. */
  first: boolean;
  onOpenOwned: (exerciseId: string) => void;
  onPreview: (row: ExerciseListRow) => void;
}) {
  return (
    <div>
      {!first && <Divider />}
      {row.exercise ? (
        <Row
          testId={`exercise-row-${row.key}`}
          onClick={() => onOpenOwned(row.exercise!.id)}
          left={<DemoThumb demo={row.pictureKey} size="sm" />}
          title={row.name}
          subtitle={exerciseSubtitle(row.exercise)}
          right={<ChevronIcon />}
        />
      ) : (
        <Row
          testId={`exercise-row-${row.key}`}
          onClick={() => onPreview(row)}
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
  );
});
