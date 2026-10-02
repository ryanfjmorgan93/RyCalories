import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { resetToSeed, routineItems } from './repo';
import { guessExerciseFromName, keepsNumbers, kindOfChoice, saveParsedRoutine, type ImportChoice } from './routineImport';
import { EXERCISE_DEMOS, findDemo } from '@/data/exerciseDemos';
import { loadCatalogue } from '@/data/catalogue';
import { parseRoutineText } from '@/domain/routineText';
import type { DemoLike } from '@/domain/library';
import type { ExerciseKind } from '@/domain/types';

/**
 * A pasted line names more than an exercise: "Plank 3x45s" is a hold of 45 seconds, "Pull-ups 3x8" is
 * bodyweight with weight added. The diagrams carry no exercise type, so the exercise made from one is
 * a plain reps exercise, and a line landed on it used to lose its seconds (the numbers are only kept
 * on a timed exercise) and its bodyweight kind. The line says what it is; the library does not.
 *
 * Every line here goes through the real parser, the real diagrams and the real catalogue, and is
 * saved to the database as the Save button saves it, then read back as the routine editor reads it.
 */

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const manifest = [
  ...(JSON.parse(readFileSync(here('../../node_modules/@bryllim/workout-guide/manifest.json'), 'utf8')) as { slug: string; name: string; exerciseType: string }[]),
];

beforeEach(async () => {
  await resetToSeed();
});

/** Paste one line the way the sheet does: parse it, choose the diagram, save, read the routine back. */
async function pasteOnDiagram(text: string, slug: string) {
  const parsed = parseRoutineText(`Day\n${text}`);
  const line = parsed.routines[0]!.exercises[0]!;
  const demo = findDemo(slug)!;
  expect(demo, slug).toBeDefined();
  const routine = await saveParsedRoutine('Day', [{ line, choice: { kind: 'demo', demo } }]);
  const [item] = await routineItems(routine.id);
  return { line, exercise: item!.exercise, rx: item!.rx };
}

