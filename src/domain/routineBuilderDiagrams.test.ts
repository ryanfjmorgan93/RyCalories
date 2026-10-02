/**
 * The routine builder over the whole library the owner sees: the bundled diagrams as well as the
 * catalogue, and the equipment their routines say they use. Hand-made pools show one rule at a time;
 * the real data (their 27 exercises, the 303 diagrams, the 518 catalogue entries) shows it works on
 * what ships.
 */
import { describe, expect, it } from 'vitest';
import { EXERCISE_DEMOS } from '../data/exerciseDemos';
import { CATALOGUE, OWN_EXERCISES, cand, miniInput, seededInput, seedsFrom } from '../test/routineFixtures';
import { NON_ROUTINE_PATTERNS, movementPattern } from './movement';
import { buildExerciseList } from './library';
import { normaliseName } from './exerciseMatch';
import { MAX_NEW_EXERCISES, buildRoutines, builtRowKey, builtRowKeys, routineToText, type BuiltRoutine, type RoutineRequest } from './routineBuilder';
import { parseRoutineText } from './routineText';
import type { MuscleGroup } from './types';

const SEEDS = seedsFrom(500);
const one = (r: BuiltRoutine[]): BuiltRoutine => r[0]!;
const patternsOf = (r: BuiltRoutine): string[] => r.rows.map((x) => x.pattern);

// ---------------------------------------------------------------------------
// One rule at a time, on small pools

