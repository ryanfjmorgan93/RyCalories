import { useState } from 'react';
import { demoFrameSrc, demoPicture, pictureFitClass } from './demoPicture';

/** Height in px is the size; a catalogue photograph (3:2) gets the width to match, a diagram is square. */
const SIZES = {
  sm: { square: 'h-10 w-10', wide: 'h-10 w-15' },
  md: { square: 'h-12 w-12', wide: 'h-12 w-18' },
  lg: { square: 'h-14 w-14', wide: 'h-14 w-21' },
} as const;

/**
 * A small still of an exercise's first frame, for a list row or a form. Renders nothing when the
 * key has no picture. The image loads lazily, so a long list only fetches what is scrolled to.
 *
 * A catalogue key cannot be checked against the catalogue here (that would put the lazy index in
 * the main bundle), so a picture that turns out not to exist, after a regeneration dropped its
 * entry or a restore from another build, is found when the image fails: an empty box the same
 * size takes its place, so the row does not shift.
 */
export function DemoThumb({ demo, size = 'md', className = '' }: { demo: string | undefined; size?: keyof typeof SIZES; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const pic = demoPicture(demo);
  const src = demoFrameSrc(demo, 1);
  if (!pic || !src) return null;
  const box = pic.shape === 'wide' ? SIZES[size].wide : SIZES[size].square;
  if (failed === src) return <span data-testid="demo-missing" aria-hidden="true" className={`${box} block shrink-0 rounded-lg bg-surface-2 ${className}`} />;
  // A catalogue photograph is shown whole on the box's surface colour; line art is too, and is inverted for the light theme.
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} className={`${box} shrink-0 rounded-lg bg-surface-2 ${pictureFitClass(pic)} ${className}`} />;
}
