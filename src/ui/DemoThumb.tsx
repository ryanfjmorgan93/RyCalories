import { useState } from 'react';
import { demoFrameSrc, demoPicture, pictureFitClass, robotSrc } from './demoPicture';
import { ExerciseHero } from './ExerciseHero';

/** Height in px is the size, and every thumbnail is the 3:2 box, so the names beside a list of them start on one edge. */
const SIZES = {
  sm: { wide: 'h-10 w-15' },
  md: { wide: 'h-12 w-18' },
  lg: { wide: 'h-14 w-21' },
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
  // An exercise with a robot render shows that (on black, with the accent glow), never a photograph.
  if (robotSrc(demo) !== undefined) return <ExerciseHero demo={demo} className={`${SIZES[size].wide} shrink-0 rounded-lg ${className}`} />;
  const pic = demoPicture(demo);
  const src = demoFrameSrc(demo, 1);
  if (!pic || !src) return null;
  const box = SIZES[size].wide;
  if (failed === src) return <span data-testid="demo-missing" aria-hidden="true" className={`${box} block shrink-0 rounded-lg bg-surface-2 ${className}`} />;
  // A catalogue photograph is shown whole on the box's surface colour; line art is too.
  // Line art is shown whole inside the box; a photograph fills it.
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} className={`${box} shrink-0 rounded-lg bg-surface-2 ${pictureFitClass(pic)} ${className}`} />;
}