describe('a pasted line landed on a library diagram keeps what it said', () => {
  it('"Plank 3x45s" is a timed exercise of 3 sets of 45 seconds, not 3 sets of 10-12 reps', async () => {
    const { line, exercise, rx } = await pasteOnDiagram('Plank 3x45s', 'plank');
    expect(line).toMatchObject({ sets: 3, repMin: 45, repMax: 45, seconds: true });
    expect(exercise).toMatchObject({ name: 'Plank', kind: 'timed', demo: 'plank' });
    expect(rx).toMatchObject({ targetSets: 3, repMin: 45, repMax: 45 });
  });

  it('keeps a range of seconds, and minutes as seconds', async () => {
    expect((await pasteOnDiagram('Dead Hang 3x20-30s', 'dead-hang')).rx).toMatchObject({ targetSets: 3, repMin: 20, repMax: 30 });
    const walk = await pasteOnDiagram('Walking 1x20 min', 'walking');
    expect(walk.exercise.kind).toBe('timed');
    expect(walk.rx).toMatchObject({ targetSets: 1, repMin: 1200, repMax: 1200 });
  });

  it.each([
    ['Pull-up 3x8', 'pull-up'],
    ['Pull-ups 3x8-10', 'pull-up'],
    ['Pull ups 3x8', 'pull-up'],
    ['Chin-ups 3x6', 'chin-up'],
    ['Dips 3x10', 'dip'],
    ['Push ups 3x15', 'push-up'],
    ['Press-ups 3x15', 'push-up'],
    ['Weighted Pull-up 3x5', 'weighted-pull-up'],
  ])('"%s" is bodyweight with weight added, with the reps it said', async (text, slug) => {
    const { line, exercise, rx } = await pasteOnDiagram(text, slug);
    expect(exercise.kind, text).toBe('bodyweight_plus');
    expect(rx.repMin).toBe(line.repMin);
    expect(rx.repMax).toBe(line.repMax);
    expect(rx.targetSets).toBe(line.sets);
  });

  it('the entry says what it is, not the wording of the line: "Strict chins" chosen for Chin-up is a chin-up, and an inverted row on a pull-up bar is a row', async () => {
    expect((await pasteOnDiagram('Strict chins 3x6', 'chin-up')).exercise.kind).toBe('bodyweight_plus');
    expect((await pasteOnDiagram('Inverted Row (pull-up bar) 3x10', 'inverted-row')).exercise.kind).toBe('reps');
  });

  it('"Dips 3xAMRAP" is bodyweight with weight added, three sets, and its own rep range since no reps were given', async () => {
    const { line, exercise, rx } = await pasteOnDiagram('Dips 3xAMRAP', 'dip');
    expect(line).toMatchObject({ sets: 3 });
    expect(line.repMin).toBeUndefined();
    expect(exercise.kind).toBe('bodyweight_plus');
    expect(rx.targetSets).toBe(3);
    expect(rx.repMin).toBeGreaterThan(0);
  });

  it('a plain exercise stays a plain reps exercise, whatever the line says about reps', async () => {
    const arnold = await pasteOnDiagram('Arnold press 3x8-10', 'arnold-press');
    expect(arnold.exercise.kind).toBe('reps');
    expect(arnold.rx).toMatchObject({ targetSets: 3, repMin: 8, repMax: 10 });
  });

  it('is not fooled by a name that merely contains a dip: a hip dip and a plain "Dip Machine" are not bodyweight pulls', async () => {
    const hip = await pasteOnDiagram('Side Plank Hip Dip 3x12', 'side-plank-hip-dip');
    expect(hip.exercise.kind).toBe('reps');
    const machine = (await loadCatalogue()).find((e) => e.name === 'Dip Machine')!;
    const parsed = parseRoutineText('Day\nDip Machine 3x10').routines[0]!.exercises[0]!;
    const routine = await saveParsedRoutine('Machine day', [{ line: parsed, choice: { kind: 'catalogue', entry: machine } }]);
    expect((await routineItems(routine.id))[0]!.exercise.kind).toBe('reps');
  });

  it('a seconds line is timed on every diagram, including all of those the library lists as a hold or a distance', async () => {
    // The ones the owner already has are theirs, with the kind they were made with, and are left alone.
    const have = new Set((await db.exercises.toArray()).flatMap((e) => (e.demo ? [e.demo] : [])));
    const known = new Set(EXERCISE_DEMOS.map((d) => d.slug));
    const timedSlugs = manifest.filter((m) => (m.exerciseType === 'duration' || m.exerciseType === 'distance_duration') && known.has(m.slug) && !have.has(m.slug)).map((m) => m.slug);
    expect(timedSlugs.length).toBeGreaterThan(40);
    for (const slug of timedSlugs) {
      const demo = findDemo(slug)!;
      const routine = await saveParsedRoutine(`Hold ${slug}`, [
        { line: { raw: '', name: demo.name, sets: 2, repMin: 30, repMax: 30, seconds: true }, choice: { kind: 'demo', demo } },
      ]);
      const [item] = await routineItems(routine.id);
      expect(item!.exercise.kind, demo.name).toBe('timed');
      expect(item!.rx, demo.name).toMatchObject({ targetSets: 2, repMin: 30, repMax: 30 });
    }
  });

  it('the exercise made keeps its kind next time: a second paste of the same movement is the same timed exercise', async () => {
    const first = await pasteOnDiagram('Plank 3x45s', 'plank');
    const second = await pasteOnDiagram('Plank 3x60s', 'plank');
    expect(second.exercise.id).toBe(first.exercise.id);
    expect(second.exercise.kind).toBe('timed');
    expect(second.rx).toMatchObject({ repMin: 60, repMax: 60 });
    expect(await db.exercises.filter((e) => e.demo === 'plank').count()).toBe(1);
  });
});

describe('a pasted line landed on a catalogue entry', () => {
  const choose = async (name: string): Promise<ImportChoice> => ({ kind: 'catalogue', entry: (await loadCatalogue()).find((e) => e.name === name)! });
  const saveOne = async (text: string, name: string) => {
    const line = parseRoutineText(`Day\n${text}`).routines[0]!.exercises[0]!;
    const routine = await saveParsedRoutine('Day', [{ line, choice: await choose(name) }]);
    const [item] = await routineItems(routine.id);
    return { line, exercise: item!.exercise, rx: item!.rx };
  };

  it('an entry the catalogue makes as reps takes the kind the line implies', async () => {
    const hold = await saveOne('Physioball Hip Bridge 3x30s', 'Physioball Hip Bridge');
    expect(hold.exercise.kind).toBe('timed');
    expect(hold.rx).toMatchObject({ targetSets: 3, repMin: 30, repMax: 30 });

  });

  it('a bodyweight word on an entry that is not bodyweight does not make it one: a Dip Machine and a Jerk Dip Squat are loaded', async () => {
    expect((await saveOne('Dip Machine 3x10', 'Dip Machine')).exercise.kind).toBe('reps');
    expect((await saveOne('Jerk Dip Squat 3x5', 'Jerk Dip Squat')).exercise.kind).toBe('reps');
  });

  it('an entry the catalogue types itself keeps its type: a carry stays a carry, a timed entry stays timed', async () => {
    expect((await saveOne('Rickshaw Carry 3x40', 'Rickshaw Carry')).exercise.kind).toBe('carry');
    expect((await saveOne('Isometric Wipers 3x20', 'Isometric Wipers')).exercise.kind).toBe('timed');
    // Even a line in seconds: the catalogue said what it is, and the line only asks for it.
    expect((await saveOne('Yoke Walk 3x30s', 'Yoke Walk')).exercise.kind).toBe('carry');
  });

  it('a plain entry stays plain: no seconds, no bodyweight word, no change', async () => {
    const pike = await saveOne('Hanging Pike 3x8-10', 'Hanging Pike');
    expect(pike.exercise.kind).toBe('reps');
    expect(pike.rx).toMatchObject({ repMin: 8, repMax: 10 });
  });
});

