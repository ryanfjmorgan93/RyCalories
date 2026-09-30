import { describe, expect, it } from 'vitest';
import {
  FOCUSABLE_MUSCLES,
  MACRO_MUSCLES,
  buildIntentPrompt,
  mergeIntent,
  parseIntentReply,
  parseQuickRequest,
  resolveOptions,
  type QuickOptions,
} from './quickRequest';
import { EQUIPMENT_KINDS, MUSCLE_GROUPS } from './types';

const parse = (text: string) => parseQuickRequest(text);

describe('parseQuickRequest: the whole sentences', () => {
  it('"can\'t be bothered today, give me four exercises that are lightweight" is four, light, and nothing left over', () => {
    const p = parse("can't be bothered today, give me four exercises that are lightweight");
    expect(p.options.count).toBe(4);
    expect(p.options.effort).toBe('light');
    expect(p.options.minutes).toBe(30);
    expect(p.residue).toEqual([]);
  });

  it('"four light exercises" is four and light; no time is implied by "light" alone', () => {
    const p = parse('four light exercises');
    expect(p.options).toEqual({ count: 4, effort: 'light' });
    expect(p.residue).toEqual([]);
  });

  it('nothing typed reads as nothing', () => {
    for (const text of ['', '   ', '!!! ...', ',']) {
      expect(parse(text)).toEqual({ options: {}, read: [], residue: [] });
    }
  });

  it('lists what it read, as typed and in order, and what it did not', () => {
    const p = parse('Four LIGHT exercises for the mirror');
    expect(p.read).toEqual(['four', 'light']);
    expect(p.residue).toEqual(['mirror']);
  });
});

describe('parseQuickRequest: count', () => {
  it('reads each count word from one to ten', () => {
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    words.forEach((w, i) => {
      expect(parse(`${w} exercises`).options.count).toBe(i + 1);
    });
  });

  it('reads digits, with or without the noun', () => {
    expect(parse('4 exercises').options.count).toBe(4);
    expect(parse('give me 5').options.count).toBe(5);
    expect(parse('10 moves').options.count).toBe(10);
  });

  it('"one" is a count only beside an exercise noun: "an easy one" is not "1"', () => {
    expect(parse('one exercise').options.count).toBe(1);
    expect(parse('one light exercise').options.count).toBe(1);
    const p = parse('give me an easy one');
    expect(p.options.count).toBeUndefined();
    expect(p.options.effort).toBe('light');
    expect(p.residue).toEqual(['one']);
  });

  it('a digit outside 1 to 10 is not a count and is left as residue', () => {
    const p = parse('12 exercises');
    expect(p.options.count).toBeUndefined();
    expect(p.residue).toEqual(['12']);
    expect(parse('0 exercises').options.count).toBeUndefined();
  });

  it('a second count is not guessed between: the first stands and the rest is residue', () => {
    const p = parse('3 or 4 exercises');
    expect(p.options.count).toBe(3);
    expect(p.residue).toEqual(['4']);
  });

  it('a number followed by a time unit is a time, never a count', () => {
    const p = parse('5 min');
    expect(p.options.count).toBeUndefined();
    expect(p.options.minutes).toBeUndefined();
    expect(p.residue).toEqual(['5', 'min']);
  });
});

