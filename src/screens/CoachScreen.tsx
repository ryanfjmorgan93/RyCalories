import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { builtRowKeys, routineToText, type BuiltRoutine } from '@/domain/routineBuilder';
import { useCoachSheet } from '@/state/coachSheet';
import { useTimer } from '@/state/timer';
import { CoachComposer } from '@/ui/CoachComposer';
import { CoachThread } from '@/ui/CoachThread';
import { PasteRoutineSheet } from '@/ui/PasteRoutineSheet';
import { Button } from '@/ui/components/Button';
import { TopBar } from '@/ui/components/TopBar';
import { useSessionDock } from '@/ui/hooks';
import { useCoachConversation } from '@/ui/useCoachConversation';

/**
 * The room the tab shell leaves at the foot of the page (src/App.tsx `Shell`): the tab bar, and the
 * session dock and rest timer when they float above it. The box is held at the same height so it is
 * never under any of them, and a short conversation still ends with the box at the bottom.
 */
function useFootRoom(): string {
  const dock = useSessionDock();
  const resting = useTimer((s) => s.endsAt !== null);
  if (dock) return resting ? 'calc(var(--inset-bottom) + var(--nav-h) + var(--dock-h) + var(--timer-h) + 1.75rem)' : 'calc(var(--inset-bottom) + var(--nav-h) + var(--dock-h) + 1.25rem)';
  return resting ? 'calc(var(--inset-bottom) + var(--nav-h) + var(--timer-h) + 1rem)' : 'calc(var(--inset-bottom) + var(--nav-h) + 0.5rem)';
}

/**
 * The coach, full screen: the same conversation as the sheet (one thread, one box), with room to
 * read a routine. Asking for a routine, or a change to the one on screen, works with or without
 * Claude (see src/ui/useCoachConversation.ts); a question needs Claude. A routine goes through
 * Review routine, which matches each row to the owner's exercises and saves it. Stop ends what the
 * rules coach is doing and keeps what is on screen; Clear ends it and empties its routines.
 */
export function CoachScreen() {
  const [params] = useSearchParams();
  const c = useCoachConversation();
  const { receive } = c;
  const foot = useFootRoom();
  // The routine under review: its text, and which exercise each of its rows is (the builder's own, not a guess from the name).
  const [review, setReview] = useState<{ text: string; known: ReadonlyMap<string, readonly string[]> } | null>(null);

  // Routines > New routine > Draft with coach opens here to build: its first message is a build whatever it says.
  const [openingBuild] = useState(params.get('mode') === 'routine');
  useEffect(() => {
    if (openingBuild) receive('', true);
  }, [openingBuild, receive]);

  // `openCoach()` from anywhere (a coach line, say) lands here while this screen is up: its line
  // goes in the box, and the sheet, which stays shut on this screen, is told it was heard.
  const asked = useCoachSheet((s) => s.open);
  const prefill = useCoachSheet((s) => s.prefill);
  const build = useCoachSheet((s) => s.build);
  const closeCoach = useCoachSheet((s) => s.closeCoach);
  useEffect(() => {
    if (!asked) return;
    receive(prefill, build);
    closeCoach();
  }, [asked, prefill, build, receive, closeCoach]);

  const openReview = (routines: BuiltRoutine[]) => setReview({ text: routineToText(routines), known: builtRowKeys(routines) });

  return (
    <div className="flex flex-col" style={{ minHeight: `calc(100dvh - ${foot})` }}>
      <TopBar
        title="Coach"
        back
        right={
          // While it is busy, and when it has a problem or a draft with nothing else on screen, Clear is still there: it is the way out.
          c.clearable ? (
            <Button size="md" variant="ghost" className="mr-1" onClick={c.clear} data-testid="coach-clear">
              Clear
            </Button>
          ) : undefined
        }
      />
      <div className="flex-1 px-4 pt-3">
        <CoachThread c={c} onReview={openReview} />
      </div>
      <div className="sticky z-20 border-t border-line bg-bg px-4 pb-3 pt-3" style={{ bottom: foot }}>
        <CoachComposer c={c} />
      </div>

      <PasteRoutineSheet open={review !== null} onClose={() => setReview(null)} initialText={review?.text} preMatched={review?.known} title="Review routine" />
    </div>
  );
}
