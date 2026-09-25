import { describe, expect, it } from 'vitest';
import {
  buildClaudeSummary,
  type ClaudeSummaryInclude,
  type ClaudeSummaryInput,
  type SummaryExercise,
  type SummaryFoodDay,
  type SummarySession,
} from './claudeSummary';
import type { Bodyweight } from './types';

const ALL_ON: ClaudeSummaryInclude = { training: true, food: true, bodyweight: true, routines: true };
const ALL_OFF: ClaudeSummaryInclude = { training: false, food: false, bodyweight: false, routines: false };

function makeInput(overrides: Partial<ClaudeSummaryInput> = {}): ClaudeSummaryInput {
  return {
    asOf: '2026-09-25',
    include: ALL_ON,
    training: { days: 7, sessions: [] },
    food: { days: 7, perDay: [], calorieTarget: null, proteinTarget: null },
    bodyweight: { days: 7, readings: [] },
    routines: [],
    ...overrides,
  };
}

const bw = (date: string, kg: number): Bodyweight => ({ id: date, date, kg });

describe('buildClaudeSummary — full export', () => {
  const pushA: SummarySession = {
    date: '2026-09-23',
    title: 'Push A',
    minutes: 58,
    exercises: [
      {
        name: 'Bench Press (Barbell)',
        kind: 'reps',
        sets: [
          { type: 'warmup', weight: 60, reps: 5 },
          { type: 'working', weight: 80, reps: 8 },
          { type: 'working', weight: 80, reps: 8 },
          { type: 'working', weight: 80, reps: 7 },
        ],
      },
      {
        name: 'Incline DB Press',
        kind: 'reps',
        sets: [
          { type: 'working', weight: 30, reps: 10 },
          { type: 'working', weight: 30, reps: 9 },
          { type: 'working', weight: 30, reps: 8 },
        ],
      },
    ],
  };
  const pullA: SummarySession = {
    date: '2026-09-20',
    title: 'Pull A',
    minutes: 61,
    deload: true,
    exercises: [
      // Warm-up only: must be omitted entirely, not shown as an empty line.
      { name: 'Lat Pulldown', kind: 'reps', sets: [{ type: 'warmup', weight: 50, reps: 8 }] },
      {
        name: 'Face Pull',
        kind: 'reps',
        sets: [
          { type: 'working', weight: 20, reps: 15 },
          { type: 'working', weight: 20, reps: 15 },
        ],
      },
    ],
  };
  // A session with no exercises at all still shows its header line.
  const legs: SummarySession = { date: '2026-09-15', title: 'Legs', minutes: null, exercises: [] };

  const foodDays: SummaryFoodDay[] = [
    { date: '2026-09-21', macros: null },
    { date: '2026-09-22', macros: { kcal: 2400, protein: 160, carbs: 250, fat: 75 } },
    { date: '2026-09-23', macros: { kcal: 2500, protein: 180, carbs: 240, fat: 80 } },
    { date: '2026-09-24', macros: null },
    { date: '2026-09-25', macros: { kcal: 2330, protein: 166, carbs: 263, fat: 82 } },
  ];

  const input: ClaudeSummaryInput = makeInput({
    training: { days: 56, sessions: [pushA, pullA, legs] },
    food: { days: 5, perDay: foodDays, calorieTarget: 2500, proteinTarget: 170, proteinTargetLegDay: 190 },
    bodyweight: {
      days: 6,
      readings: [
        bw('2026-09-20', 83.9),
        bw('2026-09-22', 83.7),
        bw('2026-09-24', 83.5),
        bw('2026-09-25', 83.4),
        bw('2026-09-10', 85.0), // outside the 6-day window — must not appear anywhere
      ],
    },
    routines: [
      {
        name: 'Push A',
        items: [
          { name: 'Bench Press (Barbell)', line: '4 × 6–8 @ 80 kg' },
          { name: 'Incline DB Press', line: '3 × 8–10 @ 30 kg' },
        ],
      },
      { name: 'Pull A', items: [{ name: 'Face Pull', line: '3 × 12–15 @ 20 kg' }] },
    ],
  });

  const expectedText = [
    'Iron export · Fri 25 Sep 2026 · weights in kg',
    '',
    [
      'TRAINING · 1 Aug – 25 Sep · 3 sessions',
      'Wed 23 Sep · Push A · 58 min',
      '  Bench Press (Barbell): 80 × 8, 8, 7',
      '  Incline DB Press: 30 × 10, 9, 8',
      'Sun 20 Sep · Pull A · 61 min · deload',
      '  Face Pull: 20 × 15, 15',
      'Tue 15 Sep · Legs',
    ].join('\n'),
    '',
    [
      'FOOD · 21 Sep – 25 Sep · 3 of 5 days logged',
      'Averages over the 3 logged days: 2,410 kcal · protein 169 g · carbs 251 g · fat 79 g',
      'Targets: 2,500 kcal · protein 170 g (leg days 190 g)',
      'Fri 25 Sep: 2,330 kcal · P 166 · C 263 · F 82',
      'Thu 24 Sep: not logged',
      'Wed 23 Sep: 2,500 kcal · P 180 · C 240 · F 80',
      'Tue 22 Sep: 2,400 kcal · P 160 · C 250 · F 75',
      'Mon 21 Sep: not logged',
    ].join('\n'),
    '',
    [
      'BODYWEIGHT · 20 Sep – 25 Sep · 4 weigh-ins',
      'Latest 83.4 kg (25 Sep) · 7-day average 83.6 kg · first in window 83.9 kg (20 Sep)',
      '20 Sep 83.9 · 22 Sep 83.7 · 24 Sep 83.5 · 25 Sep 83.4',
    ].join('\n'),
    '',
    [
      'ROUTINES',
      'Push A: Bench Press (Barbell) 4 × 6–8 @ 80 kg; Incline DB Press 3 × 8–10 @ 30 kg',
      'Pull A: Face Pull 3 × 12–15 @ 20 kg',
    ].join('\n'),
    '',
    'If you write me a routine, put its name on one line, then one exercise per line as: Exercise name 3x8-10 @ 60kg',
  ].join('\n');

  it('renders every section in order, exactly', () => {
    const { text } = buildClaudeSummary(input);
    expect(text).toBe(expectedText);
  });

  it('counts whitespace-separated tokens for words', () => {
    const { text, words } = buildClaudeSummary(input);
    expect(words).toBe(text.split(/\s+/).filter(Boolean).length);
    expect(words).toBeGreaterThan(50);
  });

  it('reports counts for every section', () => {
    const { counts } = buildClaudeSummary(input);
    expect(counts).toEqual({ sessions: 3, foodDays: 5, foodDaysLogged: 3, weighIns: 4, routines: 2 });
  });

  it('excludes a bodyweight reading from outside its window from the count and the text', () => {
    const { text, counts } = buildClaudeSummary(input);
    expect(counts.weighIns).toBe(4);
    expect(text).not.toContain('85');
    expect(text).not.toContain('10 Sep');
  });
});

