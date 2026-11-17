import { describe, expect, it } from 'vitest';
import { cleanDietCheck, dietDigest, dietScore, digestText, type DietAnswer, type DietRow } from './dietCheck';

const row = (name: string, date: string, kcal: number, protein: number, extra: Partial<DietRow> = {}): DietRow => ({
  key: `n:${name.toLowerCase()}`,
  name,
  date,
  portion: '1 pack',
  macros: { kcal, protein, carbs: 2, fat: 5 },
  estimate: false,
  ...extra,
});

const ROWS: DietRow[] = [
  row('Fridge Raiders', '2026-11-01', 110, 13),
  row('Fridge Raiders', '2026-11-02', 110, 13),
  row('Fridge Raiders', '2026-11-02', 130, 15, { portion: '1 big pack' }),
  row('Chicken and rice', '2026-11-02', 650, 55, { portion: '1 bowl' }),
  row("Nando's chips", '2026-11-03', 500, 6, { portion: '≈ 1 regular', estimate: true }),
  row('Old pizza', '2026-10-01', 900, 30),
];

describe('dietDigest', () => {
  const d = dietDigest(ROWS, '2026-10-21', '2026-11-17');

  it('keeps the window, counts logged days, and lists foods most eaten first', () => {
    expect(d.loggedDays).toBe(3);
    expect(d.foods.map((f) => f.name)).toEqual(['Fridge Raiders', 'Chicken and rice', "Nando's chips"]);
  });

  it('says how often, the usual amount, one serving on average and the share of calories', () => {
    expect(d.foods[0]).toEqual({
      name: 'Fridge Raiders',
      times: 3,
      days: 2,
      portion: '1 pack',
      each: { kcal: 117, protein: 14, carbs: 2, fat: 5 },
      // 350 of 1,500 kcal logged in the window.
      kcalShare: 23,
      estimate: false,
    });
    expect(d.foods[2]!.estimate).toBe(true);
  });

  it('reads as lines, with an estimate marked', () => {
    const text = digestText(d);
    expect(text).toContain('3 of 28 days logged');
    expect(text).toContain('- Fridge Raiders: 3 times on 2 days · usually 1 pack · each 117 kcal, P 14 C 2 F 5 · 23% of calories');
    expect(text).toContain("- Nando's chips: 1 times on 1 day · usually ≈ 1 regular · each ≈ 500 kcal");
  });
});

const ANSWER: DietAnswer = {
  headline: ' Calories and protein are sorted. ',
  detail: 'The points are in veg and fibre.',
  whole_foods: { points: 19.4, line: 'Mostly plain meat and rice.' },
  fruit_veg: { points: 9, line: '≈ 2 portions a day.' },
  fibre: { points: 12, line: '≈ 16 g a day.' },
  processed_salt: { points: 40, line: 'Processed meat most days.' },
  working: ['Protein at every meal.', '', 'Rice around training.', 'Eggs.', 'A fifth thing.'],
  add: [{ what: 'Frozen broccoli', why: 'Fibre for ≈ 50 kcal.' }],
  cut: [{ what: '', why: 'Nothing to say.' }],
  regulars: [
    { name: 'fridge raiders', verdict: 'fine', body_fat: 'It will not put fat round your stomach.', the_catch: 'Salty.', better: 'Chicken pieces.' },
    { name: 'Fridge Raiders', verdict: 'cut', body_fat: 'Said twice.', the_catch: '', better: '' },
    { name: 'Protein bar', verdict: 'swap', body_fat: 'Not in the diary.', the_catch: '', better: '' },
    { name: 'Chicken and rice', verdict: 'keep', body_fat: 'The base of the week.', the_catch: '', better: '' },
  ],
};

describe('cleanDietCheck', () => {
  const digest = dietDigest(ROWS, '2026-10-21', '2026-11-17');
  const check = cleanDietCheck(ANSWER, digest, '2026-11-17T12:00:00.000Z')!;

  it('holds each part to 0–25 whole points, and the score is their sum', () => {
    expect(check.parts.map((p) => [p.name, p.points])).toEqual([
      ['Whole foods', 19],
      ['Fruit and veg', 9],
      ['Fibre', 12],
      ['Processed and salt', 25],
    ]);
    expect(dietScore(check)).toBe(65);
  });

  it('gives a verdict only on a food in the diary, once, with the diary\'s own counts', () => {
    expect(check.regulars).toEqual([
      { name: 'Fridge Raiders', times: 3, days: 2, verdict: 'fine', bodyFat: 'It will not put fat round your stomach.', theCatch: 'Salty.', better: 'Chicken pieces.' },
      { name: 'Chicken and rice', times: 1, days: 1, verdict: 'keep', bodyFat: 'The base of the week.', theCatch: '', better: '' },
    ]);
  });

  it('tidies the text and keeps the lists short', () => {
    expect(check.headline).toBe('Calories and protein are sorted.');
    expect(check.working).toEqual(['Protein at every meal.', 'Rice around training.', 'Eggs.']);
    expect(check.add).toEqual([{ what: 'Frozen broccoli', why: 'Fibre for ≈ 50 kcal.' }]);
    expect(check.cut).toEqual([]);
    expect(check).toMatchObject({ from: '2026-10-21', to: '2026-11-17', loggedDays: 3, at: '2026-11-17T12:00:00.000Z' });
  });

  it('is nothing without a headline or with a part left unsaid', () => {
    expect(cleanDietCheck({ ...ANSWER, headline: ' ' }, digest, 'x')).toBeNull();
    expect(cleanDietCheck({ ...ANSWER, fibre: { points: 10, line: '' } }, digest, 'x')).toBeNull();
  });
});
