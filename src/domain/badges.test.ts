import { describe, expect, it } from 'vitest';
import { badgeCount, ladders, nearestBadge, newBadges, type BadgeFacts } from './badges';

const facts = (over: Partial<BadgeFacts> = {}): BadgeFacts => ({ sessions: 0, liftedKg: 0, totalLevel: 0, lifts: [], ...over });
const byId = (f: BadgeFacts, id: string) => ladders(f).find((l) => l.id === id)!;

describe('the ladders', () => {
  it('hold nothing at nothing, and name the first mark of each', () => {
    const all = ladders(facts());
    expect(all.map((l) => l.id)).toEqual(['sessions', 'tonnes', 'level']);
    expect(badgeCount(all)).toBe(0);
    expect(all.map((l) => l.next)).toEqual([
      { name: '10 sessions', chip: '10', toGo: '10 to go', done: 0 },
      { name: '10 tonnes lifted', chip: '10 t', toGo: '10 t to go', done: 0 },
      { name: 'Total level 5', chip: '5', toGo: '5 to go', done: 0 },
    ]);
  });

  it('count sessions: a mark is held from the session that reaches it', () => {
    expect(byId(facts({ sessions: 9 }), 'sessions')).toMatchObject({ earned: [], next: { name: '10 sessions', toGo: '1 to go' } });
    expect(byId(facts({ sessions: 10 }), 'sessions')).toMatchObject({ earned: ['10 sessions'], chips: ['10'], next: { name: '25 sessions', toGo: '15 to go', done: 0 } });
    // 21 is 11 of the 15 between 10 and 25.
    const at21 = byId(facts({ sessions: 21 }), 'sessions');
    expect(at21.next).toMatchObject({ name: '25 sessions', toGo: '4 to go' });
    expect(at21.next!.done).toBeCloseTo(11 / 15, 9);
    expect(byId(facts({ sessions: 500 }), 'sessions')).toMatchObject({ chips: ['10', '25', '50', '100', '250', '500'], next: null });
  });

  it('round what is left of a tonne up, never down', () => {
    // 185,584 kg: 64.416 t short of 250, said as 64.5.
    const t = byId(facts({ liftedKg: 185_584 }), 'tonnes');
    expect(t.earned).toEqual(['10 tonnes lifted', '50 tonnes lifted', '100 tonnes lifted']);
    expect(t.chips).toEqual(['10 t', '50 t', '100 t']);
    expect(t.next).toMatchObject({ name: '250 tonnes lifted', chip: '250 t', toGo: '64.5 t to go' });
    // A kilo short is not there, and is not "0 t to go".
    expect(byId(facts({ liftedKg: 9_999 }), 'tonnes')).toMatchObject({ earned: [], next: { toGo: '0.1 t to go' } });
    expect(byId(facts({ liftedKg: 10_000 }), 'tonnes').earned).toEqual(['10 tonnes lifted']);
    expect(byId(facts({ liftedKg: 1_000_000 }), 'tonnes')).toMatchObject({ next: null });
    expect(byId(facts({ liftedKg: 1_000_000 }), 'tonnes').earned.at(-1)).toBe('1,000 tonnes lifted');
  });

  it('count the total level', () => {
    expect(byId(facts({ totalLevel: 20 }), 'level')).toMatchObject({
      earned: ['Total level 5', 'Total level 10', 'Total level 15'],
      next: { name: 'Total level 25', toGo: '5 to go', done: 0.5 },
    });
  });

  it('give each barbell lift its own, in 20 kg steps from 60, by name', () => {
    const all = ladders(
      facts({
        lifts: [
          { id: 'rdl', name: 'Romanian Deadlift (Barbell)', kg: 110 },
          { id: 'bench', name: 'Bench Press (Barbell)', kg: 75 },
          { id: 'curl', name: 'Barbell Curl', kg: 30 },
        ],
      }),
    );
    expect(all.slice(3).map((l) => l.id)).toEqual(['lift:curl', 'lift:bench', 'lift:rdl']);
    expect(all[3]).toMatchObject({ title: 'Barbell Curl', earned: [], next: { name: '60 kg Barbell Curl', toGo: '30 kg to go', done: 0.5 } });
    expect(all[4]).toMatchObject({ earned: ['60 kg Bench Press (Barbell)'], chips: ['60 kg'], next: { name: '80 kg Bench Press (Barbell)', chip: '80 kg', toGo: '5 kg to go', done: 0.75 } });
    expect(all[5]).toMatchObject({ chips: ['60 kg', '80 kg', '100 kg'], next: { name: '120 kg Romanian Deadlift (Barbell)', toGo: '10 kg to go' } });
    // A mark is held at its weight, and half a kilo under it is not there.
    expect(byId(facts({ lifts: [{ id: 'b', name: 'Bench', kg: 99.5 }] }), 'lift:b')).toMatchObject({ chips: ['60 kg', '80 kg'], next: { toGo: '0.5 kg to go' } });
    expect(byId(facts({ lifts: [{ id: 'b', name: 'Bench', kg: 100 }] }), 'lift:b').earned.at(-1)).toBe('100 kg Bench');
    expect(byId(facts({ lifts: [{ id: 'b', name: 'Bench', kg: 300 }] }), 'lift:b')).toMatchObject({ next: null });
  });
});

describe('the nearest badge', () => {
  it('is the one furthest along its step, the earlier ladder on a tie, and none when every ladder is full', () => {
    // Sessions 21 is 73% of the way to 25; the bench at 75 kg is 75% of the way to 80.
    const f = facts({ sessions: 21, liftedKg: 185_584, totalLevel: 20, lifts: [{ id: 'bench', name: 'Bench Press (Barbell)', kg: 75 }] });
    expect(nearestBadge(ladders(f))).toMatchObject({ name: '80 kg Bench Press (Barbell)', toGo: '5 kg to go' });
    expect(nearestBadge(ladders(facts({ sessions: 5, totalLevel: 0 })))).toMatchObject({ name: '10 sessions' });
    expect(nearestBadge(ladders(facts()))).toMatchObject({ name: '10 sessions' });
    expect(nearestBadge([])).toBeNull();
  });
});

describe('the badges a session added', () => {
  it('are the highest new mark of each ladder that moved', () => {
    const before = ladders(facts({ sessions: 9, liftedKg: 9_000, totalLevel: 4, lifts: [{ id: 'sq', name: 'Squat', kg: 50 }] }));
    const after = ladders(facts({ sessions: 10, liftedKg: 9_900, totalLevel: 5, lifts: [{ id: 'sq', name: 'Squat', kg: 100 }] }));
    // The squat passed 60, 80 and 100 in one set: it is said once, as 100.
    expect(newBadges(before, after)).toEqual(['10 sessions', 'Total level 5', '100 kg Squat']);
    expect(newBadges(after, after)).toEqual([]);
  });

  it('count a lift that was not there before from nothing', () => {
    const after = ladders(facts({ lifts: [{ id: 'sq', name: 'Squat', kg: 60 }] }));
    expect(newBadges(ladders(facts()), after)).toEqual(['60 kg Squat']);
    expect(newBadges(ladders(facts()), ladders(facts({ lifts: [{ id: 'sq', name: 'Squat', kg: 59.5 }] })))).toEqual([]);
  });
});
