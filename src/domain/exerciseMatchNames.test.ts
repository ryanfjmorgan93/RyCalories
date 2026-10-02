import { describe, expect, it } from 'vitest';
import { loadCatalogue } from '@/data/catalogue';
import { EXERCISE_DEMOS } from '@/data/exerciseDemos';
import { SEED_EXERCISES } from '@/db/seed';
import { COMMON_EXERCISE_NAMES, matchExercise, normaliseName, type MatchCandidate } from './exerciseMatch';
import { buildExerciseList } from './library';

/**
 * The matcher over forty-odd names written the way people type them, against the real seed, the
 * real diagrams and the real catalogue. What each line should be was read from the pool's own
 * listing, not from the matcher's answers: a plural, a joined or hyphenated word, an abbreviation,
 * never changes which exercise it is, and a common name is never taken for an obscure one that
 * happens to share its words ('Pull-ups' is not 'Rocky Pull-Ups/Pulldowns').
 */
const owned = SEED_EXERCISES.map((e) => ({ ...e, createdAt: '2026-01-01T00:00:00.000Z' }));

async function pool() {
  const rows = buildExerciseList({ owned, demos: EXERCISE_DEMOS, entries: await loadCatalogue() });
  return { rows, candidates: rows.map((r): MatchCandidate => ({ id: r.key, name: r.name, aliases: r.exercise?.aliases, library: !r.owned })) };
}

/** The id of the owner's exercise with this name. */
const own = (name: string) => SEED_EXERCISES.find((e) => e.name === name)!.id;

const OBVIOUS: [typed: string, expected: string][] = [
  ['Pull ups', 'pull-up'],
  ['Pull-ups', 'pull-up'],
  ['Pullups', 'pull-up'],
  ['Chin ups', 'chin-up'],
  ['Chin-ups', 'chin-up'],
  ['Dips', 'dip'],
  ['Push ups', 'push-up'],
  ['Push-ups', 'push-up'],
  ['Press ups', 'push-up'],
  ['Step ups', 'step-up'],
  ['Planks', 'plank'],
  ['Crunches', 'crunch'],
  ['Dumbbell flyes', 'dumbbell-fly'],
  ['Cable flys', 'cable-fly'],
  ['Rear delt flyes', own('Rear Delt Fly (Machine)')],
  ['Farmer carries', own("Farmer's Carry")],
  ['Face pulls', own('Face Pull')],
  ['Lateral raises', own('Lateral Raise')],
  ['Front raises', 'front-raise'],
  ['Calf raises', 'calf-raise'],
  ['Hanging leg raises', 'hanging-leg-raise'],
  ['Skull crushers', 'skull-crusher'],
  ['Upright rows', 'upright-row'],
  ['Barbell rows', 'barbell-row'],
  ['Cable rows', 'seated-row'],
  ['Good mornings', 'good-morning'],
  ['Goblet squats', 'goblet-squat'],
  ['Front squats', 'front-squat'],
  ['Walking lunges', 'walking-lunge'],
  ['Deadlifts', 'deadlift'],
  ['Romanian deadlifts', own('Romanian Deadlift (Barbell)')],
  ['Hip thrusts', own('Hip Thrust (Barbell)')],
  ['Glute bridges', 'glute-bridge'],
  ['Leg extensions', own('Leg Extension')],
  ['Lat pulldowns', own('Lat Pulldown (Machine)')],
  ['Hammer curls', own('Hammer Curl')],
  ['Preacher curls', 'preacher-curl'],
  ['EZ bar curls', 'ez-bar-curl'],
  ['Tricep pushdowns', own('Triceps Pushdown')],
  ['Biceps curls', own('DB Curl')],
  ['Shrugs', own('Heavy DB Shrugs')],
  ['Arnold presses', 'arnold-press'],
  ['Incline dumbbell presses', own('Incline DB Press')],
  ['Bench presses', own('Bench Press (Barbell)')],
  ['Seated calf raises', own('Seated Calf Raise')],
];

