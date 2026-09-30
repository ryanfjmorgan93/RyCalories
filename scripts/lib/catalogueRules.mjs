/**
 * What scripts/build-exercise-catalogue.mjs keeps out beyond what name matching finds, and the
 * limits it holds itself to. Kept apart from the script so src/data/catalogue.test.ts can read the
 * same lists and prove none of these names came back.
 *
 * Every name is the dataset's own, verbatim. The script throws if one is no longer in the dataset,
 * so a change upstream cannot quietly turn an exclusion into a no-op.
 */

/** Total bytes of every committed frame. The script exits non-zero above it. */
export const FRAME_BUDGET_BYTES = 8 * 1024 * 1024;

/** Frame width in px; the height follows the photo's 3:2 shape. */
export const FRAME_WIDTH = 320;

/**
 * Entries that are the same exercise as one the app already has, which the name matcher cannot see
 * because the two sources word it differently. `[dataset name, the app exercise it repeats]`.
 */
export const REVIEWED_DUPLICATES = [
  ['Ab Roller', 'Ab Wheel Rollout (Bodyweight)'],
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
  ['Cable Hammer Curls - Rope Attachment', 'Rope Hammer Curl (Cable)'],
  ['Cable Rope Overhead Triceps Extension', 'Overhead Triceps Extension (seed)'],
  ['Calf Press On The Leg Press Machine', 'Leg Press Calf Raise (Machine)'],
  ['Close-Grip Front Lat Pulldown', 'Close-Grip Lat Pulldown (Cable)'],
  ['Decline Dumbbell Bench Press', 'Decline Dumbbell Press (Dumbbell)'],
  ['Dips - Chest Version', 'Chest Dip (Bodyweight)'],
  ['Dips - Triceps Version', 'Dip (Bodyweight)'],
  ['Dumbbell Alternate Bicep Curl', 'Bicep Curl (Dumbbell)'],
  ['Dumbbell One-Arm Triceps Extension', 'Single Arm Dumbbell Tricep Extension (Dumbbell)'],
  ['Dumbbell Rear Lunge', 'Reverse Lunge (Dumbbell)'],
  ['EZ-Bar Skullcrusher', 'Skull Crusher (Barbell)'],
  ['Freehand Jump Squat', 'Jump Squat (Bodyweight)'],
  ['Front Squat (Clean Grip)', 'Front Squat (Barbell)'],
  ['Glute Kickback', 'Donkey Kick (Bodyweight)'],
  ['Leverage Chest Press', 'Machine Chest Press (Machine)'],
  ['Leverage Iso Row', 'Iso-Lateral Row (Machine) (seed)'],
  ['Leverage Shoulder Press', 'Machine Shoulder Press (Machine)'],
  ['Lying Face Down Plate Neck Resistance', 'Neck (seed): Neck Extension (Weighted)'],
  ['Lying Face Up Plate Neck Resistance', 'Neck (seed): Lying Neck Curls (Weighted)'],
  ['Machine Bench Press', 'Machine Chest Press (Machine)'],
  ['Machine Shoulder (Military) Press', 'Machine Shoulder Press (Machine)'],
  ['Parallel Bar Dip', 'Dip (Bodyweight)'],
  ['Push-Ups - Close Triceps Position', 'Diamond Push-up (Bodyweight)'],
  ['Rope Crunch', 'Cable Crunch (Cable)'],
  ['Seated Dumbbell Press', 'Dumbbell Seated Shoulder Press (Dumbbell)'],
  ['Side Bridge', 'Side Plank (Bodyweight)'],
  ['Side Lateral Raise', 'Lateral Raise (Dumbbell)'],
  ['Split Squat with Dumbbells', 'Split Squat (Dumbbell)'],
  ['Standing Biceps Cable Curl', 'Cable Curl (Cable)'],
  ['Standing Military Press', 'Overhead Press (Barbell)'],
  ['T-Bar Row with Handle', 'T-Bar Row (Machine)'],
  ['Thigh Abductor', 'Hip Abduction Machine (Machine)'],
  ['Thigh Adductor', 'Hip Adductor (Machine) (seed)'],
  ['Triceps Overhead Extension with Rope', 'Overhead Triceps Extension (seed)'],
  ['Triceps Pushdown - Rope Attachment', 'Rope Tricep Pushdown (Cable)'],
];

/** Movements that are not a set of reps to log: sprinting and balance work sit in the dataset's strength category. */
export const NOT_LIFTING = ['Balance Board', 'Lunge Sprint', 'Wind Sprints'];