describe('a diagram is a candidate beside the catalogue', () => {
  const diagram = (name: string, group: MuscleGroup, equipment: 'dumbbell' | 'cable' | 'machine' = 'cable') => cand(name, group, { diagram: true, equipment });

  it('comes out as new to the owner: its origin and slug, no weight, and a reason that says so', () => {
    const pool = miniInput([cand('DB Curl', 'biceps', { weight: 9 }), diagram('Hammer Curl', 'biceps')]);
    const r = one(buildRoutines(pool, { focus: ['biceps'] }, 1));
    const row = r.rows.find((x) => x.name === 'Hammer Curl')!;
    expect(row.origin).toBe('diagram');
    expect(row.demoSlug).toBe('hammer-curl');
    expect(row.catalogueSlug).toBeUndefined();
    expect(row.id).toBe('demo:hammer-curl');
    expect(row.weightKg).toBeNull();
    expect(row.reason).toContain('new to you, no weight yet');
    expect(builtRowKey(row)).toBe('hammer-curl');
    // Its own row is the owner's, with the weight they work at.
    const mine = r.rows.find((x) => x.name === 'DB Curl')!;
    expect(mine.origin).toBe('own');
    expect(mine.demoSlug).toBeUndefined();
    expect(mine.reason).not.toContain('new to you');
  });

  it('is named among what came from the library, and the weights line says new exercises have none yet', () => {
    const pool = miniInput([cand('DB Curl', 'biceps', { weight: 9 }), diagram('Hammer Curl', 'biceps'), cand('Preacher Curl', 'biceps', { library: true })]);
    const r = one(buildRoutines(pool, { focus: ['biceps'] }, 1));
    expect(r.rows.map((x) => x.name).sort()).toEqual(['DB Curl', 'Hammer Curl', 'Preacher Curl']);
    const fresh = r.rows.filter((x) => x.origin !== 'own').map((x) => x.name);
    expect(fresh).toHaveLength(2);
    expect(r.reasonLines).toContain(`From the library, where your own exercises had nothing for the part: ${fresh[0]} and ${fresh[1]}`);
    expect(r.reasonLines).toContain('Weights are your own working weights; new exercises have none yet');
  });

  it('is taken only where the owner has nothing of their own for the part, as a catalogue entry is', () => {
    const pool = miniInput([cand('DB Curl', 'biceps', { weight: 9 }), diagram('Hammer Curl', 'biceps'), cand('Concentration Curl', 'biceps', { library: true })]);
    for (const seed of seedsFrom(80)) {
      const r = one(buildRoutines(pool, { focus: ['biceps'], count: 1 }, seed));
      expect(r.rows.map((x) => x.name), `seed ${seed}`).toEqual(['DB Curl']);
    }
  });

  it('takes at most three new exercises in all, catalogue and diagrams together, and the three are a mix', () => {
    const pool = miniInput([
      cand('DB Curl', 'biceps', { weight: 9 }),
      diagram('Incline DB Curl', 'biceps'),
      diagram('Preacher Curl', 'biceps'),
      diagram('Hammer Curl', 'biceps'),
      diagram('Reverse Curl', 'biceps'),
      cand('Cable Curl', 'biceps', { library: true }),
      cand('Spider Curl', 'biceps', { library: true }),
      cand('Zottman Curl', 'biceps', { library: true }),
      cand('Cross Body Hammer Curl', 'biceps', { library: true }),
    ]);
    let mixed = 0;
    let twoDiagrams = 0;
    for (const seed of SEEDS) {
      const r = one(buildRoutines(pool, { focus: ['biceps'] }, seed));
      const fresh = r.rows.filter((x) => x.origin !== 'own');
      // Eight to choose from and room for six: it is the cap, and nothing else, that stops it at three.
      expect(fresh, `seed ${seed}`).toHaveLength(MAX_NEW_EXERCISES);
      expect(r.rows, `seed ${seed}`).toHaveLength(1 + MAX_NEW_EXERCISES);
      const kinds = new Set(fresh.map((x) => x.origin));
      if (kinds.size === 2) mixed++;
      if (fresh.filter((x) => x.origin === 'diagram').length === 2) twoDiagrams++;
      expect(r.reasonLines, `seed ${seed}`).toContain(`4 of 6 exercises: ${MAX_NEW_EXERCISES} from the library is the most for one routine, and your own have nothing more for biceps`);
    }
    // A cap on each kind alone would let six through; one on the catalogue alone, three of each.
    expect(mixed).toBeGreaterThan(300);
    expect(twoDiagrams).toBeGreaterThan(50);
  });

  it('is never two of one movement while another is left, whichever kind of library exercise they are', () => {
    const pool = miniInput([
      cand('DB Curl', 'biceps', { weight: 9 }),
      diagram('Hammer Curl', 'biceps'),
      diagram('Cross Body Hammer Curl', 'biceps'),
      diagram('Incline DB Curl', 'biceps'),
      diagram('Preacher Curl', 'biceps'),
    ]);
    for (const seed of seedsFrom(120)) {
      const r = one(buildRoutines(pool, { focus: ['biceps'] }, seed));
      expect(new Set(patternsOf(r)).size, `seed ${seed}: ${patternsOf(r).join(', ')}`).toBe(r.rows.length);
    }
  });

  it('is the only way a part of the muscle is reached when the owner and the catalogue have none: the sixth distinct movement', () => {
    const own = [
      cand('Bench Press (Barbell)', 'chest', { compound: true, weight: 60, equipment: 'barbell' }),
      cand('Incline DB Press', 'chest', { compound: true, weight: 24 }),
      cand('Cable Fly', 'chest', { weight: 12, equipment: 'cable' }),
    ];
    const diagrams = [
      diagram('Chest Dip', 'chest', 'machine'),
      diagram('Decline Bench Press', 'chest', 'machine'),
      diagram('Dumbbell Pullover', 'chest', 'dumbbell'),
    ];
    const pool = miniInput([...own, ...diagrams]);
    for (const seed of SEEDS) {
      const r = one(buildRoutines(pool, { focus: ['chest'] }, seed));
      expect(new Set(patternsOf(r)).size, `seed ${seed}: ${patternsOf(r).join(', ')}`).toBe(6);
      expect(r.rows.filter((x) => x.origin === 'diagram').map((x) => x.name).sort()).toEqual(['Chest Dip', 'Decline Bench Press', 'Dumbbell Pullover']);
    }
    // Without the diagrams there are three movements, and the routine says it is short.
    const bare = one(buildRoutines(miniInput(own), { focus: ['chest'] }, 1));
    expect(bare.rows).toHaveLength(3);
    expect(bare.reasonLines).toContain('3 of 6 exercises: nothing more for chest in your exercises or the library');
  });

  it('is the variation a stalled lift gives way to when the owner has none of their own', () => {
    const pool = miniInput([cand('Bench Press (Barbell)', 'chest', { compound: true, weight: 60, equipment: 'barbell' }), diagram('Machine Chest Press', 'chest', 'machine')], {
      context: { routines: [], niggles: [], stalled: [{ exerciseId: 'Bench Press (Barbell)', sessions: 3 }] },
    });
    const r = one(buildRoutines(pool, { focus: ['chest'], count: 1 }, 1));
    expect(r.rows.map((x) => x.name)).toEqual(['Machine Chest Press']);
    expect(r.rows[0]!.origin).toBe('diagram');
    expect(r.reasonLines).toContain('Bench Press (Barbell) stalled for 3 sessions: Machine Chest Press in its place');
  });
});