describe('parseQuickRequest: a number that counts something else is not an exercise count', () => {
  it.each([
    ['3 sets', ['3', 'sets']],
    ['10 reps', ['10', 'reps']],
    ['three sets', ['three', 'sets']],
    ['ten reps', ['ten', 'reps']],
    ['4 x 10', ['4', 'x', '10']],
    ['4x10', ['4', 'x', '10']],
    ['3x10', ['3', 'x', '10']],
    ['5 x 5', ['5', 'x', '5']],
    ['4 by 10', ['4', '10']],
    ['3 times 10', ['3', 'times', '10']],
    ['4 sets of 10', ['4', 'sets', '10']],
    ['three sets of eight', ['three', 'sets', 'eight']],
    ['3 days a week', ['3', 'days', 'week']],
    ['three times a week', ['three', 'times', 'week']],
    ['2 rounds', ['2', 'rounds']],
    ['5 kg', ['5', 'kg']],
    ['4 weeks ago', ['4', 'weeks', 'ago']],
    ['3 day split', ['3', 'split']],
  ])('"%s" is no count, and what it says is left as residue', (text, residue) => {
    const p = parse(text);
    expect(p.options.count, text).toBeUndefined();
    expect(p.residue, text).toEqual(residue);
  });

  it.each([
    'set', 'sets', 'rep', 'reps', 'x', 'by', 'time', 'times', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
    'round', 'rounds', 'kg', 'kgs', 'kilo', 'kilos', 'lb', 'lbs', 'ago',
  ])('a number right before "%s" is not a count, typed as a digit or as a word', (word) => {
    for (const number of ['3', 'three']) {
      const p = parse(`${number} ${word}`);
      expect(p.options.count, `${number} ${word}`).toBeUndefined();
      expect(p.residue, `${number} ${word}`).toContain(number);
    }
  });

  it('keeps the rest of the request: "3 sets of 10 legs" is legs, and "legs 3 days ago" is legs', () => {
    const sets = parse('3 sets of 10 legs');
    expect(sets.options.count).toBeUndefined();
    expect(sets.options.focus).toEqual(MACRO_MUSCLES.legs);
    expect(sets.residue).toEqual(['3', 'sets', '10']);
    const ago = parse('legs 3 days ago');
    expect(ago.options.count).toBeUndefined();
    expect(ago.options.focus).toEqual(MACRO_MUSCLES.legs);
    expect(parse('5 reps of squats').options.count).toBeUndefined();
  });

  it('a count beside one of those is still a count: "4 exercises, 3 sets each" is four', () => {
    const p = parse('4 exercises, 3 sets each');
    expect(p.options.count).toBe(4);
    expect(p.residue).toEqual(['3', 'sets', 'each']);
    expect(parse('3 sets of 10, give me 5 exercises').options.count).toBe(5);
  });

  it('a count with a word between it and the noun is still a count', () => {
    expect(parse('5 leg exercises').options.count).toBe(5);
    expect(parse('four bicep exercises').options.count).toBe(4);
    expect(parse('4 light exercises').options.count).toBe(4);
    expect(parse('give me 4').options.count).toBe(4);
    expect(parse('4').options.count).toBe(4);
    expect(parse('four').options.count).toBe(4);
  });

  it('is the same key by key as whole', () => {
    // Every prefix reads without throwing, and the last one is what the whole text says.
    for (const text of ['3 sets of 10 legs', '4x10', '10 reps']) {
      let last = parse('');
      for (let n = 1; n <= text.length; n++) last = parse(text.slice(0, n));
      expect(last).toEqual(parse(text));
    }
  });
});

describe('parseQuickRequest: effort', () => {
  it.each(['light', 'lightweight', 'easy', 'gentle'])('"%s" is light and does not shorten the session', (w) => {
    expect(parse(`something ${w}`).options).toEqual({ effort: 'light' });
  });

  it.each(['normal', 'heavy', 'proper', 'hard'])('"%s" is normal', (w) => {
    expect(parse(`a ${w} one`).options.effort).toBe('normal');
  });

  it('"not heavy", "not too heavy" and "nothing heavy" are light', () => {
    for (const t of ['not heavy', 'not too heavy', 'nothing heavy', 'nothing hard']) {
      const p = parse(t);
      expect(p.options.effort, t).toBe('light');
      expect(p.residue, t).toEqual([]);
    }
  });

  it('"not light" and "not too easy" are normal, not light', () => {
    expect(parse('not light').options.effort).toBe('normal');
    expect(parse('not too easy').options.effort).toBe('normal');
  });

  it('an effort word the owner named beats effort implied by mood, and the mood still shortens the time', () => {
    const p = parse('tired but a proper session');
    expect(p.options.effort).toBe('normal');
    expect(p.options.minutes).toBe(30);
  });

  it('the last effort word wins', () => {
    expect(parse('light, actually heavy').options.effort).toBe('normal');
    expect(parse('heavy, actually light').options.effort).toBe('light');
  });
});

describe('parseQuickRequest: mood', () => {
  const phrases = [
    "can't be bothered",
    'cant be bothered',
    'cannot be bothered',
    'can not be bothered',
    "couldn't be bothered",
    'cba',
    'tired',
    'knackered',
    'shattered',
    'no energy',
    'not feeling it',
    "can't be arsed",
    'arsed',
  ];

  it.each(phrases)('"%s" is light and thirty minutes', (phrase) => {
    const p = parse(phrase);
    expect(p.options, phrase).toEqual({ effort: 'light', minutes: 30 });
    expect(p.residue, phrase).toEqual([]);
  });

  it('reads curly apostrophes the same as straight ones', () => {
    for (const q of [0x2019, 0x2018, 0x02bc].map((c) => String.fromCharCode(c))) {
      const p = parse(`can${q}t be bothered`);
      expect(p.options, q).toEqual({ effort: 'light', minutes: 30 });
      expect(p.residue, q).toEqual([]);
    }
    expect(parse('I' + String.fromCharCode(0x2019) + 'm knackered').residue).toEqual([]);
  });

  it('a time the owner gave wins over the thirty minutes that mood implies', () => {
    expect(parse('knackered, 45 min').options.minutes).toBe(45);
    expect(parse('40 minutes, cba').options.minutes).toBe(40);
  });

  it('"not tired" is read and cancels the mood: it is neither light nor short, and not residue', () => {
    const p = parse('not tired');
    expect(p.options).toEqual({});
    expect(p.read).toEqual(['not tired']);
    expect(p.residue).toEqual([]);
  });

  it('"quick" and "short" mean thirty minutes and are not residue, but say nothing about effort', () => {
    for (const w of ['quick', 'short']) {
      const p = parse(`a ${w} one`);
      expect(p.options.minutes, w).toBe(30);
      expect(p.options.effort, w).toBeUndefined();
      expect(p.residue, w).toEqual(['one']);
    }
    expect(parse('quick, 45 min').options.minutes).toBe(45);
  });
});