describe('section toggles', () => {
  const full = makeInput({
    training: { days: 7, sessions: [{ date: '2026-09-25', title: 'Push A', minutes: 40, exercises: [] }] },
    food: { days: 7, perDay: [{ date: '2026-09-25', macros: { kcal: 2000, protein: 150, carbs: 200, fat: 60 } }], calorieTarget: null, proteinTarget: null },
    bodyweight: { days: 7, readings: [bw('2026-09-25', 80)] },
    routines: [{ name: 'Push A', items: [{ name: 'Bench Press', line: '4 × 8 @ 80 kg' }] }],
  });

  it('includes only the sections switched on, each separated by one blank line', () => {
    const { text } = buildClaudeSummary({ ...full, include: { training: true, food: false, bodyweight: true, routines: false } });
    expect(text).toBe(
      [
        'Iron export · Fri 25 Sep 2026 · weights in kg',
        '',
        'TRAINING · 19 Sep – 25 Sep · 1 session',
        'Fri 25 Sep · Push A · 40 min',
        '',
        'BODYWEIGHT · 19 Sep – 25 Sep · 1 weigh-in',
        'Latest 80 kg (25 Sep) · first in window 80 kg (25 Sep)',
        '25 Sep 80',
        '',
        'If you write me a routine, put its name on one line, then one exercise per line as: Exercise name 3x8-10 @ 60kg',
      ].join('\n'),
    );
    expect(text).not.toContain('FOOD');
    expect(text).not.toContain('ROUTINES');
  });

  it('with every section switched off, the text is just the header and the closing line', () => {
    const { text } = buildClaudeSummary({ ...full, include: ALL_OFF });
    expect(text).toBe(
      [
        'Iron export · Fri 25 Sep 2026 · weights in kg',
        '',
        'If you write me a routine, put its name on one line, then one exercise per line as: Exercise name 3x8-10 @ 60kg',
      ].join('\n'),
    );
  });

  it('computes counts for a section even when it is switched off', () => {
    const { counts, text } = buildClaudeSummary({ ...full, include: { ...ALL_ON, training: false } });
    expect(counts.sessions).toBe(1);
    expect(text).not.toContain('TRAINING');
  });
});

