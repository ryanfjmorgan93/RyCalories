/**
 * A photo of a printed InBody result sheet, read by Claude into the scan the Progress card's import
 * sheet previews. This is the card's `onPhoto` (src/ui/BodyCompositionCard.tsx): it resolves with the
 * scan for the owner to check against the paper, or null when nothing could be read, and it saves
 * nothing.
 */
import { readInbodySheet } from '@/ai/vision';
import { toDateKey } from '@/domain/dates';
import type { ParsedInbody } from '@/domain/inbody';
import { parsedFromReading } from '@/domain/inbodyPhoto';
import { toast } from '@/ui/components/Toast';
import { discardImage, prepareImage, readFailureLine } from './claudeFood';

/**
 * The card says "Could not read that sheet" whenever this resolves null or throws. A failure here
 * is null as well, but with the reason as a plain line with the way forward, put up just after the
 * card's own so that it is the one left on screen.
 */
export async function scansFromPhoto(file: File): Promise<ParsedInbody | null> {
  try {
    const image = await prepareImage(file);
    try {
      const reading = await readInbodySheet(image.base64);
      return parsedFromReading(reading, toDateKey());
    } finally {
      await discardImage(image);
    }
  } catch (e) {
    const line = readFailureLine(e, 'sheet');
    window.setTimeout(() => toast(line, 'danger'), 0);
    return null;
  }
}
