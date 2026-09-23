import { describe, expect, it } from 'vitest';
import { confirmRead, NO_READ, type ReadState } from './barcodeRead';

/** Run a sequence of frames and return every code confirmed along the way. */
function feed(frames: string[][]): string[] {
  let state: ReadState = NO_READ;
  const out: string[] = [];
  for (const codes of frames) {
    const r = confirmRead(state, codes);
    if (r.confirmed) out.push(r.confirmed);
    state = r.next;
  }
  return out;
}

describe('confirmRead', () => {
  it('does not accept a code read on one frame only', () => {
    expect(feed([['5010029000061']])).toEqual([]);
  });

  it('accepts a code read on two consecutive frames', () => {
    expect(feed([['5010029000061'], ['5010029000061']])).toEqual(['5010029000061']);
  });

  it('does not accept two different codes on consecutive frames — one of them is a misread', () => {
    expect(feed([['5010029000061'], ['5010029000016']])).toEqual([]);
  });

  it('starts again after a frame that reads nothing', () => {
    expect(feed([['5010029000061'], [], ['5010029000061']])).toEqual([]);
  });

  it('confirms the second code once it is read twice in a row after a misread', () => {
    expect(feed([['5010029000016'], ['5010029000061'], ['5010029000061']])).toEqual(['5010029000061']);
  });

  it('ignores an empty string as a read', () => {
    expect(feed([[''], ['']])).toEqual([]);
  });
});