describe('empty states', () => {
  it('training: "No sessions in this window."', () => {
    const { text } = buildClaudeSummary(makeInput({ training: { days: 7, sessions: [] } }));
    expect(text).toContain('TRAINING · 19 Sep – 25 Sep · 0 sessions\nNo sessions in this window.');
  });

  it('food: "Nothing logged in this window." and no averages line when nothing is logged', () => {
    const { text } = buildClaudeSummary(
      makeInput({
        food: {
          days: 3,
          perDay: [
            { date: '2026-09-23', macros: null },
            { date: '2026-09-24', macros: null },
            { date: '2026-09-25', macros: null },
          ],
          calorieTarget: null,
          proteinTarget: null,
        },
      }),
    );
    expect(text).toContain('FOOD · 23 Sep – 25 Sep · 0 of 3 days logged\nNothing logged in this window.');
    expect(text).not.toContain('Averages');
    expect(text).not.toContain('not logged'); // no per-day list at all when nothing was logged
  });

  it('bodyweight: "No weigh-ins in this window."', () => {
    const { text } = buildClaudeSummary(makeInput({ bodyweight: { days: 7, readings: [] } }));
    expect(text).toContain('BODYWEIGHT · 19 Sep – 25 Sep · 0 weigh-ins\nNo weigh-ins in this window.');
  });

  it('routines: "No routines."', () => {
    const { text } = buildClaudeSummary(makeInput({ routines: [] }));
    expect(text).toContain('ROUTINES\nNo routines.');
  });
});

describe('food averaging never counts an unlogged day as zero', () => {
  it('averages 3 logged days over 3, not over all 7 in the window', () => {
    const perDay: SummaryFoodDay[] = [
      { date: '2026-09-19', macros: null },
      { date: '2026-09-20', macros: null },
      { date: '2026-09-21', macros: { kcal: 2000, protein: 100, carbs: 200, fat: 50 } },
      { date: '2026-09-22', macros: null },
      { date: '2026-09-23', macros: { kcal: 2200, protein: 120, carbs: 220, fat: 60 } },
      { date: '2026-09-24', macros: null },
      { date: '2026-09-25', macros: { kcal: 2600, protein: 160, carbs: 240, fat: 70 } },
    ];
    const { text, counts } = buildClaudeSummary(makeInput({ food: { days: 7, perDay, calorieTarget: null, proteinTarget: null } }));
    expect(counts.foodDaysLogged).toBe(3);
    expect(counts.foodDays).toBe(7);
    // (2000 + 2200 + 2600) / 3 = 2266.67 → 2,267, not divided by 7 (which would give 971).
    expect(text).toContain('Averages over the 3 logged days: 2,267 kcal');
    expect(text).not.toContain('971');
  });
});

describe('warm-up sets', () => {
  it('are excluded from set lines and an all-warm-up exercise is omitted', () => {
    const exercises: SummaryExercise[] = [
      {
        name: 'Squat',
        kind: 'reps',
        sets: [
          { type: 'warmup', weight: 40, reps: 5 },
          { type: 'warmup', weight: 60, reps: 3 },
          { type: 'working', weight: 100, reps: 5 },
        ],
      },
      { name: 'Leg Extension', kind: 'reps', sets: [{ type: 'warmup', weight: 20, reps: 12 }] },
    ];
    const session: SummarySession = { date: '2026-09-25', title: 'Legs', minutes: 50, exercises };
    const { text } = buildClaudeSummary(makeInput({ training: { days: 7, sessions: [session] } }));
    expect(text).toContain('  Squat: 100 × 5');
    expect(text).not.toContain('40');
    expect(text).not.toContain('Leg Extension');
  });
});

