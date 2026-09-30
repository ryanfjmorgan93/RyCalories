import { describe, expect, it } from 'vitest';
import { entryKeys, nameKeys, normaliseName, seedNamesFromSource, splitEquipmentSuffix } from '../../scripts/lib/normalise.mjs';
import { equipmentOf, isCompoundOf, kindOf, mapEntry, muscleGroupOf, slugOf, type DatasetEntry } from '../../scripts/lib/mapEntry.mjs';

/** A dataset record with sensible defaults; each test overrides what it is about. */
function raw(over: Partial<DatasetEntry> & { name: string }): DatasetEntry {
  return {
    id: over.name.replace(/\s+/g, '_'),
    level: 'beginner',
    mechanic: 'compound',
    equipment: 'barbell',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    instructions: ['Do it.'],
    category: 'strength',
    images: ['a/0.jpg', 'a/1.jpg'],
    ...over,
  };
}

describe('slugOf', () => {
  it('lowercases the id and turns every run of non-alphanumerics into one hyphen', () => {
    expect(slugOf('Barbell_Bench_Press_-_Medium_Grip')).toBe('barbell-bench-press-medium-grip');
    expect(slugOf('3_4_Sit-Up')).toBe('3-4-sit-up');
    expect(slugOf('Bradford/Rocky_Presses')).toBe('bradford-rocky-presses');
    expect(slugOf("Conan's_Wheel")).toBe('conan-s-wheel');
  });

  it('trims hyphens at either end and always matches /^[a-z0-9-]+$/', () => {
    expect(slugOf('_Leading_and_trailing_')).toBe('leading-and-trailing');
    expect(slugOf('Push-Ups_(Close_and_Wide)')).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('muscleGroupOf', () => {
  it.each([
    ['quadriceps', 'quads'],
    ['hamstrings', 'hamstrings'],
    ['glutes', 'glutes'],
    ['calves', 'calves'],
    ['adductors', 'adductors'],
    ['abductors', 'glutes'],
    ['abdominals', 'abs'],
    ['chest', 'chest'],
    ['shoulders', 'shoulders'],
    ['triceps', 'triceps'],
    ['biceps', 'biceps'],
    ['forearms', 'forearms'],
    ['lats', 'lats'],
    ['middle back', 'upper back'],
    ['lower back', 'lower back'],
    ['traps', 'traps'],
    ['neck', 'neck'],
  ])('maps the dataset muscle %s to %s', (primary, group) => {
    expect(muscleGroupOf({ name: 'Anything', primaryMuscles: [primary] })).toBe(group);
  });

  it('reads the first primary muscle only', () => {
    expect(muscleGroupOf({ name: 'Anything', primaryMuscles: ['lats', 'biceps'] })).toBe('lats');
  });

  it('files rear-delt work that the dataset calls shoulders under rear delts', () => {
    for (const name of ['Face Pull', 'Reverse Flyes', 'Reverse Flyes With External Rotation', 'Cable Rear Delt Fly', 'Bent Over Low-Pulley Side Lateral', 'Seated Bent-Over Rear Delt Raise', 'Back Flyes - With Bands', 'Low Pulley Row To Neck']) {
      expect(muscleGroupOf({ name, primaryMuscles: ['shoulders'] }), name).toBe('rear delts');
    }
  });

  it('leaves the other shoulder work as shoulders', () => {
    for (const name of ['Side Lateral Raise', 'Dumbbell Shoulder Press', 'Arnold Dumbbell Press', 'Front Plate Raise']) {
      expect(muscleGroupOf({ name, primaryMuscles: ['shoulders'] }), name).toBe('shoulders');
    }
  });

  it('applies the rear-delt names to shoulders only', () => {
    expect(muscleGroupOf({ name: 'Rear Lunge', primaryMuscles: ['quadriceps'] })).toBe('quads');
    expect(muscleGroupOf({ name: 'Reverse Flyes', primaryMuscles: ['middle back'] })).toBe('upper back');
  });

  it('refuses a muscle it does not know rather than guess', () => {
    expect(() => muscleGroupOf({ name: 'Mystery', primaryMuscles: ['pinky toe'] })).toThrow(/pinky toe/);
    expect(() => muscleGroupOf({ name: 'Mystery', primaryMuscles: [] })).toThrow();
  });
});

describe('equipmentOf', () => {
  it.each([
    ['barbell', 'barbell'],
    ['dumbbell', 'dumbbell'],
    ['cable', 'cable'],
    ['machine', 'machine'],
    ['body only', 'bodyweight'],
    ['kettlebells', 'kettlebell'],
    ['other', 'other'],
    ['bands', 'other'],
    ['foam roll', 'other'],
    ['medicine ball', 'other'],
    ['exercise ball', 'other'],
    [null, 'other'],
  ])('maps %s to %s', (dataset, equipment) => {
    expect(equipmentOf({ equipment: dataset })).toBe(equipment);
  });

  it('never calls an EZ bar a barbell (a barbell gets a 20 kg warm-up ramp)', () => {
    expect(equipmentOf({ equipment: 'e-z curl bar' })).toBe('other');
  });
});

describe('kindOf', () => {
  const kind = (name: string, equipment: string | null, category = 'strength') => kindOf({ name, equipment, category });

  it('marks a timed hold only for body-only work', () => {
    expect(kind('Plank', 'body only')).toBe('timed');
    expect(kind('Isometric Neck Exercise - Sides', 'body only')).toBe('timed');
    expect(kind('Hollow Body Hold', 'body only')).toBe('timed');
    expect(kind('Wall Sit', 'body only')).toBe('timed');
    expect(kind('Dead Hang', 'body only')).toBe('timed');
    expect(kind('Plank', 'other')).toBe('reps');
    expect(kind('Wall Sit', null)).toBe('reps');
    expect(kind('Farmers Hold', 'dumbbell')).toBe('reps');
  });

  it('does not read a hang in a lift as a hold', () => {
    for (const name of ['Hang Clean', 'Hang Snatch - Below Knees', 'Hang Clean - Below the Knees']) {
      expect(kind(name, 'body only'), name).not.toBe('timed');
      expect(kind(name, 'barbell'), name).toBe('reps');
    }
    expect(kind('Clean and Jerk', 'body only')).not.toBe('timed');
  });

  it('does not call a push-up into a side plank a hold', () => {
    expect(kind('Push Up to Side Plank', 'body only')).toBe('bodyweight_plus');
  });

  it('marks a carry by name or by a strongman event that covers ground', () => {
    expect(kind('Rickshaw Carry', 'other', 'strongman')).toBe('carry');
    expect(kind('Yoke Walk', 'other', 'strongman')).toBe('carry');
    expect(kind("Farmer's Walk", 'other', 'strongman')).toBe('carry');
    expect(kind('Sled Drag - Harness', 'other', 'strongman')).toBe('carry');
    expect(kind('Sled Push', 'other', 'strongman')).toBe('carry');
    expect(kind('Backward Drag', 'other', 'strongman')).toBe('carry');
    expect(kind("Conan's Wheel", 'other', 'strongman')).toBe('carry');
    expect(kind('Yoke', 'other', 'strongman')).toBe('carry');
    expect(kind('Monster Walk', 'bands')).toBe('carry');
    expect(kind('Suitcase Carry', 'dumbbell')).toBe('carry');
  });

  it('keeps a strongman lift, and a walking lunge, as reps', () => {
    for (const name of ['Atlas Stones', 'Log Lift', 'Tire Flip', 'Car Deadlift', 'Axle Deadlift', 'Keg Load', 'Circus Bell']) {
      expect(kind(name, 'other', 'strongman'), name).toBe('reps');
    }
    expect(kind('Barbell Walking Lunge', 'barbell')).toBe('reps');
    expect(kind('Bodyweight Walking Lunge', null)).toBe('reps');
  });

  it('marks added-weight bodyweight lifts only for body-only work', () => {
    for (const name of ['Pullups', 'Chin-Up', 'V-Bar Pullup', 'Wide-Grip Rear Pull-Up', 'Dips - Triceps Version', 'Muscle Up', 'Pushups', 'Incline Push-Up Wide', 'Hyperextensions With No Hyperextension Bench', 'Back Extension']) {
      expect(kind(name, 'body only'), name).toBe('bodyweight_plus');
    }
    expect(kind('Weighted Sit-Ups', 'body only')).toBe('reps');
    expect(kind('Crunch', 'body only')).toBe('reps');
    expect(kind('Ring Dips', 'other')).toBe('reps');
    expect(kind('Machine Dip', 'machine')).toBe('reps');
  });

  it('keeps everything else as reps', () => {
    expect(kind('Barbell Curl', 'barbell')).toBe('reps');
    expect(kind('Leg Press', 'machine')).toBe('reps');
  });
});

describe('isCompoundOf', () => {
  it('follows the dataset mechanic', () => {
    expect(isCompoundOf({ mechanic: 'compound', secondaryMuscles: [] })).toBe(true);
    expect(isCompoundOf({ mechanic: 'isolation', secondaryMuscles: ['a', 'b', 'c'] })).toBe(false);
  });

  it('falls back to two or more secondary muscles when the mechanic is missing', () => {
    expect(isCompoundOf({ mechanic: null, secondaryMuscles: ['a', 'b'] })).toBe(true);
    expect(isCompoundOf({ mechanic: null, secondaryMuscles: ['a', 'b', 'c'] })).toBe(true);
    expect(isCompoundOf({ mechanic: null, secondaryMuscles: ['a'] })).toBe(false);
    expect(isCompoundOf({ mechanic: null, secondaryMuscles: [] })).toBe(false);
  });
});

describe('mapEntry', () => {
  it('builds the whole entry, keeping the dataset name and level', () => {
    expect(
      mapEntry(raw({ id: 'Hammer_Curls', name: 'Hammer_Curls ', equipment: 'dumbbell', primaryMuscles: ['biceps'], secondaryMuscles: ['forearms'], mechanic: 'isolation', level: 'expert' })),
    ).toEqual({
      slug: 'hammer-curls',
      name: 'Hammer Curls',
      muscleGroup: 'biceps',
      equipment: 'dumbbell',
      kind: 'reps',
      isCompound: false,
      unilateral: false,
      level: 'expert',
    });
  });

  it('flags one-sided work from the name', () => {
    for (const name of ['Single-Arm Push-Up', 'One-Arm Kettlebell Row', 'One Leg Barbell Squat', 'Alternating Cable Shoulder Press', 'Bulgarian Split Squat', 'Bulgarian Squat', 'Barbell Step Ups', 'Dumbbell Lunges', 'Kettlebell Pistol Squat', 'Split Squat with Dumbbells', 'Unilateral Leg Press']) {
      expect(mapEntry(raw({ name })).unilateral, name).toBe(true);
    }
    for (const name of ['Barbell Curl', 'Leg Press', 'Two-Arm Kettlebell Row', 'Bench Press']) {
      expect(mapEntry(raw({ name })).unilateral, name).toBe(false);
    }
  });

  it('refuses a level it does not know', () => {
    expect(() => mapEntry(raw({ name: 'X', level: 'legendary' }))).toThrow(/legendary/);
  });
});

describe('normaliseName', () => {
  it('singularises plurals and drops punctuation', () => {
    expect(normaliseName('Hammer Curls')).toBe(normaliseName('Hammer Curl'));
    expect(normaliseName("Farmer's Walk")).toBe(normaliseName('Farmers Walk'));
    expect(normaliseName('Crunches')).toBe(normaliseName('Crunch'));
    expect(normaliseName('Bench Presses')).toBe(normaliseName('Bench Press'));
    expect(normaliseName('Leg Extensions')).toBe('leg extension');
  });

  it('leaves words that only look plural alone', () => {
    expect(normaliseName('Bench Press')).toBe('bench press');
    expect(normaliseName('Cross')).toBe('cross');
    expect(normaliseName('Abs')).toBe('abs');
  });

  it('joins the spellings that differ only by a space or a hyphen', () => {
    expect(normaliseName('Push-Ups')).toBe(normaliseName('Pushups'));
    expect(normaliseName('Pull Up')).toBe(normaliseName('Pullup'));
    expect(normaliseName('Dumbbell Flyes')).toBe(normaliseName('Dumbbell Fly'));
    expect(normaliseName('Incline Cable Flye')).toBe(normaliseName('Incline Cable Fly'));
  });

  it('expands the app abbreviations', () => {
    expect(normaliseName('Incline DB Press')).toBe(normaliseName('Incline Dumbbell Press'));
  });
});

describe('splitEquipmentSuffix', () => {
  it('splits a bracketed equipment word off the end', () => {
    expect(splitEquipmentSuffix('Romanian Deadlift (Barbell)')).toEqual({ base: 'Romanian Deadlift', equipment: 'Barbell' });
    expect(splitEquipmentSuffix('Standing Calf Raise (Smith Machine)')).toEqual({ base: 'Standing Calf Raise', equipment: 'Smith Machine' });
  });

  it('leaves a bracket that is not equipment where it is', () => {
    expect(splitEquipmentSuffix('Hyperextensions (Back Extensions)')).toEqual({ base: 'Hyperextensions (Back Extensions)', equipment: '' });
    expect(splitEquipmentSuffix('Kettlebell Turkish Get-Up (Lunge style)').equipment).toBe('');
    expect(splitEquipmentSuffix('Plain Name')).toEqual({ base: 'Plain Name', equipment: '' });
  });
});

describe('nameKeys', () => {
  const shares = (a: string[], b: string[]) => a.some((k) => b.includes(k));

  it('matches a name with and without its bracketed equipment', () => {
    expect(shares(nameKeys('Hammer Curls'), nameKeys('Hammer Curl (Dumbbell)'))).toBe(true);
    expect(shares(nameKeys('Leg Extensions'), nameKeys('Leg Extension (Machine)'))).toBe(true);
  });

  it('matches equipment kept apart from the name to equipment written into it', () => {
    expect(shares(nameKeys('Barbell Hip Thrust'), nameKeys('Hip Thrust', 'Barbell'))).toBe(true);
    // "Bodyweight" is not kit the name matcher can lift out of a name, so only the prefixed spelling meets it.
    expect(shares(nameKeys('Bodyweight Squat'), nameKeys('Squat', 'Bodyweight'))).toBe(true);
    expect(shares(nameKeys('Dumbbell Bicep Curl'), nameKeys('Bicep Curl (Dumbbell)'))).toBe(true);
  });

  it('matches equipment written in another place in the name', () => {
    expect(shares(nameKeys('Decline Barbell Bench Press'), nameKeys('Decline Bench Press', 'Barbell'))).toBe(true);
    expect(shares(nameKeys('Front Cable Raise', 'cable'), nameKeys('Cable Front Raise', 'Cable'))).toBe(true);
    expect(shares(nameKeys('Push-Up Wide'), nameKeys('Wide Push-up', 'Bodyweight'))).toBe(true);
  });

  it('keeps the same movement on different kit apart when the kit is in the name', () => {
    expect(shares(nameKeys('Cable Bench Press', 'cable'), nameKeys('Bench Press', 'Barbell'))).toBe(false);
    expect(shares(nameKeys('Dumbbell Bench Press', 'dumbbell'), nameKeys('Bench Press', 'Barbell'))).toBe(false);
    expect(shares(nameKeys('Smith Machine Bench Press'), nameKeys('Machine Bench Press'))).toBe(false);
  });

  it('keeps different movements apart', () => {
    expect(shares(nameKeys('Incline Dumbbell Flyes', 'dumbbell'), nameKeys('Dumbbell Fly', 'Dumbbell'))).toBe(false);
    expect(shares(nameKeys('Hammer Curl'), nameKeys('Hammer Curl Cable'))).toBe(false);
    expect(shares(nameKeys('Front Squat'), nameKeys('Squat'))).toBe(false);
  });
});

describe('entryKeys', () => {
  it('counts a catalogue entry’s kit as declared only when it names a piece of kit', () => {
    expect(entryKeys('Hip Thrust', 'barbell')).toEqual(nameKeys('Hip Thrust', 'barbell'));
    expect(entryKeys('Hip Thrust', 'bodyweight')).toEqual(nameKeys('Hip Thrust', ''));
    expect(entryKeys('Hip Thrust', 'other')).toEqual(nameKeys('Hip Thrust', ''));
  });
});

describe('seedNamesFromSource', () => {
  const line = (body: string) => `  { id: "x", ${body}, muscleGroup: "chest", isCompound: false },`;

  it('reads the name, the aliases and the equipment from a seed line', () => {
    const text = [
      'export const SEED_EXERCISES = [',
      line('name: "Incline DB Press", aliases: ["Incline Bench Press (Dumbbell)", "Incline Press (Dumbbell)"], equipment: "dumbbell"'),
      line('name: "Neck", equipment: "other"'),
      '];',
    ].join('\n');
    expect(seedNamesFromSource(text)).toEqual([
      { name: 'Incline DB Press', aliases: ['Incline Bench Press (Dumbbell)', 'Incline Press (Dumbbell)'], equipment: 'dumbbell' },
      { name: 'Neck', aliases: [], equipment: 'other' },
    ]);
  });

  it('ignores lines that are not seeded exercises', () => {
    const text = ['  { id: "r", name: "Lower (Hinge)", order: 0, isLowerBody: true, targetMinutes: 50 },', 'export const SEED_BODYWEIGHT_KG = 74;'].join('\n');
    expect(seedNamesFromSource(text)).toEqual([]);
  });
});
