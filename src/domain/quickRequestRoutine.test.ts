import { describe, expect, it } from 'vitest';
import { MACRO_MUSCLES, parseQuickRequest } from './quickRequest';

const parse = (text: string) => parseQuickRequest(text);

describe('parseQuickRequest: shoulders, delts and the words of a routine request', () => {
  it("the owner's own sentence reads as shoulders and rear delts with nothing left over", () => {
    const p = parse('Give me a routine solely designed to build 3D shoulders');
    expect(p.options.focus).toEqual(['shoulders', 'rear delts']);
    expect(p.options.count).toBeUndefined();
    expect(p.residue).toEqual([]);
    expect(p.split).toBeUndefined();
  });

  it.each([
    ['3d shoulders', ['shoulders', 'rear delts']],
    ['3D shoulders', ['shoulders', 'rear delts']],
    ['3d delts', ['shoulders', 'rear delts']],
    ['3 d shoulders', ['shoulders', 'rear delts']],
    ['delts', ['shoulders', 'rear delts']],
    ['delt', ['shoulders', 'rear delts']],
    ['deltoids', ['shoulders', 'rear delts']],
    ['all three heads', ['shoulders', 'rear delts']],
    ['all three heads of the deltoid', ['shoulders', 'rear delts']],
    ['front delts', ['shoulders']],
    ['side delts', ['shoulders']],
    ['lateral delts', ['shoulders']],
    ['rear delts', ['rear delts']],
    ['rear delt', ['rear delts']],
    ['shoulders', ['shoulders']],
  ])('"%s" reads as %j and leaves no residue', (text, muscles) => {
    const p = parse(text);
    expect(p.options.focus, text).toEqual(muscles);
    expect(p.residue, text).toEqual([]);
    expect(p.options.count, text).toBeUndefined();
  });

  it('"3D" is not an exercise count of three', () => {
    expect(parse('3d shoulders six exercises').options).toMatchObject({ count: 6, focus: ['shoulders', 'rear delts'] });
    expect(parse('3d shoulders').options.count).toBeUndefined();
  });

  it('"all three heads of the triceps" is the triceps, not the shoulders', () => {
    const p = parse('all three heads of the triceps');
    expect(p.options.focus).toEqual(['triceps']);
    expect(p.residue).toEqual([]);
  });

  it('a negated 3D shoulders rules both groups out', () => {
    const p = parse('push, no 3d shoulders');
    expect(p.options.exclude).toEqual(['shoulders', 'rear delts']);
    expect(p.options.focus).toEqual(['chest', 'triceps']);
  });

  it.each([
    'routine', 'workout', 'programme', 'program', 'plan', 'split', 'day', 'days', 'session', 'solely', 'designed', 'build', 'building',
    'grow', 'growing', 'bigger', 'develop', 'focus', 'focused',
  ])('"%s" is a word a routine request uses, never residue', (word) => {
    const p = parse(`${word} chest`);
    expect(p.residue, word).toEqual([]);
    expect(p.options.focus, word).toEqual(['chest']);
  });

  it('a word it does not know is still residue beside them', () => {
    expect(parse('a routine for chest and a banana').residue).toEqual(['banana']);
  });
});

describe('parseQuickRequest: splits', () => {
  it.each([
    ['ppl', 'ppl'],
    ['PPL', 'ppl'],
    ['push pull legs', 'ppl'],
    ['push/pull/legs', 'ppl'],
    ['push, pull, legs', 'ppl'],
    ['push pull and legs', 'ppl'],
    ['upper lower', 'upper-lower'],
    ['upper/lower', 'upper-lower'],
    ['upper lower split', 'upper-lower'],
    ['upper and lower split', 'upper-lower'],
    ['full body', 'full-body'],
    ['full-body', 'full-body'],
    ['fullbody', 'full-body'],
  ])('"%s" is the %s split, and no muscle focus', (text, split) => {
    const p = parse(`give me a ${text} routine`);
    expect(p.split, text).toBe(split);
    expect(p.options.focus, text).toBeUndefined();
    expect(p.residue, text).toEqual([]);
  });

  it('a split beside a count keeps the count', () => {
    const p = parse('ppl, five exercises a day');
    expect(p.split).toBe('ppl');
    expect(p.options.count).toBe(5);
    expect(p.residue).toEqual([]);
  });

  it('"push" and "push pull" are muscles, not splits', () => {
    expect(parse('push').split).toBeUndefined();
    expect(parse('push').options.focus).toEqual(MACRO_MUSCLES.push);
    expect(parse('push pull').split).toBeUndefined();
    expect(parse('push pull').options.focus).toEqual([...MACRO_MUSCLES.push, ...MACRO_MUSCLES.pull.filter((m) => !MACRO_MUSCLES.push.includes(m))]);
  });

  it('"upper, lower back" is two muscles and not the upper/lower split', () => {
    const p = parse('upper, lower back');
    expect(p.split).toBeUndefined();
    expect(p.options.focus).toEqual([...MACRO_MUSCLES.upper, 'lower back']);
  });

  it('"upper body" and "lower body" stay the muscles they were', () => {
    expect(parse('upper body').split).toBeUndefined();
    expect(parse('lower body').options.focus).toEqual(MACRO_MUSCLES.lower);
  });

  it('a second split is not guessed between: the first stands', () => {
    const p = parse('ppl or full body');
    expect(p.split).toBe('ppl');
    expect(p.residue).toEqual(['full']);
  });

  it('a negated split is not a split', () => {
    expect(parse('no ppl').split).toBeUndefined();
  });

  it('a parse with no split has no split key at all', () => {
    expect('split' in parse('chest')).toBe(false);
  });
});
