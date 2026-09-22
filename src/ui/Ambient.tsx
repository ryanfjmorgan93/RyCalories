import { useActiveSession } from './hooks';
import { useTimer } from '@/state/timer';
import { useAmbientFlash } from '@/state/ambient';

/**
 * The ground layer every screen sits on: a near-black base plus soft colour fields that report
 * live state at a glance — ember while a workout is running, cool while a rest timer counts down,
 * a brief green bloom on finishing an exercise, gold on a record (see `flashAmbient`,
 * src/state/ambient.ts). Mounted once in App.tsx, behind all routed content.
 *
 * `position: fixed` with a negative z-index rather than `position: relative; z-index: 1` on every
 * screen: it sits above the plain `<html>` background paint and below ordinary in-flow page
 * content without any screen having to opt in (CSS's root stacking order puts a negative-z-index
 * box above the root element's own background and below everything else). Fixed, so it never
 * repaints on scroll; only `opacity` ever transitions, never a layout property; no
 * `backdrop-filter` — all three are what keep it free on an Android WebView. Reduced motion is
 * handled globally (src/index.css): the fields still change, just without the fade between them.
 */
export function Ambient() {
  const working = useActiveSession() != null;
  const resting = useTimer((s) => s.endsAt !== null);
  const flash = useAmbientFlash((s) => s.flash);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg">
      <Field corner="left-top" color="var(--amb-base)" visible size={120} />
      <Field corner="left-top" color="var(--amb-ember)" visible={working} size={130} offset={-8} />
      <Field corner="left-top" color="var(--amb-cool)" visible={resting} size={140} offset={20} durationMs={1400} />
      <Field corner="left-top" color="var(--amb-done)" visible={flash === 'done'} size={120} offset={30} durationMs={700} />
      <Field corner="right-top" color="var(--amb-record)" visible={flash === 'record'} size={120} durationMs={700} />
      <svg width="100%" height="100%" className="absolute inset-0 opacity-[var(--amb-grain-opacity)] mix-blend-overlay">
        <filter id="iron-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#iron-grain)" />
      </svg>
    </div>
  );
}

/** One radial glow, parked in a corner and faded by opacity only. */
function Field({
  corner,
  color,
  visible,
  size,
  offset = 0,
  durationMs = 1400,
}: {
  corner: 'left-top' | 'right-top';
  color: string;
  visible: boolean;
  /** Diameter as a percentage of the larger viewport dimension (vmax). */
  size: number;
  /** Nudges this field off its neighbours' exact corner so overlapping fields read as distinct. */
  offset?: number;
  durationMs?: number;
}) {
  const pos =
    corner === 'left-top'
      ? { left: `${-size / 2 + offset}vmax`, top: `${-size / 2 + offset}vmax` }
      : { right: `${-size / 2 + offset}vmax`, top: `${-size / 2 + offset}vmax` };
  return (
    <div
      className="absolute rounded-full"
      style={{
        width: `${size}vmax`,
        height: `${size}vmax`,
        ...pos,
        background: `radial-gradient(closest-side, ${color}, transparent 72%)`,
        opacity: visible ? 1 : 0,
        transition: `opacity ${durationMs}ms ease`,
      }}
    />
  );
}
