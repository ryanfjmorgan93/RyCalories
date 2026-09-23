import { describe, expect, it } from 'vitest';
import { INITIAL_COMPLETION_HOLD, nextCompletionHold, type CompletionHoldState } from './completionHold';

describe('nextCompletionHold', () => {
  it('a completion starts a hold on the slot that just finished', () => {
    const next = nextCompletionHold('A', 'B', true, INITIAL_COMPLETION_HOLD);
    expect(next).toEqual({ heldKey: 'A' });
  });

  it('a completion then a skip within the window clears the hold — current becomes the real next slot', () => {
    let state: CompletionHoldState = INITIAL_COMPLETION_HOLD;
    state = nextCompletionHold('A', 'B', true, state); // A completes, B is next
    expect(state).toEqual({ heldKey: 'A' });
    // B is skipped before the hold's timer fires — rawCurrentKey moves on to C, but not because B
    // completed.
    state = nextCompletionHold('B', 'C', false, state);
    expect(state).toEqual({ heldKey: null });
  });

  it('a completion then a delete within the window clears the hold', () => {
    let state: CompletionHoldState = INITIAL_COMPLETION_HOLD;
    state = nextCompletionHold('A', 'B', true, state); // A completes, B is next
    expect(state).toEqual({ heldKey: 'A' });
    // A set on B is deleted — B is no longer even a completion, rawCurrentKey stays put or moves
    // for some other reason, but never because B completed.
    state = nextCompletionHold('B', 'A', false, state);
    expect(state).toEqual({ heldKey: null });
  });

  it('two completions in a row hold the second, not the first', () => {
    let state: CompletionHoldState = INITIAL_COMPLETION_HOLD;
    state = nextCompletionHold('A', 'B', true, state); // A completes
    expect(state).toEqual({ heldKey: 'A' });
    state = nextCompletionHold('B', 'C', true, state); // B also completes before A's timer fires
    expect(state).toEqual({ heldKey: 'B' });
  });

  it('a transition with no completion never holds', () => {
    const next = nextCompletionHold('A', 'B', false, INITIAL_COMPLETION_HOLD);
    expect(next).toEqual({ heldKey: null });
  });

  it('no transition (same key) leaves the current hold exactly as it is', () => {
    const held: CompletionHoldState = { heldKey: 'A' };
    expect(nextCompletionHold('B', 'B', false, held)).toBe(held);
    expect(nextCompletionHold(null, null, false, INITIAL_COMPLETION_HOLD)).toBe(INITIAL_COMPLETION_HOLD);
  });

  it('the very first render (prevRawKey null) never holds, even if flagged complete', () => {
    // Defensive: a caller should never pass prevJustCompleted=true with prevRawKey=null, but the
    // function must not crash or hold a null key if it happens.
    expect(nextCompletionHold(null, 'A', true, INITIAL_COMPLETION_HOLD)).toEqual({ heldKey: null });
  });
});