describe('parseQuickRequest: minutes', () => {
  it.each([
    ['40 min', 40],
    ['45min', 45],
    ['20 mins', 20],
    ['30 minutes', 30],
    ['90 minutes', 90],
    ['half an hour', 30],
    ['half hour', 30],
    ['half-hour', 30],
    ['an hour', 60],
    ['1 hour', 60],
    ['one hour', 60],
    ['1.5 hours', 90],
    ['ten minutes', 10],
  ])('"%s" is %i minutes', (text, minutes) => {
    const p = parse(text);
    expect(p.options.minutes).toBe(minutes);
    expect(p.options.count).toBeUndefined();
    expect(p.residue).toEqual([]);
  });

  it('a time outside 10 to 90 minutes is not read and is left as residue', () => {
    for (const text of ['5 min', '2 hours', '120 minutes']) {
      const p = parse(text);
      expect(p.options.minutes, text).toBeUndefined();
      expect(p.residue.length, text).toBeGreaterThan(0);
    }
  });

  it('a fractional number of minutes is not read', () => {
    expect(parse('12.5 minutes').options.minutes).toBeUndefined();
  });

  it('a second time is left as residue and the first stands', () => {
    const p = parse('40 min or 45 min');
    expect(p.options.minutes).toBe(40);
    expect(p.residue).toContain('45');
  });

  it('a count and a time together, in either order', () => {
    expect(parse('4 exercises in 40 minutes').options).toMatchObject({ count: 4, minutes: 40 });
    expect(parse('40 minutes, 4 exercises').options).toMatchObject({ count: 4, minutes: 40 });
  });
});

