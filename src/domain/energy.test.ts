import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import {
  KCAL_PER_KG,
  MIN_COVERAGE_FOR_ESTIMATE,
  MIN_SPAN_DAYS,
  estimateMaintenance,
  loggedDaysNeeded,
} from './energy';
import type { DayRecord } from './trends';
import type { Bodyweight } from './types';

const FROM = '2026-08-01';

/** `count` consecutive days from FROM. `kcalOf` gives a day's intake by offset; undefined leaves it unlogged. */
function window(count: number, kcalOf: (offset: number) => number | undefined = () => 2400): DayRecord[] {
  return Array.from({ length: count }, (_, i) => {
    const kcal = kcalOf(i);
    return { date: addDays(FROM, i), trained: false, ...(kcal === undefined ? {} : { kcal }) };
  });
}

/** Readings by day offset from FROM. */
function readings(...points: [offset: number, kg: number][]): Bodyweight[] {
  return points.map(([offset, kg]) => ({ id: `bw-${offset}`, date: addDays(FROM, offset), kg }));
}

/** 28 days logged at 2,400, weight 80.0 across days 1-5 and 79.5 across days 22-26: 21 days between the centres. */
const STEADY_LOSS = readings([0, 80.2], [2, 80.0], [4, 79.8], [21, 79.6], [23, 79.5], [25, 79.4]);

describe('the estimate', () => {
  it('works out to exact arithmetic on a known window', () => {
    // 4 of 28 days unlogged; the other 24 are all 2,400.
    const unlogged = new Set([3, 9, 14, 18]);
    const m = estimateMaintenance(window(28, (i) => (unlogged.has(i) ? undefined : 2400)), STEADY_LOSS);

    expect(m.basis).toBe('ok');
    expect(m.intakeAvg).toBe(2400);
    expect(m.startKg).toBeCloseTo(80.0, 9);
    expect(m.endKg).toBeCloseTo(79.5, 9);
    expect(m.deltaKg).toBeCloseTo(-0.5, 9);
    // Centres: offsets 0, 2, 4 -> day 2 = 3 Aug; offsets 21, 23, 25 -> day 23 = 24 Aug.
    expect(m.startDate).toBe('2026-08-03');
    expect(m.endDate).toBe('2026-08-24');
    expect(m.spanDays).toBe(21);
    // -0.5 kg over 21 days is 183.33 kcal a day drawn from the body, so 2,583.33 is what held weight.
    expect(m.balanceKcalPerDay).toBeCloseTo((-0.5 * KCAL_PER_KG) / 21, 6);
    expect(m.balanceKcalPerDay).toBeCloseTo(-183.3333, 3);
    expect(m.maintenanceKcal).toBe(2600);
    // Against the ROUNDED 2,600: (2400 - 2600) * 7 / 7700.
    expect(m.rateAtIntakeKgPerWeek).toBeCloseTo(-0.181818, 5);
  });

  it('puts a loss on the right side of intake, and a gain on the other', () => {
    // Losing weight on 2,400 means maintenance is ABOVE 2,400; gaining means below.
    const loss = estimateMaintenance(window(28), STEADY_LOSS);
    expect(loss.maintenanceKcal!).toBeGreaterThan(2400);

    const gain = estimateMaintenance(window(28), readings([0, 79.8], [2, 80.0], [4, 80.2], [21, 80.4], [23, 80.5], [25, 80.6]));
    expect(gain.basis).toBe('ok');
    expect(gain.maintenanceKcal!).toBeLessThan(2400);
    expect(gain.rateAtIntakeKgPerWeek!).toBeGreaterThan(0);
  });

  it('reports the rate from the rounded maintenance, so the two lines agree', () => {
    const m = estimateMaintenance(window(28), STEADY_LOSS);
    expect(m.rateAtIntakeKgPerWeek).toBe(((m.intakeAvg! - m.maintenanceKcal!) * 7) / KCAL_PER_KG);
    // The unrounded balance would have said -0.1667: a different number from the one that is shown.
    expect(m.rateAtIntakeKgPerWeek).not.toBeCloseTo((m.balanceKcalPerDay! * 7) / KCAL_PER_KG, 3);
  });

  it('is unchanged by the order the days and readings arrive in', () => {
    const forward = estimateMaintenance(window(28), STEADY_LOSS);
    const shuffled = estimateMaintenance([...window(28)].reverse(), [...STEADY_LOSS].reverse());
    expect(shuffled).toEqual(forward);
  });
});

