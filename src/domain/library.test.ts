import { describe, expect, it } from 'vitest';
import { equipmentFromDemo, exerciseFromDemo, findExistingExercise, LIBRARY_RESULT_CAP, mergeLibraryResults } from './library';
import { LOWER_BODY_GROUPS } from './catalogue';
import { EXERCISE_DEMOS } from '@/data/exerciseDemos';

describe('equipmentFromDemo', () => {
  it('maps the demo library\'s spellings to Equipment', () => {
    expect(equipmentFromDemo('Barbell')).toBe('barbell');
    expect(equipmentFromDemo('Dumbbell')).toBe('dumbbell');
    expect(equipmentFromDemo('Machine')).toBe('machine');
    expect(equipmentFromDemo('Cable')).toBe('cable');
    expect(equipmentFromDemo('Bodyweight')).toBe('bodyweight');
    expect(equipmentFromDemo('Pull-up Bar')).toBe('bodyweight');
    expect(equipmentFromDemo('Kettlebell')).toBe('kettlebell');
    expect(equipmentFromDemo('Cardio')).toBe('other');
  });

  it('covers every equipment the bundled demos use', () => {
    const used = new Set(EXERCISE_DEMOS.map((d) => d.equipment));
    for (const raw of used) expect(['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'other']).toContain(equipmentFromDemo(raw));
  });
});

describe('exerciseFromDemo', () => {
  it('builds a barbell compound with the long rest and the small plate step', () => {
    expect(exerciseFromDemo({ slug: 'bench-press', name: 'Bench Press', equipment: 'Barbell', muscleGroup: 'chest' })).toEqual({
      name: 'Bench Press',
      kind: 'reps',
      muscleGroup: 'chest',
      isCompound: true,
      isLowerBody: false,
      unilateral: false,
      defaultRestSec: 150,
      defaultIncrement: 2.5,
      equipment: 'barbell',
      demo: 'bench-press',
    });
  });

  it('builds a machine isolation with the short rest and the machine step', () => {
    const x = exerciseFromDemo({ slug: 'leg-extension', name: 'Leg Extension', equipment: 'Machine', muscleGroup: 'quads' });
    expect(x).toMatchObject({ isCompound: false, defaultRestSec: 75, defaultIncrement: 5, equipment: 'machine', isLowerBody: true, demo: 'leg-extension' });
  });

  it('files a demo with no muscle group under other, and never as lower body', () => {
    const x = exerciseFromDemo({ slug: 'x', name: 'X', equipment: 'Cardio', muscleGroup: null });
    expect(x).toMatchObject({ muscleGroup: 'other', isLowerBody: false, equipment: 'other', defaultIncrement: 2.5 });
  });

  it('marks lower body from the group, the same set the catalogue uses', () => {
    for (const g of LOWER_BODY_GROUPS) expect(exerciseFromDemo({ slug: 's', name: 'S', equipment: 'Dumbbell', muscleGroup: g }).isLowerBody, g).toBe(true);
    expect(exerciseFromDemo({ slug: 's', name: 'S', equipment: 'Dumbbell', muscleGroup: 'chest' }).isLowerBody).toBe(false);
  });
});

describe('findExistingExercise', () => {
  const at = (n: number) => `2026-01-0${n}T00:00:00.000Z`;
  const rows = [
    { id: 'a', name: 'Bench Press (Barbell)', demo: 'bench-press', aliases: ['Bench Press'], createdAt: at(1) },
    { id: 'b', name: 'Cable Crossover', createdAt: at(2) },
    { id: 'c', name: 'My Flys', demo: 'cat:cable-crossover', createdAt: at(3) },
  ];

  it('finds a row by its picture key, whatever it is called now', () => {
    expect(findExistingExercise(rows, 'cat:cable-crossover', 'Something Else')?.id).toBe('c');
    expect(findExistingExercise(rows, 'bench-press', 'Something Else')?.id).toBe('a');
  });

  it('finds a row by name, ignoring case, apostrophes and spacing', () => {
    expect(findExistingExercise(rows, 'cat:other', "  CABLE   crossover ")?.id).toBe('b');
    expect(findExistingExercise([{ id: 'f', name: "Farmer's Carry", createdAt: at(1) }], 'cat:x', 'farmers carry')?.id).toBe('f');
  });

  it('finds a row by alias, as the Hevy import does', () => {
    expect(findExistingExercise(rows, 'cat:other', 'bench press')?.id).toBe('a');
  });

  it('prefers the picture key over a name, and a name over an alias', () => {
    // 'b' has the name and 'c' the picture key: the key wins.
    expect(findExistingExercise(rows, 'cat:cable-crossover', 'Cable Crossover')?.id).toBe('c');
    const aliasFirst = [
      { id: 'alias', name: 'Other', aliases: ['Row'], createdAt: at(1) },
      { id: 'own', name: 'Row', createdAt: at(2) },
    ];
    expect(findExistingExercise(aliasFirst, 'cat:none', 'Row')?.id).toBe('own');
  });

  it('breaks a tie with the older row, whatever order the rows come in', () => {
    const twins = [
      { id: 'new', name: 'Row', createdAt: at(5) },
      { id: 'old', name: 'Row', createdAt: at(1) },
    ];
    expect(findExistingExercise(twins, 'cat:none', 'Row')?.id).toBe('old');
    expect(findExistingExercise([...twins].reverse(), 'cat:none', 'Row')?.id).toBe('old');
  });

  it('finds nothing for a new name and key, and nothing for a blank name', () => {
    expect(findExistingExercise(rows, 'cat:new', 'Brand New Lift')).toBeUndefined();
    expect(findExistingExercise(rows, 'cat:new', '   ')).toBeUndefined();
    expect(findExistingExercise([], 'cat:new', 'Anything')).toBeUndefined();
  });

  it('does not match a part of a name', () => {
    expect(findExistingExercise(rows, 'cat:new', 'Cable')).toBeUndefined();
    expect(findExistingExercise(rows, 'cat:new', 'Bench Press (Barbell) Close Grip')).toBeUndefined();
  });
});

describe('mergeLibraryResults', () => {
  const demos = (n: number) => Array.from({ length: n }, (_, i) => `d${i}`);
  const entries = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
  const summary = (r: ReturnType<typeof mergeLibraryResults<string, string>>) => ({
    demos: r.filter((x) => x.kind === 'demo').length,
    catalogue: r.filter((x) => x.kind === 'catalogue').length,
  });

  it('caps the list at thirty by default', () => {
    expect(LIBRARY_RESULT_CAP).toBe(30);
    expect(mergeLibraryResults(demos(100), entries(100)).length).toBe(30);
  });

  it('lists diagrams first, then catalogue entries, each in its own order', () => {
    const r = mergeLibraryResults(demos(2), entries(2));
    expect(r.map((x) => (x.kind === 'demo' ? x.demo : x.entry))).toEqual(['d0', 'd1', 'c0', 'c1']);
  });

  it('keeps everything when it fits', () => {
    expect(summary(mergeLibraryResults(demos(10), entries(20)))).toEqual({ demos: 10, catalogue: 20 });
  });

  it('gives each side half when both overflow, so neither crowds the other out', () => {
    expect(summary(mergeLibraryResults(demos(30), entries(30)))).toEqual({ demos: 15, catalogue: 15 });
  });

  it('hands a short side\'s unused share to the other', () => {
    expect(summary(mergeLibraryResults(demos(5), entries(60)))).toEqual({ demos: 5, catalogue: 25 });
    expect(summary(mergeLibraryResults(demos(60), entries(5)))).toEqual({ demos: 25, catalogue: 5 });
    expect(summary(mergeLibraryResults(demos(0), entries(60)))).toEqual({ demos: 0, catalogue: 30 });
    expect(summary(mergeLibraryResults(demos(60), entries(0)))).toEqual({ demos: 30, catalogue: 0 });
  });

  it('returns nothing for nothing, or a cap of nothing', () => {
    expect(mergeLibraryResults([], [])).toEqual([]);
    expect(mergeLibraryResults(demos(3), entries(3), 0)).toEqual([]);
  });

  it('honours another cap, odd or even', () => {
    for (const cap of [1, 2, 7, 10]) {
      const r = mergeLibraryResults(demos(50), entries(50), cap);
      expect(r.length, `cap ${cap}`).toBe(cap);
    }
  });
});
