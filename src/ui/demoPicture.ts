import { demoFrameUrl, findDemo } from '@/data/exerciseDemos';
import { CATALOGUE_FRAME_COUNT, catalogueFrameUrl, catalogueSlugOf, isCatalogueDemo } from '@/domain/catalogue';

/**
 * What an `Exercise.demo` value points at. It is one of two kinds of key: a bundled diagram's slug
 * (EXERCISE_DEMOS: square line art or a square photo, 1-based .png frames, usually three) or a
 * catalogue key ('cat:<slug>': 3:2 photographs, two 1-based .webp frames). Every place that draws
 * an exercise's picture goes through here, so none of them has to know which kind it holds.
 */
export interface DemoPicture {
  kind: 'diagram' | 'catalogue';
  /** The slug behind the key: the diagram's own, or the catalogue entry's. */
  slug: string;
  frames: number;
  /** A real photograph: shown object-cover, never inverted for the light theme. */
  photo: boolean;
  /** The picture's aspect: 'wide' is 3:2, 'square' is 1:1. */
  shape: 'square' | 'wide';
}

/** The picture a demo key names, or undefined when there is none: no key, or a diagram slug the app does not carry. */
export function demoPicture(demo: string | undefined): DemoPicture | undefined {
  if (demo === undefined) return undefined;
  if (isCatalogueDemo(demo)) {
    return { kind: 'catalogue', slug: catalogueSlugOf(demo), frames: CATALOGUE_FRAME_COUNT, photo: true, shape: 'wide' };
  }
  const d = findDemo(demo);
  if (!d) return undefined;
  return { kind: 'diagram', slug: d.slug, frames: d.frames, photo: d.photo, shape: 'square' };
}

/** URL of frame `frame` (1-based) of a demo key's picture; undefined when there is no such picture or frame. */
export function demoFrameSrc(demo: string | undefined, frame = 1): string | undefined {
  const pic = demoPicture(demo);
  if (!pic || !Number.isInteger(frame) || frame < 1 || frame > pic.frames) return undefined;
  return pic.kind === 'catalogue' ? catalogueFrameUrl(pic.slug, frame as 1 | 2) : demoFrameUrl(pic.slug, frame);
}
