/**
 * What scripts/build-exercise-catalogue.mjs keeps out beyond what name matching finds, and the
 * limits it holds itself to. Kept apart from the script so src/data/catalogue.test.ts can read the
 * same lists and prove none of these names came back.
 *
 * Every name is the dataset's own, verbatim. The script throws if one is no longer in the dataset,
 * so a change upstream cannot quietly turn an exclusion or an override into a no-op.
 *
 * An entry that repeats another listed here is named by what it repeats: "(seed)" for a seeded
 * exercise, "(catalogue)" for another entry of the catalogue itself, otherwise a bundled demo.
 */

/** Total bytes of every committed frame. The script exits non-zero above it. */
export const FRAME_BUDGET_BYTES = 8 * 1024 * 1024;

/** Frame width in px. The height follows the photo, which is 3:2 for nine in ten and portrait or 16:9 for the rest; the app letterboxes rather than crops. */
export const FRAME_WIDTH = 320;

/**
 * Entries that are the same exercise as one the app already has, which the name matcher cannot see
 * because the two sources word it differently. `[dataset name, the app exercise it repeats]`.
 */
export const REVIEWED_DUPLICATES = [
  ['Ab Roller', 'Ab Wheel Rollout (Bodyweight)'],
  ['Alternate Hammer Curl', 'Hammer Curl (seed)'],
  ['Alternate Heel Touchers', 'Heel Tap (Bodyweight)'],
  ['Alternate Incline Dumbbell Curl', 'Incline DB Curl (seed)'],
  ['Ball Leg Curl', 'Stability Ball Hamstring Curl'],
  ['Barbell Bench Press - Medium Grip', 'Bench Press (Barbell)'],
  ['Barbell Full Squat', 'Squat (Barbell)'],
  ['Barbell Incline Bench Press - Medium Grip', 'Incline Bench Press (Barbell)'],
  ['Barbell Shoulder Press', 'Overhead Press (Barbell)'],
  ['Battling Ropes', 'Battle Ropes (Cardio)'],
  ['Bent Over Barbell Row', 'Barbell Row (Barbell)'],
  ['Bent Over Dumbbell Rear Delt Raise With Head On Bench', 'Bent-Over Rear Delt Raise (Dumbbell)'],
  ['Bent Over Two-Dumbbell Row', 'Dumbbell Bent Over Row (Dumbbell)'],
  ['Butt Lift (Bridge)', 'Glute Bridge (Bodyweight)'],
  ['Butterfly', 'Pec Deck (Machine)'],
  ['Cable Crossover', 'Cable Fly (Cable)'],
  ['Cable Hammer Curls - Rope Attachment', 'Rope Hammer Curl (Cable)'],
  ['Cable Hip Adduction', 'Cable Standing Hip Adduction (Cable)'],
  ['Cable Rope Overhead Triceps Extension', 'Overhead Triceps Extension (seed)'],
  ['Calf Press On The Leg Press Machine', 'Leg Press Calf Raise (Machine)'],
  ['Close-Grip Front Lat Pulldown', 'Close-Grip Lat Pulldown (Cable)'],
  ['Decline Dumbbell Bench Press', 'Decline Dumbbell Press (Dumbbell)'],
  ['Decline Smith Press', 'Smith Machine Decline Press (catalogue)'],
  ['Dips - Chest Version', 'Chest Dip (Bodyweight)'],
  ['Dips - Triceps Version', 'Dip (Bodyweight)'],
  ['Dumbbell Alternate Bicep Curl', 'Bicep Curl (Dumbbell)'],
  ['Dumbbell One-Arm Triceps Extension', 'Single Arm Dumbbell Tricep Extension (Dumbbell)'],
  ['Dumbbell Rear Lunge', 'Reverse Lunge (Dumbbell)'],
  ['EZ-Bar Skullcrusher', 'Skull Crusher (Barbell)'],
  ['Flat Bench Lying Leg Raise', 'Lying Leg Raise (Bodyweight)'],
  ['Freehand Jump Squat', 'Jump Squat (Bodyweight)'],
  ['Front Squat (Clean Grip)', 'Front Squat (Barbell)'],
  ['Glute Kickback', 'Donkey Kick (Bodyweight)'],
  ['Incline Push-Up Medium', 'Incline Push-up (Bodyweight)'],
  ['Knee/Hip Raise On Parallel Bars', "Captain's Chair Knee Raise (Machine)"],
  ['Leverage Chest Press', 'Machine Chest Press (Machine)'],
  ['Leverage Iso Row', 'Iso-Lateral Row (Machine) (seed)'],
  ['Leverage Shoulder Press', 'Machine Shoulder Press (Machine)'],
  ['Lying Dumbbell Tricep Extension', 'Two Dumbbell Skullcrusher (Dumbbell)'],
  ['Lying Face Down Plate Neck Resistance', 'Neck (seed): Neck Extension (Weighted)'],
  ['Lying Face Up Plate Neck Resistance', 'Neck (seed): Lying Neck Curls (Weighted)'],
  ['Lying Triceps Press', 'Skull Crusher (Barbell)'],
  ['Machine Bench Press', 'Machine Chest Press (Machine)'],
  ['Machine Shoulder (Military) Press', 'Machine Shoulder Press (Machine)'],
  ['Monster Walk', 'Banded Monster Walk (Resistance Band)'],
  ['Parallel Bar Dip', 'Dip (Bodyweight)'],
  ['Plie Dumbbell Squat', 'Dumbbell Sumo Squat (Dumbbell)'],
  ['Push-Ups - Close Triceps Position', 'Diamond Push-up (Bodyweight)'],
  ['Push-Ups With Feet Elevated', 'Decline Push-up (Bodyweight)'],
  ['Rope Crunch', 'Cable Crunch (Cable)'],
  ['Seated Dumbbell Press', 'Dumbbell Seated Shoulder Press (Dumbbell)'],
  ['Seated Leg Tucks', 'Seated Knee Tuck (Bodyweight)'],
  ['Side Bridge', 'Side Plank (Bodyweight)'],
  ['Side Lateral Raise', 'Lateral Raise (Dumbbell)'],
  ['Smith Machine Calf Raise', 'Standing Calf Raise (Smith Machine) (seed)'],
  ['Smith Single-Leg Split Squat', 'Smith Machine Split Squat (Machine)'],
  ['Split Squat with Dumbbells', 'Split Squat (Dumbbell)'],
  ['Squat with Bands', 'Squats - With Bands (catalogue)'],
  ['Standing Biceps Cable Curl', 'Cable Curl (Cable)'],
  ['Standing Cable Wood Chop', 'Cable Woodchop (Cable)'],
  ['Standing Military Press', 'Overhead Press (Barbell)'],
  ['Standing One-Arm Dumbbell Triceps Extension', 'Single Arm Dumbbell Tricep Extension (Dumbbell)'],
  ['T-Bar Row with Handle', 'T-Bar Row (Machine)'],
  ['Thigh Abductor', 'Hip Abduction Machine (Machine)'],
  ['Thigh Adductor', 'Hip Adductor (Machine) (seed)'],
  ['Triceps Overhead Extension with Rope', 'Overhead Triceps Extension (seed)'],
  ['Triceps Pushdown - Rope Attachment', 'Rope Tricep Pushdown (Cable)'],
];

