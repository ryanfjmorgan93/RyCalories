import { describe, expect, it } from 'vitest';
import { cand, miniInput, seededInput } from '../test/routineFixtures';
import { applyEdit, applyIntensity, buildCoach, buildEdit, fitMinutes, mergeExtras, routineMinutes, type CoachRequest, type EditPlan } from './coachBuild';
import { readEdit } from './coachIntent';
import { MAX_NEW_EXERCISES, buildRoutines, routineRequestFrom, type BuiltRoutine, type RoutineInput, type RoutineRequest } from './routineBuilder';
import { parseQuickRequest } from './quickRequest';

/**
 * Editing the routine on screen, over the real generator and the owner's real starting data: what
 * the new request is, which row a swap names, and what the routine comes to. Nothing is mocked.
 */

const INPUT: RoutineInput = seededInput({ recency: { shoulders: 6, 'rear delts': 6 } });
const SHOULDERS = routineRequestFrom(parseQuickRequest('Give me a routine solely designed to build 3D shoulders'));
const names = (rs: readonly BuiltRoutine[]): string[] => rs.flatMap((r) => r.rows.map((x) => x.name));
const groups = (rs: readonly BuiltRoutine[]): string[] => rs.flatMap((r) => r.rows.map((x) => x.muscleGroup));
const sets = (rs: readonly BuiltRoutine[]): number => rs.flatMap((r) => r.rows).reduce((n, r) => n + r.sets, 0);

/** The shoulders routine of one seed, and the edit of it that a message asks for. */
function edited(text: string, seed = 7, request: CoachRequest = SHOULDERS, input: RoutineInput = INPUT) {
  const before = buildCoach(input, request, seed);
  const plan = applyEdit(request, before, text, seed);
  if (!plan.ok) return { before, plan, built: null };
  let drawn = 100;
  const built = buildEdit(input, plan, before, () => ++drawn);
  return { before, plan: plan as EditPlan, built };
}

