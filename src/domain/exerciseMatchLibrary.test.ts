import { describe, expect, it } from 'vitest';
import { loadCatalogue } from '@/data/catalogue';
import { EXERCISE_DEMOS } from '@/data/exerciseDemos';
import { SEED_EXERCISES } from '@/db/seed';
import { matchExercise, type MatchCandidate } from './exerciseMatch';
import { buildExerciseList, type ExerciseListRow } from './library';

const mine = (id: string, name: string, aliases?: string[]): MatchCandidate => ({ id, name, aliases });
const lib = (id: string, name: string): MatchCandidate => ({ id, name, library: true });

describe('matchExercise over the owner\'s exercises and the library', () => {
  it('matches a name only the library has, exactly', () => {
    expect(matchExercise('Cable Lateral Raise', [mine('a', 'Bench Press'), lib('cat:cable-lateral-raise', 'Cable Lateral Raise')])).toEqual({
      id: 'cat:cable-lateral-raise',
      score: 1,
      via: 'exact',
    });
  });

  it('matches a library name worded differently, as a fuzzy answer the owner confirms', () => {
    const close = matchExercise('Lateral raise cable', [mine('a', 'Bench Press'), lib('cat:cable-lateral-raise', 'Cable Lateral Raise')]);
    expect(close?.id).toBe('cat:cable-lateral-raise');
    expect(close?.via).toBe('fuzzy');
  });

  it('matches nothing when neither the owner\'s exercises nor the library come near', () => {
    expect(matchExercise('Zzz Qqq', [mine('a', 'Bench Press'), lib('cat:cable-lateral-raise', 'Cable Lateral Raise')])).toBeNull();
  });

  it('an exercise of the owner\'s wins an exact tie with a library entry, whichever comes first', () => {
    const candidates = [lib('cat:lateral-raise', 'Lateral Raise'), mine('own', 'Lateral Raise')];
    expect(matchExercise('lateral raise', candidates)?.id).toBe('own');
    expect(matchExercise('lateral raise', [...candidates].reverse())?.id).toBe('own');
  });

  it('their alias, matched exactly, wins over a library entry\'s own name', () => {
    const candidates = [lib('cat:chest-supported-row', 'Chest Supported Row'), mine('own', 'Iso-Lateral Row', ['Chest Supported Row'])];
    expect(matchExercise('Chest-supported row', candidates)?.id).toBe('own');
  });

  it('an exercise of the owner\'s wins a fuzzy tie with a library entry instead of leaving the line unmatched', () => {
    // "db" and "dumbbell" are the same word to the matcher, so these two answer equally well.
    const candidates = [lib('cat:seated-dumbbell-shoulder-press', 'Seated Dumbbell Shoulder Press'), mine('own', 'Seated DB Shoulder Press')];
    // Exact on own name would be the exact pass; ask for something that is a tie only by score.
    const m = matchExercise('Dumbbell shoulder press seated', candidates);
    expect(m?.id).toBe('own');
    expect(m?.via).toBe('fuzzy');
  });

  it('a library entry that is a better answer than an owned one still wins', () => {
    const candidates = [mine('own', 'Lateral Raise Machine'), lib('cat:cable-lateral-raise', 'Cable Lateral Raise')];
    expect(matchExercise('Cable Lateral Raise', candidates)?.id).toBe('cat:cable-lateral-raise');
  });

  it('two library entries that answer equally well, neither a common name, are still no match, left for the owner to choose', () => {
    // Changed from 'Chest Press' against 'Leg Press': 'Leg Press' is the common name among library
    // entries that tie, and now settles the line (see the next test). The premise here, that two
    // equally good answers with nothing to choose between them are not guessed, is unchanged.
    expect(matchExercise('Press', [lib('cat:a', 'Chest Press'), lib('cat:b', 'Landmine Press')])).toBeNull();
  });

  it('of two library entries that answer equally well, the one with the common name is the match, and the owner can still change it', () => {
    expect(matchExercise('Press', [lib('cat:a', 'Chest Press'), lib('cat:b', 'Leg Press')])?.id).toBe('cat:b');
    // Whichever order they come in.
    expect(matchExercise('Press', [lib('cat:b', 'Leg Press'), lib('cat:a', 'Chest Press')])?.id).toBe('cat:b');
  });

  it('two common names that tie are still no match: "Press" is a Leg Press and an Overhead Press', () => {
    expect(matchExercise('Press', [lib('cat:a', 'Overhead Press'), lib('cat:b', 'Leg Press')])).toBeNull();
  });

  it('the shorter name wins a tie in score: two words that all fit as well as five that mostly do', () => {
    // Against four query words, {alpha, beta} and {alpha, beta, gamma, sigma, omega} both score 2/3.
    const query = 'Alpha Beta Gamma Delta';
    const candidates = [lib('cat:long', 'Alpha Beta Gamma Sigma Omega'), lib('cat:short', 'Alpha Beta')];
    expect(matchExercise(query, candidates)?.id).toBe('cat:short');
    expect(matchExercise(query, [...candidates].reverse())?.id).toBe('cat:short');
  });

  it('two of the owner\'s exercises that answer equally well are no match, and a library entry does not settle it', () => {
    expect(matchExercise('Press', [mine('a', 'Chest Press'), mine('b', 'Leg Press'), lib('cat:c', 'Shoulder Press')])).toBeNull();
  });

  it('behaves as before when nothing is marked as library', () => {
    const candidates = [mine('b', 'Hammer Curl'), mine('a', 'DB Curl')];
    expect(matchExercise('Curl', candidates)).toBeNull();
    expect(matchExercise('hammer curl', candidates)).toEqual({ id: 'b', score: 1, via: 'exact' });
  });
});

