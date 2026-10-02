import { describe, expect, it } from 'vitest';
import { SEED_EXERCISES } from '../db/seed';
import { EXERCISE_DEMOS } from '../data/exerciseDemos';
import catalogueJson from '../data/exerciseCatalogue.json';
import {
  MOVEMENT_PATTERNS,
  MUSCLE_REGIONS,
  NON_ROUTINE_PATTERNS,
  PATTERN_LABELS,
  REGION_LABELS,
  movementPattern,
  patternLabel,
  regionOf,
} from './movement';
import type { CatalogueEntry } from './catalogue';
import { MUSCLE_GROUPS, type MuscleGroup } from './types';

const CATALOGUE = catalogueJson as CatalogueEntry[];

interface Named {
  source: 'seed' | 'diagram' | 'catalogue';
  name: string;
  group: MuscleGroup;
}

/** Every name in the library, filed under the group it is filed under. */
const LIBRARY: Named[] = [
  ...SEED_EXERCISES.map((e): Named => ({ source: 'seed', name: e.name, group: e.muscleGroup })),
  ...EXERCISE_DEMOS.map((d): Named => ({ source: 'diagram', name: d.name, group: d.muscleGroup ?? 'other' })),
  ...CATALOGUE.map((c): Named => ({ source: 'catalogue', name: c.name, group: c.muscleGroup })),
];

const patternOf = (n: Named) => movementPattern(n.name, n.group);

describe('movementPattern: the 27 seeded exercises', () => {
  const EXPECTED: Record<string, string> = {
    'Romanian Deadlift (Barbell)': 'hinge',
    'Hip Thrust (Barbell)': 'hip-thrust',
    'Lying Leg Curl (Machine)': 'leg-curl',
    'Back Extension': 'back-extension',
    "Farmer's Carry": 'carry',
    'Seated Calf Raise': 'calf-raise',
    'Bench Press (Barbell)': 'press-horizontal',
    'Incline DB Press': 'press-incline',
    'DB Shoulder Press': 'press-vertical',
    'Triceps Pushdown': 'pushdown',
    'Barbell Back Squat': 'squat',
    'Bulgarian Split Squat': 'lunge',
    'Leg Extension': 'leg-extension',
    'Hip Adductor (Machine)': 'adduction',
    'Standing Calf Raise': 'calf-raise',
    'Lat Pulldown (Machine)': 'pulldown',
    'Iso-Lateral Row (Machine)': 'row',
    'Heavy DB Shrugs': 'shrug',
    'DB Curl': 'curl',
    'Incline DB Curl': 'incline-curl',
    'Hammer Curl': 'hammer-curl',
    'Overhead Triceps Extension': 'triceps-extension',
    'Lateral Raise': 'lateral-raise',
    'Rear Delt Fly (Machine)': 'rear-fly',
    'Face Pull': 'face-pull',
    'Cable Crunch': 'crunch',
    // The seeded neck row is filed under 'neck' and nothing in its name places it.
    Neck: 'neck',
  };

  it('covers all of them', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(SEED_EXERCISES.map((e) => e.name).sort());
  });

  it.each(SEED_EXERCISES.map((e) => [e.name, e.muscleGroup] as const))('%s', (name, group) => {
    expect(movementPattern(name, group)).toBe(EXPECTED[name]);
  });
});

