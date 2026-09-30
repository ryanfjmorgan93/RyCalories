import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_DEMO_PREFIX,
  CATALOGUE_FRAME_COUNT,
  catalogueDemoKey,
  catalogueFrameUrl,
  catalogueSlugOf,
  exerciseFromCatalogue,
  isCatalogueDemo,
  LOWER_BODY_GROUPS,
  searchCatalogue,
  type CatalogueEntry,
} from './catalogue';
import { MUSCLE_GROUPS } from './types';

function entry(over: Partial<CatalogueEntry> & { name: string }): CatalogueEntry {
  return {
    slug: over.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    muscleGroup: 'chest',
    equipment: 'dumbbell',
    kind: 'reps',
    isCompound: false,
    unilateral: false,
    level: 'beginner',
    ...over,
  };
}

describe('demo keys and frame URLs', () => {
  it('prefixes the slug and reads it back', () => {
    expect(CATALOGUE_DEMO_PREFIX).toBe('cat:');
    expect(catalogueDemoKey('barbell-curl')).toBe('cat:barbell-curl');
    expect(catalogueSlugOf('cat:barbell-curl')).toBe('barbell-curl');
    expect(catalogueSlugOf(catalogueDemoKey('x-1'))).toBe('x-1');
  });

  it('recognises only a prefixed key with a slug after it', () => {
    expect(isCatalogueDemo('cat:barbell-curl')).toBe(true);
    expect(isCatalogueDemo('cat:')).toBe(false);
    expect(isCatalogueDemo('bench-press')).toBe(false);
    expect(isCatalogueDemo('CAT:barbell-curl')).toBe(false);
    expect(isCatalogueDemo('')).toBe(false);
    expect(isCatalogueDemo(undefined)).toBe(false);
  });

  it('gives no slug for a key that is not a catalogue key', () => {
    expect(catalogueSlugOf('bench-press')).toBe('');
    expect(catalogueSlugOf('cat:')).toBe('');
  });

  it('points frames at /catalogue/<slug>/<n>.webp, one-based, two of them', () => {
    expect(CATALOGUE_FRAME_COUNT).toBe(2);
    expect(catalogueFrameUrl('barbell-curl', 1)).toBe('/catalogue/barbell-curl/1.webp');
    expect(catalogueFrameUrl('barbell-curl', 2)).toBe('/catalogue/barbell-curl/2.webp');
  });
});

describe('LOWER_BODY_GROUPS', () => {
  it('is exactly the five leg groups', () => {
    expect([...LOWER_BODY_GROUPS].sort()).toEqual(['adductors', 'calves', 'glutes', 'hamstrings', 'quads']);
  });

  it('holds only real muscle groups', () => {
    for (const g of LOWER_BODY_GROUPS) expect(MUSCLE_GROUPS).toContain(g);
  });
});

