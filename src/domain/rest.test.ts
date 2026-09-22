import { describe, expect, it } from 'vitest';
import { shouldStartRest, type RestGroupMember } from './rest';

/**
 * Plays out a whole session against `shouldStartRest`, following the same rotation `currentKey`
 * uses in `LiveSessionScreen.tsx` (fewest counted sets so far, ties by array order): at each step,
 * the member with fewest counted sets under its own target logs next (ties broken by position in
 * `order`). Returns the `shouldStartRest` result recorded at every log, in log order.
 */
function simulate(order: { key: string; targetSets: number; skipped?: boolean }[], setType: 'working' | 'drop' = 'working'): boolean[] {
  const counted: Record<string, number> = {};
  for (const m of order) counted[m.key] = 0;
  const results: boolean[] = [];

  for (;;) {
    let next: (typeof order)[number] | null = null;
    for (const m of order) {
      if (m.skipped) continue;
      if (counted[m.key] >= m.targetSets) continue;
      if (!next || counted[m.key] < counted[next.key]) next = m;
    }
    if (!next) break;
    counted[next.key]++;
    const members: RestGroupMember[] = order.map((m) => ({ key: m.key, targetSets: m.targetSets, skipped: !!m.skipped, counted: counted[m.key] }));
    results.push(shouldStartRest(members, next.key, { type: setType }));
  }
  return results;
}

describe('shouldStartRest', () => {
  it('a lone slot always starts rest', () => {
    const members: RestGroupMember[] = [{ key: 'a', targetSets: 3, skipped: false, counted: 1 }];
    expect(shouldStartRest(members, 'a', { type: 'working' })).toBe(true);
    expect(shouldStartRest(members, 'a', { type: 'failure' })).toBe(true);
  });

  it('a drop set never starts rest, alone or in a superset', () => {
    const lone: RestGroupMember[] = [{ key: 'a', targetSets: 3, skipped: false, counted: 4 }];
    expect(shouldStartRest(lone, 'a', { type: 'drop' })).toBe(false);

    const superset: RestGroupMember[] = [
      { key: 'a', targetSets: 3, skipped: false, counted: 3 },
      { key: 'b', targetSets: 3, skipped: false, counted: 0 },
    ];
    expect(shouldStartRest(superset, 'a', { type: 'drop' })).toBe(false);
  });

  it('unequal targets A(3) B(4), array order [A, B]: the longer member finishes alone and its solo sets each start rest', () => {
    const results = simulate([
      { key: 'a', targetSets: 3 },
      { key: 'b', targetSets: 4 },
    ]);
    // A,B,A,B,A,B,B — the round alternates until A hits its target, then B logs two solo sets.
    expect(results).toEqual([false, true, false, true, false, true, true]);
    expect(results[results.length - 1]).toBe(true); // B's final, solo set must start rest.
  });

  it('unequal targets A(3) B(4), array order [B, A]: the same fix holds regardless of array order', () => {
    const results = simulate([
      { key: 'b', targetSets: 4 },
      { key: 'a', targetSets: 3 },
    ]);
    expect(results).toEqual([false, true, false, true, false, true, true]);
    expect(results[results.length - 1]).toBe(true);
  });

  it('a skipped member never blocks rest — the active member always rests, like a lone slot', () => {
    const members: RestGroupMember[] = [
      { key: 'a', targetSets: 3, skipped: false, counted: 2 },
      { key: 'b', targetSets: 3, skipped: true, counted: 0 },
    ];
    expect(shouldStartRest(members, 'a', { type: 'working' })).toBe(true);
  });

  it('three members: rest waits for the last member of the round, not the array position', () => {
    // A and B have both already logged once this round; C's set completes it.
    const roundComplete: RestGroupMember[] = [
      { key: 'a', targetSets: 3, skipped: false, counted: 1 },
      { key: 'b', targetSets: 3, skipped: false, counted: 1 },
      { key: 'c', targetSets: 3, skipped: false, counted: 1 },
    ];
    expect(shouldStartRest(roundComplete, 'c', { type: 'working' })).toBe(true);

    // B hasn't gone yet this round when C logs out of turn — B is still owed, so no rest.
    const midRound: RestGroupMember[] = [
      { key: 'a', targetSets: 3, skipped: false, counted: 1 },
      { key: 'b', targetSets: 3, skipped: false, counted: 0 },
      { key: 'c', targetSets: 3, skipped: false, counted: 1 },
    ];
    expect(shouldStartRest(midRound, 'c', { type: 'working' })).toBe(false);
  });

  it('equal targets A(4) B(4): rest alternates false/true with the A/B/A/B rotation', () => {
    const results = simulate([
      { key: 'a', targetSets: 4 },
      { key: 'b', targetSets: 4 },
    ]);
    expect(results).toEqual([false, true, false, true, false, true, false, true]);
  });
});
