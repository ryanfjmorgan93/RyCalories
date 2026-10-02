/**
 * What a typed line says beyond the muscles: a part of a muscle ("upper chest"), a sore body part
 * ("my lower back is sore") and a movement left out ("no squats").
 */
import { describe, expect, it } from 'vitest';
import { MACRO_MUSCLES, parseQuickRequest } from './quickRequest';
import { routineRequestFrom } from './routineBuilder';

const parse = (text: string) => parseQuickRequest(text);

describe('parseQuickRequest: a part of a muscle is the muscle, with the part preferred', () => {
  it.each([
    ['give me an upper chest routine', 'chest:upper'],
    ['upper chest', 'chest:upper'],
    ['upper pecs', 'chest:upper'],
    ['give me a lower chest routine', 'chest:lower'],
    ['lower pecs', 'chest:lower'],
    ['mid chest', 'chest:mid'],
    ['middle chest', 'chest:mid'],
    ['inner chest', 'chest:fly'],
  ])('"%s" is the chest, with %s preferred, and nothing else', (text, region) => {
    const p = parse(text);
    expect(p.options.focus, text).toEqual(['chest']);
    expect(p.preferRegions, text).toEqual([region]);
    expect(p.residue, text).toEqual([]);
    expect(p.options.exclude, text).toBeUndefined();
  });

  it('beside another muscle it stays the chest: "upper chest and triceps"', () => {
    const p = parse('upper chest and triceps');
    expect(p.options.focus).toEqual(['chest', 'triceps']);
    expect(p.preferRegions).toEqual(['chest:upper']);
  });

  it('"upper back" and "lower back" stay as they were, and "upper body" and "lower body" are still the macros', () => {
    expect(parse('upper back').options.focus).toEqual(['upper back']);
    expect(parse('lower back').options.focus).toEqual(['lower back']);
    expect(parse('upper body').options.focus).toEqual([...MACRO_MUSCLES.upper]);
    expect(parse('lower body').options.focus).toEqual([...MACRO_MUSCLES.lower]);
    expect(parse('upper back').preferRegions).toBeUndefined();
  });

  it('"upper traps" and "lower abs" are the traps and the abs, not a half of the body', () => {
    expect(parse('upper traps').options.focus).toEqual(['traps']);
    expect(parse('lower abs').options.focus).toEqual(['abs']);
  });

  it('"no upper chest" rules the chest out and nothing else', () => {
    const p = parse('push, no upper chest');
    expect(p.options.exclude).toEqual(['chest']);
    expect(p.options.focus).toEqual(['shoulders', 'triceps']);
    expect(p.preferRegions).toBeUndefined();
  });

  it('a parse with no part named has no preferRegions key at all', () => {
    expect('preferRegions' in parse('chest')).toBe(false);
  });
});

describe('parseQuickRequest: a sore body part is a niggle, never a muscle to train', () => {
  it.each([
    ['my lower back is sore', 'lower back'],
    ['bad knee', 'knee'],
    ['shoulder hurts', 'shoulder'],
    ['tweaked my hamstring', 'hamstring DOMS'],
    ['my knees are sore', 'knee'],
    ['my shoulder is killing me', 'shoulder'],
    ['sore shoulders', 'shoulder'],
    ['I have a bad back', 'lower back'],
    ['my back hurts', 'lower back'],
    ['pulled a hamstring', 'hamstring DOMS'],
    ['knee pain', 'knee'],
    ['my elbow is sore', 'other'],
    ['my upper back is sore', 'other'],
    ['sore wrists', 'other'],
  ])('"%s" is a typed %s niggle and no muscle at all', (text, tag) => {
    const p = parse(text);
    expect(p.typedNiggles, text).toEqual([tag]);
    expect(p.options.focus, text).toBeUndefined();
    expect(p.options.exclude, text).toBeUndefined();
    expect(p.residue, text).toEqual([]);
  });

  it('beside a request it leaves the request alone: a back routine with a sore lower back is lats and upper back', () => {
    const p = parse('Give me a back routine, my lower back is sore');
    expect(p.options.focus).toEqual(['lats', 'upper back']);
    expect(p.typedNiggles).toEqual(['lower back']);
    expect(p.residue).toEqual([]);
  });

  it('a sore shoulder with a chest request is the chest, not the shoulders', () => {
    const p = parse('chest routine, my shoulder hurts');
    expect(p.options.focus).toEqual(['chest']);
    expect(p.typedNiggles).toEqual(['shoulder']);
  });

  it('a pain word binds the body part next to it, and a muscle named elsewhere is still asked for', () => {
    const p = parse('legs, my shoulder hurts, and a bad knee');
    expect(p.options.focus).toEqual([...MACRO_MUSCLES.legs]);
    expect(p.typedNiggles).toEqual(['shoulder', 'knee']);
    expect(parse('shoulders but my knee is sore').options.focus).toEqual(['shoulders']);
    expect(parse('shoulders but my knee is sore').typedNiggles).toEqual(['knee']);
  });

  it('two words for one pain are one niggle', () => {
    expect(parse('my knee is sore and bad').typedNiggles).toEqual(['knee']);
  });

  it('the same body part named plainly is still a muscle: "shoulders", "hamstrings", "back"', () => {
    expect(parse('shoulders').options.focus).toEqual(['shoulders']);
    expect(parse('hamstrings').options.focus).toEqual(['hamstrings']);
    expect(parse('back').options.focus).toEqual(['lats', 'upper back']);
    for (const text of ['shoulders', 'hamstrings', 'back', 'knees']) expect('typedNiggles' in parse(text), text).toBe(false);
  });

  it('a pain word with no body part beside it is not guessed at: it stays residue', () => {
    const p = parse("chest routine please, I'm sore");
    expect(p.residue).toEqual(['sore']);
    expect('typedNiggles' in p).toBe(false);
    expect(parse('not too bad, chest').residue).toContain('bad');
    expect('typedNiggles' in parse('not too bad, chest')).toBe(false);
  });

  it('"no knee pain" is not a niggle', () => {
    expect('typedNiggles' in parse('legs, no knee pain')).toBe(false);
  });

  it('says what it read, in the order it came', () => {
    expect(parse('my lower back is sore').read).toEqual(['lower back', 'sore']);
  });
});