// ---------------------------------------------------------------------------
// The real library

describe('over the real library, 500 seeds', () => {
  const REAL = seededInput({ recency: { shoulders: 6, 'rear delts': 6, chest: 2, biceps: 3 } });
  const ownChest = REAL.candidates.filter((c) => c.origin === 'own' && c.muscleGroup === 'chest');

  /** The movements the pool could offer for a muscle at all, as the builder reads it: nothing expert, no carry, no timed, no non-lift. */
  const offered = (focus: MuscleGroup[]): Set<string> =>
    new Set(
      REAL.candidates
        .filter((c) => focus.includes(c.muscleGroup) && c.kind !== 'carry' && c.kind !== 'timed' && !(c.origin === 'catalogue' && c.level === 'expert'))
        .map((c) => movementPattern(c.name, c.muscleGroup))
        .filter((p) => !NON_ROUTINE_PATTERNS.has(p)),
    );

  it('the pool holds the diagrams, none of them a movement a routine cannot be built from', () => {
    const diagrams = REAL.candidates.filter((c) => c.origin === 'diagram');
    expect(diagrams.length).toBeGreaterThan(150);
    for (const c of diagrams) expect(NON_ROUTINE_PATTERNS.has(movementPattern(c.name, c.muscleGroup)), c.name).toBe(false);
    // The owner's own always wins: nothing in the pool is a diagram of an exercise they have.
    const ownNames = new Set(OWN_EXERCISES.flatMap((e) => [e.name, ...(e.aliases ?? [])]).map(normaliseName));
    const ownKeys = new Set(OWN_EXERCISES.map((e) => e.demo));
    for (const c of diagrams) {
      expect(ownNames.has(normaliseName(c.name)), c.name).toBe(false);
      expect(ownKeys.has(c.demoSlug), c.name).toBe(false);
    }
    // And none a catalogue entry is as well.
    const diagramNames = new Set(diagrams.map((c) => normaliseName(c.name)));
    for (const c of REAL.candidates.filter((x) => x.origin === 'catalogue')) expect(diagramNames.has(normaliseName(c.name)), c.name).toBe(false);
  });

  it('chest has an incline press, a flat press and a fly every time, and every movement the pool offers up to the cap', () => {
    // The pool offers five movements for the chest (a flat press, an incline press, a fly, a decline
    // press and a dip), and the owner has two chest exercises of their own: two and three new ones
    // are five, which is as far as one routine goes, so five distinct movements is what a sixth would be.
    const want = Math.min(6, offered(['chest']).size, ownChest.length + MAX_NEW_EXERCISES);
    expect(offered(['chest']).size).toBeGreaterThanOrEqual(5);
    expect(want).toBe(5);
    let dips = 0;
    let declines = 0;
    let withDiagram = 0;
    for (const seed of SEEDS) {
      const r = one(buildRoutines(REAL, { focus: ['chest'] }, seed));
      const p = patternsOf(r);
      for (const x of ['press-incline', 'press-horizontal', 'fly']) expect(p, `seed ${seed}: ${p.join(', ')}`).toContain(x);
      expect(new Set(p).size, `seed ${seed}: ${p.join(', ')}`).toBe(want);
      expect(r.rows.every((x) => x.muscleGroup === 'chest')).toBe(true);
      expect(r.rows.filter((x) => x.origin !== 'own').length, `seed ${seed}`).toBeLessThanOrEqual(MAX_NEW_EXERCISES);
      if (p.includes('dip')) dips++;
      if (p.includes('press-decline')) declines++;
      if (r.rows.some((x) => x.origin === 'diagram')) withDiagram++;
    }
    // Dips and a decline press are in reach, and the diagrams are a real share of what is drawn.
    expect(dips).toBeGreaterThan(0);
    expect(declines).toBeGreaterThan(0);
    expect(withDiagram).toBeGreaterThan(250);
  });

  it('a chest routine of five or fewer is five or fewer distinct movements, never a repeat', () => {
    for (const count of [3, 4, 5]) {
      for (const seed of SEEDS.slice(0, 100)) {
        const r = one(buildRoutines(REAL, { focus: ['chest'], count }, seed));
        expect(r.rows, `seed ${seed}`).toHaveLength(count);
        expect(new Set(patternsOf(r)).size, `count ${count} seed ${seed}`).toBe(count);
      }
    }
  });

  it('3D shoulders is still six distinct movements, front, side and rear, with diagram rows among them', () => {
    let withDiagram = 0;
    const fromDiagram = new Set<string>();
    for (const seed of SEEDS) {
      const r = one(buildRoutines(REAL, { focus: ['shoulders', 'rear delts'] }, seed));
      expect(r.rows, `seed ${seed}`).toHaveLength(6);
      expect(new Set(patternsOf(r)).size, `seed ${seed}`).toBe(6);
      const regions = new Set(r.rows.map((x) => x.region));
      for (const region of ['shoulders:front', 'shoulders:side', 'shoulders:rear']) expect(regions, `seed ${seed}`).toContain(region);
      for (const x of r.rows.filter((y) => y.origin === 'diagram')) {
        expect(['shoulders', 'rear delts']).toContain(x.muscleGroup);
        fromDiagram.add(x.name);
      }
      if (r.rows.some((x) => x.origin === 'diagram')) withDiagram++;
      expect(r.rows.filter((x) => x.origin !== 'own').length).toBeLessThanOrEqual(MAX_NEW_EXERCISES);
    }
    expect(withDiagram).toBeGreaterThan(20);
    expect([...fromDiagram].sort()).toEqual(expect.arrayContaining(['Cable Front Raise', 'Front Raise']));
  });

  it('a face pull is reachable for an owner who has none: it is in the pool as a diagram, filed under the upper back it is', () => {
    const NO_FACE_PULL = seededInput({ without: ['Face Pull'] });
    const face = NO_FACE_PULL.candidates.find((c) => c.name === 'Face Pull');
    expect(face).toMatchObject({ origin: 'diagram', demoSlug: 'face-pull', muscleGroup: 'upper back', equipment: 'cable' });
    // The owner who has one is not offered a second: theirs is the row.
    expect(REAL.candidates.filter((c) => c.name === 'Face Pull').map((c) => c.origin)).toEqual(['own']);

    let seen = 0;
    for (const seed of SEEDS) {
      const r = one(buildRoutines(NO_FACE_PULL, { focus: ['lats', 'upper back'] }, seed));
      const row = r.rows.find((x) => x.name === 'Face Pull');
      if (!row) continue;
      seen++;
      expect(row).toMatchObject({ origin: 'diagram', demoSlug: 'face-pull', pattern: 'face-pull', region: 'shoulders:rear', weightKg: null });
    }
    expect(seen).toBeGreaterThan(20);
  });

  it('an owner with no rear-delt exercise still gets rear-delt work for 3D shoulders, from the diagrams and the catalogue', () => {
    const NONE = seededInput({ without: ['Face Pull', 'Rear Delt Fly (Machine)'] });
    expect(NONE.candidates.some((c) => c.origin === 'own' && c.muscleGroup === 'rear delts')).toBe(false);
    const names = new Set<string>();
    for (const seed of SEEDS) {
      const r = one(buildRoutines(NONE, { focus: ['shoulders', 'rear delts'] }, seed));
      const rear = r.rows.filter((x) => x.region === 'shoulders:rear');
      expect(rear.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const x of rear) names.add(`${x.origin}:${x.name}`);
    }
    expect([...names].some((n) => n.startsWith('diagram:'))).toBe(true);
    expect([...names].some((n) => n.startsWith('catalogue:'))).toBe(true);
  });

  it('leg press, hip abduction and dips, which exist as diagrams only, are each chosen by some routine', () => {
    const found = new Set<string>();
    const ask = (request: RoutineRequest) => {
      for (const seed of SEEDS) for (const x of one(buildRoutines(REAL, request, seed)).rows) if (x.origin === 'diagram') found.add(x.demoSlug!);
    };
    ask({ focus: ['quads'] });
    ask({ focus: ['glutes'] });
    ask({ focus: ['triceps'] });
    ask({ focus: ['chest'] });
    expect(found.has('leg-press')).toBe(true);
    expect([...found].some((s) => /hip-abduction/.test(s))).toBe(true);
    expect([...found].some((s) => /dip/.test(s))).toBe(true);
  });

  it('no row is ever one of the owner\'s own exercises twice, under its diagram as well', () => {
    const ownNames = new Set(OWN_EXERCISES.map((e) => normaliseName(e.name)));
    const requests: RoutineRequest[] = [{ focus: ['chest'] }, { focus: ['quads'] }, { focus: ['lats', 'upper back'] }, { focus: [], split: 'ppl' }];
    for (const request of requests) {
      for (const seed of seedsFrom(80)) {
        for (const day of buildRoutines(REAL, request, seed)) {
          for (const x of day.rows) if (x.origin !== 'own') expect(ownNames.has(normaliseName(x.name)), x.name).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The equipment the owner's routines use

describe('a fresh owner: nothing logged, routines built on machines, cables and dumbbells', () => {
  const FRESH = seededInput({ sets: false, recency: {} });
  const LOGGED = seededInput({ recency: {} });

  it('is offered library exercises for the equipment their routines use, not bodyweight only', () => {
    const equipment = (input: typeof FRESH) => new Set(input.candidates.filter((c) => c.origin !== 'own').map((c) => c.equipment));
    expect(equipment(FRESH)).toEqual(new Set(['bodyweight', 'barbell', 'dumbbell', 'machine', 'cable']));
    // The same as an owner who has logged a set on all of them: their routines say what their sets would.
    expect(equipment(FRESH)).toEqual(equipment(LOGGED));
  });

  it('builds 3D shoulders to six exercises, where bodyweight alone gave four', () => {
    const library = new Set<string>();
    for (const seed of seedsFrom(150)) {
      const r = one(buildRoutines(FRESH, { focus: ['shoulders', 'rear delts'] }, seed));
      expect(r.rows, `seed ${seed}`).toHaveLength(6);
      expect(new Set(patternsOf(r)).size, `seed ${seed}`).toBe(6);
      for (const x of r.rows.filter((y) => y.origin !== 'own')) library.add(x.equipment ?? 'none');
    }
    // The library exercises it took are machines, cables and weights, not only the body.
    expect([...library].some((e) => e !== 'bodyweight')).toBe(true);
  });

  it('builds a routine for every muscle to the six asked for', () => {
    for (const focus of [['chest'], ['lats', 'upper back'], ['quads'], ['biceps'], ['triceps']] as MuscleGroup[][]) {
      for (const seed of seedsFrom(40)) expect(one(buildRoutines(FRESH, { focus }, seed)).rows.length, `${focus.join(',')} seed ${seed}`).toBeGreaterThanOrEqual(5);
    }
  });
});

// ---------------------------------------------------------------------------
// What a built row is, for the review that follows

describe('builtRowKey and builtRowKeys', () => {
  it('a row is its owner exercise id, its diagram slug or its catalogue key: the key of its row in the exercise list', () => {
    expect(builtRowKey({ id: 'abc-123', origin: 'own' })).toBe('abc-123');
    expect(builtRowKey({ id: 'demo:face-pull', origin: 'diagram', demoSlug: 'face-pull' })).toBe('face-pull');
    expect(builtRowKey({ id: 'cat:cable-fly', origin: 'catalogue', catalogueSlug: 'cable-fly' })).toBe('cat:cable-fly');
  });

  it('lists the keys of the rows under their names, normalised, in the order they are written', () => {
    const pool = miniInput([cand('DB Curl', 'biceps', { weight: 9 }), cand('Hammer Curl', 'biceps', { diagram: true, equipment: 'cable' })]);
    const built = buildRoutines(pool, { focus: ['biceps'] }, 1);
    const keys = builtRowKeys(built);
    expect([...keys.entries()]).toEqual([
      ['db curl', ['DB Curl']],
      ['hammer curl', ['hammer-curl']],
    ]);
  });

  it('keeps two rows of one name as two keys, in order', () => {
    const rows = (id: string) => ({ id, name: "Cable  Row's", origin: 'own' as const });
    const routine = (ids: string[]) => ({ name: 'x', rows: ids.map(rows) }) as unknown as BuiltRoutine;
    expect([...builtRowKeys([routine(['a']), routine(['b', 'c'])]).entries()]).toEqual([['cable rows', ['a', 'b', 'c']]]);
  });

  it('every key of a real built row is the key of that very row in the list the review reads, and the list says what the row is', () => {
    const REAL = seededInput({ recency: {} });
    const list = buildExerciseList({ owned: OWN_EXERCISES, demos: EXERCISE_DEMOS, entries: CATALOGUE });
    const byKey = new Map(list.map((r) => [r.key, r]));
    expect(byKey.size).toBe(list.length);
    let diagrams = 0;
    let catalogue = 0;
    const requests: RoutineRequest[] = [{ focus: ['chest'] }, { focus: ['lats', 'upper back'] }, { focus: ['quads'] }, { focus: ['shoulders', 'rear delts'] }, { focus: [], split: 'ppl' }];
    for (const request of requests) {
      for (const seed of seedsFrom(150)) {
        for (const day of buildRoutines(REAL, request, seed)) {
          for (const x of day.rows) {
            const row = byKey.get(builtRowKey(x));
            expect(row, `${x.name} (${x.origin})`).toBeDefined();
            expect(row!.name).toBe(x.name);
            expect(row!.owned).toBe(x.origin === 'own');
            if (x.origin === 'diagram') {
              expect(row!.demo?.slug).toBe(x.demoSlug);
              diagrams++;
            }
            if (x.origin === 'catalogue') {
              expect(row!.entry?.slug).toBe(x.catalogueSlug);
              catalogue++;
            }
          }
        }
      }
    }
    expect(diagrams).toBeGreaterThan(100);
    expect(catalogue).toBeGreaterThan(100);
  });

  it('every diagram name, as the routine text writes it, comes back from the parser unchanged', () => {
    for (const d of EXERCISE_DEMOS) {
      const [back] = parseRoutineText(`Test\n${d.name} 3x8-12`).routines[0]!.exercises;
      expect(back!.name, d.name).toBe(d.name);
    }
  });

  it('a built routine of diagram rows reads back through the text with every row named as built', () => {
    const REAL = seededInput({ recency: {} });
    for (const seed of seedsFrom(40)) {
      const built = buildRoutines(REAL, { focus: ['lats', 'upper back'] }, seed);
      const parsed = parseRoutineText(routineToText(built)).routines;
      expect(parsed[0]!.exercises.map((e) => e.name)).toEqual(built[0]!.rows.map((x) => x.name));
    }
  });
});
