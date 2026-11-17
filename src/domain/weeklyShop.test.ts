import { describe, expect, it } from 'vitest';
import type { Macros } from './food';
import {
  aisleOfCode,
  aisleOfName,
  fmtWeekRange,
  fmtWeight,
  moreOfTheSame,
  packText,
  shopLines,
  shopTotals,
  shopWeek,
  weekTargets,
  weekText,
  type Eaten,
} from './weeklyShop';

const per100 = (kcal: number, protein: number): Macros => ({ kcal, protein, carbs: 0, fat: 0 });
const weighed = (key: string, date: string, grams: number, p100: Macros): Eaten => ({
  key,
  name: key,
  date,
  grams,
  macros: { kcal: (p100.kcal * grams) / 100, protein: (p100.protein * grams) / 100, carbs: 0, fat: 0 },
});
const noAisle = () => undefined;

describe('shopWeek', () => {
  it('plans the week after the coming Sunday; on a Sunday, tomorrow', () => {
    expect(shopWeek('2026-11-17')).toBe('2026-11-23'); // Tuesday
    expect(shopWeek('2026-11-22')).toBe('2026-11-23'); // Sunday
    expect(shopWeek('2026-11-23')).toBe('2026-11-30'); // Monday: that week's shop is done
  });
});

describe('aisleOfCode', () => {
  it('reads the UK table food groups', () => {
    expect(aisleOfCode('18-001')).toBe('Meat and fish');
    expect(aisleOfCode('16-100')).toBe('Meat and fish');
    expect(aisleOfCode('12-528')).toBe('Dairy and eggs');
    expect(aisleOfCode('13-010')).toBe('Fruit and veg');
    expect(aisleOfCode('11-001')).toBe('Cupboard');
    expect(aisleOfCode('15-001')).toBe('Other');
  });
});

describe('aisleOfName', () => {
  it('takes the UK table\'s group first, then the words, else no guess', () => {
    expect(aisleOfName('Rice, white, basmati, raw', '11-857')).toBe('Cupboard');
    expect(aisleOfName('Chicken thigh', undefined)).toBe('Meat and fish');
    expect(aisleOfName('Greek yoghurt 0%', undefined)).toBe('Dairy and eggs');
    expect(aisleOfName('Frozen peas', undefined)).toBe('Frozen');
    expect(aisleOfName('Wholemeal bread', undefined)).toBe('Bakery');
    expect(aisleOfName('Bananas', undefined)).toBe('Fruit and veg');
    expect(aisleOfName('Porridge oats', undefined)).toBe('Cupboard');
    expect(aisleOfName('Protein shake', undefined)).toBeUndefined();
  });
});