describe('Add new guesses the kind from the line as the library match does', () => {
  it('a seconds line is timed before anything else, even a name that reads as a carry', () => {
    expect(guessExerciseFromName('Walking', { timed: true }).kind).toBe('timed');
    expect(guessExerciseFromName("Farmer's walk", { timed: true }).kind).toBe('timed');
    expect(guessExerciseFromName("Farmer's walk").kind).toBe('carry');
  });

  it('dips, in the plural people write, are bodyweight with weight added', () => {
    expect(guessExerciseFromName('Dips').kind).toBe('bodyweight_plus');
    expect(guessExerciseFromName('Pull ups').kind).toBe('bodyweight_plus');
    expect(guessExerciseFromName('Press-ups').kind).toBe('bodyweight_plus');
    expect(guessExerciseFromName('Side Plank Hip Dip').kind).toBe('reps');
  });
});

describe('the numbers of a line are never dropped without the Review row saying so', () => {
  const bench: { kind: ExerciseKind } = { kind: 'reps' };
  const held: { kind: ExerciseKind } = { kind: 'timed' };

  it('keepsNumbers: only a timed exercise keeps the numbers of a seconds line; every exercise keeps those of a reps line', () => {
    expect(keepsNumbers({ seconds: true }, 'timed')).toBe(true);
    expect(keepsNumbers({ seconds: true }, 'reps')).toBe(false);
    expect(keepsNumbers({ seconds: true }, 'carry')).toBe(false);
    expect(keepsNumbers({ seconds: true }, 'bodyweight_plus')).toBe(false);
    for (const kind of ['reps', 'timed', 'carry', 'bodyweight_plus'] as const) expect(keepsNumbers({}, kind)).toBe(true);
  });

  it('kindOfChoice agrees with what Save writes, for each kind of choice', async () => {
    const owned = new Map([['bench', bench], ['hold', held]]);
    const entries = await loadCatalogue();
    const secs = { name: 'Plank', seconds: true };
    const reps = { name: 'Pull-ups', seconds: undefined };
    expect(kindOfChoice({ kind: 'existing', exerciseId: 'bench' }, secs, owned)).toBe('reps');
    expect(kindOfChoice({ kind: 'existing', exerciseId: 'hold' }, secs, owned)).toBe('timed');
    expect(kindOfChoice({ kind: 'existing', exerciseId: 'not loaded' }, secs, owned)).toBeUndefined();
    expect(kindOfChoice({ kind: 'new' }, secs, owned)).toBe('timed');
    expect(kindOfChoice({ kind: 'new' }, reps, owned)).toBe('bodyweight_plus');
    expect(kindOfChoice({ kind: 'demo', demo: findDemo('plank')! }, secs, owned)).toBe('timed');
    expect(kindOfChoice({ kind: 'demo', demo: findDemo('pull-up')! }, reps, owned)).toBe('bodyweight_plus');
    expect(kindOfChoice({ kind: 'catalogue', entry: entries.find((e) => e.name === 'Yoke Walk')! }, secs, owned)).toBe('carry');
  });

  it('a seconds line on an exercise of the owner\'s that is not timed is written with that exercise\'s own reps, which is what the row says is not used', async () => {
    const line = parseRoutineText('Day\nBench press 3x30s').routines[0]!.exercises[0]!;
    const bench = (await db.exercises.toArray()).find((e) => e.name === 'Bench Press (Barbell)')!;
    expect(keepsNumbers(line, bench.kind)).toBe(false);
    const routine = await saveParsedRoutine('Day', [{ line, choice: { kind: 'existing', exerciseId: bench.id } }]);
    const [item] = await routineItems(routine.id);
    expect(item!.rx.targetSets).toBe(3);
    expect([item!.rx.repMin, item!.rx.repMax]).not.toEqual([30, 30]);
  });
});

describe('the diagrams the paste can land on', () => {
  it('has at least the demos these tests name', () => {
    const slugs: string[] = ['plank', 'dead-hang', 'walking', 'pull-up', 'chin-up', 'dip', 'push-up', 'weighted-pull-up', 'arnold-press', 'side-plank-hip-dip'];
    for (const s of slugs) expect((findDemo(s) as DemoLike | undefined)?.slug, s).toBe(s);
  });
});
