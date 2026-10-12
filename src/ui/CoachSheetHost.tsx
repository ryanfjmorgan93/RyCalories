import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { builtRowKeys, routineToText, type BuiltRoutine } from '@/domain/routineBuilder';
import { useCoachSheet } from '@/state/coachSheet';
import { CoachSheet } from './CoachSheet';
import { PasteRoutineSheet } from './PasteRoutineSheet';

/**
 * The one coach sheet, mounted once in App.tsx. A routine the coach drafted or built goes through
 * the same review the rules-based coach uses (PasteRoutineSheet with the rows it already knows), so
 * nothing the coach builds is saved without the owner seeing it.
 *
 * On the full-screen coach (/coach) the sheet stays shut: that screen is the same conversation and
 * takes whatever was passed to `openCoach` itself.
 */
export function CoachSheetHost() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const open = useCoachSheet((s) => s.open) && pathname !== '/coach';
  const prefill = useCoachSheet((s) => s.prefill);
  const build = useCoachSheet((s) => s.build);
  const closeCoach = useCoachSheet((s) => s.closeCoach);
  const [review, setReview] = useState<{ text: string; known: ReadonlyMap<string, readonly string[]> } | null>(null);

  function saveDraft(routines: BuiltRoutine[]) {
    setReview({ text: routineToText(routines), known: builtRowKeys(routines) });
    closeCoach();
  }

  return (
    <>
      <CoachSheet
        open={open}
        onClose={closeCoach}
        onSaveDraft={saveDraft}
        onFullScreen={() => {
          closeCoach();
          nav('/coach');
        }}
        prefill={prefill}
        build={build}
      />
      <PasteRoutineSheet open={review !== null} onClose={() => setReview(null)} initialText={review?.text} preMatched={review?.known} title="Review routine" />
    </>
  );
}
