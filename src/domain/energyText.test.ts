import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { estimateMaintenance } from './energy';
import { dateRangeText, maintenanceBasisText, maintenanceFigureText, maintenanceGateText, maintenanceRateText } from './energyText';
import type { DayRecord } from './trends';
import type { Bodyweight } from './types';

const FROM = '2026-09-01';

function window(count: number, kcalOf: (offset: number) => number | undefined = () => 2400): DayRecord[] {
  return Array.from({ length: count }, (_, i) => {
    const kcal = kcalOf(i);
    return { date: addDays(FROM, i), trained: false, ...(kcal === undefined ? {} : { kcal }) };
  });
}

function readings(...points: [offset: number, kg: number][]): Bodyweight[] {
  return points.map(([offset, kg]) => ({ id: `bw-${offset}`, date: addDays(FROM, offset), kg }));
}

// Weight 80.0 across 1-5 Sep and 79.5 across 22-26 Sep: 21 days between the centres.
const LOSS = readings([0, 80.2], [2, 80.0], [4, 79.8], [21, 79.6], [23, 79.5], [25, 79.4]);

describe('the figure and its lines', () => {
  const unlogged = new Set([3, 9, 14, 18]);
  const m = estimateMaintenance(window(28, (i) => (unlogged.has(i) ? undefined : 2400)), LOSS);

  it('writes the figure with a thousands separator', () => {
    expect(maintenanceFigureText(m)).toBe('≈ 2,600 kcal a day');
  });

  it('says how many days were logged and which weigh-ins the figure stands on', () => {
    expect(maintenanceBasisText(m)).toBe('24 of 28 days logged · weigh-ins 1–5 Sep (3) and 22–26 Sep (3)');
  });

  it('keeps each weigh-in count with its own range', () => {
    // Three readings at the start, two at the end: the counts must not swap.
    const uneven = estimateMaintenance(window(28), readings([0, 80.2], [2, 80.0], [4, 79.8], [23, 79.6], [25, 79.4]));
    expect(maintenanceBasisText(uneven)).toBe('28 of 28 days logged · weigh-ins 1–5 Sep (3) and 24–26 Sep (2)');
  });

  it('gives the rate at the logged intake, signed, to one decimal', () => {
    expect(maintenanceRateText(m)).toBe('At your logged 2,400 a day, about −0.2 kg a week');
  });

  it('shows a gain with a plus', () => {
    const gain = estimateMaintenance(window(28), readings([0, 79.8], [2, 80.0], [4, 80.2], [21, 80.4], [23, 80.5], [25, 80.6]));
    expect(maintenanceRateText(gain)).toBe('At your logged 2,400 a day, about +0.2 kg a week');
  });

  it('shows 0 kg, not "no change", when the rate rounds away', () => {
    const flat = estimateMaintenance(window(28), readings([0, 80], [21, 80]));
    expect(maintenanceRateText(flat)).toBe('At your logged 2,400 a day, about 0 kg a week');
  });

  it('rounds the logged intake for the sentence', () => {
    const odd = estimateMaintenance(window(28, (i) => (i % 2 === 0 ? 2301 : 2400)), LOSS);
    expect(maintenanceRateText(odd)).toContain('At your logged 2,351 a day');
  });

  it('says nothing when gated', () => {
    const gated = estimateMaintenance(window(28), []);
    expect(maintenanceFigureText(gated)).toBeNull();
    expect(maintenanceBasisText(gated)).toBeNull();
    expect(maintenanceRateText(gated)).toBeNull();
  });
});

describe('the date range', () => {
  it('shares the month inside one month', () => {
    expect(dateRangeText('2026-09-01', '2026-09-07')).toBe('1–7 Sep');
  });

  it('names both months across a boundary', () => {
    expect(dateRangeText('2026-08-28', '2026-09-03')).toBe('28 Aug–3 Sep');
  });

  it('is one date for one day', () => {
    expect(dateRangeText('2026-09-05', '2026-09-05')).toBe('5 Sep');
  });
});

describe('the gate line', () => {
  it('is null when there is a figure', () => {
    expect(maintenanceGateText(estimateMaintenance(window(28), LOSS))).toBeNull();
  });

  it('names the first week when only it has no weigh-in', () => {
    const m = estimateMaintenance(window(28), readings([21, 79.6]));
    expect(maintenanceGateText(m)).toBe('No weigh-in in the first week of the window');
  });

  it('names the last week when only it has no weigh-in', () => {
    const m = estimateMaintenance(window(28), readings([2, 80]));
    expect(maintenanceGateText(m)).toBe('No weigh-in in the last week of the window');
  });

  it('names both when neither has one', () => {
    expect(maintenanceGateText(estimateMaintenance(window(28), []))).toBe('No weigh-ins in the first and last weeks');
  });

  it('says a window too short for any estimate needs the longer windows', () => {
    expect(maintenanceGateText(estimateMaintenance(window(14), readings([1, 80], [10, 79.8])))).toBe('Needs the 4 or 8 week window');
  });

  it('gives the days between weigh-ins that there are', () => {
    const m = estimateMaintenance(window(20), readings([1, 80], [14, 79.8]));
    expect(maintenanceGateText(m)).toBe('Needs 14 days between weigh-ins (13)');
  });

  it('gives the days logged that there are, out of the days needed', () => {
    // Six of 28 days unlogged leaves 22, one short of the 23 needed.
    const gone = new Set([1, 5, 8, 12, 16, 19]);
    const m = estimateMaintenance(window(28, (i) => (gone.has(i) ? undefined : 2400)), LOSS);
    expect(maintenanceGateText(m)).toBe('Needs 23 of 28 days logged (22 of 28)');
  });
});