describe('applyEdit: what each kind of message makes of the request', () => {
  const before = buildCoach(INPUT, SHOULDERS, 7);
  const plan = (text: string, request: CoachRequest = SHOULDERS, routines: readonly BuiltRoutine[] = before): EditPlan => {
    const r = applyEdit(request, routines, text, 7);
    expect(r.ok, text).toBe(true);
    return r as EditPlan;
  };

  it('add biceps: the muscle joins the focus, and the routine is composed of what it had', () => {
    const p = plan('add biceps');
    expect(p.request.focus).toEqual(['shoulders', 'rear delts', 'biceps']);
    expect(p.kind).toBe('compose');
    expect(p.added).toEqual(['biceps']);
    expect(p.keep).toHaveLength(before[0]!.rows.length);
    expect(p.want).toBe(before[0]!.rows.length + 2);
  });

  it('more rear delts, for a muscle the routine is for: one more exercise for it, the focus as it was', () => {
    const p = plan('more rear delts');
    expect(p.request.focus).toEqual(['shoulders', 'rear delts']);
    expect(p.fillMuscles).toEqual(['rear delts']);
    expect(p.want).toBe(before[0]!.rows.length + 1);
  });

  it('more of a muscle the routine is not for adds it', () => {
    expect(plan('more biceps').request.focus).toEqual(['shoulders', 'rear delts', 'biceps']);
  });

  it.each(['no legs', 'drop the legs', 'without legs', 'skip legs', 'lose the legs'])('%s: the legs are ruled out, the focus is as it was', (text) => {
    const p = plan(text);
    expect(p.request.exclude).toEqual(['quads', 'hamstrings', 'glutes', 'adductors', 'calves']);
    expect(p.request.focus).toEqual(['shoulders', 'rear delts']);
    expect(p.want).toBe(before[0]!.rows.length);
  });

  it('no shoulders takes the shoulders out of the focus as well as ruling them out', () => {
    const p = plan('no shoulders');
    expect(p.request.exclude).toEqual(['shoulders']);
    expect(p.request.focus).toEqual(['rear delts']);
  });

  it('a count: make it 5 exercises sets it, fewer and more move it by one, two more by two', () => {
    expect(plan('make it 5 exercises').request.count).toBe(5);
    expect(plan('make it 5 exercises').want).toBe(5);
    expect(plan('fewer').want).toBe(before[0]!.rows.length - 1);
    expect(plan('more').want).toBe(before[0]!.rows.length + 1);
    expect(plan('two more').want).toBe(before[0]!.rows.length + 2);
    expect(plan('4 fewer').want).toBe(before[0]!.rows.length - 4);
  });

  it('fewer drops the finishers it can spare and keeps the main lift', () => {
    const p = plan('fewer');
    const dropped = before[0]!.rows.filter((_, i) => !p.keep.includes(i));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.tier).not.toBe('primary');
  });

  it('a count is never below one or above twelve', () => {
    expect(plan('7 fewer').want).toBe(1);
    expect(plan('make it 12 exercises').want).toBe(12);
    expect(plan('add 5 exercises').want).toBe(11);
    expect(plan('add 5 exercises', { ...SHOULDERS, count: 10 }, buildCoach(INPUT, { ...SHOULDERS, count: 10 }, 7)).want).toBe(12);
  });

  it('shorter asks for less time than the routine takes; longer for more, and more exercises to fill it', () => {
    const e = before[0]!.estimateMinutes;
    const s = plan('make it shorter');
    expect(s.request.minutes).toBeLessThan(e);
    expect(s.trim).toBe(true);
    expect(s.want).toBe(before[0]!.rows.length);
    const l = plan('make it longer');
    expect(l.request.minutes).toBeGreaterThan(e);
    expect(l.want).toBeGreaterThan(before[0]!.rows.length);
  });

  it('a length is taken as typed: 30 mins, half an hour, an hour', () => {
    expect(plan('30 mins').request.minutes).toBe(30);
    expect(plan('half an hour').request.minutes).toBe(30);
    expect(plan('make it 45 minutes').request.minutes).toBe(45);
    expect(plan('an hour').request.minutes).toBe(60);
  });

  it('harder and easier are steps on the request, and nothing else about it changes', () => {
    const h = plan('make it harder');
    expect(h.kind).toBe('compose');
    expect(h.request).toEqual({ ...SHOULDERS, intensity: 1 });
    const hh = plan('harder', { ...SHOULDERS, intensity: 3 });
    expect(hh.request.intensity).toBe(3);
    expect(plan('easier', { ...SHOULDERS, intensity: -3 }).request.intensity).toBe(-3);
    expect(plan('easier').request.intensity).toBe(-1);
  });

  it('make it a push day: the muscles are push, the count and the rest of the request stay', () => {
    const p = plan('make it a push day', { ...SHOULDERS, count: 5, equipment: ['dumbbell'] });
    expect(p.request.focus).toEqual(['chest', 'shoulders', 'triceps']);
    expect(p.request.count).toBe(5);
    expect(p.request.equipment).toEqual(['dumbbell']);
    expect(p.kind).toBe('rebuild');
  });

  it('a split replaces the muscles', () => {
    const p = plan('make it push pull legs');
    expect(p.request.split).toBe('ppl');
    expect(p.request.focus).toEqual([]);
  });

  it('equipment narrows what was allowed, and joins it for "also"', () => {
    const narrow = plan('no barbell', { ...SHOULDERS, equipment: ['barbell', 'dumbbell', 'cable'] });
    expect(narrow.request.equipment).toEqual(['dumbbell', 'cable']);
    expect(plan('dumbbells only').request.equipment).toEqual(['dumbbell']);
    expect(plan('also cable', { ...SHOULDERS, equipment: ['dumbbell'] }).request.equipment).toEqual(['dumbbell', 'cable']);
    // Said of equipment the routine did not allow, it is what is wanted.
    expect(plan('cable only', { ...SHOULDERS, equipment: ['dumbbell'] }).request.equipment).toEqual(['cable']);
  });

  it('another one is the same request, to be built with another seed', () => {
    for (const text of ['give me another one', 'try again', 'different one', 'something else', 'shuffle']) {
      const p = plan(text, { ...SHOULDERS, count: 5, intensity: 1 });
      expect(p.kind, text).toBe('shuffle');
      expect(p.request, text).toEqual({ ...SHOULDERS, count: 5, intensity: 1 });
    }
  });

  it('swap the front raise names that row, and only that row', () => {
    const rows = before[0]!.rows;
    const at = rows.findIndex((r) => r.pattern === 'front-raise');
    expect(at).toBeGreaterThanOrEqual(0);
    const p = plan('swap the front raise');
    expect(p.swap).toEqual({ row: at });
    expect(p.routine).toBe(0);
    expect(p.keep).toEqual(rows.map((_, i) => i).filter((i) => i !== at));
    expect(p.want).toBe(rows.length);
    // The same row, said three ways.
    for (const text of ['swap the front raise for something else', 'replace front raise', 'change the front raise']) expect(plan(text).swap?.row, text).toBe(at);
  });

  it('a row is named by its movement, its muscle part or its equipment as well as its name', () => {
    const rows = before[0]!.rows;
    const lateral = rows.findIndex((r) => r.pattern === 'lateral-raise');
    const press = rows.findIndex((r) => r.pattern === 'press-vertical');
    expect(plan('swap the lateral raise').swap?.row).toBe(lateral);
    expect(plan('swap the side raise').swap?.row).toBe(lateral);
    expect(plan('swap the overhead press').swap?.row).toBe(press);
    expect(plan('replace the press').swap?.row).toBe(press);
    expect(plan('drop the face pull').remove?.row).toBe(rows.findIndex((r) => r.pattern === 'face-pull'));
  });

  it('a row that is not in the routine is a fact, not a guess', () => {
    const r = applyEdit(SHOULDERS, before, 'swap the leg press', 7);
    expect(r).toEqual({ ok: false, reason: 'No exercise called leg press in this routine' });
    expect(applyEdit(SHOULDERS, before, 'drop the banana', 7)).toEqual({ ok: false, reason: 'No exercise called banana in this routine' });
  });

  it('drop the face pull takes the row out, and the count with it', () => {
    const p = plan('drop the face pull');
    expect(p.remove).toBeDefined();
    expect(p.want).toBe(before[0]!.rows.length - 1);
    expect(p.request.count).toBe(before[0]!.rows.length - 1);
  });

  it('a split takes no muscle added to it', () => {
    const split = buildCoach(INPUT, { focus: [], split: 'ppl' }, 3);
    expect(applyEdit({ focus: [], split: 'ppl' }, split, 'add calves', 7)).toEqual({ ok: false, reason: 'A split takes its muscles from its days' });
  });

  it('is not an edit for a message that asks for none', () => {
    expect(applyEdit(SHOULDERS, before, 'why is there a press', 7).ok).toBe(false);
    expect(readEdit('why is there a press')).toBeNull();
  });

  it('carries every field of the previous request, whatever it is, through every kind of edit', () => {
    // A field this module has never heard of: the owner\'s request may carry more than it names.
    const previous = { ...SHOULDERS, count: 6, excludePatterns: ['press-vertical'], mystery: { n: 1 } } as CoachRequest;
    for (const text of ['add biceps', 'no legs', 'make it 5 exercises', 'shorter', 'harder', 'give me another one', 'make it a push day', 'dumbbells only', 'swap the front raise', 'drop the face pull', 'make it push pull legs']) {
      const r = applyEdit(previous, before, text, 7);
      expect(r.ok, text).toBe(true);
      const request = (r as EditPlan).request as unknown as Record<string, unknown>;
      expect(request.mystery, text).toEqual({ n: 1 });
      expect(request.excludePatterns, text).toEqual(['press-vertical']);
    }
  });

  it('does not touch the request it was given', () => {
    const previous: CoachRequest = { focus: ['shoulders'], exclude: ['calves'], count: 6 };
    const frozen = JSON.stringify(previous);
    applyEdit(previous, before, 'no legs', 7);
    applyEdit(previous, before, 'add biceps', 7);
    expect(JSON.stringify(previous)).toBe(frozen);
  });
});

