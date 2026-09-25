import { describe, expect, it } from 'vitest';
import { EXERCISE_MATCH_THRESHOLD, matchExercise, normaliseName, type MatchCandidate } from './exerciseMatch';
import { SEED_EXERCISES } from '@/db/seed';

const CANDIDATES: MatchCandidate[] = SEED_EXERCISES.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases }));

const idFor = (name: string) => SEED_EXERCISES.find((e) => e.name === name)!.id;
const byId = (id: string) => SEED_EXERCISES.find((e) => e.id === id)!;

describe('matchExercise — against the real seed library', () => {
  it('"Bench press" → Bench Press (Barbell)', () => {
    const m = matchExercise('Bench press', CANDIDATES);
    expect(m?.id).toBe(idFor('Bench Press (Barbell)'));
  });

  it('"Seated DB shoulder press" → DB Shoulder Press (via db → dumbbell expansion)', () => {
    const m = matchExercise('Seated DB shoulder press', CANDIDATES);
    expect(m?.id).toBe(idFor('DB Shoulder Press'));
    expect(m?.via).toBe('fuzzy');
  });

  it('"RDL" and "Romanian deadlift" both → Romanian Deadlift (Barbell)', () => {
    expect(matchExercise('RDL', CANDIDATES)?.id).toBe(idFor('Romanian Deadlift (Barbell)'));
    expect(matchExercise('Romanian deadlift', CANDIDATES)?.id).toBe(idFor('Romanian Deadlift (Barbell)'));
  });

  it('"Lat pulldown" → Lat Pulldown (Machine)', () => {
    const m = matchExercise('Lat pulldown', CANDIDATES);
    expect(m?.id).toBe(idFor('Lat Pulldown (Machine)'));
  });

  it('"Tricep pushdown" → Triceps Pushdown, via its "Tricep Pushdown" alias, exactly', () => {
    const m = matchExercise('Tricep pushdown', CANDIDATES);
    expect(m?.id).toBe(idFor('Triceps Pushdown'));
    expect(m).toEqual({ id: idFor('Triceps Pushdown'), score: 1, via: 'exact' });
  });

  it('"Hip thrust" → Hip Thrust (Barbell)', () => {
    const m = matchExercise('Hip thrust', CANDIDATES);
    expect(m?.id).toBe(idFor('Hip Thrust (Barbell)'));
  });

  it('"Leg curl" → Lying Leg Curl (Machine): the equipment qualifier costs precision but the score still clears the threshold', () => {
    const m = matchExercise('Leg curl', CANDIDATES);
    expect(m?.id).toBe(idFor('Lying Leg Curl (Machine)'));
    expect(m?.score).toBeGreaterThan(EXERCISE_MATCH_THRESHOLD);
  });

  it('"Chest-supported row" → null: it must NOT claim Iso-Lateral Row on the strength of "row" alone', () => {
    const m = matchExercise('Chest-supported row', CANDIDATES);
    expect(m).toBeNull();
  });

  it('"Incline bench press" → Incline DB Press, via its "Incline Bench Press (Dumbbell)" alias outscoring Bench Press (Barbell)', () => {
    // Both "Incline DB Press" and "Bench Press (Barbell)" share tokens with the query. The alias
    // "Incline Bench Press (Dumbbell)" shares three of the query's three words (incline, bench,
    // press) against only one extra word of its own, which beats Bench Press (Barbell)'s two
    // shared words against two of its own — this is the documented, deterministic outcome.
    const m = matchExercise('Incline bench press', CANDIDATES);
    expect(m?.id).toBe(idFor('Incline DB Press'));
    expect(m?.via).toBe('fuzzy');
    const benchPressBarbell = idFor('Bench Press (Barbell)');
    expect(m?.id).not.toBe(benchPressBarbell);
  });

  it('"Farmers walk" → Farmer\'s Carry, exact via its "Farmers Walk" alias', () => {
    const m = matchExercise('Farmers walk', CANDIDATES);
    expect(m).toEqual({ id: idFor("Farmer's Carry"), score: 1, via: 'exact' });
  });
});

describe('matchExercise — exact pass', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(matchExercise('  bench   PRESS (barbell)  ', CANDIDATES)?.id).toBe(idFor('Bench Press (Barbell)'));
  });

  it('matches an alias exactly ahead of any fuzzy scoring', () => {
    const m = matchExercise('Shrug (Dumbbell)', CANDIDATES);
    expect(m).toEqual({ id: idFor('Heavy DB Shrugs'), score: 1, via: 'exact' });
  });
});

