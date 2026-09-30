import { demoFrameSrc, demoPicture } from './demoPicture';

/** Height in px is the size; a catalogue photograph (3:2) gets the width to match, a diagram is square. */
const SIZES = {
  sm: { square: 'h-10 w-10', wide: 'h-10 w-15' },
  md: { square: 'h-12 w-12', wide: 'h-12 w-18' },
  lg: { square: 'h-14 w-14', wide: 'h-14 w-21' },
} as const;

/**
 * A small still of an exercise's first frame, for a list row or a form. Renders nothing when the
 * key has no picture. The image loads lazily, so a long list only fetches what is scrolled to.
 */
export function DemoThumb({ demo, size = 'md', className = '' }: { demo: string | undefined; size?: keyof typeof SIZES; className?: string }) {
  const pic = demoPicture(demo);
  const src = demoFrameSrc(demo, 1);
  if (!pic || !src) return null;
  const box = pic.shape === 'wide' ? SIZES[size].wide : SIZES[size].square;
  // A photograph fills its box; line art keeps its whole drawing in view, and is inverted for the light theme.
  const fit = pic.photo ? 'object-cover' : 'demo-frame object-contain';
  return <img src={src} alt="" loading="lazy" className={`${box} shrink-0 rounded-lg bg-surface-2 ${fit} ${className}`} />;
}