describe('parseQuickRequest: muscles', () => {
  it.each(Object.entries(MACRO_MUSCLES))('"%s" expands to the macro group', (word, muscles) => {
    expect(parse(word).options.focus).toEqual(muscles);
  });

  it('the macro groups are exactly these muscles', () => {
    expect(MACRO_MUSCLES).toEqual({
      upper: ['chest', 'shoulders', 'triceps', 'biceps', 'forearms', 'lats', 'upper back', 'traps', 'rear delts'],
      lower: ['quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'lower back'],
      push: ['chest', 'shoulders', 'triceps'],
      pull: ['lats', 'upper back', 'traps', 'rear delts', 'biceps'],
      arms: ['biceps', 'triceps', 'forearms'],
      core: ['abs', 'lower back'],
      legs: ['quads', 'hamstrings', 'glutes', 'adductors', 'calves'],
    });
  });

  it('macro groups only name muscles a request can train, with no repeats', () => {
    for (const [name, muscles] of Object.entries(MACRO_MUSCLES)) {
      expect(new Set(muscles).size, name).toBe(muscles.length);
      for (const m of muscles) expect(FOCUSABLE_MUSCLES, `${name}: ${m}`).toContain(m);
    }
  });

  it.each([
    ['chest', ['chest']],
    ['pecs', ['chest']],
    ['back', ['lats', 'upper back']],
    ['shoulders', ['shoulders']],
    ['shoulder', ['shoulders']],
    ['delts', ['shoulders']],
    ['biceps', ['biceps']],
    ['bicep', ['biceps']],
    ['triceps', ['triceps']],
    ['quads', ['quads']],
    ['quad', ['quads']],
    ['hamstrings', ['hamstrings']],
    ['glutes', ['glutes']],
    ['calves', ['calves']],
    ['calf', ['calves']],
    ['abs', ['abs']],
    ['traps', ['traps']],
    ['forearms', ['forearms']],
    ['lats', ['lats']],
    ['lat', ['lats']],
    ['neck', ['neck']],
    ['adductors', ['adductors']],
    ['upper body', MACRO_MUSCLES.upper],
    ['lower body', MACRO_MUSCLES.lower],
  ])('"%s" reads as %j', (text, muscles) => {
    const p = parse(text);
    expect(p.options.focus).toEqual(muscles);
    expect(p.residue).toEqual([]);
  });

  it('"lower back" and "upper back" are the muscles of those names, not "lower" or "back"', () => {
    expect(parse('lower back').options.focus).toEqual(['lower back']);
    expect(parse('upper back').options.focus).toEqual(['upper back']);
    expect(parse('rear delts').options.focus).toEqual(['rear delts']);
  });

  it('several muscles run together in the order given, without repeats', () => {
    expect(parse('chest and biceps').options.focus).toEqual(['chest', 'biceps']);
    expect(parse('back, biceps, back').options.focus).toEqual(['lats', 'upper back', 'biceps']);
    expect(parse('arms and biceps').options.focus).toEqual(['biceps', 'triceps', 'forearms']);
  });

  it('"leg day" and "pull day" read the group and drop the filler', () => {
    const p = parse('leg day');
    expect(p.options.focus).toEqual(MACRO_MUSCLES.legs);
    expect(p.residue).toEqual([]);
    expect(parse('pull day').options.focus).toEqual(MACRO_MUSCLES.pull);
  });
});

describe('parseQuickRequest: negation', () => {
  it('"upper, no triceps" trains the upper body without triceps and records the exclusion', () => {
    const p = parse('upper, no triceps');
    expect(p.options.focus).toEqual(MACRO_MUSCLES.upper.filter((m) => m !== 'triceps'));
    expect(p.options.exclude).toEqual(['triceps']);
  });

  it.each(['no legs', 'not legs', 'without legs', 'skip legs', 'avoid legs', 'no the legs', 'not any legs'])(
    '"%s" removes the leg muscles and adds nothing',
    (text) => {
      const p = parse(text);
      expect(p.options.focus).toBeUndefined();
      expect(p.options.exclude).toEqual(MACRO_MUSCLES.legs);
      expect(p.residue).toEqual([]);
    },
  );

  it('"can\'t do legs" and "don\'t want to train arms" rule the muscles out, and "can\'t be bothered" is still just mood', () => {
    const cant = parse("I can't do legs today");
    expect(cant.options.exclude).toEqual(MACRO_MUSCLES.legs);
    expect(cant.options.focus).toBeUndefined();
    expect(cant.residue).toEqual([]);
    const dont = parse("I don't want to train arms");
    expect(dont.options.exclude).toEqual(MACRO_MUSCLES.arms);
    expect(dont.residue).toEqual([]);
    expect(parse("can't be bothered with legs").options.focus).toEqual(MACRO_MUSCLES.legs);
    expect(parse("can't be bothered").options.exclude).toBeUndefined();
    expect(parse('cant do heavy').options.effort).toBe('light');
  });

  it('a negation does not depend on where it sits in the sentence', () => {
    const a = parse('no calves, legs').options;
    const b = parse('legs, no calves').options;
    expect(a).toEqual(b);
    expect(a.focus).toEqual(['quads', 'hamstrings', 'glutes', 'adductors']);
    expect(a.exclude).toEqual(['calves']);
  });

  it('"no lower back" removes the lower back and not every lower-body muscle', () => {
    expect(parse('no lower back').options.exclude).toEqual(['lower back']);
  });

  it('a negation with nothing after it to negate is residue, not a silent drop', () => {
    const p = parse('no time');
    expect(p.residue).toEqual(['no', 'time']);
  });

  it('negates equipment: "no barbell" allows every other kind', () => {
    const p = parse('no barbell');
    expect(p.options.equipment).toEqual(EQUIPMENT_KINDS.filter((e) => e !== 'barbell'));
    expect(p.options.exclude).toBeUndefined();
  });

  it('"dumbbells and cables, no cables" is dumbbells', () => {
    expect(parse('dumbbells and cables, no cables').options.equipment).toEqual(['dumbbell']);
  });

  it('"not light" is an effort, so it excludes nothing', () => {
    const p = parse('not light');
    expect(p.options.exclude).toBeUndefined();
    expect(p.options.focus).toBeUndefined();
  });

  describe('carries across "or", "and" and "nor"', () => {
    const legsAndArms = [...MACRO_MUSCLES.legs, ...MACRO_MUSCLES.arms];

    it.each(['no legs or arms', 'no legs and arms', 'no legs nor arms', 'without legs or arms', 'skip legs and arms', 'not legs or arms', 'no legs or the arms', 'no legs, or arms'])(
      '"%s" rules out both, and trains neither',
      (text) => {
        const p = parse(text);
        expect(p.options.exclude, text).toEqual(legsAndArms);
        expect(p.options.focus, text).toBeUndefined();
        expect(p.residue, text).toEqual([]);
      },
    );

    it('goes on down a list: "no legs or arms or core"', () => {
      const p = parse('no legs or arms or core');
      expect(p.options.exclude).toEqual([...legsAndArms, 'abs', 'lower back']);
      expect(p.options.focus).toBeUndefined();
      expect(p.read).toEqual(['no legs', 'or arms', 'or core']);
    });

    it('"without legs or core" rules out the legs and the core', () => {
      const p = parse('without legs or core');
      expect(p.options.exclude).toEqual([...MACRO_MUSCLES.legs, 'abs', 'lower back']);
      expect(p.options.focus).toBeUndefined();
    });

    it('"no legs and no arms" was already both, and still is', () => {
      expect(parse('no legs and no arms').options.exclude).toEqual(legsAndArms);
    });

    it('a muscle before the negation is still asked for: "chest, no legs or arms"', () => {
      const p = parse('chest, no legs or arms');
      expect(p.options.focus).toEqual(['chest']);
      expect(p.options.exclude).toEqual(legsAndArms);
    });

    it('a comma ends the negation, so "no calves, legs" and "no legs, arms" train the second', () => {
      expect(parse('no legs, arms').options.focus).toEqual(MACRO_MUSCLES.arms);
      expect(parse('no legs, arms').options.exclude).toEqual(MACRO_MUSCLES.legs);
    });

    it('a new clause after the joiner is not negated: "no legs and do arms", "no legs or 4 exercises"', () => {
      const arms = parse('no legs and do arms');
      expect(arms.options.focus).toEqual(MACRO_MUSCLES.arms);
      expect(arms.options.exclude).toEqual(MACRO_MUSCLES.legs);
      const four = parse('no legs or 4 exercises');
      expect(four.options.count).toBe(4);
      expect(four.options.exclude).toEqual(MACRO_MUSCLES.legs);
    });

    it('only a negation carries: a list of muscles asked for stays asked for', () => {
      expect(parse('legs or arms').options.focus).toEqual(legsAndArms);
      expect(parse('legs or arms').options.exclude).toBeUndefined();
      expect(parse('dumbbells and cables').options.equipment).toEqual(['dumbbell', 'cable']);
    });

    it('nothing carries past another word: "no legs today or arms" asks for arms', () => {
      const p = parse('no legs today or arms');
      expect(p.options.focus).toEqual(MACRO_MUSCLES.arms);
      expect(p.options.exclude).toEqual(MACRO_MUSCLES.legs);
    });

    it('carries across a muscle into equipment', () => {
      const p = parse('no legs or dumbbells');
      expect(p.options.exclude).toEqual(MACRO_MUSCLES.legs);
      expect(p.options.equipment).toEqual(EQUIPMENT_KINDS.filter((e) => e !== 'dumbbell'));
    });

    it('is the same key by key as whole, and every prefix reads', () => {
      for (const text of ['no legs or arms', 'no legs and arms or core', "I don't have a barbell or dumbbells"]) {
        let last = parse('');
        for (let n = 1; n <= text.length; n++) last = parse(text.slice(0, n));
        expect(last).toEqual(parse(text));
      }
    });
  });

  describe('equipment that is negated is left out, however the negation is worded', () => {
    const allBut = (...out: string[]) => EQUIPMENT_KINDS.filter((e) => !out.includes(e));

    it.each([
      ["I don't have a barbell", ['barbell']],
      ["I don't have dumbbells", ['dumbbell']],
      ['i dont have a barbell', ['barbell']],
      ["can't use the barbell", ['barbell']],
      ["I haven't got a barbell", ['barbell']],
      ['I havent got dumbbells', ['dumbbell']],
      ["I don't need a barbell", ['barbell']],
      ["don't have any machines", ['machine']],
      ["I don't have a barbell or dumbbells", ['barbell', 'dumbbell']],
      ["I don't have a barbell and no cables", ['barbell', 'cable']],
      ['no barbell or dumbbells', ['barbell', 'dumbbell']],
      ['no barbell and dumbbells', ['barbell', 'dumbbell']],
      ['without a barbell or cables', ['barbell', 'cable']],
    ])('"%s" allows every other kind', (text, out) => {
      const p = parse(text);
      expect(p.options.equipment, text).toEqual(allBut(...out));
      expect(p.options.exclude, text).toBeUndefined();
      expect(p.residue, text).toEqual([]);
    });

    it('a kind asked for and another ruled out is an allow-list of the first', () => {
      expect(parse('dumbbells, no barbell').options.equipment).toEqual(['dumbbell']);
    });
  });

  describe('muscles that are negated are ruled out, however the negation is worded', () => {
    it.each([
      ["I don't feel like legs", MACRO_MUSCLES.legs],
      ["can't face legs", MACRO_MUSCLES.legs],
      ["I can't do legs or arms", [...MACRO_MUSCLES.legs, ...MACRO_MUSCLES.arms]],
      ["I don't want to do legs", MACRO_MUSCLES.legs],
      ["I won't do legs today", MACRO_MUSCLES.legs],
      ["I don't need to train arms", MACRO_MUSCLES.arms],
    ])('"%s"', (text, muscles) => {
      const p = parse(text);
      expect(p.options.exclude, text).toEqual(muscles);
      expect(p.options.focus, text).toBeUndefined();
    });

    it('"can\'t be bothered" is still only mood, and "can\'t be bothered with legs" still asks for them', () => {
      expect(parse("can't be bothered").options).toEqual({ effort: 'light', minutes: 30 });
      expect(parse("can't be bothered with legs").options.focus).toEqual(MACRO_MUSCLES.legs);
    });
  });

  describe('curly apostrophes read as straight ones', () => {
    const quotes = [0x2019, 0x2018, 0x02bc, 0x0060, 0x00b4].map((c) => String.fromCharCode(c));

    it.each(quotes)('%s in "don\'t have", "can\'t use", "haven\'t got" and "don\'t feel like"', (q) => {
      expect(parse(`I don${q}t have a barbell`).options.equipment).toEqual(EQUIPMENT_KINDS.filter((e) => e !== 'barbell'));
      expect(parse(`can${q}t use the barbell or dumbbells`).options.equipment).toEqual(EQUIPMENT_KINDS.filter((e) => e !== 'barbell' && e !== 'dumbbell'));
      expect(parse(`I haven${q}t got dumbbells`).options.equipment).toEqual(EQUIPMENT_KINDS.filter((e) => e !== 'dumbbell'));
      expect(parse(`I don${q}t feel like legs or arms`).options.exclude).toEqual([...MACRO_MUSCLES.legs, ...MACRO_MUSCLES.arms]);
      expect(parse(`I don${q}t have a barbell`).residue).toEqual([]);
    });
  });
});

describe('parseQuickRequest: equipment', () => {
  it.each([
    ['dumbbells', 'dumbbell'],
    ['dumbbell', 'dumbbell'],
    ['db', 'dumbbell'],
    ['DBs', 'dumbbell'],
    ['machines', 'machine'],
    ['cables', 'cable'],
    ['barbell', 'barbell'],
    ['bodyweight', 'bodyweight'],
    ['body weight', 'bodyweight'],
    ['kettlebells', 'kettlebell'],
  ])('"%s" allows %s', (text, equipment) => {
    const p = parse(text);
    expect(p.options.equipment).toEqual([equipment]);
    expect(p.residue).toEqual([]);
  });

  it('collects several, in order, without repeats', () => {
    expect(parse('dumbbells, cables and db').options.equipment).toEqual(['dumbbell', 'cable']);
  });
});

describe('parseQuickRequest: residue and filler', () => {
  it('filler words are neither read nor residue', () => {
    const p = parse("give me a bit of something for today please, I'm just really quite up for the gym");
    expect(p.residue).toEqual([]);
    expect(p.options).toEqual({});
  });

  it('anything else is residue, in order, lower-cased', () => {
    const p = parse('Four exercises with the KETTLE and something Mirror');
    expect(p.options.count).toBe(4);
    expect(p.residue).toEqual(['kettle', 'mirror']);
  });

  it('is not tripped by words that are also object properties', () => {
    const p = parse('constructor toString __proto__ hasOwnProperty valueOf');
    expect(p.options).toEqual({});
    expect(p.residue).toEqual(['constructor', 'tostring', 'proto', 'hasownproperty', 'valueof']);
  });

  it('a request that mixes read and unread words keeps both', () => {
    const p = parse('shoulders, something that burns, 30 min');
    expect(p.options).toMatchObject({ focus: ['shoulders'], minutes: 30 });
    expect(p.residue).toEqual(['burns']);
  });

  it('never throws on odd input', () => {
    for (const text of ['\u0000\u0001', '\n\t', '💪 4 💪', 'x'.repeat(10000), '4'.repeat(500), 'no '.repeat(200)]) {
      expect(() => parse(text)).not.toThrow();
    }
    expect(() => parseQuickRequest(undefined as unknown as string)).not.toThrow();
  });
});

describe('resolveOptions', () => {
  it('fills the defaults: normal, forty minutes, no focus, no new exercises', () => {
    expect(resolveOptions({})).toEqual({ effort: 'normal', minutes: 40, focus: [], includeNew: false });
  });

  it('keeps what was given, including the thirty minutes a tired request parsed to', () => {
    const o = resolveOptions(parse("can't be bothered, four exercises").options);
    expect(o).toEqual({ count: 4, minutes: 30, effort: 'light', focus: [], includeNew: false });
  });

  it('carries the exclusion and equipment through and copies the arrays instead of sharing them', () => {
    const p: Partial<QuickOptions> = { focus: ['chest'], exclude: ['quads'], equipment: ['cable'] };
    const o = resolveOptions(p);
    expect(o).toMatchObject({ focus: ['chest'], exclude: ['quads'], equipment: ['cable'] });
    o.focus.push('lats');
    o.exclude!.push('calves');
    o.equipment!.push('machine');
    expect(p).toEqual({ focus: ['chest'], exclude: ['quads'], equipment: ['cable'] });
  });
});

describe('buildIntentPrompt', () => {
  const { system, prompt } = buildIntentPrompt('  something\n   gentle for   my shoulders ');

  it('carries the request, tidied, as the prompt', () => {
    expect(prompt).toContain('Request: something gentle for my shoulders');
  });

  it('lists every muscle a request can name and every kind of equipment', () => {
    for (const m of FOCUSABLE_MUSCLES) expect(system).toContain(m);
    for (const e of EQUIPMENT_KINDS) expect(system).toContain(e);
    expect(system).not.toContain('full body');
  });

  it('asks for options only: it forbids exercises and weights and names its five keys', () => {
    for (const key of ['"count"', '"minutes"', '"effort"', '"focus"', '"equipment"']) expect(system).toContain(key);
    expect(system).toMatch(/never name exercises, weights/i);
    expect(system).not.toContain('includeNew');
  });

  it('is the same every time for the same text and caps a very long one', () => {
    expect(buildIntentPrompt('legs')).toEqual(buildIntentPrompt('legs'));
    expect(buildIntentPrompt('x'.repeat(5000)).prompt.length).toBeLessThan(400);
  });
});

describe('parseIntentReply', () => {
  it('reads strict JSON', () => {
    expect(parseIntentReply('{"count": 4, "effort": "light", "focus": ["chest", "lats"]}')).toEqual({
      count: 4,
      effort: 'light',
      focus: ['chest', 'lats'],
    });
  });

  it('reads every field it may set', () => {
    expect(parseIntentReply('{"count":3,"minutes":35,"effort":"normal","focus":["quads"],"equipment":["dumbbell","cable"]}')).toEqual({
      count: 3,
      minutes: 35,
      effort: 'normal',
      focus: ['quads'],
      equipment: ['dumbbell', 'cable'],
    });
  });

  it('tolerates a json code fence, with or without the language tag', () => {
    expect(parseIntentReply('```json\n{"count": 5}\n```')).toEqual({ count: 5 });
    expect(parseIntentReply('```\n{"minutes": 45}\n```')).toEqual({ minutes: 45 });
    expect(parseIntentReply('```JSON {"effort": "light"} ```')).toEqual({ effort: 'light' });
  });

  it('tolerates prose before and after, in a fence or bare', () => {
    expect(parseIntentReply('Sure, here you go: {"count": 4} Hope that helps.')).toEqual({ count: 4 });
    expect(parseIntentReply('Here are the options.\n```json\n{"effort":"light"}\n```\nLet me know.')).toEqual({ effort: 'light' });
  });

  it('is not thrown by braces inside a string, or a stray brace before the object', () => {
    expect(parseIntentReply('{ oops } then {"count": 2, "note": "a } b"}')).toEqual({ count: 2 });
  });

  it('prefers the object in a code fence over an example quoted before it', () => {
    expect(parseIntentReply('For instance {"count": 1} would mean one.\n```json\n{"count": 4}\n```')).toEqual({ count: 4 });
  });

  it('is not stopped by an unbalanced brace in the prose before the object', () => {
    expect(parseIntentReply('A { on its own. {"count": 2}')).toEqual({ count: 2 });
    expect(parseIntentReply('Set { then ```json\n{"minutes": 30}\n```')).toEqual({ minutes: 30 });
  });

  it('takes the first object when there are two', () => {
    expect(parseIntentReply('{"count": 3} and also {"count": 6}')).toEqual({ count: 3 });
  });

  it('reads no further than the first 20,000 characters of a reply', () => {
    expect(parseIntentReply('x'.repeat(20000) + '{"count": 3}')).toBeNull();
    expect(parseIntentReply('x'.repeat(19000) + '{"count": 3}')).toEqual({ count: 3 });
  });

  it('returns null when there is no JSON object to read', () => {
    for (const r of ['', 'I could not work that out.', '[1,2,3]', '"count"', 'null', '{"count": 4', '{count: 4}']) {
      expect(parseIntentReply(r), r).toBeNull();
    }
    expect(parseIntentReply(undefined as unknown as string)).toBeNull();
  });

  it('returns an empty object, not null, for an object that holds nothing usable', () => {
    expect(parseIntentReply('{}')).toEqual({});
    expect(parseIntentReply('{"exercises": ["Squat"]}')).toEqual({});
  });

  describe('validates every field and drops the ones that fail', () => {
    it.each([
      ['count as a string', '{"count": "4"}'],
      ['count as a word', '{"count": "four"}'],
      ['count fractional', '{"count": 4.5}'],
      ['count zero', '{"count": 0}'],
      ['count negative', '{"count": -2}'],
      ['count above 8', '{"count": 9}'],
      ['count null', '{"count": null}'],
      ['minutes below 10', '{"minutes": 5}'],
      ['minutes above 90', '{"minutes": 91}'],
      ['minutes as a string', '{"minutes": "40"}'],
      ['minutes fractional', '{"minutes": 37.5}'],
      ['effort unknown', '{"effort": "heavy"}'],
      ['effort a number', '{"effort": 1}'],
      ['focus a string', '{"focus": "chest"}'],
      ['focus with a bad entry', '{"focus": ["chest", "pinky"]}'],
      ['focus with a non-string', '{"focus": ["chest", 3]}'],
      ['focus empty', '{"focus": []}'],
      ['focus naming no muscle', '{"focus": ["full body"]}'],
      ['focus as an object', '{"focus": {"0": "chest"}}'],
      ['equipment with a bad entry', '{"equipment": ["dumbbell", "spaceship"]}'],
      ['equipment a string', '{"equipment": "cable"}'],
    ])('%s is dropped', (_label, reply) => {
      expect(parseIntentReply(reply)).toEqual({});
    });

    it('keeps the good fields beside the bad ones', () => {
      expect(parseIntentReply('{"count": "many", "minutes": 30, "effort": "extreme", "focus": ["biceps"], "equipment": ["laser"]}')).toEqual({
        minutes: 30,
        focus: ['biceps'],
      });
    });

    it('forgives case and padding in a name and drops repeats', () => {
      expect(parseIntentReply('{"effort": " Light ", "focus": ["Chest", "chest", " LATS"]}')).toEqual({ effort: 'light', focus: ['chest', 'lats'] });
    });

    it('accepts the ends of each range', () => {
      expect(parseIntentReply('{"count": 1, "minutes": 10}')).toEqual({ count: 1, minutes: 10 });
      expect(parseIntentReply('{"count": 8, "minutes": 90}')).toEqual({ count: 8, minutes: 90 });
    });

    it('accepts every muscle a request can name and every equipment kind', () => {
      expect(parseIntentReply(JSON.stringify({ focus: FOCUSABLE_MUSCLES }))).toEqual({ focus: FOCUSABLE_MUSCLES });
      expect(parseIntentReply(JSON.stringify({ equipment: EQUIPMENT_KINDS }))).toEqual({ equipment: EQUIPMENT_KINDS });
      expect(MUSCLE_GROUPS.length).toBeGreaterThan(FOCUSABLE_MUSCLES.length);
    });
  });

  describe('never returns anything but options', () => {
    it('ignores unknown keys, and exercises and weights above all', () => {
      const reply = JSON.stringify({
        count: 4,
        exercises: [{ name: 'Barbell Back Squat', sets: 5, reps: 5, weightKg: 140 }],
        weights: { squat: 140 },
        weightKg: 100,
        sets: 5,
        reps: 8,
        routine: 'Legs',
        includeNew: true,
        exclude: ['quads'],
        unknown: 1,
      });
      const out = parseIntentReply(reply);
      expect(out).toEqual({ count: 4 });
      expect(Object.keys(out ?? {})).toEqual(['count']);
    });

    it('never returns more than the five option keys, whatever the reply holds', () => {
      const reply = JSON.stringify({ count: 3, minutes: 30, effort: 'light', focus: ['chest'], equipment: ['cable'], includeNew: true, exclude: ['abs'], id: 'x' });
      expect(Object.keys(parseIntentReply(reply) ?? {}).sort()).toEqual(['count', 'effort', 'equipment', 'focus', 'minutes']);
    });

    it('does not let a __proto__ key reach the result or Object.prototype', () => {
      const out = parseIntentReply('{"__proto__": {"count": 3, "polluted": true}, "minutes": 40}');
      expect(out).toEqual({ minutes: 40 });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(({} as Record<string, unknown>).count).toBeUndefined();
    });
  });
});

describe('mergeIntent', () => {
  it('fills a field the rules left unset', () => {
    expect(mergeIntent({ count: 4 }, { effort: 'light', focus: ['chest'] })).toEqual({ count: 4, effort: 'light', focus: ['chest'] });
  });

  it('never overwrites a field the rules set, even with a different value', () => {
    const rules: Partial<QuickOptions> = { count: 4, minutes: 30, effort: 'normal', focus: ['quads'], equipment: ['machine'] };
    const ai: Partial<QuickOptions> = { count: 6, minutes: 60, effort: 'light', focus: ['chest'], equipment: ['cable'] };
    expect(mergeIntent(rules, ai)).toEqual(rules);
  });

  it('takes each field independently: one set by the rules does not block the others', () => {
    expect(mergeIntent({ effort: 'light' }, { count: 3, minutes: 45, effort: 'normal' })).toEqual({ effort: 'light', count: 3, minutes: 45 });
  });

  it('with no assistant reply, is a copy of the rules', () => {
    const rules: Partial<QuickOptions> = { count: 4, focus: ['abs'] };
    const out = mergeIntent(rules, null);
    expect(out).toEqual(rules);
    expect(out).not.toBe(rules);
    expect(out.focus).not.toBe(rules.focus);
  });

  it('treats an empty focus or equipment list as unset', () => {
    expect(mergeIntent({ focus: [], equipment: [] }, { focus: ['lats'], equipment: ['dumbbell'] })).toEqual({ focus: ['lats'], equipment: ['dumbbell'] });
  });

  it('never brings back a muscle the rules ruled out', () => {
    expect(mergeIntent({ exclude: ['quads'] }, { focus: ['quads', 'chest'] })).toEqual({ exclude: ['quads'], focus: ['chest'] });
    expect(mergeIntent({ exclude: ['quads'] }, { focus: ['quads'] })).toEqual({ exclude: ['quads'] });
  });

  it('takes only the five fields the assistant may set, even if handed more', () => {
    const ai = { count: 3, includeNew: true, exclude: ['abs'] } as Partial<QuickOptions>;
    expect(mergeIntent({}, ai)).toEqual({ count: 3 });
  });

  it('does not mutate what it was given', () => {
    const rules: Partial<QuickOptions> = { focus: ['abs'] };
    const ai: Partial<QuickOptions> = { count: 3, equipment: ['cable'] };
    const before = JSON.stringify([rules, ai]);
    const out = mergeIntent(rules, ai);
    out.equipment!.push('machine');
    out.focus!.push('lats');
    expect(JSON.stringify([rules, ai])).toBe(before);
  });
});