describe('movementPattern: real names from the diagrams and the catalogue', () => {
  // [name, group, pattern]
  const TABLE: [string, MuscleGroup, string][] = [
    // shoulders
    ['Arnold Press', 'shoulders', 'press-vertical'],
    ['Machine Shoulder Press', 'shoulders', 'press-vertical'],
    ['Seated Barbell Military Press', 'shoulders', 'press-vertical'],
    ['Smith Machine Overhead Shoulder Press', 'shoulders', 'press-vertical'],
    ['Standing Palms-In Dumbbell Press', 'shoulders', 'press-vertical'],
    ['Push Press', 'shoulders', 'press-vertical'],
    ['Pike Push-up', 'shoulders', 'press-vertical'],
    ['Cable Lateral Raise', 'shoulders', 'lateral-raise'],
    ['Seated Side Lateral Raise', 'shoulders', 'lateral-raise'],
    ['One-Arm Side Laterals', 'shoulders', 'lateral-raise'],
    ['Lying One-Arm Lateral Raise', 'shoulders', 'lateral-raise'],
    ['Dumbbell Raise', 'shoulders', 'lateral-raise'],
    ['Front Raise', 'shoulders', 'front-raise'],
    ['Plate Front Raise', 'shoulders', 'front-raise'],
    ['Front Two-Dumbbell Raise', 'shoulders', 'front-raise'],
    ['Dumbbell Scaption', 'shoulders', 'front-raise'],
    ['Single Dumbbell Raise', 'shoulders', 'front-raise'],
    ['Upright Row', 'shoulders', 'upright-row'],
    ['Dumbbell One-Arm Upright Row', 'shoulders', 'upright-row'],
    ['External Rotation with Cable', 'shoulders', 'rotation'],
    ['Cable Rear Delt Fly', 'rear delts', 'rear-fly'],
    ['Reverse Pec Deck', 'rear delts', 'rear-fly'],
    ['Seated Bent-Over Rear Delt Raise', 'rear delts', 'rear-fly'],
    ['Dumbbell Lying Rear Lateral Raise', 'rear delts', 'rear-fly'],
    ['Bent Over Low-Pulley Side Lateral', 'rear delts', 'rear-fly'],
    ['Reverse Flyes With External Rotation', 'rear delts', 'rear-fly'],
    ['Band Pull-Apart', 'upper back', 'rear-fly'],
    ['Banded Face Pull', 'upper back', 'face-pull'],
    ['Low Pulley Row To Neck', 'rear delts', 'face-pull'],
    ['Barbell Rear Delt Row', 'rear delts', 'rear-row'],
    ['Cable Rope Rear-Delt Rows', 'rear delts', 'rear-row'],
    // chest
    ['Dumbbell Bench Press', 'chest', 'press-horizontal'],
    ['Machine Chest Press', 'chest', 'press-horizontal'],
    ['Push-up', 'chest', 'press-horizontal'],
    ['Smith Machine Incline Bench Press', 'chest', 'press-incline'],
    ['Incline Dumbbell Bench With Palms Facing In', 'chest', 'press-incline'],
    ['Incline Push-up', 'chest', 'press-incline'],
    ['Decline Dumbbell Press', 'chest', 'press-decline'],
    ['Leverage Decline Chest Press', 'chest', 'press-decline'],
    ['Cable Fly', 'chest', 'fly'],
    ['Pec Deck', 'chest', 'fly'],
    ['Low Cable Crossover', 'chest', 'fly'],
    ['Incline Dumbbell Flyes', 'chest', 'fly'],
    ['Decline Dumbbell Flyes', 'chest', 'fly'],
    ['Chest Dip', 'chest', 'dip'],
    // triceps
    ['Rope Tricep Pushdown', 'triceps', 'pushdown'],
    ['Triceps Pushdown - V-Bar Attachment', 'triceps', 'pushdown'],
    ['Skull Crusher', 'triceps', 'triceps-extension'],
    ['Cable Incline Triceps Extension', 'triceps', 'triceps-extension'],
    ['Seated Triceps Press', 'triceps', 'triceps-extension'],
    ['Decline Close-Grip Bench To Skull Crusher', 'triceps', 'triceps-extension'],
    ['Close-Grip Bench Press', 'triceps', 'press-close'],
    ['JM Press', 'triceps', 'press-close'],
    ['Diamond Push-up', 'triceps', 'press-close'],
    ['Tricep Kickback', 'triceps', 'triceps-kickback'],
    ['Weighted Bench Dip', 'triceps', 'dip'],
    ['Dip Machine', 'triceps', 'dip'],
    // back
    ['Wide-Grip Lat Pulldown', 'lats', 'pulldown'],
    ['V-Bar Pulldown', 'lats', 'pulldown'],
    ['Pull-up', 'lats', 'pull-up'],
    ['Chin-up', 'biceps', 'pull-up'],
    ['Straight-Arm Pulldown', 'lats', 'pullover'],
    ['Bent-Arm Dumbbell Pullover', 'lats', 'pullover'],
    ['Cable Incline Pushdown', 'lats', 'pullover'],
    ['Seated Cable Row', 'upper back', 'row'],
    ['T-Bar Row', 'upper back', 'row'],
    ['Chest Supported Row', 'upper back', 'row'],
    ['Kneeling High Pulley Row', 'lats', 'row'],
    ['Upright Cable Row', 'traps', 'upright-row'],
    ['Dumbbell Shrug', 'upper back', 'shrug'],
    ['Clean Shrug', 'traps', 'shrug'],
    // biceps
    ['Barbell Curl', 'biceps', 'curl'],
    ['Cable Curl', 'biceps', 'curl'],
    ['Preacher Curl', 'biceps', 'preacher-curl'],
    ['Spider Curl', 'biceps', 'preacher-curl'],
    ['Standing Concentration Curl', 'biceps', 'preacher-curl'],
    ['Incline Dumbbell Curl', 'biceps', 'incline-curl'],
    ['Flexor Incline Dumbbell Curls', 'biceps', 'incline-curl'],
    ['Cross Body Hammer Curl', 'biceps', 'hammer-curl'],
    ['Zottman Curl', 'biceps', 'hammer-curl'],
    ['Reverse Cable Curl', 'biceps', 'reverse-curl'],
    ['Drag Curl', 'biceps', 'curl'],
    ['Cable Wrist Curl', 'forearms', 'wrist-curl'],
    // legs
    ['Front Squat', 'quads', 'squat'],
    ['Goblet Squat', 'quads', 'squat'],
    ['Smith Machine Squat', 'quads', 'squat'],
    ['Box Squat', 'quads', 'squat'],
    ['Leg Press', 'quads', 'leg-press'],
    ['Hack Squat', 'quads', 'leg-press'],
    ['Walking Lunge', 'quads', 'lunge'],
    ['Reverse Lunge', 'quads', 'lunge'],
    ['Step-Up', 'quads', 'lunge'],
    ['Smith Machine Split Squat', 'quads', 'lunge'],
    ['Single-Leg Leg Extension', 'quads', 'leg-extension'],
    ['Romanian Deadlift', 'hamstrings', 'hinge'],
    ['Stiff-Legged Dumbbell Deadlift', 'hamstrings', 'hinge'],
    ['Good Morning', 'hamstrings', 'hinge'],
    ['Cable Pull-Through', 'glutes', 'hinge'],
    ['Seated Leg Curl', 'hamstrings', 'leg-curl'],
    ['Nordic Hamstring Curl', 'hamstrings', 'leg-curl'],
    ['Glute Ham Raise', 'hamstrings', 'leg-curl'],
    ['Hip Thrust', 'glutes', 'hip-thrust'],
    ['Glute Bridge', 'glutes', 'hip-thrust'],
    ['Cable Kickback', 'glutes', 'glute-kickback'],
    ['Hip Abduction Machine', 'glutes', 'abduction'],
    ['Hip Adduction Machine', 'adductors', 'adduction'],
    ['Leg Press Calf Raise', 'calves', 'calf-raise'],
    ['Donkey Calf Raise', 'calves', 'calf-raise'],
    ['Reverse Hyperextension', 'glutes', 'back-extension'],
    // core
    ['Hanging Leg Raise', 'abs', 'leg-raise'],
    ['Captain\'s Chair Knee Raise', 'abs', 'leg-raise'],
    ['Decline Sit-Up', 'abs', 'crunch'],
    ['Plank', 'abs', 'plank'],
    ['Ab Wheel Rollout', 'abs', 'plank'],
    ['Russian Twist', 'abs', 'twist'],
    ['Side Plank Hip Dip', 'abs', 'plank'],
    ['Wall Sit', 'quads', 'squat'],
    // not lifts
    ['Doorway Chest Stretch', 'chest', 'mobility'],
    ["Child's Pose", 'upper back', 'mobility'],
    ['Scapular Pull-up', 'lats', 'mobility'],
    ['Burpee', 'quads', 'cardio'],
    ['Assault Bike', 'quads', 'cardio'],
    ['Jump Squat', 'quads', 'jump'],
    ['Explosive Push-up', 'chest', 'jump'],
    ['Power Clean', 'full body', 'olympic'],
    ['Kettlebell Turkish Get-Up (Squat style)', 'shoulders', 'strongman'],
    ['Sled Push', 'quads', 'strongman'],
    ['Farmer Carry', 'forearms', 'carry'],
    ['Neck Curl (Plate)', 'neck', 'neck'],
  ];

  it.each(TABLE)('%s (%s) is %s', (name, group, pattern) => {
    expect(movementPattern(name, group)).toBe(pattern);
  });

  it('reads the same name the same way whatever its case, punctuation or spacing', () => {
    expect(movementPattern('LATERAL  RAISE', 'shoulders')).toBe('lateral-raise');
    expect(movementPattern('lateral-raise', 'shoulders')).toBe('lateral-raise');
    expect(movementPattern("Child’s Pose", 'upper back')).toBe('mobility');
  });

  it('gives an unplaceable name the muscle group it was filed under, and nothing else', () => {
    for (const group of MUSCLE_GROUPS) {
      expect(movementPattern('Zxqv Mmmm', group)).toBe(group);
      expect(movementPattern('', group)).toBe(group);
    }
  });

  it('never throws on odd input', () => {
    for (const name of ['\u0000', '💪', 'x'.repeat(20000), '(((', undefined as unknown as string, 42 as unknown as string]) {
      expect(() => movementPattern(name, 'chest')).not.toThrow();
    }
  });

  it('a group-bound rule does not leak across groups: the same words in another group are read for that group', () => {
    // "Press" under chest is a bench, under shoulders it is vertical, under triceps it is a close-grip press.
    expect(movementPattern('Neutral Grip Press', 'chest')).toBe('press-horizontal');
    expect(movementPattern('Neutral Grip Press', 'shoulders')).toBe('press-vertical');
    expect(movementPattern('Neutral Grip Press', 'triceps')).toBe('press-close');
    // "Lateral" in a leg exercise is not a lateral raise.
    expect(movementPattern('Dumbbell Lateral Lunge', 'quads')).toBe('lunge');
    expect(movementPattern('Side-Lying Leg Raise', 'glutes')).toBe('abduction');
  });
});