/** Movements that are not a set of reps to log: sprinting and balance work sit in the dataset's strength category. */
export const NOT_LIFTING = ['Balance Board', 'Lunge Sprint', 'Wind Sprints'];

const under = (group, names) => names.map((name) => [name, group]);

/** An object from `[name, group]` pairs; a name listed twice (under two groups) is a mistake, not a choice. */
function overrideMap(pairs) {
  const map = {};
  for (const [name, group] of pairs) {
    if (Object.hasOwn(map, name)) throw new Error(`scripts/lib/catalogueRules.mjs files "${name}" twice in MUSCLE_OVERRIDES.`);
    map[name] = group;
  }
  return map;
}

/**
 * Entries whose muscle group the dataset gets wrong or files inconsistently, by the dataset's name
 * and the group the app files them under. The dataset copies one primary muscle per entry with no
 * rule behind it, so the powerlifting bench variants are "triceps", Hang Clean is "quadriceps" and
 * Clean is "hamstrings". The app's own convention (src/db/hevy.ts guessMuscle) is what these follow:
 * bench, floor, board and pin presses are chest, deadlifts are lower back (the Romanian and
 * stiff-legged hinges stay hamstrings), pullovers are lats, hip adduction is adductors, and the
 * clean, snatch and jerk families are "full body" as a farmer's carry is. The shrugs stay traps and
 * the bottoms-up clean stays forearms: they train one thing.
 *
 * Only the entries that differ from what the dataset's own muscle would give are listed. Close-grip
 * bench presses, the JM press and the skull crushers are triceps work and are left alone.
 */