describe('shopLines', () => {
  it('averages over logged days, never calendar days, and rounds packs up', () => {
    // 200 g of chicken on each of 2 logged days in the window: 200 g a logged day, 1.4 kg a week.
    const eaten = [weighed('chicken', '2026-11-10', 200, per100(129, 20)), weighed('chicken', '2026-11-12', 200, per100(129, 20))];
    const [line] = shopLines(eaten, 2, { chicken: { packGrams: 750 } }, {}, {}, noAisle);
    expect(line!.week).toBeCloseTo(1400);
    expect(line!.packs).toBe(2);
    expect(packText(line!)).toBe('2 × 750 g');
    expect(weekText(line!)).toBe('1.4 kg');
    expect(shopTotals([line!])).toEqual({ kcal: 1806, protein: 280 });
  });

  it('counts a food by its unit when one is remembered and no pack is', () => {
    const egg = per100(131, 12.6);
    const eaten = [weighed('egg', '2026-11-10', 116, egg)]; // two eggs on the one logged day
    const [line] = shopLines(eaten, 1, { egg: { unitGrams: 58, unitLabel: 'egg', unitPlural: 'eggs' } }, {}, {}, noAisle);
    expect(packText(line!)).toBe('14 eggs');
    expect(weekText(line!)).toBe('14 eggs');
  });

  it('falls back to 100 g packs, and takes the owner\'s pack and aisle over any guess', () => {
    const eaten = [weighed('rice', '2026-11-10', 100, per100(350, 8))];
    const [guessed] = shopLines(eaten, 1, {}, {}, {}, () => 'Cupboard');
    expect(guessed!.pack).toBe(100);
    expect(guessed!.packs).toBe(7);
    expect(guessed!.aisle).toBe('Cupboard');
    const [fixed] = shopLines(eaten, 1, {}, { rice: { pack: 1000, aisle: 'Other' } }, {}, () => 'Cupboard');
    expect(packText(fixed!)).toBe('1 × 1 kg');
    expect(fixed!.aisle).toBe('Other');
  });

  it('once − or + is tapped, the week is what is bought', () => {
    const eaten = [weighed('chicken', '2026-11-10', 200, per100(129, 20))];
    const [line] = shopLines(eaten, 1, { chicken: { packGrams: 750 } }, {}, { chicken: { packs: 3 } }, noAisle);
    expect(line!.packs).toBe(3);
    expect(line!.week).toBe(2250);
    const [gone] = shopLines(eaten, 1, { chicken: { packGrams: 750 } }, {}, { chicken: { packs: 0 } }, noAisle);
    expect(shopTotals([gone!])).toEqual({ kcal: 0, protein: 0 });
  });

  it('counts a food logged only by the portion as portions', () => {
    const shake: Eaten = { key: 'shake', name: 'Shake', date: '2026-11-10', grams: null, macros: per100(200, 30) };
    const [line] = shopLines([shake, { ...shake, date: '2026-11-11' }], 2, {}, {}, {}, noAisle);
    expect(line!.unit).toBe('portion');
    expect(packText(line!)).toBe('7 portions');
    expect(shopTotals([line!])).toEqual({ kcal: 1400, protein: 210 });
  });

  it('keeps an in-already line in the totals, since it is eaten', () => {
    const eaten = [weighed('oats', '2026-11-10', 80, per100(374, 11))];
    const [line] = shopLines(eaten, 1, {}, {}, { oats: { inAlready: true } }, noAisle);
    expect(line!.inAlready).toBe(true);
    expect(shopTotals([line!]).kcal).toBe(2094);
  });

  it('has nothing to say with no logged day', () => {
    expect(shopLines([weighed('oats', '2026-11-10', 80, per100(374, 11))], 0, {}, {}, {}, noAisle)).toEqual([]);
  });
});

describe('the totals add up from the lines as shown', () => {
  it('sums the rounded line figures, not the unrounded ones', () => {
    // Three lines of 0.4 g protein each would round to 0 each but 1 together; the column says 0.
    const eaten = ['a', 'b', 'c'].map((k) => weighed(k, '2026-11-10', 1, per100(0, 40 / 7)));
    const lines = shopLines(eaten, 1, {}, {}, {}, noAisle);
    expect(lines.map((l) => Math.round(l.per.protein * l.week))).toEqual([0, 0, 0]);
    expect(shopTotals(lines).protein).toBe(0);
  });
});

describe('weekTargets', () => {
  it('sums each day\'s calories and takes protein × 7', () => {
    expect(weekTargets([2600, 2600, 2600, 2600, 2600, 2600, 2600], 190)).toEqual({ kcal: 18200, protein: 1330 });
  });
  it('has no calorie target when a day has none', () => {
    expect(weekTargets([2600, null, 2600, 2600, 2600, 2600, 2600], 190).kcal).toBeNull();
  });
});

describe('moreOfTheSame', () => {
  it('adds packs of the best protein per calorie until protein is met', () => {
    const eaten = [weighed('yoghurt', '2026-11-10', 100, per100(57, 10.3)), weighed('oats', '2026-11-10', 80, per100(374, 11))];
    const lines = shopLines(eaten, 1, { yoghurt: { packGrams: 500 } }, {}, {}, noAisle);
    // 700 g yoghurt (72 g) + 560 g oats (62 g) = 134 g. A third 500 g pot makes the yoghurt
    // 1.5 kg (155 g): 217 g, past 200, so it stops there.
    const added = moreOfTheSame(lines, 200);
    expect(added).toEqual({ yoghurt: 3 });
  });
  it('stops at the cap and changes nothing when there is no protein to add', () => {
    const lines = shopLines([weighed('oil', '2026-11-10', 10, per100(899, 0))], 1, {}, {}, {}, noAisle);
    expect(moreOfTheSame(lines, 500)).toEqual({});
  });
});

describe('fmtWeight', () => {
  it('says grams under a kilo and kilos to one place over', () => {
    expect(fmtWeight(560)).toBe('560 g');
    expect(fmtWeight(1400)).toBe('1.4 kg');
    expect(fmtWeight(2250)).toBe('2.3 kg');
  });
});

describe('fmtWeekRange', () => {
  it('names the month once, or both across a month', () => {
    expect(fmtWeekRange('2026-11-23')).toBe('23 to 29 Nov');
    expect(fmtWeekRange('2026-11-30')).toBe('30 Nov to 6 Dec');
  });
});
