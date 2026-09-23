/**
 * When the camera's decoder has really read a barcode.
 *
 * A single decoded frame is not enough. EAN/UPC check digits catch most misreads, but a blurred or
 * angled frame can still decode to a different code that happens to pass its check digit — which is
 * a different product, or none, written onto the food behind a label badge. Requiring the same code
 * on two consecutive frames rules that out for the price of one extra frame (~150 ms), which is how
 * dedicated scanners behave.
 */
export interface ReadState {
  /** The code read on the previous frame, not yet confirmed. Null when that frame read nothing. */
  pending: string | null;
}

export const NO_READ: ReadState = { pending: null };

/**
 * Feed one frame's decoded codes. Returns `confirmed` once the same code has been read on two
 * consecutive frames. A frame that reads nothing, or reads a different code, starts again.
 */
export function confirmRead(prev: ReadState, codes: readonly string[]): { confirmed?: string; next: ReadState } {
  const code = codes[0];
  if (code === undefined || code === '') return { next: NO_READ };
  if (prev.pending === code) return { confirmed: code, next: NO_READ };
  return { next: { pending: code } };
}
