import { demoFrameUrl, findDemo } from '@/data/exerciseDemos';
import { CATALOGUE_FRAME_COUNT, catalogueFrameUrl, catalogueSlugOf, isCatalogueDemo } from '@/domain/catalogue';

/**
 * What an `Exercise.demo` value points at. It is one of two kinds of key: a bundled diagram's slug
 * (EXERCISE_DEMOS: square line art or a square photo, 1-based .png frames, usually three) or a
 * catalogue key ('cat:<slug>': photographs in a 3:2 box, two 1-based .webp frames). Every place that draws
 * an exercise's picture goes through here, so none of them has to know which kind it holds.
 */
export interface DemoPicture {
  kind: 'diagram' | 'catalogue';
  /** The slug behind the key: the diagram's own, or the catalogue entry's. */
  slug: string;
  frames: number;
  /** A real photograph: never inverted for the light theme (see pictureFitClass for how it fills its box). */
  photo: boolean;
  /** The box the picture is drawn in: 'wide' is 3:2, 'square' is 1:1. */
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

/**
 * How a picture fills its fixed box. A catalogue photograph is shown whole, letterboxed on the
 * box's surface colour: the dataset's photos are 3:2 for nine in ten, but the rest are portrait or
 * 16:9, and filling the box would cut a third to a half of those off, head and feet first. Line art
 * is shown whole too, and inverted for the light theme. Only a bundled square photograph (the neck
 * demo) fills its square box, which crops nothing.
 */
export function pictureFitClass(pic: DemoPicture): string {
  if (pic.kind === 'catalogue') return 'object-contain';
  return pic.photo ? 'object-cover' : 'demo-frame object-contain';
}

/** URL of frame `frame` (1-based) of a demo key's picture; undefined when there is no such picture or frame. */
export function demoFrameSrc(demo: string | undefined, frame = 1): string | undefined {
  const pic = demoPicture(demo);
  if (!pic || !Number.isInteger(frame) || frame < 1 || frame > pic.frames) return undefined;
  return pic.kind === 'catalogue' ? catalogueFrameUrl(pic.slug, frame as 1 | 2) : demoFrameUrl(pic.slug, frame);
}
