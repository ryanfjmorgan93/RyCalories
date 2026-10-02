import { describe, expect, it } from 'vitest';
import { cand, miniInput, seededInput, seedsFrom } from '../test/routineFixtures';
import { movementPattern } from './movement';
import { resolveOptions } from './quickRequest';
import { PATTERN_PENALTY, generateQuickSession, type Candidate } from './quickSession';

const SEEDS = seedsFrom(400);
const patternsOf = (rows: { candidate: Candidate }[]) => rows.map((r) => movementPattern(r.candidate.name, r.candidate.muscleGroup));

describe('a short session does not take one movement twice while another is on offer', () => {
  const pool = [
    cand('DB Shoulder Press', 'shoulders', { compound: true, weight: 18 }),
    cand('Arnold Press', 'shoulders', { compound: true, weight: 14 }),
    cand('Seated Dumbbell Shoulder Press', 'shoulders', { compound: true, weight: 16 }),
    cand('Lateral Raise', 'shoulders', { weight: 8 }),
  ];
  const options = resolveOptions({ focus: ['shoulders'], count: 2 });

  it('draws a lateral raise beside a press far more often than a second press', () => {
    let twoPresses = 0;
    for (const seed of SEEDS) {
      const plan = generateQuickSession(miniInput(pool), options, seed);
      if (patternsOf(plan.rows).filter((p) => p === 'press-vertical').length === 2) twoPresses++;
    }
    // Without the penalty: three presses to one raise, two presses about two draws in three.
    expect(twoPresses / SEEDS.length).toBeLessThan(0.25);
    expect(PATTERN_PENALTY).toBe(0.05);
  });

  it('control: a muscle whose exercises are all one movement is not penalised for having them', () => {
    const presses = pool.slice(0, 3);
    const counts = new Map<string, number>();
    for (const seed of SEEDS) {
      for (const row of generateQuickSession(miniInput(presses), options, seed).rows) counts.set(row.candidate.name, (counts.get(row.candidate.name) ?? 0) + 1);
    }
    // Two of three, so each is in about two plans in three, and every one of them is used.
    for (const name of presses.map((c) => c.name)) expect(counts.get(name) ?? 0, name).toBeGreaterThan(SEEDS.length * 0.5);
  });

  it('is a fraction, not a ban: when only one movement is left, it is still taken', () => {
    const two = [cand('DB Shoulder Press', 'shoulders', { compound: true }), cand('Arnold Press', 'shoulders', { compound: true })];
    for (const seed of seedsFrom(40)) {
      const plan = generateQuickSession(miniInput(two), options, seed);
      expect(plan.rows).toHaveLength(2);
      expect(plan.shortfall).toBe(0);
    }
  });

  it('a name no rule can place is its muscle group, and two of those are one movement', () => {
    const unknown = [cand('Zxqv One', 'shoulders'), cand('Zxqv Two', 'shoulders'), cand('Lateral Raise', 'shoulders')];
    expect(movementPattern('Zxqv One', 'shoulders')).toBe('shoulders');
    let both = 0;
    for (const seed of SEEDS) {
      const names = generateQuickSession(miniInput(unknown), resolveOptions({ focus: ['shoulders'], count: 2 }), seed).rows.map((r) => r.candidate.name);
      if (names.every((n) => n.startsWith('Zxqv'))) both++;
    }
    expect(both / SEEDS.length).toBeLessThan(0.25);
  });
});

describe('a short session in the real library', () => {
  const real = seededInput({ context: null });
  const request = resolveOptions({ focus: ['shoulders', 'rear delts'], count: 4, includeNew: true });

  it('is four different movements over 400 seeds', () => {
    let repeats = 0;
    for (const seed of SEEDS) {
      const p = patternsOf(generateQuickSession(real, request, seed).rows);
      if (new Set(p).size < p.length) repeats++;
    }
    // Rarely: the penalty is a fraction, and a press can still be drawn twice when the rest are taken.
    expect(repeats / SEEDS.length).toBeLessThan(0.05);
  });

  it('is deterministic: the same seed gives the same session', () => {
    expect(generateQuickSession(real, request, 9)).toEqual(generateQuickSession(real, request, 9));
  });
});
