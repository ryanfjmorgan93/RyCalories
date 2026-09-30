import { describe, expect, it } from 'vitest';
import { EXERCISE_DEMOS, findDemo } from '@/data/exerciseDemos';
import { demoFrameSrc, demoPicture } from './demoPicture';

describe('demoPicture', () => {
  it('reads a bundled diagram slug as a square picture with that demo\'s own frame count', () => {
    const squat = findDemo('squat')!;
    expect(demoPicture('squat')).toEqual({ kind: 'diagram', slug: 'squat', frames: squat.frames, photo: squat.photo, shape: 'square' });
    // Not every demo has three frames: the count comes from the demo, not from a constant.
    expect(findDemo('neck')!.frames).toBe(2);
    expect(demoPicture('neck')?.frames).toBe(2);
  });

  it('carries the photo flag of a bundled photograph, and not of line art', () => {
    expect(findDemo('neck')!.photo).toBe(true);
    expect(demoPicture('neck')).toMatchObject({ kind: 'diagram', photo: true, shape: 'square' });
    expect(demoPicture('bench-press')?.photo).toBe(false);
  });

  it('reads a catalogue key as a 3:2 photograph with two frames', () => {
    expect(demoPicture('cat:cable-crossover')).toEqual({ kind: 'catalogue', slug: 'cable-crossover', frames: 2, photo: true, shape: 'wide' });
  });

  it('has no picture for an unknown diagram slug, an empty catalogue key or no demo at all', () => {
    expect(demoPicture('not-a-real-demo')).toBeUndefined();
    expect(demoPicture('cat:')).toBeUndefined();
    expect(demoPicture('')).toBeUndefined();
    expect(demoPicture(undefined)).toBeUndefined();
  });
});

describe('demoFrameSrc', () => {
  it('gives a bundled diagram its 1-based .png frames', () => {
    expect(demoFrameSrc('bench-press', 1)).toBe('/exercises/bench-press/1.png');
    expect(demoFrameSrc('squat', 3)).toBe('/exercises/squat/3.png');
  });

  it('gives a catalogue key its two 1-based .webp frames', () => {
    expect(demoFrameSrc('cat:cable-crossover', 1)).toBe('/catalogue/cable-crossover/1.webp');
    expect(demoFrameSrc('cat:cable-crossover', 2)).toBe('/catalogue/cable-crossover/2.webp');
  });

  it('defaults to the first frame', () => {
    expect(demoFrameSrc('squat')).toBe('/exercises/squat/1.png');
    expect(demoFrameSrc('cat:cable-crossover')).toBe('/catalogue/cable-crossover/1.webp');
  });

  it('refuses a frame the picture does not have', () => {
    // A catalogue entry has two frames; asking for a third would be a URL that 404s.
    expect(demoFrameSrc('cat:cable-crossover', 3)).toBeUndefined();
    expect(demoFrameSrc('cat:cable-crossover', 0)).toBeUndefined();
    expect(demoFrameSrc('squat', 4)).toBeUndefined();
    expect(demoFrameSrc('squat', 1.5)).toBeUndefined();
  });

  it('has no URL for an unknown slug or no demo', () => {
    expect(demoFrameSrc('not-a-real-demo', 1)).toBeUndefined();
    expect(demoFrameSrc(undefined, 1)).toBeUndefined();
  });

  it('agrees with the generated demoFrameUrl for every bundled diagram, frame by frame', async () => {
    const { demoFrameUrl } = await import('@/data/exerciseDemos');
    for (const d of EXERCISE_DEMOS) {
      for (let f = 1; f <= d.frames; f++) expect(demoFrameSrc(d.slug, f), `${d.slug} frame ${f}`).toBe(demoFrameUrl(d.slug, f));
    }
  });
});