describe('deload tag', () => {
  it('is appended to the session header only when set', () => {
    const withDeload: SummarySession = { date: '2026-09-25', title: 'Legs', minutes: 50, deload: true, exercises: [] };
    const without: SummarySession = { date: '2026-09-24', title: 'Legs', minutes: 50, exercises: [] };
    const { text } = buildClaudeSummary(makeInput({ training: { days: 7, sessions: [withDeload, without] } }));
    expect(text).toContain('Fri 25 Sep · Legs · 50 min · deload');
    expect(text).toContain('Thu 24 Sep · Legs · 50 min');
    expect(text).not.toContain('Thu 24 Sep · Legs · 50 min · deload');
  });
});

describe('date and weekday formatting', () => {
  const cases: { asOf: string; weekday: string }[] = [
    { asOf: '2026-09-25', weekday: 'Fri' },
    { asOf: '2026-01-01', weekday: 'Thu' },
    { asOf: '2026-12-31', weekday: 'Thu' },
    { asOf: '2027-01-01', weekday: 'Fri' }, // crosses a year boundary from the previous case
    { asOf: '2024-02-29', weekday: 'Thu' }, // leap day
    { asOf: '2000-01-01', weekday: 'Sat' },
  ];
  it.each(cases)('gets the weekday for $asOf right', ({ asOf, weekday }) => {
    const { text } = buildClaudeSummary(makeInput({ asOf }));
    expect(text.startsWith(`Iron export · ${weekday} `)).toBe(true);
  });

  it('shows the year on a section range only when the two ends differ', () => {
    const sameYear = buildClaudeSummary(makeInput({ asOf: '2026-09-25', training: { days: 7, sessions: [] } })).text;
    expect(sameYear).toContain('TRAINING · 19 Sep – 25 Sep');

    const crossesYear = buildClaudeSummary(makeInput({ asOf: '2027-01-03', training: { days: 10, sessions: [] } })).text;
    expect(crossesYear).toContain('TRAINING · 25 Dec 2026 – 3 Jan 2027');
  });
});

describe('bodyweight window and 7-day average', () => {
  it('filters readings to the window and omits the 7-day-average clause with only one reading', () => {
    const { text } = buildClaudeSummary(
      makeInput({
        bodyweight: { days: 7, readings: [bw('2026-09-25', 82.4), bw('2026-08-01', 90)] },
      }),
    );
    expect(text).toContain('BODYWEIGHT · 19 Sep – 25 Sep · 1 weigh-in');
    expect(text).toContain('Latest 82.4 kg (25 Sep) · first in window 82.4 kg (25 Sep)');
    expect(text).not.toContain('7-day average');
    expect(text).not.toContain('90');
  });

  it('averages only readings within 7 days of the latest one, not the whole window', () => {
    const { text } = buildClaudeSummary(
      makeInput({
        bodyweight: {
          days: 30,
          readings: [
            bw('2026-08-28', 90), // outside the 7 days ending on the latest reading
            bw('2026-09-19', 83.0),
            bw('2026-09-25', 83.6),
          ],
        },
      }),
    );
    // (83.0 + 83.6) / 2 = 83.3, not averaged in with the 90 kg reading from a month earlier.
    expect(text).toContain('7-day average 83.3 kg');
  });
});

describe('routine lines', () => {
  it('joins a routine\'s exercises with "; " and omits the semicolon for a single exercise', () => {
    const { text } = buildClaudeSummary(
      makeInput({
        routines: [
          {
            name: 'Push A',
            items: [
              { name: 'Bench Press (Barbell)', line: '4 × 6–8 @ 80 kg' },
              { name: 'Incline DB Press', line: '3 × 8–10 @ 30 kg' },
            ],
          },
          { name: 'Pull A', items: [{ name: 'Face Pull', line: '3 × 12–15 @ 20 kg' }] },
        ],
      }),
    );
    expect(text).toContain('Push A: Bench Press (Barbell) 4 × 6–8 @ 80 kg; Incline DB Press 3 × 8–10 @ 30 kg');
    expect(text).toContain('Pull A: Face Pull 3 × 12–15 @ 20 kg');
    expect(text).not.toContain('Pull A: Face Pull 3 × 12–15 @ 20 kg;');
  });
});
