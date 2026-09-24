import { useEffect, useState } from 'react';
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
 * decision logic lives there, tested on its own).
 *
 * The hold is decided DURING the render in which `rawCurrentKey` changes (React's "adjust state
 * while rendering" pattern), not in an effect afterwards. Deciding it in an effect left one
 * committed render in which the hold had not been applied yet: the slot that had just finished
 * was already off `currentKey` and the next one was on it, then the hold snapped it back. The
 * screen's focus hand-off watched `currentKey`, saw that flicker, and spent the pending hand-off on
 * the finished card (which has no input to focus) — so focus never reached the next exercise, and
 * the next card was briefly `isCurrent`, long enough to start scrolling to it mid-celebration.
 *
 * Every transition replaces the state object, so the timer effect below — keyed on it — always
 * cancels the previous timer before scheduling the next: a transition that is not itself a
 * completion (a skip, a delete) can never leave a stale hold with no timer left to clear it.
 *
 * `isSlotComplete` is called with the *previous* raw key, at the moment of the transition, so it
 * reads this render's live data.
 */
export function useCompletionHold(rawCurrentKey: string | null, isSlotComplete: (key: string) => boolean): string | null {
  const [state, setState] = useState<CompletionHoldState>(INITIAL_COMPLETION_HOLD);
  const [prevRawKey, setPrevRawKey] = useState<string | null>(rawCurrentKey);

  let current = state;
  if (prevRawKey !== rawCurrentKey) {
    const prevJustCompleted = prevRawKey !== null && isSlotComplete(prevRawKey);
    current = nextCompletionHold(prevRawKey, rawCurrentKey, prevJustCompleted, state);
    setPrevRawKey(rawCurrentKey);
    setState(current);
  }

  useEffect(() => {
    if (state.heldKey === null) return;
    const ms = prefersReducedMotion() ? 0 : 1800;
    const t = window.setTimeout(() => setState(INITIAL_COMPLETION_HOLD), ms);
    return () => window.clearTimeout(t);
  }, [state]);

  return current.heldKey;
}