describe('applyIntensity and fitMinutes: sets more or fewer, and a length held to', () => {
  const rows = (...tiers: ('primary' | 'secondary' | 'isolation')[]) =>
    buildCoach(INPUT, { focus: ['shoulders', 'rear delts'], count: 6 }, 7)[0]!.rows.slice(0, tiers.length).map((r, i) => ({ ...r, tier: tiers[i]!, sets: 3 }));
  const routineOf = (rs: ReturnType<typeof rows>): BuiltRoutine => ({ ...buildCoach(INPUT, SHOULDERS, 7)[0]!, rows: rs });

  it('harder is a set more on the main and secondary lifts, up to five, and the isolation lifts only once those are as far as they go', () => {
    const r = routineOf(rows('primary', 'secondary', 'isolation', 'isolation'));
    const one = applyIntensity(r, 1, INPUT).routine.rows.map((x) => x.sets);
    expect(one).toEqual([4, 4, 3, 3]);
    expect(applyIntensity(r, 2, INPUT).routine.rows.map((x) => x.sets)).toEqual([5, 5, 3, 3]);
    // The third step finds the main and secondary lifts as far as they go, and takes the isolation lifts a set.
    const three = applyIntensity(r, 3, INPUT).routine.rows.map((x) => x.sets);
    expect(three).toEqual([5, 5, 4, 4]);
    // However many are asked for, three is the most.
    expect(applyIntensity(r, 9, INPUT).routine.rows.map((x) => x.sets)).toEqual(three);
    const capped = routineOf(rows('primary', 'secondary', 'isolation', 'isolation').map((x) => ({ ...x, sets: x.tier === 'isolation' ? 3 : 5 })));
    expect(applyIntensity(capped, 1, INPUT).routine.rows.map((x) => x.sets)).toEqual([5, 5, 4, 4]);
  });

  it('easier is a set fewer on every lift, down to two and no lower', () => {
    const r = routineOf(rows('primary', 'secondary', 'isolation'));
    expect(applyIntensity(r, -1, INPUT).routine.rows.map((x) => x.sets)).toEqual([2, 2, 2]);
    expect(applyIntensity(r, -3, INPUT).routine.rows.map((x) => x.sets)).toEqual([2, 2, 2]);
  });

  it('leaves reps, weights and which exercises alone, works the minutes out again, and says what it did', () => {
    const base = buildCoach(INPUT, SHOULDERS, 7)[0]!;
    const harder = applyIntensity(base, 2, INPUT);
    expect(harder.routine.rows.map((r) => [r.name, r.repMin, r.repMax, r.weightKg])).toEqual(base.rows.map((r) => [r.name, r.repMin, r.repMax, r.weightKg]));
    expect(harder.routine.estimateMinutes).toBe(routineMinutes(harder.routine.rows, INPUT));
    expect(harder.routine.estimateMinutes).toBeGreaterThan(base.estimateMinutes);
    expect(harder.fact).toMatch(/^Harder: \d+ sets? more, on /);
    expect(harder.routine.reasonLines.filter((l) => l.startsWith('About '))).toEqual([`About ${harder.routine.estimateMinutes} min at your pace`]);
    expect(harder.routine.reasonLines).toContain(harder.fact);
  });

  it('does nothing to no steps, and nothing to a routine with nothing in it', () => {
    const base = buildCoach(INPUT, SHOULDERS, 7)[0]!;
    expect(applyIntensity(base, 0, INPUT)).toEqual({ routine: base, fact: null });
    expect(applyIntensity(base, Number.NaN, INPUT)).toEqual({ routine: base, fact: null });
    const none = { ...base, rows: [] };
    expect(applyIntensity(none, 2, INPUT)).toEqual({ routine: none, fact: null });
  });

  it('fitMinutes drops finishers until the routine is near the length, never a main lift and never below two exercises', () => {
    const base = buildCoach(INPUT, { focus: ['shoulders', 'rear delts'], count: 8 }, 7)[0]!;
    const fit = fitMinutes(base, base.estimateMinutes - 15, INPUT);
    expect(fit.rows.length).toBeLessThan(base.rows.length);
    expect(fit.estimateMinutes).toBeLessThanOrEqual(base.estimateMinutes - 15);
    expect(fit.rows.filter((r) => r.tier === 'primary')).toEqual(base.rows.filter((r) => r.tier === 'primary'));
    expect(fit.reasonLines.some((l) => /^Dropped .* to come nearer the \d+ min asked$/.test(l))).toBe(true);
    expect(fit.reasonLines[fit.reasonLines.length - 1]).toBe(`About ${fit.estimateMinutes} min at your pace`);
    expect(fitMinutes(base, 1, INPUT).rows.length).toBeGreaterThanOrEqual(2);
    // Under the length already: untouched.
    expect(fitMinutes(base, 200, INPUT)).toBe(base);
  });

  it('a harder routine asked to stay at a length is held to it, and a shuffle of it too', () => {
    const request: CoachRequest = { focus: ['shoulders', 'rear delts'], minutes: 35, intensity: 2 };
    for (const seed of [1, 2, 3, 4]) {
      const [r] = buildCoach(INPUT, request, seed);
      expect(r!.estimateMinutes, `seed ${seed}`).toBeLessThanOrEqual(35);
      expect(r!.estimateMinutes).toBe(routineMinutes(r!.rows, INPUT));
    }
  });
});

