import { describe, expect, it } from 'vitest';
import table from '@/data/liftStandards.json';
import { ageBand, groupText, liftStanding, standingText, weightClassFor, type LiftTable } from './liftStandards';

const PCTS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99];
// Squat bests of 100 kg at the 5th percentile, rising 10 kg a step to 290 kg at the 95th, 330 kg at the 99th.
const KG = [...PCTS.slice(0, -1).map((_, i) => 100 + i * 10), 330];
const fake: LiftTable = {
  date: '2026-10-31',
  pcts: PCTS,
  classes: { M: ['59', '66', '74', '83', '93', '105', '120', '120+'], F: ['47', '52', '57', '63', '69', '76', '84', '84+'] },
  bands: ['20-23', '24-34', '35-39', '80-999'],
  cells: { 'M|24-34|83|squat': { n: 24677, kg: KG } },
};
const squat = (e1rmKg: number, extra: Partial<{ age: number; bodyweightKg: number }> = {}) =>
  liftStanding(fake, { sex: 'male', age: 29, bodyweightKg: 82, lift: 'squat', e1rmKg, ...extra });

describe('the group a lifter is compared with', () => {
  it('takes the age band the age falls in, and none below the youngest', () => {
    expect(ageBand(29, fake.bands)).toBe('24-34');
    expect(ageBand(24, fake.bands)).toBe('24-34');
    expect(ageBand(35, fake.bands)).toBe('35-39');
    expect(ageBand(85, fake.bands)).toBe('80-999');
    expect(ageBand(12, fake.bands)).toBeNull();
  });

  it('takes the lightest IPF class the bodyweight is within, and the open one above the heaviest', () => {
    expect(weightClassFor(83, fake.classes.M)).toBe('83');
    expect(weightClassFor(83.1, fake.classes.M)).toBe('93');
    expect(weightClassFor(55, fake.classes.M)).toBe('59');
    expect(weightClassFor(131, fake.classes.M)).toBe('120+');
  });

  it('is named as the owner reads it', () => {
    expect(groupText('male', { band: '24-34', weightClass: '83' })).toBe('Men 24–34, 83 kg class');
    expect(groupText('female', { band: '80-999', weightClass: '84+' })).toBe('Women 80+, 84+ kg class');
  });
});

describe('where a lift stands', () => {
  it('gives the elite line and the share beaten, rounded down', () => {
    expect(squat(195)).toEqual({ band: '24-34', weightClass: '83', n: 24677, eliteKg: 330, beatsPct: 52 });
    expect(standingText(squat(195)!)).toBe('Beats 52% of raw lifters at meets');
  });

  it('never rounds a tie up into a win: equal to a line is not beating it', () => {
    expect(squat(190)!.beatsPct).toBe(50);
    expect(squat(100)!.beatsPct).toBe(0);
    expect(standingText(squat(100)!)).toBe('Beats fewer than 5% of raw lifters at meets');
    expect(squat(330)!.beatsPct).toBe(99);
    expect(squat(329)!.beatsPct).toBe(98);
  });

  it('is the top 1% only above the elite line', () => {
    expect(squat(331)!.beatsPct).toBe(99);
    expect(standingText(squat(331)!)).toBe('Top 1% of raw lifters at meets');
  });

  it('says nothing for a group the table does not have', () => {
    expect(squat(195, { age: 37 })).toBeNull();
    expect(squat(195, { bodyweightKg: 95 })).toBeNull();
    expect(squat(195, { age: 12 })).toBeNull();
    expect(squat(195, { bodyweightKg: 0 })).toBeNull();
    expect(liftStanding(fake, { sex: 'female', age: 29, bodyweightKg: 82, lift: 'squat', e1rmKg: 195 })).toBeNull();
  });
});

describe('the committed table', () => {
  const real = table as LiftTable;

  it('holds rising percentiles from at least 20 lifters in every group', () => {
    expect(real.pcts).toEqual(PCTS);
    for (const [key, cell] of Object.entries(real.cells)) {
      expect(cell.n, key).toBeGreaterThanOrEqual(20);
      expect(cell.kg, key).toHaveLength(PCTS.length);
      for (let i = 1; i < cell.kg.length; i++) expect(cell.kg[i], key).toBeGreaterThanOrEqual(cell.kg[i - 1]!);
    }
  });

  it('matches what raw meets look like for a common group', () => {
    const s = liftStanding(real, { sex: 'male', age: 29, bodyweightKg: 82, lift: 'squat', e1rmKg: 190 })!;
    expect(s.n).toBeGreaterThan(10_000);
    expect(s.eliteKg).toBeGreaterThan(250);
    expect(s.eliteKg).toBeLessThan(320);
    expect(s.beatsPct).toBeGreaterThan(35);
    expect(s.beatsPct).toBeLessThan(65);
  });
});
