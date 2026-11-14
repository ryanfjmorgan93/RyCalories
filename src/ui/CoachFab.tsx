import { useCoachSheet } from '@/state/coachSheet';
import { useTimer } from '@/state/timer';
import { useSettings } from './hooks';

/**
 * The coach's mark, as the owner picks it in Settings → Look (`Settings.coachMark`): the seal, a
 * hexagon (the game's own shape) with an engraved I, or the robot, drawn flat in fine lines with the
 * dumbbell for its face. Both are line drawings in the accent and cream, so they follow the wheel.
 */
export function CoachMark({ size = 26, kind }: { size?: number; kind?: CoachMarkKind }) {
  const picked = useSettings()?.coachMark;
  return (kind ?? picked ?? 'seal') === 'robot' ? <RobotMark size={size} /> : <SealMark size={size} />;
}

export type CoachMarkKind = 'seal' | 'robot';

function SealMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" data-mark="seal">
      <path d="M12 2.2 20.5 7.1v9.8L12 21.8 3.5 16.9V7.1L12 2.2Z" stroke="var(--c-accent)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 5.4 17.7 8.7v6.6L12 18.6l-5.7-3.3V8.7L12 5.4Z" stroke="var(--c-accent)" strokeOpacity=".45" strokeWidth=".75" strokeLinejoin="round" />
      <path d="M10 8.6h4M10 15.4h4M12 8.6v6.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function RobotMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" data-mark="robot">
      <rect x="4.5" y="3" width="15" height="11.5" rx="3.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 14.5v2.2h4v-2.2M3.5 22c.6-3 3-5.3 6.5-5.3h4c3.5 0 5.9 2.3 6.5 5.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.2 6.9v3.7M9.9 6v5.5M14.1 6v5.5M15.8 6.9v3.7M9.9 8.75h4.2" stroke="var(--c-accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The way to the coach from every screen: a glass disc with the coach's mark, opening the coach
 * sheet (its text field and microphone are inside). Off a session it floats in the tab island's row,
 * to its right, so it never covers the page; in a session it sits above a running rest timer.
 * Hidden while the sheet is open.
 */
export function CoachFab({ inSession = false, testId = 'coach-fab' }: { inSession?: boolean; testId?: string }) {
  const open = useCoachSheet((s) => s.open);
  const openCoach = useCoachSheet((s) => s.openCoach);
  const resting = useTimer((s) => s.endsAt !== null);
  if (open) return null;
  // Off the session the disc floats in the tab island's row, to its right; in a session, above the
  // rest timer as before.
  const stack = [
    'var(--inset-bottom)',
    '0.75rem',
    inSession && resting ? 'var(--timer-h)' : null,
  ]
    .filter(Boolean)
    .join(' + ');
  return (
    <div className="content-max pointer-events-none fixed inset-x-0 z-40 mx-auto flex justify-end px-4" style={{ bottom: `calc(${stack})` }}>
      <button
        type="button"
        aria-label="Coach"
        data-testid={testId}
        onClick={() => openCoach()}
        className="glass-fixed pointer-events-auto flex h-16 w-16 items-center justify-center rounded-full text-fg shadow-[inset_0_0_0_1px_rgba(243,239,230,0.09),0_24px_48px_-16px_rgba(0,0,0,0.9)] transition-transform duration-150 active:scale-95"
      >
        <CoachMark size={28} />
      </button>
    </div>
  );
}
