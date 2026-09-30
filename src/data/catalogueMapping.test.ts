import { describe, expect, it } from 'vitest';
import { entryKeys, nameKeys, normaliseName, seedNamesFromSource, splitEquipmentSuffix } from '../../scripts/lib/normalise.mjs';
import { equipmentOf, isCompoundOf, kindOf, mapEntry, muscleGroupOf, slugOf, type DatasetEntry } from '../../scripts/lib/mapEntry.mjs';
import { ISOLATION_OVERRIDES, MUSCLE_OVERRIDES } from '../../scripts/lib/catalogueRules.mjs';
import { MUSCLE_GROUPS } from '@/domain/types';

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

  // Real dataset records: the name and first primary muscle free-exercise-db gives them.
  it.each([
    ['Bench Press - Powerlifting', 'triceps', 'chest'],
    ['Bench Press with Chains', 'triceps', 'chest'],
    ['Reverse Band Bench Press', 'triceps', 'chest'],
    ['Board Press', 'triceps', 'chest'],
    ['Pin Presses', 'triceps', 'chest'],
    ['Floor Press', 'triceps', 'chest'],
    ['Floor Press with Chains', 'triceps', 'chest'],
    ['One Arm Floor Press', 'triceps', 'chest'],
    ['Dumbbell Floor Press', 'triceps', 'chest'],
    ['Cable Hip Adduction', 'quadriceps', 'adductors'],
    ['Car Deadlift', 'quadriceps', 'lower back'],
    ['Rickshaw Deadlift', 'quadriceps', 'lower back'],
    ['Sumo Deadlift with Chains', 'hamstrings', 'lower back'],
    ['Clean Deadlift', 'hamstrings', 'lower back'],
    ['Bent-Arm Dumbbell Pullover', 'chest', 'lats'],
    ['Wide-Grip Decline Barbell Pullover', 'chest', 'lats'],
    ['Clean', 'hamstrings', 'full body'],
    ['Hang Clean', 'quadriceps', 'full body'],
    ['Power Snatch', 'hamstrings', 'full body'],
    ['Snatch from Blocks', 'quadriceps', 'full body'],
    ['Split Jerk', 'quadriceps', 'full body'],
    ['Clean and Jerk', 'shoulders', 'full body'],
    ['Jerk Balance', 'shoulders', 'full body'],
    ['One-Arm Kettlebell Snatch', 'shoulders', 'full body'],
  ])('files %s (the dataset says %s) under %s', (name, primary, group) => {
    expect(muscleGroupOf({ name, primaryMuscles: [primary] })).toBe(group);
  });

  it('leaves the lifts next to the overridden ones as the dataset has them', () => {
    // Triceps work beside the bench variants, the Romanian and stiff-legged hinges, the shrugs and a chest floor press.
    expect(muscleGroupOf({ name: 'Smith Machine Close-Grip Bench Press', primaryMuscles: ['triceps'] })).toBe('triceps');
    expect(muscleGroupOf({ name: 'Reverse Triceps Bench Press', primaryMuscles: ['triceps'] })).toBe('triceps');
    expect(muscleGroupOf({ name: 'Weighted Bench Dip', primaryMuscles: ['triceps'] })).toBe('triceps');
    expect(muscleGroupOf({ name: 'Stiff-Legged Barbell Deadlift', primaryMuscles: ['hamstrings'] })).toBe('hamstrings');
    expect(muscleGroupOf({ name: 'Romanian Deadlift from Deficit', primaryMuscles: ['hamstrings'] })).toBe('hamstrings');
    expect(muscleGroupOf({ name: 'Clean Shrug', primaryMuscles: ['traps'] })).toBe('traps');
    expect(muscleGroupOf({ name: 'Snatch Shrug', primaryMuscles: ['traps'] })).toBe('traps');
    expect(muscleGroupOf({ name: 'Leg-Over Floor Press', primaryMuscles: ['chest'] })).toBe('chest');
    expect(muscleGroupOf({ name: 'Barbell Bench Press - Medium Grip', primaryMuscles: ['chest'] })).toBe('chest');
  });

  it('keeps every override to a real group, a name spelt as mapEntry reads it, and a group that wins over the dataset muscle', () => {
    const overrides = Object.entries(MUSCLE_OVERRIDES);
    expect(overrides.length).toBeGreaterThan(50);
    for (const [name, group] of overrides) {
      expect(MUSCLE_GROUPS, name).toContain(group);
      // mapEntry tidies a name before it looks anything up, so a key that tidying would change could never match.
      expect(name, name).toBe(name.replace(/_/g, ' ').trim());
      expect(mapEntry(raw({ name, primaryMuscles: ['calves'] })).muscleGroup, name).toBe(group);
    }
  });

  it('does not read an override off the object prototype', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(muscleGroupOf({ name, primaryMuscles: ['chest'] }), name).toBe('chest');
    }
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

  it('does not take an EZ-bar movement the dataset files under barbell for one', () => {
    // The two real records: free-exercise-db says barbell for both, and names the bar in the title.
    expect(equipmentOf({ name: 'Close-Grip EZ Bar Curl', equipment: 'barbell' })).toBe('other');
    expect(equipmentOf({ name: 'Decline EZ Bar Triceps Extension', equipment: 'barbell' })).toBe('other');
    expect(equipmentOf({ name: 'EZ-Bar Curl', equipment: 'barbell' })).toBe('other');
    expect(equipmentOf({ name: 'Standing Ez Bar Curl', equipment: 'barbell' })).toBe('other');
  });

  it('leaves a barbell a barbell when the name does not say EZ, and copes with no name', () => {
    expect(equipmentOf({ name: 'Barbell Curl', equipment: 'barbell' })).toBe('barbell');
    expect(equipmentOf({ name: 'Breeze Bar Curl', equipment: 'barbell' })).toBe('barbell');
    expect(equipmentOf({ name: 'Zercher Squat', equipment: 'barbell' })).toBe('barbell');
    expect(equipmentOf({ equipment: 'barbell' })).toBe('barbell');
    expect(equipmentOf({ name: undefined, equipment: 'barbell' })).toBe('barbell');
  });

  it('reads an EZ bar on a cable as the cable', () => {
    expect(equipmentOf({ name: 'Cable EZ-Bar Curl', equipment: 'cable' })).toBe('cable');
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

  it('marks added-weight bodyweight lifts for body-only work', () => {
    for (const name of ['Pullups', 'Chin-Up', 'V-Bar Pullup', 'Wide-Grip Rear Pull-Up', 'Dips - Triceps Version', 'Pushups', 'Incline Push-Up Wide', 'Hyperextensions With No Hyperextension Bench', 'Back Extension']) {
      expect(kind(name, 'body only'), name).toBe('bodyweight_plus');
    }
    expect(kind('Weighted Sit-Ups', 'body only')).toBe('reps');
    expect(kind('Crunch', 'body only')).toBe('reps');
    expect(kind('Machine Dip', 'machine')).toBe('reps');
  });

  // The dataset files most hanging and dipping work under equipment "other", or none: these are its real pairs.
  it('marks the pulling and dipping work the dataset files under "other" as added-weight bodyweight lifts', () => {
    for (const name of ['Muscle Up', 'Kipping Muscle Up', 'One Arm Chin-Up', 'Ring Dips', 'Rocky Pull-Ups/Pulldowns', 'Weighted Bench Dip', 'Suspended Push-Up', 'Mixed Grip Chin', 'Gironda Sternum Chins', 'Side To Side Chins', 'Rope Climb']) {
      expect(kind(name, 'other'), name).toBe('bodyweight_plus');
    }
  });

  it('marks the same work with no equipment at all the same way', () => {
    expect(kind('Muscle Up', null)).toBe('bodyweight_plus');
    expect(kind('Ring Dips', null)).toBe('bodyweight_plus');
  });

  it('keeps assisted work as reps: the assistance is a negative load, not added weight', () => {
    expect(kind('Band Assisted Pull-Up', 'other')).toBe('reps');
    expect(kind('Assisted Chin-Up', 'body only')).toBe('reps');
  });

  it('keeps a pull-up or dip that kit does the loading for as reps', () => {
    expect(kind('Dip Machine', 'machine')).toBe('reps');
    expect(kind('Jerk Dip Squat', 'barbell')).toBe('reps');
    expect(kind('Plyo Kettlebell Pushups', 'kettlebells')).toBe('reps');
    expect(kind('Push-Ups With Feet On An Exercise Ball', 'exercise ball')).toBe('reps');
    expect(kind('Weighted Ball Hyperextension', 'exercise ball')).toBe('reps');
    expect(kind('Lying Close-Grip Barbell Triceps Press To Chin', 'e-z curl bar')).toBe('reps');
    expect(kind('Lat Pull-Up Machine', 'machine')).toBe('reps');
  });

  it('does not read every chin as a chin-up', () => {
    expect(kind('Gorilla Chin/Crunch', 'body only')).toBe('reps');
    expect(kind('Lying Close-Grip Barbell Triceps Press To Chin', 'other')).toBe('reps');
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

  const abs = (name: string, over: Record<string, unknown> = {}) => ({ name, mechanic: 'compound', equipment: 'body only', primaryMuscles: ['abdominals'], secondaryMuscles: [] as string[], ...over });

  it('files body-only abdominal work as isolation, whatever the dataset mechanic says', () => {
    for (const name of ['3/4 Sit-Up', 'Cross-Body Crunch', 'Decline Oblique Crunch', 'Jackknife Sit-Up', 'Air Bike', 'Cocoons', 'Leg Pull-In', 'Bent-Knee Hip Raise', 'Elbow to Knee']) {
      expect(isCompoundOf(abs(name)), name).toBe(false);
    }
    // Two secondary muscles would make it compound through the fallback; the rule comes first.
    expect(isCompoundOf(abs('Air Bike', { mechanic: null, secondaryMuscles: ['a', 'b'] }))).toBe(false);
  });

  it('keeps loaded abdominal work, and body-only work elsewhere, as the dataset has it', () => {
    expect(isCompoundOf(abs('Barbell Ab Rollout', { equipment: 'barbell' }))).toBe(true);
    expect(isCompoundOf(abs('Kettlebell Windmill', { equipment: 'kettlebells' }))).toBe(true);
    expect(isCompoundOf(abs('Standing Cable Lift', { equipment: 'cable' }))).toBe(true);
    expect(isCompoundOf(abs('Push-Ups With Feet Elevated', { primaryMuscles: ['chest'] }))).toBe(true);
    expect(isCompoundOf(abs('Chin-Up', { primaryMuscles: ['lats'] }))).toBe(true);
  });

  it('files the named misfiles as isolation and leaves a real press alone', () => {
    expect(ISOLATION_OVERRIDES).toEqual(['Cable Internal Rotation', 'Dumbbell Raise', 'External Rotation with Band', 'High Cable Curls']);
    for (const name of ISOLATION_OVERRIDES) {
      expect(isCompoundOf({ name, mechanic: 'compound', equipment: 'cable', primaryMuscles: ['shoulders'], secondaryMuscles: ['biceps'] }), name).toBe(false);
    }
    expect(isCompoundOf({ name: 'Arnold Dumbbell Press', mechanic: 'compound', equipment: 'dumbbell', primaryMuscles: ['shoulders'], secondaryMuscles: ['triceps'] })).toBe(true);
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

  it('runs every rule on the real record of a lift that needed one', () => {
    expect(mapEntry(raw({ id: 'Bench_Press_-_Powerlifting', name: 'Bench Press - Powerlifting', category: 'powerlifting', primaryMuscles: ['triceps'], secondaryMuscles: ['chest', 'lats'] }))).toMatchObject({ muscleGroup: 'chest', equipment: 'barbell', kind: 'reps', isCompound: true });
    expect(mapEntry(raw({ id: 'Close-Grip_EZ_Bar_Curl', name: 'Close-Grip EZ Bar Curl', primaryMuscles: ['biceps'], mechanic: 'isolation' }))).toMatchObject({ muscleGroup: 'biceps', equipment: 'other', isCompound: false });
    expect(mapEntry(raw({ id: 'Muscle_Up', name: 'Muscle Up', equipment: 'other', primaryMuscles: ['lats'] }))).toMatchObject({ kind: 'bodyweight_plus', equipment: 'other' });
    expect(mapEntry(raw({ id: '3_4_Sit-Up', name: '3/4 Sit-Up', equipment: 'body only', primaryMuscles: ['abdominals'] }))).toMatchObject({ muscleGroup: 'abs', equipment: 'bodyweight', isCompound: false });
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