describe('exerciseFromCatalogue', () => {
  it('carries the entry across and keys the picture to the slug', () => {
    const e = entry({ name: 'Hammer Curl - Alternating', slug: 'hammer-curl-alt', muscleGroup: 'biceps', equipment: 'dumbbell', unilateral: true });
    const x = exerciseFromCatalogue(e);
    expect(x.name).toBe('Hammer Curl - Alternating');
    expect(x.muscleGroup).toBe('biceps');
    expect(x.equipment).toBe('dumbbell');
    expect(x.kind).toBe('reps');
    expect(x.unilateral).toBe(true);
    expect(x.isCompound).toBe(false);
    expect(x.demo).toBe('cat:hammer-curl-alt');
  });

  it('leaves the id and the creation time to the caller', () => {
    const x = exerciseFromCatalogue(entry({ name: 'Curl' })) as Record<string, unknown>;
    expect('id' in x).toBe(false);
    expect('createdAt' in x).toBe(false);
  });

  it('marks lower body from the muscle group, not the equipment', () => {
    for (const g of MUSCLE_GROUPS) {
      expect(exerciseFromCatalogue(entry({ name: 'X', muscleGroup: g })).isLowerBody).toBe(LOWER_BODY_GROUPS.has(g));
    }
    expect(exerciseFromCatalogue(entry({ name: 'X', muscleGroup: 'quads', equipment: 'cable' })).isLowerBody).toBe(true);
    expect(exerciseFromCatalogue(entry({ name: 'X', muscleGroup: 'lower back', equipment: 'barbell' })).isLowerBody).toBe(false);
  });

  it('rests 90 s for a carry, 150 s for a compound, 75 s otherwise', () => {
    expect(exerciseFromCatalogue(entry({ name: 'X', kind: 'carry', isCompound: true })).defaultRestSec).toBe(90);
    expect(exerciseFromCatalogue(entry({ name: 'X', kind: 'carry', isCompound: false })).defaultRestSec).toBe(90);
    expect(exerciseFromCatalogue(entry({ name: 'X', isCompound: true })).defaultRestSec).toBe(150);
    expect(exerciseFromCatalogue(entry({ name: 'X', isCompound: false })).defaultRestSec).toBe(75);
    expect(exerciseFromCatalogue(entry({ name: 'X', kind: 'timed', isCompound: false })).defaultRestSec).toBe(75);
  });

  const increments: [string, Partial<CatalogueEntry>, number][] = [
    ['dumbbell biceps isolation', { equipment: 'dumbbell', muscleGroup: 'biceps' }, 1],
    ['dumbbell triceps isolation', { equipment: 'dumbbell', muscleGroup: 'triceps' }, 1],
    ['dumbbell shoulders isolation', { equipment: 'dumbbell', muscleGroup: 'shoulders' }, 1],
    ['dumbbell shoulders compound', { equipment: 'dumbbell', muscleGroup: 'shoulders', isCompound: true }, 2],
    ['dumbbell chest', { equipment: 'dumbbell', muscleGroup: 'chest' }, 2],
    ['dumbbell rear delts', { equipment: 'dumbbell', muscleGroup: 'rear delts' }, 2],
    ['dumbbell quads', { equipment: 'dumbbell', muscleGroup: 'quads', isCompound: true }, 2],
    ['machine chest', { equipment: 'machine', muscleGroup: 'chest' }, 5],
    ['machine triceps', { equipment: 'machine', muscleGroup: 'triceps' }, 5],
    ['cable lats', { equipment: 'cable', muscleGroup: 'lats' }, 5],
    ['cable rear delts', { equipment: 'cable', muscleGroup: 'rear delts' }, 5],
    ['cable abs', { equipment: 'cable', muscleGroup: 'abs' }, 5],
    ['cable triceps', { equipment: 'cable', muscleGroup: 'triceps' }, 2.5],
    ['cable biceps', { equipment: 'cable', muscleGroup: 'biceps' }, 2.5],
    ['cable shoulders', { equipment: 'cable', muscleGroup: 'shoulders' }, 2.5],
    ['barbell quads (lower body)', { equipment: 'barbell', muscleGroup: 'quads', isCompound: true }, 5],
    ['barbell hamstrings (lower body)', { equipment: 'barbell', muscleGroup: 'hamstrings', isCompound: true }, 5],
    ['barbell chest (upper body)', { equipment: 'barbell', muscleGroup: 'chest', isCompound: true }, 2.5],
    ['barbell lower back (not in the leg groups)', { equipment: 'barbell', muscleGroup: 'lower back', isCompound: true }, 2.5],
    ['kettlebell', { equipment: 'kettlebell', muscleGroup: 'quads' }, 2],
    ['bodyweight plus', { equipment: 'bodyweight', kind: 'bodyweight_plus', muscleGroup: 'lats' }, 2.5],
    ['bodyweight plus on a machine (kind decides)', { equipment: 'machine', kind: 'bodyweight_plus', muscleGroup: 'lats' }, 2.5],
    ['bodyweight reps', { equipment: 'bodyweight', kind: 'reps', muscleGroup: 'abs' }, 2.5],
    ['other', { equipment: 'other', muscleGroup: 'quads' }, 2.5],
  ];
  it.each(increments)('sets the increment for %s', (_label, over, expected) => {
    expect(exerciseFromCatalogue(entry({ name: 'X', ...over })).defaultIncrement).toBe(expected);
  });
});

