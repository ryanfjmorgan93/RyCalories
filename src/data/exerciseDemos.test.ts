import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MUSCLE_GROUPS } from '@/domain/types';
import { demoFrameUrl, EXERCISE_DEMOS, findDemo, searchDemos } from './exerciseDemos';

const SEED_DEMOS: Record<string, string> = JSON.parse(readFileSync(new URL('../../scripts/seed-demos.json', import.meta.url), 'utf8'));

describe('EXERCISE_DEMOS', () => {
  it('has 302 entries', () => {
    expect(EXERCISE_DEMOS.length).toBe(302);
  });

  it('has unique slugs', () => {
    const slugs = new Set(EXERCISE_DEMOS.map((d) => d.slug));
    expect(slugs.size).toBe(EXERCISE_DEMOS.length);
  });

  it('gives every entry 3 frames and a non-empty name', () => {
    for (const demo of EXERCISE_DEMOS) {
      expect(demo.frames).toBe(3);
      expect(demo.name.length).toBeGreaterThan(0);
    }
  });

  it('gives every entry a muscleGroup that is null or a real MuscleGroup', () => {
    for (const demo of EXERCISE_DEMOS) {
      if (demo.muscleGroup !== null) {
        expect(MUSCLE_GROUPS).toContain(demo.muscleGroup);
      }
    }
  });
});

describe('findDemo', () => {
  it('resolves every seed exercise slug in scripts/seed-demos.json', () => {
    const slugs = Object.values(SEED_DEMOS);
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(findDemo(slug), `expected a demo for seed slug "${slug}"`).toBeDefined();
    }
  });

  it('returns undefined for an unknown slug', () => {
    expect(findDemo('not-a-real-exercise')).toBeUndefined();
  });
});

describe('searchDemos', () => {
  it('puts "Bench Press" first for a "bench" query', () => {
    const results = searchDemos('bench');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('Bench Press');
  });

  it('is case-insensitive and matches equipment/primaryMuscle too', () => {
    const byMuscle = searchDemos('hamstrings');
    expect(byMuscle.length).toBeGreaterThan(0);
    expect(byMuscle.every((d) => d.name.toLowerCase().includes('hamstrings') || d.equipment.toLowerCase().includes('hamstrings') || d.primaryMuscle.toLowerCase().includes('hamstrings'))).toBe(
      true,
    );
  });

  it('returns nothing for an empty query', () => {
    expect(searchDemos('')).toEqual([]);
  });
});

describe('demoFrameUrl', () => {
  it('builds the expected path shape', () => {
    expect(demoFrameUrl('bench-press', 1)).toBe('/exercises/bench-press/1.webp');
    expect(demoFrameUrl('squat', 3)).toBe('/exercises/squat/3.webp');
  });
});