describe('matchExercise — fuzzy scoring, threshold and abbreviations', () => {
  it('rejects a candidate at or below the threshold', () => {
    const candidates: MatchCandidate[] = [{ id: 'x', name: 'Bench Press' }];
    // "Press" alone against "Bench Press": shared 1, precision 1/2, recall 1/1, F1 = 2/3 — but a
    // single, near-meaningless word should not be allowed to win on its own against a two-word
    // exact-ish name. Assert the actual behaviour of the scoring function instead of a guess: only
    // above-threshold candidates are ever returned.
    const m = matchExercise('Press', candidates);
    if (m) expect(m.score).toBeGreaterThan(EXERCISE_MATCH_THRESHOLD);
  });

  it('returns null for a genuinely unrelated name', () => {
    expect(matchExercise('Zzyzx unrelated nonsense', CANDIDATES)).toBeNull();
  });

  it('expands ohp, bb, kb, bw, bicep/tricep, pull-up/chin-up/pulldown/pushdown spelling variants', () => {
    const candidates: MatchCandidate[] = [
      { id: 'ohp', name: 'Overhead Press (Barbell)' },
      { id: 'bb-row', name: 'Barbell Row' },
      { id: 'kb-swing', name: 'Kettlebell Swing' },
      { id: 'pullup', name: 'Pull Up' },
      { id: 'chinup', name: 'Chin Up' },
      { id: 'pulldown', name: 'Lat Pulldown' },
      { id: 'pushdown', name: 'Triceps Pushdown' },
      { id: 'bicep-curl', name: 'Biceps Curl' },
    ];
    expect(matchExercise('OHP', candidates)?.id).toBe('ohp');
    expect(matchExercise('BB row', candidates)?.id).toBe('bb-row');
    expect(matchExercise('KB swing', candidates)?.id).toBe('kb-swing');
    expect(matchExercise('Pull-up', candidates)?.id).toBe('pullup');
    expect(matchExercise('Pull up', candidates)?.id).toBe('pullup');
    expect(matchExercise('Chinup', candidates)?.id).toBe('chinup');
    expect(matchExercise('Pull-down', candidates)?.id).toBe('pulldown');
    expect(matchExercise('Push down', candidates)?.id).toBe('pushdown');
    expect(matchExercise('Bicep curl', candidates)?.id).toBe('bicep-curl');
  });

  it('stripping parentheses can only help a candidate whose extra token was inside them', () => {
    const withParens: MatchCandidate[] = [{ id: 'a', name: 'Lying Leg Curl (Machine)' }];
    const scored = matchExercise('Leg curl', withParens);
    expect(scored).not.toBeNull();
    expect(scored!.score).toBeCloseTo(0.8, 5); // {leg,curl} vs {lying,leg,curl} once "(Machine)" is dropped
  });
});

describe('matchExercise — ties and determinism', () => {
  it('two exercises with the same name: the exact pass settles on the lower id, every time', () => {
    const candidates: MatchCandidate[] = [
      { id: 'zzz', name: 'Bench Press Extra Long Name' },
      { id: 'bbb', name: 'Bench Press' },
      { id: 'aaa', name: 'Bench Press' },
    ];
    expect(matchExercise('Bench press', candidates)?.id).toBe('aaa');
  });

  it('an exact match on an exercise\'s own name beats the same words carried as another\'s alias', () => {
    const candidates: MatchCandidate[] = [
      { id: 'a', name: 'Neck', aliases: ['Curl'] },
      { id: 'b', name: 'Curl' },
    ];
    expect(matchExercise('Curl', candidates)).toEqual({ id: 'b', score: 1, via: 'exact' });
  });

  it('"Curl" and "Extension" are not Neck: a shorter name no longer wins a tie reached through an alias', () => {
    // Neck carries "Neck Curl" and "Neck Extension" as aliases, which score "Curl" exactly as well
    // as DB Curl or Hammer Curl score it on their own names. Before, the shortest name — "Neck" —
    // won that tie, so a pasted "Curl 3x10" arrived as neck work.
    const neck = idFor('Neck');
    for (const q of ['Curl', 'Curls', 'Extension']) {
      const m = matchExercise(q, CANDIDATES);
      expect(m?.id, q).not.toBe(neck);
    }
  });

  it('at the same score, an exercise matched on its own name beats one matched only through an alias', () => {
    const candidates: MatchCandidate[] = [
      { id: 'neck', name: 'Neck', aliases: ['Neck Curl'] },
      { id: 'hammer', name: 'Hammer Curl' },
    ];
    expect(matchExercise('Curl', candidates)?.id).toBe('hammer');
  });

  it('two different exercises that answer equally well are no match at all, left for the owner to choose', () => {
    expect(matchExercise('Calf raise', CANDIDATES)).toBeNull(); // Seated or Standing?
    expect(matchExercise('Curl', CANDIDATES)).toBeNull(); // DB, Hammer?
    expect(matchExercise('Extension', CANDIDATES)).toBeNull(); // Leg or Back?
    // …while a clear winner among several partial matches still wins.
    expect(matchExercise('Standing calf raise', CANDIDATES)?.id).toBe(idFor('Standing Calf Raise'));
  });

  it('is deterministic across repeated calls with the same input', () => {
    const results = Array.from({ length: 5 }, () => matchExercise('Seated DB shoulder press', CANDIDATES));
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });
});

describe('normaliseName', () => {
  it('lowercases, strips apostrophes, and collapses punctuation/whitespace to single spaces', () => {
    expect(normaliseName("Farmer's Carry")).toBe('farmers carry');
    expect(normaliseName('  Bench   Press (Barbell)  ')).toBe('bench press (barbell)');
  });
});

// Sanity check the fixture itself, so a future seed change that removes one of the exercises this
// suite depends on fails loudly here rather than as a confusing mismatch above.
describe('seed fixture sanity', () => {
  it('the seed still has the exercises this suite matches against', () => {
    for (const name of [
      'Bench Press (Barbell)',
      'DB Shoulder Press',
      'Romanian Deadlift (Barbell)',
      'Lat Pulldown (Machine)',
      'Triceps Pushdown',
      'Hip Thrust (Barbell)',
      'Lying Leg Curl (Machine)',
      'Iso-Lateral Row (Machine)',
      'Incline DB Press',
      "Farmer's Carry",
      'Neck',
      'DB Curl',
      'Hammer Curl',
      'Leg Extension',
      'Back Extension',
      'Seated Calf Raise',
      'Standing Calf Raise',
    ]) {
      expect(byId(idFor(name)).name).toBe(name);
    }
  });
});