describe('searchCatalogue', () => {
  // Frozen, so a search that sorted the caller's array in place would throw instead of quietly reordering later tests.
  const list = Object.freeze([
    entry({ name: 'Zercher Squat', muscleGroup: 'quads', equipment: 'barbell' }),
    entry({ name: 'Alternate Hammer Curl', muscleGroup: 'biceps', equipment: 'dumbbell' }),
    entry({ name: 'Hammer Curl', muscleGroup: 'biceps', equipment: 'dumbbell' }),
    entry({ name: 'Hammer Curl Cable', muscleGroup: 'biceps', equipment: 'cable' }),
    entry({ name: 'Aregrip Press', muscleGroup: 'chest', equipment: 'barbell' }),
    entry({ name: 'Close-Grip Bench Press', muscleGroup: 'triceps', equipment: 'barbell' }),
    entry({ name: 'Cable Row', muscleGroup: 'upper back', equipment: 'cable' }),
    entry({ name: 'Arm Rope Thing', muscleGroup: 'biceps', equipment: 'cable' }),
    entry({ name: 'Zzcable Thing', muscleGroup: 'chest', equipment: 'dumbbell' }),
  ]);
  const names = (q: string, limit?: number) => searchCatalogue(list, q, limit).map((e) => e.name);

  it('returns nothing for an empty or blank query', () => {
    expect(searchCatalogue(list, '')).toEqual([]);
    expect(searchCatalogue(list, '   ')).toEqual([]);
    expect(searchCatalogue(list, '\t\n')).toEqual([]);
  });

  it('ignores case in the query and in the names', () => {
    expect(names('HAMMER')).toEqual(names('hammer'));
    expect(names('hAmMeR').length).toBeGreaterThan(0);
    expect(names('zercher')).toEqual(['Zercher Squat']);
  });

  it('ranks a name that starts with the whole query ahead of one where the words start later', () => {
    // Listed first, but "Alternate Hammer Curl" only has the words at word starts.
    expect(names('hammer curl')).toEqual(['Hammer Curl', 'Hammer Curl Cable', 'Alternate Hammer Curl']);
  });

  it('ranks a word start (after a hyphen too) ahead of a substring that sorts earlier', () => {
    // "Aregrip Press" sorts before "Close-Grip Bench Press"; only the tier puts it second.
    expect(names('grip')).toEqual(['Close-Grip Bench Press', 'Aregrip Press']);
  });

  it('sorts alphabetically within a tier, not in the order the entries were given', () => {
    // All three match "barbell" through equipment alone, and Zercher Squat is listed first.
    expect(names('barbell')).toEqual(['Aregrip Press', 'Close-Grip Bench Press', 'Zercher Squat']);
  });

  it('requires every word, matching the name, the muscle group or the equipment', () => {
    expect(names('hammer cable')).toEqual(['Hammer Curl Cable']);
    expect(names('hammer biceps')).toEqual(['Alternate Hammer Curl', 'Hammer Curl', 'Hammer Curl Cable']);
    expect(names('curl barbell')).toEqual([]);
    expect(names('quads')).toEqual(['Zercher Squat']);
    expect(names('upper back')).toEqual(['Cable Row']);
  });

  it('ranks a match found only through muscle group or equipment after every name match', () => {
    // "Arm Rope Thing" is cable equipment only and sorts before "Zzcable Thing", which has it inside its name; the name match still leads.
    expect(names('cable')).toEqual(['Cable Row', 'Hammer Curl Cable', 'Zzcable Thing', 'Arm Rope Thing']);
  });

  it('caps the result at the limit, keeping the best', () => {
    expect(searchCatalogue(list, 'hammer', 2).map((e) => e.name)).toEqual(['Hammer Curl', 'Hammer Curl Cable']);
    expect(searchCatalogue(list, 'hammer', 0)).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => entry({ name: `Curl ${String(i).padStart(2, '0')}`, slug: `curl-${i}` }));
    expect(searchCatalogue(many, 'curl')).toHaveLength(30);
    expect(searchCatalogue(many, 'curl', 45)).toHaveLength(45);
  });

  it('leaves the list it was given as it was', () => {
    const before = list.map((e) => e.name);
    expect(() => names('curl')).not.toThrow();
    expect(list.map((e) => e.name)).toEqual(before);
  });

  it('finds nothing when no entry matches', () => {
    expect(names('zzz')).toEqual([]);
  });
});
