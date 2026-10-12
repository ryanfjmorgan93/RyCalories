import { describe, expect, it } from 'vitest';
import { regionOfMuscle, regionRecency, restLabel, routinesByRest } from './routineOrder';
import type { MuscleGroup, Routine } from './types';

const routine = (id: string, order: number, extra: Partial<Routine> = {}): Routine => ({ id, name: id, order, isLowerBody: false, ...extra });

const PUSH = routine('push', 0);
const PULL = routine('pull', 1);
const LEGS = routine('legs', 2);

const musclesOf = new Map<string, MuscleGroup[]>([
  ['push', ['chest', 'chest', 'shoulders', 'triceps']],
  ['pull', ['lats', 'upper back', 'upper back', 'biceps', 'rear delts']],
  ['legs', ['quads', 'hamstrings', 'glutes', 'calves']],
]);

describe('regions', () => {
  it('maps a muscle to the one region it belongs to', () => {
    expect(regionOfMuscle('quads')).toBe('Legs');
    expect(regionOfMuscle('calves')).toBe('Legs');
    expect(regionOfMuscle('upper back')).toBe('Back');
    expect(regionOfMuscle('lats')).toBe('Back');
    expect(regionOfMuscle('rear delts')).toBe('Shoulders');
    expect(regionOfMuscle('triceps')).toBe('Arms');
    expect(regionOfMuscle('abs')).toBe('Core');
    expect(regionOfMuscle('lower back')).toBe('Core');
    expect(regionOfMuscle('chest')).toBe('Chest');
  });

  it('neck, full body and other belong to no region', () => {
    expect(regionOfMuscle('neck')).toBeNull();
    expect(regionOfMuscle('full body')).toBeNull();
    expect(regionOfMuscle('other')).toBeNull();
  });

  it('a region was last trained when its most recent muscle was; one never trained is absent', () => {
    expect(regionRecency({ quads: 9, calves: 3, chest: 1 })).toEqual({ Legs: 3, Chest: 1 });
    expect(regionRecency({})).toEqual({});
  });

  it('labels in plain words', () => {
    expect(restLabel('Back', 6)).toBe('Back last trained 6 days ago');
    expect(restLabel('Legs', 1)).toBe('Legs last trained yesterday');
    expect(restLabel('Chest', 0)).toBe('Chest trained today');
    expect(restLabel('Core', null)).toBe('Core not trained yet');
  });
});

describe('routinesByRest', () => {
  it('puts the routine whose muscles have rested longest first', () => {
    const recency = { chest: 2, shoulders: 2, triceps: 2, lats: 6, 'upper back': 6, biceps: 6, 'rear delts': 6, quads: 9, hamstrings: 9, glutes: 9, calves: 9 };
    const out = routinesByRest([PUSH, PULL, LEGS], musclesOf, recency);
    expect(out.map((r) => r.routine.id)).toEqual(['legs', 'pull', 'push']);
  });

  it('carries days since and the region names, most rested first, for a label like "Back last trained 6 days ago"', () => {
    const recency = { chest: 2, shoulders: 2, triceps: 2, lats: 6, 'upper back': 6, biceps: 1, 'rear delts': 3, quads: 9, hamstrings: 9, glutes: 9, calves: 9 };
    const out = routinesByRest([PUSH, PULL, LEGS], musclesOf, recency);
    const pull = out.find((r) => r.routine.id === 'pull')!;
    expect(pull.regions).toEqual(['Back', 'Shoulders', 'Arms']);
    expect(pull.daysSince).toBe(6);
    expect(pull.label).toBe('Back last trained 6 days ago');
    const legs = out.find((r) => r.routine.id === 'legs')!;
    expect(legs).toMatchObject({ regions: ['Legs'], daysSince: 9, label: 'Legs last trained 9 days ago' });
  });

  it('a region never trained leads, and reads "not trained yet"', () => {
    const out = routinesByRest([PUSH, PULL, LEGS], musclesOf, { chest: 1, shoulders: 1, triceps: 1, lats: 4, 'upper back': 4, biceps: 4, 'rear delts': 4 });
    expect(out[0].routine.id).toBe('legs');
    expect(out[0]).toMatchObject({ daysSince: null, label: 'Legs not trained yet' });
  });

  it('weights each region by how many of the routine\'s exercises hit it', () => {
    // Mostly chest (3 of 4), rested 2 days, with one back exercise rested 20: the chest day is not
    // "most rested" because of one row.
    const mostlyChest = routine('chest-day', 0);
    const mostlyLegs = routine('leg-day', 1);
    const m = new Map<string, MuscleGroup[]>([
      ['chest-day', ['chest', 'chest', 'chest', 'lats']],
      ['leg-day', ['quads', 'quads', 'hamstrings']],
    ]);
    const out = routinesByRest([mostlyChest, mostlyLegs], m, { chest: 2, lats: 20, quads: 7, hamstrings: 7 });
    expect(out.map((r) => r.routine.id)).toEqual(['leg-day', 'chest-day']);
  });

  it('a region the routine barely touches does not name it', () => {
    const big = routine('big', 0);
    const m = new Map<string, MuscleGroup[]>([['big', ['chest', 'chest', 'chest', 'chest', 'chest', 'chest', 'chest', 'chest', 'chest', 'biceps']]]);
    const [out] = routinesByRest([big], m, { chest: 2, biceps: 30 });
    expect(out.regions).toEqual(['Chest']);
    expect(out.label).toBe('Chest last trained 2 days ago');
  });

  it('leaves out archived and quick routines', () => {
    const archived = routine('old', 3, { archived: true });
    const quick = routine('quick', 4, { archived: true, quick: true });
    const m = new Map(musclesOf);
    m.set('old', ['quads']);
    m.set('quick', ['quads']);
    const out = routinesByRest([PUSH, archived, quick, PULL], m, { quads: 30 });
    expect(out.map((r) => r.routine.id)).toEqual(['push', 'pull']);
  });

  it('keeps the routine order for a tie, and puts a routine with no region last', () => {
    const empty = routine('empty', 0);
    const a = routine('a', 1);
    const b = routine('b', 2);
    const m = new Map<string, MuscleGroup[]>([
      ['a', ['chest']],
      ['b', ['chest']],
      ['empty', []],
    ]);
    const out = routinesByRest([empty, b, a], m, { chest: 5 });
    expect(out.map((r) => r.routine.id)).toEqual(['a', 'b', 'empty']);
    expect(out[2]).toMatchObject({ daysSince: null, regions: [], label: null });
  });

  it('a routine whose exercises map to no region (neck, full body) has no label', () => {
    const odd = routine('odd', 0);
    const [out] = routinesByRest([odd], new Map([['odd', ['neck', 'full body'] as MuscleGroup[]]]), {});
    expect(out).toMatchObject({ regions: [], daysSince: null, label: null });
  });

  it('does not change the routines it was given', () => {
    const input = [PUSH, PULL, LEGS];
    routinesByRest(input, musclesOf, { quads: 9 });
    expect(input.map((r) => r.id)).toEqual(['push', 'pull', 'legs']);
  });
});
