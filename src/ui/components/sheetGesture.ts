/**
 * The decisions behind dragging a bottom sheet down to close it, kept free of the DOM so they
 * are tested directly (sheetGesture.test.ts). `Sheet.tsx` owns the touch listeners and the
 * element writes; everything it has to judge — whose gesture this is, where the panel sits,
 * whether letting go closes it — is decided here.
 */

export type DragIntent = 'pending' | 'drag' | 'scroll';

/** Movement below this is not judged yet: a tap that wobbles is still a tap. */
export const DRAG_SLOP_PX = 8;

/** A release this far down closes the sheet, capped so a tall sheet needs no longer a pull. */
export const DISMISS_DISTANCE_PX = 120;
export const DISMISS_FRACTION = 0.25;

/** A downward flick at this speed closes the sheet short of the distance… */
export const FLICK_VELOCITY_PX_MS = 0.6;
/** …provided the finger actually travelled, so a jab is not a flick. */
export const FLICK_MIN_DISTANCE_PX = 16;

/** Release speed is measured over the last stretch of the gesture, not its whole length. */
export const VELOCITY_WINDOW_MS = 100;

/**
 * Whose gesture this is, decided once — on the first move past the slop — and kept for the rest
 * of the touch. Switching mid-gesture from scrolling the list to dragging the sheet (or back)
 * would fight the finger, and the browser only lets a gesture be taken from it at the start.
 *
 * - `fromHandle`: the touch began on the handle or title, where nothing scrolls, so any
 *   downward movement drags. Upward or flat drift is left alone: claiming it would swallow the
 *   click of a tap on Close whose thumb rolled up as it lifted.
 * - `scrollEligible`: every scrollable box between the finger and the panel was already at its
 *   top when the touch began. Only then can a pull down mean "close" rather than "scroll back".
 */
export function decideDragIntent(dx: number, dy: number, fromHandle: boolean, scrollEligible: boolean): DragIntent {
  if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return 'pending';
  if (fromHandle) return dy > 0 ? 'drag' : 'scroll';
  if (!scrollEligible) return 'scroll';
  return dy > 0 && dy > Math.abs(dx) ? 'drag' : 'scroll';
}

/** The panel follows the finger 1:1 downward. Above its resting place there is nothing to show. */
export function dragOffset(dy: number): number {
  return Math.max(0, dy);
}

/** The scrim fades with the drag: fully dark at rest, clear once the panel has travelled `fadeDistance`. */
export function scrimOpacity(offset: number, fadeDistance: number): number {
  if (fadeDistance <= 0) return offset > 0 ? 0 : 1;
  return Math.min(1, Math.max(0, 1 - offset / fadeDistance));
}

export function dismissDistance(panelHeight: number): number {
  return Math.min(DISMISS_DISTANCE_PX, Math.max(0, panelHeight) * DISMISS_FRACTION);
}

export function shouldDismiss({ distance, panelHeight, velocityPxMs }: { distance: number; panelHeight: number; velocityPxMs: number }): boolean {
  if (distance >= dismissDistance(panelHeight)) return true;
  return velocityPxMs >= FLICK_VELOCITY_PX_MS && distance >= FLICK_MIN_DISTANCE_PX;
}

export interface DragSample {
  y: number;
  t: number;
}

/**
 * Downward speed at release in px/ms, over the samples inside the last `VELOCITY_WINDOW_MS`.
 * A slow pull that ends in a flick reads as a flick; a flick that stopped dead before letting go
 * does not. Fewer than two samples in the window has no speed.
 */
export function releaseVelocity(samples: readonly DragSample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i]!;
    if (last.t - s.t > VELOCITY_WINDOW_MS) break;
    first = s;
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return (last.y - first.y) / dt;
}
