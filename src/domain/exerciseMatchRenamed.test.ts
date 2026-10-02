import { describe, expect, it } from 'vitest';
import { loadCatalogue } from '@/data/catalogue';
import { EXERCISE_DEMOS } from '@/data/exerciseDemos';
import { SEED_EXERCISES } from '@/db/seed';
import { matchExercise } from './exerciseMatch';
import { buildExerciseList, candidatesFromRows } from './library';
import type { Exercise } from './types';

/**
 * An exercise the owner added from the library and then renamed. The library row for it is gone
 * from the list (they have it), and the owned row carries only the new name, so a routine that
 * says what the library calls it, as one written outside the app will, had nothing to match.
 */
const DAY = '2026-01-01T00:00:00.000Z';
const seed = SEED_EXERCISES.map((e) => ({ ...e, createdAt: DAY }));
const renamed = (over: Partial<Exercise>): Exercise => ({ ...seed[0]!, id: 'renamed', createdAt: DAY, aliases: undefined, ...over });

describe('an exercise the owner renamed after adding it from the library', () => {
  it('is still found by the catalogue entry\'s own name, which a pasted routine may use', async () => {
    const entries = await loadCatalogue();
    const entry = entries.find((e) => e.slug === 'back-flyes-with-bands')!;
    expect(entry.name).toBe('Back Flyes - With Bands');
    const rows = buildExerciseList({ owned: [...seed, renamed({ name: 'Pec deck reverse', demo: `cat:${entry.slug}` })], demos: EXERCISE_DEMOS, entries });
    // Premise: its library row is gone from the list, since the owner has it, under its new name.
    expect(rows.some((r) => r.name === entry.name)).toBe(false);

    const candidates = candidatesFromRows(rows);
    expect(matchExercise(entry.name, candidates)).toEqual({ id: 'renamed', score: 1, via: 'exact' });
    expect(matchExercise('Back flyes with bands', candidates)?.id).toBe('renamed');
  });

  it('is found by a bundled diagram\'s name the same way', () => {
    const rows = buildExerciseList({ owned: [...seed, renamed({ name: 'Shoulder thing', demo: 'arnold-press' })], demos: EXERCISE_DEMOS, entries: [] });
    expect(rows.some((r) => r.name === 'Arnold Press')).toBe(false);
    expect(matchExercise('Arnold Press', candidatesFromRows(rows))).toEqual({ id: 'renamed', score: 1, via: 'exact' });
  });

  it('does not write the library name into the exercise: its aliases stay what the owner or a paste put there', () => {
    const rows = buildExerciseList({ owned: [renamed({ name: 'Shoulder thing', demo: 'arnold-press', aliases: ['Rev press'] })], demos: EXERCISE_DEMOS, entries: [] });
    expect(rows.find((r) => r.key === 'renamed')!.exercise!.aliases).toEqual(['Rev press']);
  });

  it('adds nothing for one still called what the library calls it, or one that already has the library name as an alias', () => {
    const same = buildExerciseList({ owned: [renamed({ name: 'Arnold Press', demo: 'arnold-press' })], demos: EXERCISE_DEMOS, entries: [] });
    expect(same.find((r) => r.key === 'renamed')!.libraryName).toBeUndefined();
    const aliased = buildExerciseList({ owned: [renamed({ name: 'Shoulder thing', demo: 'arnold-press', aliases: ['arnold  press'] })], demos: EXERCISE_DEMOS, entries: [] });
    expect(aliased.find((r) => r.key === 'renamed')!.libraryName).toBeUndefined();
  });

  it('claims nothing it was not called: an unrelated line is still no match', () => {
    const rows = buildExerciseList({ owned: [...seed, renamed({ name: 'Shoulder thing', demo: 'arnold-press' })], demos: EXERCISE_DEMOS, entries: [] });
    expect(matchExercise('Zzz Qqq Unrelated', candidatesFromRows(rows))).toBeNull();
  });
});
