import { useEffect } from 'react';
import type { BuiltRoutine } from '@/domain/routineBuilder';
import { Button } from './components/Button';
import { Sheet } from './components/Sheet';
import { CoachComposer } from './CoachComposer';
import { CoachThread } from './CoachThread';
import { useCoachConversation } from './useCoachConversation';

/**
 * The coach, as a bottom sheet: the one conversation (src/ui/CoachThread.tsx), its box with the
 * microphone (src/ui/CoachComposer.tsx), and a way into the full screen. A routine the coach
 * drafted or built is offered for review when the caller passes `onSaveDraft`; saving is the
 * caller's, because turning a draft into routines is the same review the rest of the app uses, and
 * nothing is saved here.
 *
 * `prefill` starts the box with a line the owner can send or change; `build` makes the first
 * message a request for a routine whatever it says.
 */
export function CoachSheet({
  open,
  onClose,
  onSaveDraft,
  onFullScreen,
  prefill = '',
  build = false,
}: {
  open: boolean;
  onClose: () => void;
  onSaveDraft?: (routines: BuiltRoutine[]) => void;
  onFullScreen?: () => void;
  prefill?: string;
  build?: boolean;
}) {
  const c = useCoachConversation({ active: open });
  const { receive } = c;

  useEffect(() => {
    if (open) receive(prefill, build);
  }, [open, prefill, build, receive]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center justify-between gap-2">
          <span>Coach</span>
          {onFullScreen && (
            <Button size="sm" variant="ghost" className="-mr-3" onClick={onFullScreen} data-testid="coach-fullscreen">
              Full screen
            </Button>
          )}
        </div>
      }
      footer={<CoachComposer c={c} />}
    >
      <CoachThread c={c} onReview={onSaveDraft} />
    </Sheet>
  );
}