describe('matchExercise over common gym names, written the way people type them', () => {
  it('has at least forty lines, so a regression in a plural or a hyphen cannot hide in a short list', () => {
    expect(OBVIOUS.length).toBeGreaterThanOrEqual(40);
  });

  it.each(OBVIOUS)('"%s" is the obvious entry', async (typed, expected) => {
    const { rows, candidates } = await pool();
    const m = matchExercise(typed, candidates);
    const got = m ? rows.find((r) => r.key === m.id)!.name : null;
    expect(m?.id, `${typed} matched ${got}`).toBe(expected);
  });

  it('a plural, hyphenated or joined spelling reaches the same entry as the singular', async () => {
    const { candidates } = await pool();
    for (const [plain, plural] of [
      ['Pull-up', 'Pull ups'],
      ['Chin-up', 'Chin ups'],
      ['Push-up', 'Pushups'],
      ['Step-Up', 'Step ups'],
      ['Dip', 'Dips'],
      ['Crunch', 'Crunches'],
      ['Dumbbell Fly', 'Dumbbell Flyes'],
    ] as const) {
      const want = matchExercise(plain, candidates)?.id;
      expect(want, plain).toBeDefined();
      expect(matchExercise(plural, candidates)?.id, plural).toBe(want);
    }
  });

  it('a bare plural is never taken for an obscure entry that merely contains its words', async () => {
    const { rows, candidates } = await pool();
    const obscure = /rocky|commando|l-sit|v-bar|jerk|negative|scapular|towel|meadows|sled|shotgun|doorway|t-bar/i;
    for (const typed of ['Pull ups', 'Pull-ups', 'Chin ups', 'Dips', 'Rows', 'Row', 'Lunges', 'Presses', 'Curls', 'Raises', 'Flyes', 'Squats']) {
      const m = matchExercise(typed, candidates);
      if (m) expect(rows.find((r) => r.key === m.id)!.name, typed).not.toMatch(obscure);
    }
  });

  it('"Rows" is the owner\'s own row when they have one: their machine row carries "Seated Row (Machine)", and at the same score theirs beats the library\'s', async () => {
    const { candidates } = await pool();
    expect(matchExercise('Rows', candidates)?.id).toBe(own('Iso-Lateral Row (Machine)'));
  });
});

describe('matchExercise over the library alone, where nothing is the owner\'s', () => {
  const library = async () => {
    const rows = buildExerciseList({ owned: [], demos: EXERCISE_DEMOS, entries: await loadCatalogue() });
    return { rows, candidates: rows.map((r): MatchCandidate => ({ id: r.key, name: r.name, library: true })) };
  };
  const nameOf = (rows: { key: string; name: string }[], id: string | undefined) => rows.find((r) => r.key === id)?.name;

  it('entries that answer equally well are told apart by which is the common one', async () => {
    const { rows, candidates } = await library();
    // Seated, Upright and Elevated Cable Row all answer "Cable rows" equally well; only one is meant.
    expect(nameOf(rows, matchExercise('Cable rows', candidates)?.id)).toBe('Seated Cable Row');
    expect(nameOf(rows, matchExercise('Pulldowns', candidates)?.id)).toBe('Lat Pulldown');
  });

  it('and left for the owner to choose when several are common ("Rows" is a Barbell, a T-Bar and an Upright Row)', async () => {
    const { candidates } = await library();
    for (const typed of ['Rows', 'Press', 'Curl', 'Raise', 'Flyes']) expect(matchExercise(typed, candidates), typed).toBeNull();
  });

  it('every name on the common list is a real library entry, so the list cannot go stale unseen', async () => {
    const { rows } = await library();
    const have = new Set(rows.map((r) => normaliseName(r.name)));
    for (const name of COMMON_EXERCISE_NAMES) expect(have.has(normaliseName(name)), name).toBe(true);
  });
});