describe('movementPattern over the whole library', () => {
  it(`reads all ${LIBRARY.length} names: a key of the vocabulary, or the muscle group they were filed under`, () => {
    expect(LIBRARY.length).toBeGreaterThan(800);
    for (const n of LIBRARY) {
      const p = patternOf(n);
      expect(p === n.group || MOVEMENT_PATTERNS.includes(p), `${n.name} (${n.group}) -> ${p}`).toBe(true);
    }
  });

  it('is the same on a second reading', () => {
    for (const n of LIBRARY) expect(movementPattern(n.name, n.group)).toBe(patternOf(n));
  });

  it('every stretch is mobility and every non-lift key is one the builder leaves out', () => {
    for (const n of LIBRARY.filter((x) => /stretch/i.test(x.name))) expect(patternOf(n), n.name).toBe('mobility');
    for (const key of ['mobility', 'cardio', 'jump', 'carry', 'strongman', 'olympic', 'rotation']) expect(NON_ROUTINE_PATTERNS.has(key), key).toBe(true);
    for (const key of ['press-vertical', 'row', 'squat', 'curl', 'lateral-raise']) expect(NON_ROUTINE_PATTERNS.has(key), key).toBe(false);
  });

  it('a lateral raise under the shoulders is a lateral raise or, said of the rear, a rear fly; never a press or a row', () => {
    for (const n of LIBRARY.filter((x) => x.group === 'shoulders' && /lateral raise/i.test(x.name))) {
      expect(['lateral-raise', 'rear-fly'], n.name).toContain(patternOf(n));
    }
  });

  it('every curl under the biceps is a curl of some kind, except the chins and pull-ups filed there', () => {
    const curls = ['curl', 'incline-curl', 'preacher-curl', 'hammer-curl', 'reverse-curl'];
    for (const n of LIBRARY.filter((x) => x.group === 'biceps' && /curl/i.test(x.name))) expect(curls, n.name).toContain(patternOf(n));
  });

  it('nothing filed under the chest is a vertical press, and nothing under the shoulders is a horizontal one', () => {
    for (const n of LIBRARY.filter((x) => x.group === 'chest')) expect(patternOf(n), n.name).not.toBe('press-vertical');
    for (const n of LIBRARY.filter((x) => x.group === 'shoulders')) expect(['press-horizontal', 'press-incline', 'press-decline'], n.name).not.toContain(patternOf(n));
  });

  it('a hinge is named for one: a deadlift, a good morning, a swing, a pull-through or a rack pull', () => {
    for (const n of LIBRARY.filter((x) => patternOf(x) === 'hinge')) {
      expect(/deadlift|romanian|rdl|stiff|good morning|rack pull|pull.?through|swing/i.test(n.name), n.name).toBe(true);
    }
    for (const n of LIBRARY.filter((x) => /deadlift/i.test(x.name) && !/axle|car deadlift/i.test(x.name))) expect(patternOf(n), n.name).toBe('hinge');
  });

  it('every leg curl is a leg curl and every calf raise a calf raise', () => {
    for (const n of LIBRARY.filter((x) => /leg curl/i.test(x.name))) expect(patternOf(n), n.name).toBe('leg-curl');
    for (const n of LIBRARY.filter((x) => /calf raise/i.test(x.name) && x.group === 'calves')) expect(patternOf(n), n.name).toBe('calf-raise');
  });

  it('every shrug is a shrug and every upright row an upright row', () => {
    for (const n of LIBRARY.filter((x) => /shrug/i.test(x.name))) expect(patternOf(n), n.name).toBe('shrug');
    for (const n of LIBRARY.filter((x) => /upright (cable )?row/i.test(x.name))) expect(patternOf(n), n.name).toBe('upright-row');
  });

  it('every pulldown is a pulldown or a straight-arm pullover; every pull-up a pull-up', () => {
    for (const n of LIBRARY.filter((x) => /pulldown/i.test(x.name) && x.group === 'lats')) expect(['pulldown', 'pullover'], n.name).toContain(patternOf(n));
    for (const n of LIBRARY.filter((x) => /pull-?up|chin-?up/i.test(x.name) && !/scapular|rocky/i.test(x.name))) expect(patternOf(n), n.name).toBe('pull-up');
  });

  describe('how much of the library falls back to the muscle group', () => {
    const groups = [...new Set(LIBRARY.map((n) => n.group))].sort();
    const share = (rows: Named[]) => rows.filter((n) => patternOf(n) === n.group).length;

    it('is a small minority overall and in every muscle that a routine is built from', () => {
      const lines = groups.map((g) => {
        const rows = LIBRARY.filter((n) => n.group === g);
        return `${g}: ${share(rows)} of ${rows.length}`;
      });
      // The share, per muscle, as a record of what the rules do not know.
      console.info(`Fall back to the muscle group, per muscle:\n  ${lines.join('\n  ')}\n  all: ${share(LIBRARY)} of ${LIBRARY.length}`);
      expect(share(LIBRARY) / LIBRARY.length).toBeLessThan(0.04);
      const built: MuscleGroup[] = ['chest', 'shoulders', 'rear delts', 'lats', 'upper back', 'traps', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves'];
      for (const g of built) {
        const rows = LIBRARY.filter((n) => n.group === g);
        expect(share(rows) / rows.length, g).toBeLessThan(0.05);
      }
    });

    it('is zero for every exercise the app already carries but the neck', () => {
      for (const n of LIBRARY.filter((x) => x.source === 'seed' && x.group !== 'neck')) expect(patternOf(n), n.name).not.toBe(n.group);
    });
  });
});

describe('regionOf', () => {
  it.each([
    ['DB Shoulder Press', 'shoulders', 'shoulders:front'],
    ['Front Raise', 'shoulders', 'shoulders:front'],
    ['Lateral Raise', 'shoulders', 'shoulders:side'],
    ['Upright Row', 'shoulders', 'shoulders:side'],
    ['Rear Delt Fly (Machine)', 'rear delts', 'shoulders:rear'],
    ['Face Pull', 'rear delts', 'shoulders:rear'],
    ['Face Pull', 'upper back', 'shoulders:rear'],
    ['Bench Press (Barbell)', 'chest', 'chest:mid'],
    ['Incline DB Press', 'chest', 'chest:upper'],
    ['Pec Deck', 'chest', 'chest:fly'],
    ['Decline Bench Press', 'chest', 'chest:lower'],
    ['Chest Dip', 'chest', 'chest:lower'],
    ['Dip', 'triceps', 'triceps:compound'],
    ['Lat Pulldown (Machine)', 'lats', 'back:vertical'],
    ['Chin-up', 'biceps', 'back:vertical'],
    ['Iso-Lateral Row (Machine)', 'upper back', 'back:horizontal'],
    ['Heavy DB Shrugs', 'traps', 'back:traps'],
    ['Incline DB Curl', 'biceps', 'biceps:long'],
    ['Preacher Curl', 'biceps', 'biceps:short'],
    ['DB Curl', 'biceps', 'biceps:short'],
    ['Hammer Curl', 'biceps', 'biceps:brachialis'],
    ['Overhead Triceps Extension', 'triceps', 'triceps:long'],
    ['Triceps Pushdown', 'triceps', 'triceps:lateral'],
    ['Close-Grip Bench Press', 'triceps', 'triceps:compound'],
    ['Barbell Back Squat', 'quads', 'quads:bilateral'],
    ['Leg Press', 'quads', 'quads:bilateral'],
    ['Bulgarian Split Squat', 'quads', 'quads:single'],
    ['Leg Extension', 'quads', 'quads:isolation'],
    ['Romanian Deadlift (Barbell)', 'hamstrings', 'hamstrings:hinge'],
    ['Lying Leg Curl (Machine)', 'hamstrings', 'hamstrings:flexion'],
    ['Hip Thrust (Barbell)', 'glutes', 'glutes:thrust'],
    ['Hip Abduction Machine', 'glutes', 'glutes:abduction'],
    ['Standing Calf Raise', 'calves', 'calves:standing'],
    ['Seated Calf Raise', 'calves', 'calves:seated'],
    ['Barbell Seated Calf Raise', 'calves', 'calves:seated'],
    ['Cable Crunch', 'abs', 'abs:crunch'],
    ['Back Extension', 'lower back', 'lowerback:extension'],
    ['Hip Adductor (Machine)', 'adductors', 'adductors:adduction'],
  ] as const)('%s (%s) reaches %s', (name, group, region) => {
    expect(regionOf(name, group)).toBe(region);
  });

  it('a movement with no region reaches none', () => {
    expect(regionOf('Neck', 'neck')).toBeNull();
    expect(regionOf('Plank', 'chest')).toBe('abs:brace');
    expect(regionOf('Burpee', 'quads')).toBeNull();
    expect(regionOf('Zxqv Mmmm', 'chest')).toBeNull();
  });

  it('every region a library name reaches has words, and a muscle that lists it', () => {
    const listed = new Set(Object.values(MUSCLE_REGIONS).flatMap((r) => r ?? []));
    const reached = new Set<string>();
    for (const n of LIBRARY) {
      const r = regionOf(n.name, n.group);
      if (r) reached.add(r);
    }
    for (const r of reached) {
      expect(REGION_LABELS[r], r).toBeTruthy();
      expect(listed.has(r), r).toBe(true);
    }
    for (const r of listed) expect(REGION_LABELS[r], r).toBeTruthy();
  });

  it('every routine movement has words, and a key with none names itself', () => {
    const lifts = MOVEMENT_PATTERNS.filter((p) => !NON_ROUTINE_PATTERNS.has(p));
    for (const p of lifts) expect(PATTERN_LABELS[p], p).toBeTruthy();
    expect(patternLabel('lateral-raise')).toBe('lateral raise');
    expect(patternLabel('neck')).toBe('neck');
  });
});
