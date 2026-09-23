import { useEffect, useRef, useState } from 'react';
import { INITIAL_COMPLETION_HOLD, nextCompletionHold, type CompletionHoldState } from '@/domain/completionHold';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false; // matchMedia unavailable — treat as full motion
  }
}

/**
 * Owns the ~1.8s timer around `nextCompletionHold` (src/domain/completionHold.ts — the actual
 * decision logic lives there, tested on its own). Every render where `rawCurrentKey` has actually
 * changed since the last one cancels any in-flight timer FIRST, then asks the pure function what
 * the next hold should be — so a transition that isn't itself a completion (a skip, a delete, the
 * timer having nothing left to hold) can never leave a stale hold stranded with no timer left to
 * clear it (the bug this replaces).
 *
 * `isSlotComplete` is called with the *previous* raw key, at the moment of the transition, so it
 * always reads live (not stale) data — same render, same closure.
 */
export function useCompletionHold(rawCurrentKey: string | null, isSlotComplete: (key: string) => boolean): string | null {
  const [state, setState] = useState<CompletionHoldState>(INITIAL_COMPLETION_HOLD);
  const stateRef = useRef(state);
  stateRef.current = state;
  const prevRawKeyRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const prevRawKey = prevRawKeyRef.current;
    prevRawKeyRef.current = rawCurrentKey;
    if (prevRawKey === rawCurrentKey) return;

    // Every transition clears any in-flight hold and timer first.
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const prevJustCompleted = prevRawKey !== null && isSlotComplete(prevRawKey);
    const next = nextCompletionHold(prevRawKey, rawCurrentKey, prevJustCompleted, stateRef.current);
    stateRef.current = next;
    setState(next);

    if (next.heldKey !== null) {
      const ms = prefersReducedMotion() ? 0 : 1800;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        stateRef.current = INITIAL_COMPLETION_HOLD;
        setState(INITIAL_COMPLETION_HOLD);
      }, ms);
    }
    // Only `rawCurrentKey` should re-run this — `isSlotComplete` is read fresh from this same
    // render's closure exactly once, at the instant of the transition it's about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawCurrentKey]);

  // Unmount-only cleanup — every other path above already clears its own timer before replacing it.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return state.heldKey;
}
