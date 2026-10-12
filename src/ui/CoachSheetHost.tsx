import { useState } from 'react';
import { builtRowKeys, routineToText, type BuiltRoutine } from '@/domain/routineBuilder';
import { useCoachSheet } from '@/state/coachSheet';
import { CoachSheet } from './CoachSheet';
import { PasteRoutineSheet } from './PasteRoutineSheet';

/**
 * The one coach sheet, mounted once in App.tsx. A routine the coach drafted goes through the same
 * review the rules-based coach uses (PasteRoutineSheet with the rows it already knows), so nothing
 * the coach builds is saved without the owner seeing it.
 */
export function CoachSheetHost() {
  const open = useCoachSheet((s) => s.open);
  const closeCoach = useCoachSheet((s) => s.closeCoach);
  const [review, setReview] = useState<{ text: string; known: ReadonlyMap<string, readonly string[]> } | null>(null);

  function saveDraft(routines: BuiltRoutine[]) {
    setReview({ text: routineToText(routines), known: builtRowKeys(routines) });
    closeCoach();
  }

  return (
    <>
      <CoachSheet open={open} onClose={closeCoach} onSaveDraft={saveDraft} />
      <PasteRoutineSheet open={review !== null} onClose={() => setReview(null)} initialText={review?.text} preMatched={review?.known} title="Review routine" />
    </>
  );
}
