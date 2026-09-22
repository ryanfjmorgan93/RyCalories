import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Press-and-hold destructive confirm. A single tap does nothing — the action only fires once the
 * pointer (or Space/Enter) has been held down for `holdMs`, with a visible fill showing progress.
 * Releasing early cancels and the fill resets to zero; there is no partial-credit state to race.
 */
export function HoldToConfirm({
  label,
  holdMs = 1500,
  onComplete,
  disabled,
  testId,
}: {
  label: string;
  holdMs?: number;
  onComplete: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const [progress, setProgress] = useState(0); // 0..1
  const [holding, setHolding] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  const tick = useCallback(() => {
    if (startRef.current === null) return;
    const elapsed = performance.now() - startRef.current;
    const p = Math.min(1, elapsed / holdMs);
    setProgress(p);
    if (p >= 1) {
      if (!doneRef.current) {
        doneRef.current = true;
        onComplete();
      }
      stop();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [holdMs, onComplete, stop]);

  const start = useCallback(() => {
    if (disabled || startRef.current !== null) return;
    doneRef.current = false;
    startRef.current = performance.now();
    setHolding(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [disabled, tick]);

  // Unmounting mid-hold (e.g. the sheet's Cancel closes it) must not leave a stray rAF running.
  useEffect(() => () => stop(), [stop]);

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      // touch-none: without it a finger that drifts a few pixels lets the browser claim the gesture
      // as a scroll and fire pointercancel, so a real hold on the phone keeps resetting.
      className={`relative isolate flex h-14 w-full touch-none select-none items-center justify-center overflow-hidden rounded-2xl border border-danger/50 text-lg font-bold text-danger disabled:opacity-40 ${holding ? 'holding' : 'idle'}`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault();
        start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && startRef.current === null) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') stop();
      }}
    >
      <span className="pointer-events-none absolute inset-y-0 left-0 bg-danger/25" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
      <span className="relative z-10">{label}</span>
    </button>
  );
}