describe('matchExercise over the real seed, the bundled diagrams and the catalogue', () => {
  const owned = SEED_EXERCISES.map((e) => ({ ...e, createdAt: '2026-01-01T00:00:00.000Z' }));
  const pool = async (): Promise<{ rows: ExerciseListRow[]; candidates: MatchCandidate[] }> => {
    const rows = buildExerciseList({ owned, demos: EXERCISE_DEMOS, entries: await loadCatalogue() });
    return { rows, candidates: rows.map((r) => ({ id: r.key, name: r.name, aliases: r.exercise?.aliases, library: !r.owned })) };
  };

  it('every library entry is found by its own name, and is that entry', async () => {
    const { rows, candidates } = await pool();
    const library = rows.filter((r) => !r.owned);
    expect(library.length).toBeGreaterThan(700);
    for (const r of library) expect(matchExercise(r.name, candidates), r.name).toEqual({ id: r.key, score: 1, via: 'exact' });
  });

  it('every exercise of the owner\'s is still found by its own name', async () => {
    const { rows, candidates } = await pool();
    for (const r of rows.filter((x) => x.owned)) expect(matchExercise(r.name, candidates)?.id, r.name).toBe(r.key);
  });

  it('the lines the paste review has always matched to the owner\'s exercises still are', async () => {
    const { candidates } = await pool();
    const idFor = (name: string) => SEED_EXERCISES.find((e) => e.name === name)!.id;
    expect(matchExercise('Bench press', candidates)?.id).toBe(idFor('Bench Press (Barbell)'));
    expect(matchExercise('Seated DB shoulder press', candidates)?.id).toBe(idFor('DB Shoulder Press'));
    expect(matchExercise('RDL', candidates)?.id).toBe(idFor('Romanian Deadlift (Barbell)'));
    expect(matchExercise('Lat pulldown', candidates)?.id).toBe(idFor('Lat Pulldown (Machine)'));
    expect(matchExercise('Tricep pushdown', candidates)?.id).toBe(idFor('Triceps Pushdown'));
  });

  it('a catalogue name the owner does not have matches that entry, marked as library by the pool it came from', async () => {
    const { rows, candidates } = await pool();
    const target = rows.find((r) => !r.owned && r.entry && r.name === 'Cable Rear Delt Fly') ?? rows.find((r) => !r.owned && r.entry)!;
    const m = matchExercise(target.name, candidates)!;
    expect(m.id).toBe(target.key);
    expect(rows.find((r) => r.key === m.id)!.owned).toBe(false);
  });
});
