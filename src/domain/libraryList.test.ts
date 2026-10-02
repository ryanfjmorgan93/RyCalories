import { describe, expect, it } from 'vitest';
import type { CatalogueEntry } from './catalogue';
import {
  buildExerciseList,
  emptyListText,
  filterExerciseList,
  findExistingExercise,
  groupsInList,
  libraryCountsLine,
  LIST_PAGE_SIZE,
  listCounts,
  listHeading,
  pageWindow,
  type ExerciseListRow,
  type ListDemo,
} from './library';
import type { Exercise } from './types';

const DAY = '2026-01-01T00:00:00.000Z';
function owned(id: string, name: string, over: Partial<Exercise> = {}): Exercise {
  return { id, name, kind: 'reps', muscleGroup: 'chest', isCompound: false, isLowerBody: false, defaultRestSec: 75, defaultIncrement: 2.5, unilateral: false, createdAt: DAY, ...over };
}
function demo(slug: string, name: string, over: Partial<ListDemo> = {}): ListDemo {
  return { slug, name, equipment: 'Dumbbell', muscleGroup: 'shoulders', ...over };
}
function entry(slug: string, name: string, over: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return { slug, name, muscleGroup: 'shoulders', equipment: 'cable', kind: 'reps', isCompound: false, unilateral: false, level: 'beginner', ...over };
}
const names = (rows: ExerciseListRow[]) => rows.map((r) => r.name);

