import { describe, expect, it } from 'vitest';
import { hashFacts } from '@/ai/moments';
import { leadTopSet, mostRestedRegion, openFacts, partOfDay, planRow, type OpenFactsInput, type PlanRowInput } from './homeToday';

describe('mostRestedRegion', () => {
  it('is the region left alone the longest', () => {
    expect(mostRestedRegion({ Legs: 3, Back: 6, Chest: 2 })).toEqual({ region: 'Back', days: 6 });
  });

  it('breaks a tie by the usual region order and ignores regions never trained', () => {
    expect(mostRestedRegion({ Back: 4, Legs: 4 })).toEqual({ region: 'Legs', days: 4 });
    expect(mostRestedRegion({})).toBeNull();
  });

  it('counts a region trained today as zero days, not as absent', () => {
    expect(mostRestedRegion({ Legs: 0 })).toEqual({ region: 'Legs', days: 0 });
  });
});

describe('partOfDay', () => {
  it('splits the day at noon and five', () => {
    expect([0, 11, 12, 16, 17, 23].map(partOfDay)).toEqual(['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
  });
});

describe('openFacts', () => {
  const base: OpenFactsInput = {
    weekday: 'Monday',
    hour: 9,
    rested: { region: 'Back', days: 6 },
    daysSinceSession: 2,
    kcal: 1234,
    protein: 87,
    kcalTarget: 2300,
    proteinTarget: 170,
    weighInDue: true,
  };

  it('carries the day, the most rested region, the last session, the food so far and the weigh-in', () => {
    expect(openFacts(base)).toEqual({
      weekday: 'Monday',
      timeOfDay: 'morning',
      mostRestedRegion: 'Back',
      daysSinceMostRestedRegion: 6,
      daysSinceLastSession: 2,
      caloriesSoFar: 1200,
      calorieTarget: 2300,
      proteinSoFarGrams: 90,
      proteinTargetGrams: 170,
      weighInDue: true,
    });
  });

  it('leaves out what is not known', () => {
    const f = openFacts({ ...base, rested: null, daysSinceSession: null, kcalTarget: null });
    expect(f.mostRestedRegion).toBeUndefined();
    expect(f.daysSinceLastSession).toBeUndefined();
    expect(f.calorieTarget).toBeUndefined();
  });

  it('does not change for a small snack, so the coach is not asked again for it', () => {
    expect(hashFacts(openFacts({ ...base, kcal: 1210 }))).toBe(hashFacts(openFacts({ ...base, kcal: 1249 })));
    expect(hashFacts(openFacts({ ...base, kcal: 1200 }))).not.toBe(hashFacts(openFacts({ ...base, kcal: 1400 })));
  });
});

describe('leadTopSet', () => {
  it('is the lead lift\'s heaviest counted set', () => {
    expect(
      leadTopSet([
        {
          name: 'Barbell Row',
          kind: 'reps',
          sets: [
            { type: 'working', weight: 70, reps: 8 },
            { type: 'working', weight: 80, reps: 6 },
            { type: 'working', weight: 80, reps: 8 },
            { type: 'warmup', weight: 100, reps: 3 },
          ],
        },
      ]),
    ).toBe('Barbell Row 80 kg × 8');
  });

  it('skips a lead lift with nothing counted and a carry, and takes the next lift', () => {
    expect(
      leadTopSet([
        { name: 'Farmer\'s Carry', kind: 'carry', sets: [{ type: 'working', weight: 40, reps: 1 }] },
        { name: 'Pull-up', kind: 'bodyweight_plus', sets: [] },
        { name: 'Lat Pulldown', kind: 'reps', sets: [{ type: 'working', weight: 60, reps: 10 }] },
      ]),
    ).toBe('Lat Pulldown 60 kg × 10');
  });

  it('words added weight and bodyweight the way the rest of the app does', () => {
    expect(leadTopSet([{ name: 'Dip', kind: 'bodyweight_plus', sets: [{ type: 'working', weight: 10, reps: 8 }] }])).toBe('Dip +10 kg × 8');
    expect(leadTopSet([{ name: 'Dip', kind: 'bodyweight_plus', sets: [{ type: 'working', weight: 0, reps: 12 }] }])).toBe('Dip bodyweight × 12');
  });

  it('is null when no exercise has a counted set', () => {
    expect(leadTopSet([])).toBeNull();
    expect(leadTopSet([{ name: 'Curl', kind: 'reps', sets: [{ type: 'warmup', weight: 5, reps: 10 }] }])).toBeNull();
  });
});

describe('planRow', () => {
  const rx = { targetSets: 4, repMin: 6, repMax: 8, mode: 'normal' as const };
  const row = (over: Partial<PlanRowInput> & { prescription?: Partial<PlanRowInput['prescription']> } = {}): ReturnType<typeof planRow> =>
    planRow({
      kind: 'reps',
      rx: { ...rx, ...(over.rx ?? {}) },
      prescription: { weight: 65, weightDelta: null, flags: [], ...(over.prescription ?? {}) },
      ...(over.kind ? { kind: over.kind } : {}),
    });

  it('gives the weight, the sets by reps, and no change when the weight stayed', () => {
    expect(row()).toEqual({ weight: '65 kg', scheme: '4 × 6–8', change: null, flags: [] });
  });

  it('shows a rise as ok and a drop as a warning', () => {
    expect(row({ prescription: { weight: 67.5, weightDelta: 2.5, flags: [] } }).change).toEqual({ text: '+2.5 kg', tone: 'ok' });
    expect(row({ prescription: { weight: 60, weightDelta: -5, flags: [] } }).change).toEqual({ text: '−5 kg', tone: 'warn' });
  });

  it('shows a range of sets as given', () => {
    expect(row({ rx: { ...rx, targetSetsMax: 5 } }).scheme).toBe('4–5 × 6–8');
  });

  it('says calibrating instead of a weight while the lift has none', () => {
    expect(row({ rx: { ...rx, mode: 'calibrating' }, prescription: { weight: null, weightDelta: null, flags: ['calibrating'] } })).toMatchObject({ weight: 'calibrating', flags: [] });
  });

  it('flags a stall, in words', () => {
    expect(row({ prescription: { weight: 65, weightDelta: null, flags: ['stalled'] } }).flags).toEqual(['Stalled']);
  });

  it('words added weight, a timed hold and a carry in their own ways', () => {
    expect(row({ kind: 'bodyweight_plus', prescription: { weight: 10, weightDelta: null, flags: [] } }).weight).toBe('+10 kg');
    expect(row({ kind: 'timed', rx: { ...rx, repMin: 30, repMax: 40 }, prescription: { weight: null, weightDelta: null, flags: [] } })).toMatchObject({ weight: null, scheme: '4 × 30–40 s' });
    expect(row({ kind: 'carry', rx: { ...rx, targetSets: 3, distanceMinM: 30, distanceMaxM: 40 }, prescription: { weight: null, weightDelta: null, flags: [] } })).toMatchObject({ weight: null, scheme: '3 walks · 30–40 m' });
  });
});