describe('mergeExtras: whatever else the typed words read joins what the request holds', () => {
  it('lists join the previous list without repeating, and a single value replaces', () => {
    const request = { focus: [], excludePatterns: ['a', 'b'], typed: 'x' } as unknown as CoachRequest;
    mergeExtras(request, { excludePatterns: ['b', 'c'], typed: 'y', fresh: ['z'] });
    expect(request).toEqual({ focus: [], excludePatterns: ['a', 'b', 'c'], typed: 'y', fresh: ['z'] });
  });
});

describe('buildEdit: the routine an edit comes to, built by the generator from the owner\'s own exercises and the library', () => {
  it('add biceps keeps every exercise the routine had, and adds biceps exercises, with no model', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { before, built } = edited('add biceps', seed);
      const after = built!.routines;
      for (const name of names(before)) expect(names(after), `seed ${seed}`).toContain(name);
      expect(groups(after)).toEqual(expect.arrayContaining(['shoulders', 'rear delts', 'biceps']));
      expect(groups(after).filter((g) => g === 'biceps').length).toBeGreaterThanOrEqual(2);
      expect(after[0]!.rows.length).toBe(before[0]!.rows.length + 2);
      expect(new Set(names(after)).size).toBe(names(after).length);
      expect(built!.fact, `seed ${seed}`).toMatch(/^Added /);
      expect(built!.request.focus).toEqual(['shoulders', 'rear delts', 'biceps']);
      expect(built!.request.count).toBe(after[0]!.rows.length);
    }
  });

  it('more rear delts adds one rear delt exercise and no other change', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { before, built } = edited('more rear delts', seed);
      const after = built!.routines;
      for (const name of names(before)) expect(names(after)).toContain(name);
      expect(after[0]!.rows).toHaveLength(before[0]!.rows.length + 1);
      const added = after[0]!.rows.filter((r) => !names(before).includes(r.name));
      expect(added.map((r) => r.muscleGroup)).toEqual(['rear delts']);
    }
  });

  it('swap the front raise replaces that row, in its place, with another exercise for the same part of the shoulder, and every other row is as it was', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { before, plan, built } = edited('swap the front raise', seed);
      const at = (plan as EditPlan).swap!.row;
      const was = before[0]!.rows;
      const now = built!.routines[0]!.rows;
      expect(now).toHaveLength(was.length);
      expect(now[at]!.name, `seed ${seed}`).not.toBe(was[at]!.name);
      expect(now.map((r) => r.name).filter((_, i) => i !== at)).toEqual(was.map((r) => r.name).filter((_, i) => i !== at));
      expect(now[at]!.region).toBe(was[at]!.region);
      expect(built!.fact).toBe(`Swapped ${was[at]!.name} for ${now[at]!.name}`);
      expect(new Set(now.map((r) => r.name)).size).toBe(now.length);
    }
  });

  it('a swap of any row of any routine, over many seeds, replaces exactly that row: in its place when the replacement is the same kind of lift, and no other exercise ever changes', () => {
    const requests: CoachRequest[] = [{ focus: ['shoulders', 'rear delts'] }, { focus: ['chest'] }, { focus: ['biceps', 'triceps'] }, { focus: [], count: 8 }];
    let inPlace = 0;
    for (const request of requests) {
      for (let seed = 1; seed <= 40; seed++) {
        const before = buildCoach(INPUT, request, seed);
        const was = before[0]!.rows;
        for (const [at, row] of was.entries()) {
          const plan = applyEdit(request, before, `swap the ${row.name}`, seed);
          expect(plan.ok, `${row.name} is a row of the routine`).toBe(true);
          const built = buildEdit(INPUT, plan as EditPlan, before, () => 1);
          const now = built.routines[0]!.rows;
          expect(now.length, `seed ${seed} ${row.name}`).toBe(was.length);
          expect(new Set(now.map((r) => r.name)).size).toBe(now.length);
          const gone = was.filter((r) => !now.some((x) => x.name === r.name));
          const came = now.filter((r) => !was.some((x) => x.name === r.name));
          if (built.fact.startsWith('Kept ')) {
            // Nothing else for that part of the muscle: the routine is as it was.
            expect(now.map((r) => r.name), `seed ${seed} ${row.name}`).toEqual(was.map((r) => r.name));
            continue;
          }
          // Exactly the row named went, and exactly one exercise came, and it is for the same part of the muscle.
          expect(gone.map((r) => r.name), `seed ${seed} ${row.name}`).toEqual([row.name]);
          expect(came).toHaveLength(1);
          expect(came[0]!.region).toBe(row.region);
          if (came[0]!.tier === row.tier) {
            // The same kind of lift takes the place of the one it replaces, and every other row keeps its own.
            expect(now.map((r, i) => (r.name === was[i]!.name ? -1 : i)).filter((i) => i >= 0), `seed ${seed} ${row.name}`).toEqual([at]);
            inPlace++;
          }
        }
      }
    }
    // The property was looked at over real swaps, not an empty set of them.
    expect(inPlace).toBeGreaterThan(500);
  });

  it('a swap with equipment named gives that equipment, or says there is none', () => {
    const { built, before } = edited('swap the lateral raise for a cable one');
    const row = built!.routines[0]!.rows.find((r) => !names(before).includes(r.name));
    expect(row?.equipment).toBe('cable');
    // Nothing for the shoulders is a kettlebell here: the row stays, and the line says why.
    const none = edited('swap the lateral raise for a kettlebell one');
    expect(names(none.built!.routines)).toEqual(names(none.before));
    expect(none.built!.fact).toMatch(/^Kept .*: nothing else for .* in your exercises or the library$/);
  });

  it('a swap with nothing else for that part of the muscle leaves the routine and says so', () => {
    const only = miniInput([
      cand('Overhead Press (Barbell)', 'shoulders', { compound: true, weight: 40, equipment: 'barbell' }),
      cand('Lateral Raise', 'shoulders', { weight: 8 }),
      cand('Front Raise', 'shoulders', { weight: 8 }),
    ]);
    const { before, built } = edited('swap the front raise', 3, { focus: ['shoulders'], count: 3 }, only);
    expect(names(built!.routines)).toEqual(names(before));
    expect(built!.fact).toBe('Kept Front Raise: nothing else for front delts in your exercises or the library');
  });

  it('shorter gives fewer exercises and a smaller time, out of the routine it had', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { before, built } = edited('make it shorter', seed);
      const was = before[0]!;
      const now = built!.routines[0]!;
      expect(now.estimateMinutes, `seed ${seed}`).toBeLessThan(was.estimateMinutes);
      expect(now.rows.length).toBeLessThan(was.rows.length);
      for (const name of names(built!.routines)) expect(names(before)).toContain(name);
      expect(built!.request.minutes).toBeLessThan(was.estimateMinutes);
      const gone = was.rows.filter((r) => !now.rows.some((x) => x.id === r.id)).map((r) => r.name);
      expect(built!.fact).toBe(`Dropped ${gone.length > 1 ? `${gone.slice(0, -1).join(', ')} and ${gone[gone.length - 1]}` : gone[0]}; about ${now.estimateMinutes} min, was ${was.estimateMinutes}`);
    }
  });

  it('30 mins trims to about that, finishers first, and never the main lift', () => {
    const { before, built } = edited('30 mins');
    const now = built!.routines[0]!;
    expect(now.estimateMinutes).toBeLessThanOrEqual(30);
    expect(now.rows[0]!.name).toBe(before[0]!.rows[0]!.name);
  });

  it('longer gives more exercises and a longer time', () => {
    const { before, built } = edited('make it longer');
    expect(built!.routines[0]!.rows.length).toBeGreaterThan(before[0]!.rows.length);
    expect(built!.routines[0]!.estimateMinutes).toBeGreaterThan(before[0]!.estimateMinutes);
    for (const name of names(before)) expect(names(built!.routines)).toContain(name);
  });

  it('make it 5 exercises keeps five of the six, and 8 keeps all six and adds two', () => {
    const five = edited('make it 5 exercises');
    expect(five.built!.routines[0]!.rows).toHaveLength(5);
    for (const name of names(five.built!.routines)) expect(names(five.before)).toContain(name);
    expect(five.built!.request.count).toBe(5);
    // An owner with plenty for the chest, so there is room to grow.
    const rich = miniInput(
      ['Bench Press (Barbell)', 'Incline DB Press', 'Cable Fly', 'Pec Deck', 'Decline Press (Machine)', 'Push Up', 'Chest Dip', 'Chest Press (Machine)', 'Landmine Press', 'Svend Press'].map((n, i) =>
        cand(n, 'chest', { weight: 20 + i, compound: i % 2 === 0, equipment: i === 0 ? 'barbell' : i % 3 === 0 ? 'cable' : 'dumbbell' }),
      ),
    );
    for (const seed of [1, 2, 3, 4]) {
      const eight = edited('make it 8 exercises', seed, { focus: ['chest'], count: 6 }, rich);
      expect(eight.built!.routines[0]!.rows, `seed ${seed}`).toHaveLength(8);
      for (const name of names(eight.before)) expect(names(eight.built!.routines)).toContain(name);
      expect(eight.built!.request.count).toBe(8);
      expect(new Set(names(eight.built!.routines)).size).toBe(8);
    }
  });

  it('asked for more exercises than there are, it says how many it could find, and keeps that count', () => {
    const pool = miniInput([
      cand('Overhead Press (Barbell)', 'shoulders', { compound: true, weight: 40, equipment: 'barbell' }),
      cand('Lateral Raise', 'shoulders', { weight: 8 }),
      cand('Front Raise', 'shoulders', { weight: 8 }),
    ]);
    const { before, built } = edited('make it 6 exercises', 3, { focus: ['shoulders'], count: 3 }, pool);
    expect(names(built!.routines)).toEqual(names(before));
    expect(built!.fact).toBe('3 of 6: nothing more in your exercises or the library');
    expect(built!.request.count).toBe(3);
  });

  it('no legs from a full-body routine drops every leg exercise and fills up from the rest, so it is as long as it was', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const request: CoachRequest = { focus: [], count: 8 };
      const { before, built } = edited('no legs', seed, request);
      expect(groups(before).some((g) => ['quads', 'hamstrings', 'glutes', 'adductors', 'calves'].includes(g)), `seed ${seed} had legs`).toBe(true);
      const after = built!.routines[0]!;
      expect(groups([after]).filter((g) => ['quads', 'hamstrings', 'glutes', 'adductors', 'calves'].includes(g))).toEqual([]);
      expect(after.rows).toHaveLength(8);
      // What was not legs stays.
      for (const row of before[0]!.rows.filter((r) => !['quads', 'hamstrings', 'glutes', 'adductors', 'calves'].includes(r.muscleGroup))) expect(names([after])).toContain(row.name);
    }
  });

  it('no legs from a shoulders routine changes nothing and says so', () => {
    const { before, built } = edited('no legs');
    expect(names(built!.routines)).toEqual(names(before));
    expect(built!.request.exclude).toEqual(['quads', 'hamstrings', 'glutes', 'adductors', 'calves']);
  });

  it('drop the face pull takes that row out and leaves the others', () => {
    const { before, built } = edited('drop the face pull');
    expect(names(built!.routines)).toEqual(names(before).filter((n) => n !== 'Face Pull'));
    expect(built!.fact).toBe('Dropped Face Pull');
  });

  it('harder is more sets on the main and secondary lifts, and a longer time, with the same exercises', () => {
    const { before, built } = edited('make it harder');
    expect(names(built!.routines)).toEqual(names(before));
    expect(sets(built!.routines)).toBeGreaterThan(sets(before));
    expect(built!.routines[0]!.estimateMinutes).toBeGreaterThan(before[0]!.estimateMinutes);
    for (const [i, row] of before[0]!.rows.entries()) {
      const now = built!.routines[0]!.rows[i]!;
      expect(now.repMin).toBe(row.repMin);
      expect(now.weightKg).toBe(row.weightKg);
      if (row.tier !== 'isolation') expect(now.sets).toBe(Math.min(5, row.sets + 1));
      else expect(now.sets).toBe(row.sets);
    }
    expect(built!.request.intensity).toBe(1);
    expect(built!.fact).toMatch(/^Harder: \d sets? more, on /);
  });

  it('easier is fewer sets and a shorter time, never below two sets', () => {
    const { before, built } = edited('make it easier');
    expect(names(built!.routines)).toEqual(names(before));
    expect(sets(built!.routines)).toBeLessThan(sets(before));
    expect(built!.routines[0]!.estimateMinutes).toBeLessThan(before[0]!.estimateMinutes);
    let again = built!.routines;
    for (let i = 0; i < 4; i++) {
      const plan = applyEdit(built!.request, again, 'easier', 7);
      again = buildEdit(INPUT, plan as EditPlan, again, () => 1).routines;
    }
    for (const row of again[0]!.rows) expect(row.sets).toBeGreaterThanOrEqual(2);
  });

  it('harder stops at the most a lift goes to and says so, rather than pretending', () => {
    let request: CoachRequest = SHOULDERS;
    let routines = buildCoach(INPUT, request, 7);
    let last = '';
    for (let i = 0; i < 8; i++) {
      const plan = applyEdit(request, routines, 'harder', 7) as EditPlan;
      const built = buildEdit(INPUT, plan, routines, () => 1);
      routines = built.routines;
      request = built.request;
      last = built.fact;
    }
    expect(Math.max(...routines[0]!.rows.map((r) => r.sets))).toBeLessThanOrEqual(5);
    expect(request.intensity).toBe(3);
    expect(last).toMatch(/already at the most sets/);
  });

  it('harder is kept by what follows: a swap after it is still a harder routine, and a shuffle too', () => {
    const hard = edited('make it harder');
    const plan = applyEdit(hard.built!.request, hard.built!.routines, 'swap the front raise', 7) as EditPlan;
    const swapped = buildEdit(INPUT, plan, hard.built!.routines, () => 1);
    expect(sets(swapped.routines)).toBeGreaterThanOrEqual(sets(hard.built!.routines));
    expect(swapped.request.intensity).toBe(1);
    const shuffled = buildEdit(INPUT, applyEdit(swapped.request, swapped.routines, 'give me another one', 7) as EditPlan, swapped.routines, (() => { let n = 50; return () => ++n; })());
    expect(shuffled.request.intensity).toBe(1);
    expect(shuffled.routines[0]!.reasonLines.some((l) => l.startsWith('Harder: '))).toBe(true);
  });

  it('another one is a different routine for the same request, and says so', () => {
    const { before, built } = edited('give me another one');
    expect(names(built!.routines)).not.toEqual(names(before));
    expect(built!.request).toEqual(SHOULDERS);
    expect(built!.seed).toBeGreaterThan(100);
    expect(built!.fact).toBe('Same request, another routine');
  });

  it('make it a push day builds push afresh, keeping what it can of the request', () => {
    const { built } = edited('make it a push day', 7, { ...SHOULDERS, count: 7 });
    expect(new Set(groups(built!.routines))).toEqual(new Set(['chest', 'shoulders', 'triceps']));
    expect(built!.routines[0]!.rows).toHaveLength(7);
    expect(built!.routines[0]!.name).toBe('Push');
  });

  it('a split: a swap changes the day it names and no other, and a shorter one is every day built to the length', () => {
    const request: CoachRequest = { focus: [], split: 'ppl' };
    const before = buildCoach(INPUT, request, 5);
    const target = before[1]!.rows[before[1]!.rows.length - 1]!;
    const swap = applyEdit(request, before, `swap the ${target.name}`, 5) as EditPlan;
    expect(swap.routine).toBe(1);
    const built = buildEdit(INPUT, swap, before, () => 1);
    expect(built.routines).toHaveLength(3);
    expect(built.routines.map((r) => r.name)).toEqual(['Push', 'Pull', 'Legs']);
    expect(built.routines[0]).toEqual(before[0]);
    expect(built.routines[2]).toEqual(before[2]);
    expect(names([built.routines[1]!])).not.toContain(target.name);
    expect(built.request.split).toBe('ppl');

    const shorter = edited('make it shorter', 5, request);
    expect(shorter.built!.routines).toHaveLength(3);
    for (const [i, r] of shorter.built!.routines.entries()) expect(r.estimateMinutes).toBeLessThanOrEqual(shorter.before[i]!.estimateMinutes);
  });

  it('the library is never more than three exercises of a routine, however it grows', () => {
    // Nothing of the owner\'s for the arms: every row of an arms routine is from the library.
    const bare = seededInput({ recency: {}, without: ['Barbell Curl', 'Dumbbell Curl', 'Hammer Curl (Dumbbell)', 'Triceps Pushdown (Cable)', 'Skull Crusher (EZ-Bar)', 'Overhead Triceps Extension (Cable)'] });
    for (const seed of [1, 2, 3]) {
      const { built } = edited('add triceps', seed, { focus: ['biceps'], count: 4 }, bare);
      const library = built!.routines[0]!.rows.filter((r) => r.origin !== 'own');
      expect(library.length, `seed ${seed}`).toBeLessThanOrEqual(MAX_NEW_EXERCISES);
    }
  });

  it('the minutes the routine says are the minutes the generator works out, for what it made', () => {
    const requests: RoutineRequest[] = [SHOULDERS, { focus: ['chest'], count: 5 }, { focus: [], split: 'ppl' }, { focus: ['biceps', 'triceps'], minutes: 30 }];
    // At the owner's own pace, whatever it is, and with their own rest times.
    for (const input of [INPUT, { ...INPUT, pace: 1.3 }, { ...INPUT, pace: 0.8 }, { ...INPUT, settings: { ...INPUT.settings, restCompoundSec: 200, restIsolationSec: 45 } }]) {
      for (const request of requests) {
        for (const seed of [1, 2, 3, 4]) {
          for (const r of buildRoutines(input, request, seed)) expect(routineMinutes(r.rows, input), `${r.name} seed ${seed} pace ${input.pace}`).toBe(r.estimateMinutes);
        }
      }
    }
  });

  it('the same message from the same routine builds the same edit', () => {
    const a = edited('add biceps', 4);
    const b = edited('add biceps', 4);
    expect(a.built).toEqual(b.built);
  });

  it('puts what was changed among the routine\'s reasons, for the model to quote and the owner to read', () => {
    const { built } = edited('add biceps');
    const lines = built!.routines[0]!.reasonLines;
    expect(lines).toContain(`Changed: ${built!.fact}`);
    expect(lines[lines.length - 1]).toMatch(/^About \d+ min at your pace$/);
  });
});