describe('the intake mean', () => {
  it('is over the logged days only, while the unlogged days still count in the window and the span', () => {
    // Logged days alternate 2,300 and 2,500 (mean 2,400); four days are blank.
    const unlogged = new Set([3, 9, 14, 18]);
    const days = window(28, (i) => (unlogged.has(i) ? undefined : i % 2 === 0 ? 2300 : 2500));
    const m = estimateMaintenance(days, STEADY_LOSS);

    expect(m.loggedDays).toBe(24);
    expect(m.totalDays).toBe(28);
    // Counting the four blanks as zero would give 24 * 2400 / 28 = 2057.
    expect(m.intakeAvg).toBeCloseTo(2400, 9);
    expect(m.spanDays).toBe(21);
  });

  it('counts a logged zero as logged', () => {
    // A fast is a fact about the day: fourteen days at 0 and fourteen at 2,400 average 1,200.
    const m = estimateMaintenance(window(28, (i) => (i % 2 === 0 ? 0 : 2400)), STEADY_LOSS);
    expect(m.loggedDays).toBe(28);
    expect(m.basis).toBe('ok');
    expect(m.intakeAvg).toBe(1200);
  });
});

describe('rounding to the nearest 50', () => {
  // No weight change, so maintenance is the intake mean, rounded.
  const flat = readings([0, 80], [21, 80]);
  const at = (kcal: number) => estimateMaintenance(window(28, () => kcal), flat).maintenanceKcal;

  it('rounds down below the halfway point', () => {
    expect(at(2400)).toBe(2400);
    expect(at(2424)).toBe(2400);
    expect(at(2374)).toBe(2350);
  });

  it('rounds up above it', () => {
    expect(at(2426)).toBe(2450);
    expect(at(2476)).toBe(2500);
  });

  it('rounds the halfway point up', () => {
    expect(at(2425)).toBe(2450);
  });
});

describe('the weigh-in means', () => {
  it('is the reading itself with one reading at each end', () => {
    const m = estimateMaintenance(window(28), readings([3, 81.4], [24, 80.9]));
    expect(m.weighInsStart).toBe(1);
    expect(m.weighInsEnd).toBe(1);
    expect(m.startKg).toBe(81.4);
    expect(m.endKg).toBe(80.9);
    expect(m.startDate).toBe('2026-08-04');
    expect(m.endDate).toBe('2026-08-25');
    expect(m.startRange).toEqual({ from: '2026-08-04', to: '2026-08-04' });
  });

  it('is the mean of three, with the ranges of the days they were taken', () => {
    const m = estimateMaintenance(window(28), readings([0, 80.2], [1, 80.0], [6, 79.8], [21, 79.0], [24, 78.5], [27, 78.1]));
    expect(m.weighInsStart).toBe(3);
    expect(m.weighInsEnd).toBe(3);
    expect(m.startKg).toBeCloseTo(80.0, 9);
    expect(m.endKg).toBeCloseTo(78.5333333, 6);
    expect(m.startRange).toEqual({ from: '2026-08-01', to: '2026-08-07' });
    expect(m.endRange).toEqual({ from: '2026-08-22', to: '2026-08-28' });
    // Offsets 0, 1, 6 average 2.33 -> day 2; offsets 21, 24, 27 average 24 exactly.
    expect(m.startDate).toBe('2026-08-03');
    expect(m.endDate).toBe('2026-08-25');
  });

  it('takes only the first and last week of the window', () => {
    // A reading on offset 7 is the eighth day: in neither end. Offset 6 and 21 are in.
    const m = estimateMaintenance(window(28), readings([6, 80], [7, 99], [14, 99], [20, 99], [21, 79]));
    expect(m.weighInsStart).toBe(1);
    expect(m.weighInsEnd).toBe(1);
    expect(m.startKg).toBe(80);
    expect(m.endKg).toBe(79);
  });

  it('ignores readings outside the window', () => {
    const m = estimateMaintenance(window(28), [
      ...STEADY_LOSS,
      { id: 'before', date: addDays(FROM, -1), kg: 120 },
      { id: 'after', date: addDays(FROM, 28), kg: 40 },
    ]);
    expect(m.weighInsStart).toBe(3);
    expect(m.weighInsEnd).toBe(3);
    expect(m.startKg).toBeCloseTo(80.0, 9);
    expect(m.endKg).toBeCloseTo(79.5, 9);
  });
});