describe('parseQuickRequest: no <movement> leaves the movement out', () => {
  it.each([
    ['no squats', ['squat']],
    ['no deadlifts', ['hinge']],
    ['no lunges', ['lunge']],
    ['no rows', ['row']],
    ['no dips', ['dip']],
    ['no overhead press', ['press-vertical']],
    ['no leg press', ['leg-press']],
    ['no back squats', ['squat']],
    ['no pull ups', ['pull-up']],
    ['no curls', ['curl', 'incline-curl', 'preacher-curl', 'hammer-curl', 'reverse-curl']],
    ['skip squats', ['squat']],
    ['avoid deadlifts', ['hinge']],
    ["can't do lunges", ['lunge']],
    ['without squats', ['squat']],
  ])('"%s" leaves out %j and nothing else', (text, patterns) => {
    const p = parse(text);
    expect(p.excludePatterns, text).toEqual(patterns);
    expect(p.options.focus, text).toBeUndefined();
    expect(p.options.exclude, text).toBeUndefined();
    expect(p.options.equipment, text).toBeUndefined();
    expect(p.residue, text).toEqual([]);
  });

  it('beside a muscle it is that muscle with the movement left out: "legs, no squats" and "no squats legs"', () => {
    for (const text of ['legs, no squats', 'no squats legs', 'give me a leg routine with no squats']) {
      const p = parse(text);
      expect(p.options.focus, text).toEqual([...MACRO_MUSCLES.legs]);
      expect(p.excludePatterns, text).toEqual(['squat']);
      expect(p.residue, text).toEqual([]);
    }
  });

  it('a list of movements: "no squats or lunges"', () => {
    expect(parse('legs, no squats or lunges').excludePatterns).toEqual(['squat', 'lunge']);
    expect(parse('legs no squats and no deadlifts').excludePatterns).toEqual(['squat', 'hinge']);
  });

  it('"no machines" and "no barbell" are equipment, as before, and leave no movement out', () => {
    const machines = parse('chest, no machines');
    expect(machines.options.equipment).toEqual(['barbell', 'dumbbell', 'cable', 'bodyweight', 'kettlebell', 'other']);
    expect('excludePatterns' in machines).toBe(false);
    const barbell = parse('no barbell');
    expect(barbell.options.equipment).not.toContain('barbell');
    expect('excludePatterns' in barbell).toBe(false);
  });

  it('a muscle still ruled out as a muscle: "no legs", "no back"', () => {
    expect(parse('upper, no back').options.exclude).toEqual(['lats', 'upper back']);
    expect('excludePatterns' in parse('no legs')).toBe(false);
  });

  it('a movement named without a negation is not read as one', () => {
    const p = parse('squats');
    expect('excludePatterns' in p).toBe(false);
    expect(p.residue).toEqual(['squats']);
  });
});

describe('routineRequestFrom: carries what the parse read', () => {
  it('copies the movements left out, the typed niggles and the part of a muscle, and only when there are some', () => {
    const request = routineRequestFrom(parse('upper chest routine, no dips, my shoulder hurts'));
    expect(request).toEqual({ focus: ['chest'], excludePatterns: ['dip'], typedNiggles: ['shoulder'], preferRegions: ['chest:upper'] });
    const plain = routineRequestFrom(parse('chest'));
    expect(plain).toEqual({ focus: ['chest'] });
    expect('excludePatterns' in plain || 'typedNiggles' in plain || 'preferRegions' in plain).toBe(false);
  });

  it('copies them rather than sharing them with the parse', () => {
    const parsed = parse('legs, no squats, my knee is sore');
    const request = routineRequestFrom(parsed);
    request.excludePatterns!.push('lunge');
    request.typedNiggles!.push('shoulder');
    expect(parsed.excludePatterns).toEqual(['squat']);
    expect(parsed.typedNiggles).toEqual(['knee']);
  });
});
