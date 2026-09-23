/**
 * The live session screen holds `currentKey` on a slot that just reached its target for a short
 * window, so its completion celebration is actually seen before the view moves on (see
 * `screens/session/useCompletionHold.ts`, which owns the timer around this). Pure state machine:
 * given the transition that just happened, decide the next hold.
 *
 * The rule: every transition clears any in-flight hold first. A hold is only (re)started when the
 * transition happened BECAUSE the previous slot just completed — a skip, a delete, or any other
 * reason `rawCurrentKey` moved on clears the hold outright instead of leaving it pointed at a slot
 * that is no longer the reason anything moved.
 */
export interface CompletionHoldState {
  heldKey: string | null;
}

export const INITIAL_COMPLETION_HOLD: CompletionHoldState = { heldKey: null };

/**
 * @param prevRawKey The raw current key before this transition (null before anything has loaded).
 * @param rawKey The raw current key now.
 * @param prevJustCompleted Whether `prevRawKey`'s slot just reached its target — the only reason a
 *   transition may start a hold, computed by the caller from live data at the moment of the
 *   transition (a slot lookup that no longer exists, e.g. a removed extra, counts as false).
 * @param current The hold state before this transition.
 */
export function nextCompletionHold(
  prevRawKey: string | null,
  rawKey: string | null,
  prevJustCompleted: boolean,
  current: CompletionHoldState,
): CompletionHoldState {
  if (prevRawKey === rawKey) return current; // no transition — leave any running hold alone
  if (prevJustCompleted && prevRawKey !== null) return { heldKey: prevRawKey };
  return { heldKey: null };
}