describe('the gates', () => {
  it('needs a weigh-in in the first week', () => {
    const m = estimateMaintenance(window(28), readings([21, 79.6], [24, 79.4]));
    expect(m.basis).toBe('too_few_weighins');
    expect(m.weighInsStart).toBe(0);
    expect(m.weighInsEnd).toBe(2);
    expect(m.startKg).toBeNull();
    expect(m.endKg).toBeCloseTo(79.5, 9);
    expect(m.deltaKg).toBeNull();
    expect(m.maintenanceKcal).toBeNull();
    expect(m.rateAtIntakeKgPerWeek).toBeNull();
  });

  it('needs a weigh-in in the last week', () => {
    const m = estimateMaintenance(window(28), readings([0, 80.2], [2, 79.8]));
    expect(m.basis).toBe('too_few_weighins');
    expect(m.weighInsStart).toBe(2);
    expect(m.weighInsEnd).toBe(0);
    expect(m.endKg).toBeNull();
    expect(m.maintenanceKcal).toBeNull();
  });

  it('has no estimate with no readings, and still carries its day counts', () => {
    const m = estimateMaintenance(window(28), []);
    expect(m.basis).toBe('too_few_weighins');
    expect(m.weighInsStart).toBe(0);
    expect(m.weighInsEnd).toBe(0);
    expect(m.loggedDays).toBe(28);
    expect(m.totalDays).toBe(28);
    expect(m.intakeAvg).toBe(2400);
    expect(m.spanDays).toBe(0);
  });

  it('counts readings from outside the window for nothing', () => {
    const m = estimateMaintenance(window(28), readings([-5, 80], [40, 79]));
    expect(m.basis).toBe('too_few_weighins');
  });

  it('needs 14 days between the two centres, and says how many there are', () => {
    // 22-day window: offsets 0..21. Readings on 6 and 20 are exactly 14 apart; 6 and 19 are 13.
    const enough = estimateMaintenance(window(22), readings([6, 80], [20, 79.5]));
    expect(enough.spanDays).toBe(MIN_SPAN_DAYS);
    expect(enough.basis).toBe('ok');

    const short = estimateMaintenance(window(22), readings([6, 80], [19, 79.5]));
    expect(short.spanDays).toBe(13);
    expect(short.basis).toBe('too_short');
    expect(short.deltaKg).toBeCloseTo(-0.5, 9);
    expect(short.balanceKcalPerDay).toBeNull();
    expect(short.maintenanceKcal).toBeNull();
    expect(short.rateAtIntakeKgPerWeek).toBeNull();
  });

  it('says the window is too short over a fortnight, because the centres cannot be 14 days apart', () => {
    const m = estimateMaintenance(window(14), readings([0, 80], [13, 79]));
    expect(m.spanDays).toBe(13);
    expect(m.basis).toBe('window_too_short');
  });

  it('does not divide by a zero span when one reading serves both ends of a short window', () => {
    const m = estimateMaintenance(window(10), readings([5, 80]));
    expect(m.weighInsStart).toBe(1);
    expect(m.weighInsEnd).toBe(1);
    expect(m.spanDays).toBe(0);
    expect(m.basis).toBe('window_too_short');
    expect(m.balanceKcalPerDay).toBeNull();
  });

  it('needs eight days in ten logged: 0.8 passes, just under does not', () => {
    expect(MIN_COVERAGE_FOR_ESTIMATE).toBe(0.8);
    const w = (logged: number, total: number) =>
      estimateMaintenance(window(total, (i) => (i < logged ? 2400 : undefined)), readings([0, 80], [total - 1, 79.5]));
    // 40 days would run past the 8 weeks the screen offers, but the maths does not care.
    expect(w(32, 40).basis).toBe('ok'); // exactly 0.8
    expect(w(31, 40).basis).toBe('too_few_logged_days'); // 0.775
    expect(w(23, 28).basis).toBe('ok'); // 0.821
    expect(w(22, 28).basis).toBe('too_few_logged_days'); // 0.786
    const thin = w(22, 28);
    expect(thin.loggedDays).toBe(22);
    expect(thin.totalDays).toBe(28);
    expect(thin.intakeAvg).toBe(2400);
    expect(thin.maintenanceKcal).toBeNull();
    expect(thin.rateAtIntakeKgPerWeek).toBeNull();
  });

  it('has no estimate when nothing was logged at all', () => {
    const m = estimateMaintenance(window(28, () => undefined), STEADY_LOSS);
    expect(m.basis).toBe('too_few_logged_days');
    expect(m.loggedDays).toBe(0);
    expect(m.intakeAvg).toBeNull();
    expect(m.maintenanceKcal).toBeNull();
  });

  it('checks the window first, then weigh-ins, then the span, then the logging', () => {
    // A fortnight can never reach the span, whatever else is missing: the window gate speaks.
    expect(estimateMaintenance(window(14, () => undefined), readings([0, 80])).basis).toBe('window_too_short');
    // Nothing logged and no readings at the far end of a long enough window: the weigh-ins gate speaks.
    const noneAtEnd = estimateMaintenance(window(20, () => undefined), readings([0, 80]));
    expect(noneAtEnd.basis).toBe('too_few_weighins');
    // Nothing logged and a short span, both groups present: the span gate speaks.
    const shortAndUnlogged = estimateMaintenance(window(20, () => undefined), readings([0, 80], [13, 79]));
    expect(shortAndUnlogged.basis).toBe('too_short');
    // Long enough, but nothing logged: the logging gate speaks.
    const unlogged = estimateMaintenance(window(28, () => undefined), STEADY_LOSS);
    expect(unlogged.basis).toBe('too_few_logged_days');
  });

  it('the shortest window that can pass the span gate is 15 days', () => {
    expect(estimateMaintenance(window(15), readings([0, 80], [14, 79.8])).basis).not.toBe('window_too_short');
    expect(estimateMaintenance(window(14), readings([0, 80], [13, 79.8])).basis).toBe('window_too_short');
  });

  it('reads intake over finished days only: today\'s breakfast does not move the figure', () => {
    const today = addDays(FROM, 28);
    const days = [...window(28), { date: today, trained: false, kcal: 400 }];
    const withToday = estimateMaintenance(days, STEADY_LOSS, { today });
    const without = estimateMaintenance(window(28), STEADY_LOSS);
    expect(withToday.intakeAvg).toBe(2400);
    expect(withToday.totalDays).toBe(28);
    expect(withToday.loggedDays).toBe(28);
    expect(withToday.maintenanceKcal).toBe(without.maintenanceKcal);
    // Without being told which day is today, the 400 counts and pulls the average down.
    expect(estimateMaintenance(days, STEADY_LOSS).intakeAvg).toBeLessThan(2400);
  });

  it('still reads today\'s weigh-in: a reading is complete when it is taken', () => {
    const today = addDays(FROM, 27);
    const m = estimateMaintenance(window(28), readings([0, 80], [27, 79.5]), { today });
    expect(m.weighInsEnd).toBe(1);
    expect(m.endKg).toBe(79.5);
  });

  it('has nothing to say about an empty window', () => {
    const m = estimateMaintenance([], readings([0, 80]));
    expect(m.basis).toBe('window_too_short');
    expect(m.totalDays).toBe(0);
    expect(m.loggedDays).toBe(0);
  });
});

