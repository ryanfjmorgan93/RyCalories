import { useId } from 'react';
import { useCoachSheet } from '@/state/coachSheet';
import { useTimer } from '@/state/timer';

/**
 * The coach's own mark: the satin robot's shoulders and neck with the Iron icon as its head, made
 * solid (a bevelled black tile, a lit top edge, the dumbbell glowing in the accent). Drawn, not a
 * picture, so it follows the colour wheel and costs nothing to load. Ids are per instance, because
 * the same SVG can be on screen twice.
 */
export function CoachMark({ size = 42 }: { size?: number }) {
  const raw = useId();
  const id = raw.replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`sh${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9eaec" />
          <stop offset=".5" stopColor="#9da1a7" />
          <stop offset="1" stopColor="#4a4e54" />
        </linearGradient>
        <linearGradient id={`sd${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b5f66" />
          <stop offset="1" stopColor="#1c1d20" />
        </linearGradient>
        <linearGradient id={`fc${id}`} x1="0" y1="0" x2=".35" y2="1">
          <stop offset="0" stopColor="#34363b" />
          <stop offset=".45" stopColor="#16171a" />
          <stop offset="1" stopColor="#0a0a0c" />
        </linearGradient>
        <linearGradient id={`rm${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".85" />
          <stop offset=".35" stopColor="#c9ccd1" stopOpacity=".35" />
          <stop offset="1" stopColor="#6b7077" stopOpacity=".25" />
        </linearGradient>
        <linearGradient id={`db${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="color-mix(in srgb, var(--c-accent) 55%, #fff)" />
          <stop offset=".5" stopColor="var(--c-accent)" />
          <stop offset="1" stopColor="color-mix(in srgb, var(--c-accent) 70%, #000)" />
        </linearGradient>
        <filter id={`gl${id}`} x="-40%" y="-80%" width="180%" height="260%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <path d="M8 62c1-9.5 7.5-16 16.5-17.6h15C48.5 46 55 52.5 56 62H8Z" fill={`url(#sh${id})`} />
      <path d="M14 56.5c2.6-4.4 6.4-7 11-7.7" stroke="#fff" strokeOpacity=".35" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="17" cy="53.5" r="2" fill="#3e4247" opacity=".6" />
      <circle cx="47" cy="53.5" r="2" fill="#3e4247" opacity=".6" />
      <rect x="27.5" y="37" width="9" height="8.5" rx="2.2" fill="#6f747a" />
      <path d="M27.5 40h9M27.5 42.6h9" stroke="#4a4e54" strokeWidth=".8" />
      <rect x="12.5" y="6.5" width="39" height="31" rx="9" fill={`url(#sd${id})`} />
      <rect x="12.5" y="3.5" width="39" height="31" rx="9" fill={`url(#fc${id})`} />
      <rect x="12.9" y="3.9" width="38.2" height="30.2" rx="8.6" stroke={`url(#rm${id})`} strokeWidth=".9" />
      <path d="M18 6.3c2-.9 4-1.2 6-1.2h16" stroke="#fff" strokeOpacity=".55" strokeWidth="1" strokeLinecap="round" />
      <g filter={`url(#gl${id})`} opacity=".85" fill="var(--c-accent)">
        <Dumbbell />
      </g>
      <g fill={`url(#db${id})`}>
        <Dumbbell />
      </g>
      <path d="M21.9 13.6h2.8M39.3 13.6h2.8" stroke="#fff" strokeOpacity=".6" strokeWidth=".6" strokeLinecap="round" />
    </svg>
  );
}

/** The dumbbell of the Iron app icon (public/icons/icon.svg), scaled into the head. */
function Dumbbell() {
  return (
    <>
      <rect x="17.6" y="15.3" width="3.1" height="9.4" rx="1" />
      <rect x="21.4" y="12.8" width="3.8" height="14.4" rx="1.1" />
      <rect x="38.8" y="12.8" width="3.8" height="14.4" rx="1.1" />
      <rect x="43.3" y="15.3" width="3.1" height="9.4" rx="1" />
      <rect x="25.2" y="18.4" width="13.6" height="3.2" rx=".8" />
    </>
  );
}

/**
 * The way to the coach from every screen: a floating glass button bottom-right with the coach's
 * mark, opening the coach sheet (its text field and microphone are inside). It sits above whatever
 * else is pinned to the bottom: the tab bar, the session dock and a running rest timer, using the
 * same height variables they do, so the four never overlap. Hidden while the sheet is open.
 */
export function CoachFab({ inSession = false, dock = false, testId = 'coach-fab' }: { inSession?: boolean; dock?: boolean; testId?: string }) {
  const open = useCoachSheet((s) => s.open);
  const openCoach = useCoachSheet((s) => s.openCoach);
  const resting = useTimer((s) => s.endsAt !== null);
  if (open) return null;
  const stack = [
    'var(--inset-bottom)',
    inSession ? '0.75rem' : 'var(--nav-h) + 0.75rem',
    dock && !inSession ? 'var(--dock-h) + 0.5rem' : null,
    resting ? 'var(--timer-h)' : null,
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
        className="glass-fixed pointer-events-auto relative isolate flex h-15 w-15 items-center justify-center rounded-full border active:scale-95"
        style={{ boxShadow: '0 10px 30px -8px color-mix(in srgb, var(--c-accent) 55%, transparent), inset 0 1px 0 rgba(255,255,255,.14)' }}
      >
        <span
          aria-hidden="true"
          className="absolute -inset-px -z-10 rounded-full"
          style={{ background: 'radial-gradient(70% 55% at 50% 115%, color-mix(in srgb, var(--c-accent) 55%, transparent), transparent 70%)' }}
        />
        <CoachMark />
      </button>
    </div>
  );
}
