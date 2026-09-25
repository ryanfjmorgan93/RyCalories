import { describe, expect, it } from 'vitest';
import {
  decideDragIntent,
  dismissDistance,
  dragOffset,
  releaseVelocity,
  scrimOpacity,
  shouldDismiss,
  DRAG_SLOP_PX,
  FLICK_MIN_DISTANCE_PX,
  FLICK_VELOCITY_PX_MS,
} from './sheetGesture';

describe('decideDragIntent', () => {
  it('judges nothing under the slop, from the handle or the body', () => {
    expect(decideDragIntent(0, DRAG_SLOP_PX - 1, true, true)).toBe('pending');
    expect(decideDragIntent(3, 4, false, true)).toBe('pending');
  });

  it('from the handle, any movement past the slop drags — sideways and upward included', () => {
    expect(decideDragIntent(0, 20, true, false)).toBe('drag');
    expect(decideDragIntent(30, 2, true, false)).toBe('drag');
    expect(decideDragIntent(0, -20, true, false)).toBe('drag');
  });

  it('from the body, a downward, mostly vertical pull at the top of the list drags', () => {
    expect(decideDragIntent(0, 20, false, true)).toBe('drag');
    expect(decideDragIntent(5, 20, false, true)).toBe('drag');
  });

  it('from the body, upward or mostly sideways movement stays with the browser', () => {
    expect(decideDragIntent(0, -20, false, true)).toBe('scroll');
    expect(decideDragIntent(30, 10, false, true)).toBe('scroll');
    // A perfect diagonal is not "more down than sideways".
    expect(decideDragIntent(15, 15, false, true)).toBe('scroll');
  });

  it('a scrolled list takes the pull, however vertical it is', () => {
    expect(decideDragIntent(0, 200, false, false)).toBe('scroll');
  });
});

describe('dragOffset', () => {
  it('follows the finger 1:1 downward', () => {
    expect(dragOffset(0)).toBe(0);
    expect(dragOffset(57)).toBe(57);
  });

  it('never lifts the panel above its resting place', () => {
    expect(dragOffset(-40)).toBe(0);
  });
});

describe('scrimOpacity', () => {
  it('fades linearly with the drag', () => {
    expect(scrimOpacity(0, 400)).toBe(1);
    expect(scrimOpacity(100, 400)).toBe(0.75);
    expect(scrimOpacity(200, 400)).toBe(0.5);
  });

  it('stays within 0..1 either side of the range', () => {
    expect(scrimOpacity(900, 400)).toBe(0);
    expect(scrimOpacity(-10, 400)).toBe(1);
  });

  it('a zero fade distance is clear as soon as the panel moves', () => {
    expect(scrimOpacity(0, 0)).toBe(1);
    expect(scrimOpacity(1, 0)).toBe(0);
  });
});

describe('dismissDistance and shouldDismiss', () => {
  it('a short sheet closes at a quarter of its height', () => {
    expect(dismissDistance(200)).toBe(50);
    expect(shouldDismiss({ distance: 49, panelHeight: 200, velocityPxMs: 0 })).toBe(false);
    expect(shouldDismiss({ distance: 50, panelHeight: 200, velocityPxMs: 0 })).toBe(true);
  });

  it('a tall sheet is capped at 120 px, not a quarter of its height', () => {
    expect(dismissDistance(800)).toBe(120);
    expect(shouldDismiss({ distance: 119, panelHeight: 800, velocityPxMs: 0 })).toBe(false);
    expect(shouldDismiss({ distance: 120, panelHeight: 800, velocityPxMs: 0 })).toBe(true);
  });

  it('a flick closes well short of the distance', () => {
    expect(shouldDismiss({ distance: 30, panelHeight: 800, velocityPxMs: FLICK_VELOCITY_PX_MS })).toBe(true);
  });

  it('a slow short pull settles back', () => {
    expect(shouldDismiss({ distance: 60, panelHeight: 800, velocityPxMs: 0.2 })).toBe(false);
  });

  it('a fast jab that barely moved is not a flick', () => {
    expect(shouldDismiss({ distance: FLICK_MIN_DISTANCE_PX - 1, panelHeight: 800, velocityPxMs: 3 })).toBe(false);
  });
});

describe('releaseVelocity', () => {
  it('no speed from fewer than two samples', () => {
    expect(releaseVelocity([])).toBe(0);
    expect(releaseVelocity([{ y: 10, t: 0 }])).toBe(0);
  });

  it('measures only the last 100 ms: a slow pull ending in a flick is a flick', () => {
    const samples = [
      { y: 0, t: 0 },
      { y: 20, t: 400 }, // 400 ms of slow pulling
      { y: 30, t: 450 },
      { y: 100, t: 500 }, // then 70 px in the last 50 ms
    ];
    expect(releaseVelocity(samples)).toBeCloseTo((100 - 20) / (500 - 400));
  });

  it('a pull that stopped dead before release has no speed at release', () => {
    // The release itself is appended as a sample at the finger's last position.
    const samples = [
      { y: 0, t: 0 },
      { y: 80, t: 50 },
      { y: 80, t: 400 },
    ];
    expect(releaseVelocity(samples)).toBe(0);
  });

  it('upward movement at release is negative, never a downward flick', () => {
    expect(releaseVelocity([{ y: 100, t: 0 }, { y: 40, t: 50 }])).toBeLessThan(0);
  });
});