describe('what it never does', () => {
  it('never clamps: a maintenance below zero is reported as it came out', () => {
    // Eating 1,000 a day while gaining 5 kg in 21 days stores 1,833 a day, so maintenance is -833.
    const m = estimateMaintenance(window(28, () => 1000), readings([0, 80], [21, 85]));
    expect(m.basis).toBe('ok');
    expect(m.balanceKcalPerDay).toBeCloseTo((5 * KCAL_PER_KG) / 21, 6);
    expect(m.maintenanceKcal).toBe(-850);
    expect(m.rateAtIntakeKgPerWeek!).toBeGreaterThan(0);
  });

  it('never prints a negative zero', () => {
    // Eating nothing while storing 20 kcal a day: maintenance is -20, which rounds to -0 without care.
    const m = estimateMaintenance(window(28, () => 0), readings([0, 80], [21, 80 + (20 * 21) / KCAL_PER_KG]));
    expect(m.basis).toBe('ok');
    expect(Object.is(m.maintenanceKcal, 0)).toBe(true);
  });
});

describe('logged days needed', () => {
  it('is the least count the gate itself accepts', () => {
    for (let total = 1; total <= 60; total++) {
      const need = loggedDaysNeeded(total);
      expect(need / total).toBeGreaterThanOrEqual(MIN_COVERAGE_FOR_ESTIMATE);
      if (need > 0) expect((need - 1) / total).toBeLessThan(MIN_COVERAGE_FOR_ESTIMATE);
    }
  });

  it('is 8 of 10, 12 of 14 and 23 of 28', () => {
    expect(loggedDaysNeeded(10)).toBe(8);
    expect(loggedDaysNeeded(14)).toBe(12);
    expect(loggedDaysNeeded(28)).toBe(23);
    expect(loggedDaysNeeded(56)).toBe(45);
    expect(loggedDaysNeeded(0)).toBe(0);
  });
});