describe('buildExerciseList', () => {
  it('lists what the owner has first, then the library, each alphabetical, diagrams and catalogue mixed by name', () => {
    const rows = buildExerciseList({
      owned: [owned('a', 'Squat'), owned('b', 'Bench Press')],
      demos: [demo('lateral-raise', 'Lateral Raise'), demo('arnold-press', 'Arnold Press')],
      entries: [entry('cable-fly', 'Cable Fly'), entry('zottman-curl', 'Zottman Curl')],
    });
    expect(names(rows)).toEqual(['Bench Press', 'Squat', 'Arnold Press', 'Cable Fly', 'Lateral Raise', 'Zottman Curl']);
    expect(rows.map((r) => r.owned)).toEqual([true, true, false, false, false, false]);
    expect(listCounts(rows)).toEqual({ owned: 2, library: 4 });
  });

  it('gives every row a key that is unique and says what a row is made from', () => {
    const rows = buildExerciseList({ owned: [owned('a', 'Squat', { demo: 'squat' })], demos: [demo('arnold-press', 'Arnold Press')], entries: [entry('cable-fly', 'Cable Fly')] });
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    const [mine, d, c] = rows;
    expect(mine).toMatchObject({ key: 'a', owned: true, pictureKey: 'squat' });
    expect(mine!.exercise!.id).toBe('a');
    expect(d).toMatchObject({ key: 'arnold-press', owned: false, pictureKey: 'arnold-press', equipment: 'dumbbell' });
    expect(d!.demo!.slug).toBe('arnold-press');
    expect(c).toMatchObject({ key: 'cat:cable-fly', owned: false, pictureKey: 'cat:cable-fly', equipment: 'cable' });
    expect(c!.entry!.slug).toBe('cable-fly');
  });

  it('drops a library entry the owner already has by picture key, whatever the row is called now', () => {
    const rows = buildExerciseList({
      owned: [owned('a', 'My Flys', { demo: 'cat:cable-fly' }), owned('b', 'Overhead Thing', { demo: 'arnold-press' })],
      demos: [demo('arnold-press', 'Arnold Press'), demo('lateral-raise', 'Lateral Raise')],
      entries: [entry('cable-fly', 'Cable Fly'), entry('zottman-curl', 'Zottman Curl')],
    });
    expect(names(rows)).toEqual(['My Flys', 'Overhead Thing', 'Lateral Raise', 'Zottman Curl']);
  });

  it('drops a library entry the owner already has by name, ignoring case, apostrophes and spacing', () => {
    const rows = buildExerciseList({
      owned: [owned('a', "Farmer's  Carry"), owned('b', 'cable FLY')],
      demos: [demo('farmers-carry', 'Farmers Carry')],
      entries: [entry('cable-fly', 'Cable Fly'), entry('zottman-curl', 'Zottman Curl')],
    });
    expect(names(rows)).toEqual(['cable FLY', "Farmer's  Carry", 'Zottman Curl']);
  });

  it('drops a library entry the owner already has under an alias', () => {
    const rows = buildExerciseList({
      owned: [owned('a', 'Pec Deck', { aliases: ['Cable Fly', '  '] })],
      demos: [],
      entries: [entry('cable-fly', 'Cable Fly'), entry('zottman-curl', 'Zottman Curl')],
    });
    expect(names(rows)).toEqual(['Pec Deck', 'Zottman Curl']);
  });

  it('agrees with findExistingExercise for every library entry, whichever way the owner has it', () => {
    const mine = [
      owned('a', 'Alpha', { demo: 'd-key' }),
      owned('b', "Beta's Row"),
      owned('c', 'Gamma', { aliases: ['Delta Press'] }),
      owned('d', 'Epsilon', { demo: 'cat:c-key' }),
    ];
    const demos = [demo('d-key', 'Something Else'), demo('d-name', 'betas row'), demo('d-alias', 'delta   press'), demo('d-free', 'Free Demo')];
    const entries = [entry('c-key', 'Other Name'), entry('c-name', 'GAMMA'), entry('c-free', 'Free Entry'), entry('c-blank', '   ')];
    const inList = new Set(
      buildExerciseList({ owned: mine, demos, entries })
        .filter((r) => !r.owned)
        .map((r) => r.key),
    );
    for (const d of demos) expect(inList.has(d.slug), d.slug).toBe(findExistingExercise(mine, d.slug, d.name) === undefined);
    for (const e of entries) expect(inList.has(`cat:${e.slug}`), e.slug).toBe(findExistingExercise(mine, `cat:${e.slug}`, e.name) === undefined);
    // Premise: the cases above are not all one answer.
    expect(inList.size).toBeGreaterThan(0);
    expect(inList.size).toBeLessThan(demos.length + entries.length);
  });

  it('keeps a diagram with no muscle group, labelled by its own muscle, or "other" when it has none', () => {
    const rows = buildExerciseList({
      owned: [],
      demos: [demo('cat-cow', 'Cat Cow', { muscleGroup: null, primaryMuscle: 'Mobility', equipment: 'Bodyweight' }), demo('mystery', 'Mystery', { muscleGroup: null })],
      entries: [],
    });
    expect(rows.map((r) => [r.muscleGroup, r.muscleLabel])).toEqual([
      [null, 'mobility'],
      [null, 'other'],
    ]);
  });

  it('says equipment in lower case, and "" for an owned exercise with none set', () => {
    const rows = buildExerciseList({ owned: [owned('a', 'Plain'), owned('b', 'Bar', { equipment: 'barbell' })], demos: [demo('p', 'Pull-up', { equipment: 'Pull-up Bar' })], entries: [] });
    expect(rows.map((r) => r.equipment)).toEqual(['barbell', '', 'pull-up bar']);
  });

  it('is only the owner and the diagrams until the catalogue arrives', () => {
    const rows = buildExerciseList({ owned: [owned('a', 'Squat')], demos: [demo('arnold-press', 'Arnold Press')], entries: [] });
    expect(listCounts(rows)).toEqual({ owned: 1, library: 1 });
  });

  it('does not reorder or change what it was given', () => {
    const mine = Object.freeze([owned('b', 'B'), owned('a', 'A')]);
    const demos = Object.freeze([demo('y', 'Y'), demo('x', 'X')]);
    const entries = Object.freeze([entry('z', 'Z'), entry('w', 'W')]);
    expect(() => buildExerciseList({ owned: mine, demos, entries })).not.toThrow();
    expect(mine.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('filterExerciseList', () => {
  const rows = buildExerciseList({
    owned: [
      owned('o1', 'Bench Press', { muscleGroup: 'chest', equipment: 'barbell', aliases: ['Flat Bench'] }),
      owned('o2', 'Lateral Raise', { muscleGroup: 'shoulders', equipment: 'dumbbell' }),
      owned('o3', 'Squat', { muscleGroup: 'quads', equipment: 'barbell' }),
    ],
    demos: [
      demo('arnold-press', 'Arnold Press', { muscleGroup: 'shoulders', equipment: 'Dumbbell' }),
      demo('cat-cow', 'Cat Cow', { muscleGroup: null, primaryMuscle: 'Mobility', equipment: 'Bodyweight' }),
      demo('rear-delt-fly', 'Rear Delt Fly', { muscleGroup: 'rear delts', equipment: 'Dumbbell' }),
    ],
    entries: [
      entry('cable-rear-delt-fly', 'Cable Rear Delt Fly', { muscleGroup: 'rear delts', equipment: 'cable' }),
      entry('dumbbell-bench-press', 'Dumbbell Bench Press', { muscleGroup: 'chest', equipment: 'dumbbell' }),
      entry('machine-bench-press', 'Machine Bench Press', { muscleGroup: 'chest', equipment: 'machine' }),
    ],
  });

  it('with no filter keeps the whole list in its own order', () => {
    expect(filterExerciseList(rows)).toEqual(rows);
    expect(filterExerciseList(rows, { query: '   ' })).toEqual(rows);
  });

  it('Yours keeps only what the owner has', () => {
    expect(names(filterExerciseList(rows, { scope: 'yours' }))).toEqual(['Bench Press', 'Lateral Raise', 'Squat']);
    expect(filterExerciseList(rows, { scope: 'all' }).length).toBe(rows.length);
  });

  it('filters by muscle group across owned, diagrams and catalogue, and files a diagram with no group under "other"', () => {
    expect(names(filterExerciseList(rows, { muscle: 'rear delts' }))).toEqual(['Cable Rear Delt Fly', 'Rear Delt Fly']);
    expect(names(filterExerciseList(rows, { muscle: 'chest' }))).toEqual(['Bench Press', 'Dumbbell Bench Press', 'Machine Bench Press']);
    expect(names(filterExerciseList(rows, { muscle: 'other' }))).toEqual(['Cat Cow']);
    expect(filterExerciseList(rows, { muscle: 'calves' })).toEqual([]);
  });

  it('searches the name, the muscle group and the equipment, every word having to match', () => {
    expect(names(filterExerciseList(rows, { query: 'arnold' }))).toEqual(['Arnold Press']);
    expect(names(filterExerciseList(rows, { query: 'rear delts' }))).toEqual(['Cable Rear Delt Fly', 'Rear Delt Fly']);
    expect(names(filterExerciseList(rows, { query: 'machine' }))).toEqual(['Machine Bench Press']);
    expect(names(filterExerciseList(rows, { query: 'cable fly' }))).toEqual(['Cable Rear Delt Fly']);
    expect(names(filterExerciseList(rows, { query: 'ChEsT  PrEsS' }))).toEqual(['Bench Press', 'Dumbbell Bench Press', 'Machine Bench Press']);
    expect(filterExerciseList(rows, { query: 'bench zzz' })).toEqual([]);
    // A diagram's own muscle label is searchable too: it is what its row says.
    expect(names(filterExerciseList(rows, { query: 'mobility' }))).toEqual(['Cat Cow']);
  });

  it('finds a row through its equipment or its muscle alone, after the rows whose name has the word', () => {
    const list = buildExerciseList({
      owned: [owned('o', 'Goblet Squat', { muscleGroup: 'quads', equipment: 'kettlebell' })],
      demos: [demo('swing', 'Swing', { equipment: 'Kettlebell', muscleGroup: 'glutes' }), demo('rack', 'Kettlebell Row', { equipment: 'Dumbbell', muscleGroup: 'lats' })],
      entries: [entry('windmill', 'Windmill', { equipment: 'kettlebell', muscleGroup: 'abs' })],
    });
    // "Kettlebell Row" has the word in its name, so it is first of the library; the others are found by their equipment.
    expect(names(filterExerciseList(list, { query: 'kettlebell' }))).toEqual(['Goblet Squat', 'Kettlebell Row', 'Swing', 'Windmill']);
    expect(names(filterExerciseList(list, { query: 'glutes' }))).toEqual(['Swing']);
  });

  it('finds an owned exercise by one of its aliases', () => {
    expect(names(filterExerciseList(rows, { query: 'flat' }))).toEqual(['Bench Press']);
  });

  it('ranks by how the query fits, as the catalogue search does', () => {
    // "Bench Press" (yours) starts with the query; the two library names have both words starting a word.
    expect(names(filterExerciseList(rows, { query: 'bench press' }))).toEqual(['Bench Press', 'Dumbbell Bench Press', 'Machine Bench Press']);
  });

  it('puts the owner\'s rows ahead of the library\'s even when a library name fits the query better', () => {
    const list = buildExerciseList({
      owned: [owned('o', 'Chest Press')],
      demos: [demo('press-up', 'Press Up'), demo('zero-press', 'Zero Press'), demo('overpress', 'Overpress')],
      entries: [],
    });
    // "Press Up" starts with it (tier 0); "Chest Press" and "Zero Press" start a word with it (tier 1); "Overpress" only contains it (tier 2).
    expect(names(filterExerciseList(list, { query: 'press' }))).toEqual(['Chest Press', 'Press Up', 'Zero Press', 'Overpress']);
  });

  it('applies the group, the scope and the query together', () => {
    expect(names(filterExerciseList(rows, { scope: 'all', muscle: 'chest', query: 'dumbbell' }))).toEqual(['Dumbbell Bench Press']);
    expect(filterExerciseList(rows, { scope: 'yours', muscle: 'chest', query: 'dumbbell' })).toEqual([]);
  });

  it('leaves out the owned exercises named by excludeIds, and only those', () => {
    // 'arnold-press' is a library key, not an exercise id: it names nothing the owner has, so it stays.
    expect(names(filterExerciseList(rows, { excludeIds: ['o1', 'arnold-press'] }))).toEqual(['Lateral Raise', 'Squat', ...names(rows.filter((r) => !r.owned))]);
  });

  it('does not change the list it was given', () => {
    const frozen = Object.freeze([...rows]);
    expect(() => filterExerciseList(frozen, { query: 'press' })).not.toThrow();
    expect(frozen).toEqual(rows);
  });
});

describe('groupsInList', () => {
  it('lists the groups present, in the app\'s order, with "other" for a diagram that has none', () => {
    const rows = buildExerciseList({
      owned: [owned('a', 'A', { muscleGroup: 'chest' })],
      demos: [demo('x', 'X', { muscleGroup: null }), demo('y', 'Y', { muscleGroup: 'rear delts' })],
      entries: [entry('z', 'Z', { muscleGroup: 'hamstrings' })],
    });
    expect(groupsInList(rows)).toEqual(['hamstrings', 'chest', 'rear delts', 'other']);
    expect(groupsInList([])).toEqual([]);
  });
});

describe('libraryCountsLine', () => {
  it('states the counts once the catalogue has loaded', () => {
    expect(libraryCountsLine({ owned: 27, library: 794 }, 'ready')).toBe('27 yours · 794 in the library');
  });

  it('does not claim a total while the catalogue is still loading', () => {
    expect(libraryCountsLine({ owned: 27, library: 276 }, 'loading')).toBe('27 yours · 276 in the library so far');
  });

  it('says so when the catalogue could not be loaded', () => {
    expect(libraryCountsLine({ owned: 27, library: 276 }, 'failed')).toBe('27 yours · 276 in the library · catalogue not loaded');
  });
});

describe('listHeading', () => {
  it('counts the rows, and says "exercise" for one', () => {
    expect(listHeading(303, 'ready', 'all')).toBe('303 exercises');
    expect(listHeading(1, 'ready', 'all')).toBe('1 exercise');
    expect(listHeading(0, 'ready', 'yours')).toBe('0 exercises');
  });

  it('qualifies the count of a list that reads the library while the catalogue is on its way, or never came', () => {
    expect(listHeading(303, 'loading', 'all')).toBe('303 exercises so far');
    expect(listHeading(303, 'failed', 'all')).toBe('303 exercises · catalogue not loaded');
  });

  it('says nothing about the catalogue over Yours, which is whole whatever became of it', () => {
    expect(listHeading(27, 'failed', 'yours')).toBe('27 exercises');
    expect(listHeading(27, 'loading', 'yours')).toBe('27 exercises');
  });
});

describe('emptyListText', () => {
  const base = { status: 'ready' as const, scope: 'all' as const, owned: 27, query: '', muscle: 'all' as const };

  it('blames the library only in a list that reads it', () => {
    expect(emptyListText({ ...base, status: 'failed' })).toBe('Library unavailable');
    expect(emptyListText({ ...base, status: 'loading' })).toBe('Loading…');
    // Yours reads only the owner's rows: a search that finds nothing there found nothing.
    expect(emptyListText({ ...base, status: 'failed', scope: 'yours', query: 'zzzz' })).toBe('No matches.');
    expect(emptyListText({ ...base, status: 'loading', scope: 'yours', query: 'zzzz' })).toBe('No matches.');
  });

  it('says "No exercises." only for an owner with none, with nothing typed or chosen', () => {
    expect(emptyListText({ ...base, scope: 'yours', owned: 0 })).toBe('No exercises.');
    expect(emptyListText({ ...base, scope: 'yours', owned: 0, query: 'curl' })).toBe('No matches.');
    expect(emptyListText({ ...base, scope: 'yours', owned: 0, muscle: 'biceps' })).toBe('No matches.');
    expect(emptyListText({ ...base, scope: 'yours', owned: 3 })).toBe('No matches.');
    expect(emptyListText({ ...base, query: 'zzzz' })).toBe('No matches.');
  });
});

describe('pageWindow', () => {
  it('draws one page, then another each time, never more than there are', () => {
    expect(LIST_PAGE_SIZE).toBe(60);
    expect(pageWindow(794, 1)).toEqual({ shown: 60, more: true });
    expect(pageWindow(794, 2)).toEqual({ shown: 120, more: true });
    expect(pageWindow(794, 14)).toEqual({ shown: 794, more: false });
    expect(pageWindow(794, 99)).toEqual({ shown: 794, more: false });
  });

  it('has no more when everything fits on the first page, exactly or with room to spare', () => {
    expect(pageWindow(60, 1)).toEqual({ shown: 60, more: false });
    expect(pageWindow(61, 1)).toEqual({ shown: 60, more: true });
    expect(pageWindow(7, 1)).toEqual({ shown: 7, more: false });
    expect(pageWindow(0, 1)).toEqual({ shown: 0, more: false });
  });

  it('treats a page count below one as one, and takes another size', () => {
    expect(pageWindow(100, 0)).toEqual({ shown: 60, more: true });
    expect(pageWindow(100, 2, 10)).toEqual({ shown: 20, more: true });
  });
});