export const MUSCLE_OVERRIDES = overrideMap([
  ...under('chest', [
    'Bench Press - Powerlifting',
    'Bench Press with Chains',
    'Board Press',
    'Dumbbell Floor Press',
    'Floor Press',
    'Floor Press with Chains',
    'One Arm Floor Press',
    'Pin Presses',
    'Reverse Band Bench Press',
  ]),
  ...under('adductors', ['Cable Hip Adduction']),
  ...under('lower back', [
    'Cable Deadlifts',
    'Car Deadlift',
    'Clean Deadlift',
    'Leverage Deadlift',
    'One-Arm Side Deadlift',
    'Reverse Band Sumo Deadlift',
    'Rickshaw Deadlift',
    'Snatch Deadlift',
    'Sumo Deadlift with Bands',
    'Sumo Deadlift with Chains',
  ]),
  ...under('lats', ['Bent-Arm Dumbbell Pullover', 'Front Raise And Pullover', 'Straight-Arm Dumbbell Pullover', 'Wide-Grip Decline Barbell Pullover']),
  ...under('full body', [
    'Alternating Hang Clean',
    'Clean',
    'Clean and Jerk',
    'Clean and Press',
    'Clean from Blocks',
    'Clean Pull',
    'Double Kettlebell Alternating Hang Clean',
    'Double Kettlebell Jerk',
    'Double Kettlebell Snatch',
    'Dumbbell Clean',
    'Hang Clean',
    'Hang Clean - Below the Knees',
    'Hang Snatch',
    'Hang Snatch - Below Knees',
    'Heaving Snatch Balance',
    'Jerk Balance',
    'Jerk Dip Squat',
    'Kettlebell Dead Clean',
    'Kettlebell Hang Clean',
    'Muscle Snatch',
    'One-Arm Kettlebell Clean',
    'One-Arm Kettlebell Clean and Jerk',
    'One-Arm Kettlebell Jerk',
    'One-Arm Kettlebell Snatch',
    'One-Arm Kettlebell Split Jerk',
    'One-Arm Kettlebell Split Snatch',
    'One-Arm Open Palm Kettlebell Clean',
    'Open Palm Kettlebell Clean',
    'Power Clean',
    'Power Clean from Blocks',
    'Power Jerk',
    'Power Snatch',
    'Power Snatch from Blocks',
    'Smith Machine Hang Power Clean',
    'Snatch',
    'Snatch Balance',
    'Snatch from Blocks',
    'Snatch Pull',
    'Split Clean',
    'Split Jerk',
    'Split Snatch',
    'Squat Jerk',
    'Two-Arm Kettlebell Clean',
    'Two-Arm Kettlebell Jerk',
  ]),
]);

/**
 * Entries the dataset calls compound that are one joint: a curl, a raise and the two rotator-cuff
 * rotations. (The other half of this rule is in mapEntry.mjs: body-only abdominal work is never
 * compound.) Dataset names, verbatim.
 */
export const ISOLATION_OVERRIDES = ['Cable Internal Rotation', 'Dumbbell Raise', 'External Rotation with Band', 'High Cable Curls'];
