import { describe, expect, it } from 'vitest';
import {
  aiFills,
  EMPTY_DRAFT,
  quickChips,
  quickOptions,
  removeExcluded,
  setAi,
  tapCount,
  tapEffort,
  tapEquipment,
  tapFocusAuto,
  tapIncludeNew,
  tapMinutes,
  toggleFocus,
  typeText,
  type QuickDraft,
} from './quickDraft';
import { MACRO_MUSCLES, type QuickOptions } from './quickRequest';

const typed = (text: string, from: QuickDraft = EMPTY_DRAFT): QuickDraft => typeText(from, text);
/** `more` typed on after what is there, a key at a time. */
function typedOn(more: string, from: QuickDraft): QuickDraft {
  let d = from;
  for (const ch of more) d = typeText(d, d.text + ch);
  return d;
}
/** Keystroke by keystroke, as the sheet receives it. */
function typedByKey(text: string, from: QuickDraft = EMPTY_DRAFT): QuickDraft {
  let d = from;
  for (let i = 1; i <= text.length; i++) d = typeText(d, text.slice(0, i));
  return d;
}

const LEGS = MACRO_MUSCLES.legs;

/** Nothing is ever both asked for and ruled out, in the options the generator gets and on the chips the owner sees. */
function expectNoOverlap(d: QuickDraft, label = ''): void {
  const o = quickOptions(d);
  const chips = quickChips(d);
  const excluded = chips.excluded.flatMap((c) => c.muscles);
  for (const m of o.focus) {
    expect(o.exclude ?? [], `${label}: ${m} is in the options' focus and exclusion`).not.toContain(m);
    expect(excluded, `${label}: ${m} is in the focus and on an Exclude chip`).not.toContain(m);
  }
  const lit = chips.focus.macros.filter((m) => m.lit).flatMap((m) => MACRO_MUSCLES[m.name]);
  for (const m of [...lit, ...chips.focus.muscles]) expect(excluded, `${label}: ${m} is lit and excluded`).not.toContain(m);
}

describe('typing sets the chips', () => {
  it('reads the whole request into the options and the chips', () => {
    const d = typed("can't be bothered today, give me four exercises that are lightweight");
    const chips = quickChips(d);
    expect(chips.count.selected).toBe(4);
    expect(chips.count.auto).toBe(false);
    expect(chips.effort).toBe('light');
    // Thirty minutes is what was typed and what the options carry, but with four exercises asked for
    // the minutes size nothing, so no Time chip is lit.
    expect(chips.minutes.selected).toBeNull();
    expect(quickOptions(d)).toMatchObject({ count: 4, effort: 'light', minutes: 30, focus: [], includeNew: false });
  });

  it('is the same typed whole or key by key', () => {
    const text = "can't be bothered today, give me four exercises that are lightweight";
    expect(quickOptions(typedByKey(text))).toEqual(quickOptions(typed(text)));
  });

  it('starts on Auto, Normal and 40 minutes with nothing chosen', () => {
    const chips = quickChips(EMPTY_DRAFT);
    expect(chips.count).toMatchObject({ auto: true, selected: null, values: [3, 4, 5, 6] });
    expect(chips.minutes).toMatchObject({ selected: 40, values: [30, 40, 45] });
    expect(chips.effort).toBe('normal');
    expect(chips.focus.auto).toBe(true);
    expect(chips.includeNew).toBe(false);
    expect(quickOptions(EMPTY_DRAFT)).toEqual({ effort: 'normal', minutes: 40, focus: [], includeNew: false });
  });

  it('shows a typed count or time outside the fixed chips as one more, selected', () => {
    const two = quickChips(typed('two exercises'));
    expect(two.count.values).toEqual([2, 3, 4, 5, 6]);
    expect(two.count.selected).toBe(2);
    const eight = quickChips(typed('8 exercises'));
    expect(eight.count.values).toEqual([3, 4, 5, 6, 8]);
    const thirtyFive = quickChips(typed('35 min'));
    expect(thirtyFive.minutes.values).toEqual([30, 35, 40, 45]);
    expect(thirtyFive.minutes.selected).toBe(35);
  });

  it('keeps the typed value beside the fixed chips after a tap moves off it, so it can be tapped back', () => {
    const d = tapCount(typed('two exercises'), 5);
    const chips = quickChips(d);
    expect(chips.count.selected).toBe(5);
    expect(chips.count.values).toContain(2);
    expect(quickChips(tapMinutes(typed('35 min'), 45)).minutes.values).toContain(35);
  });
});

describe('the last action wins, field by field', () => {
  it('a tap replaces what was typed, and a phrase that says something new about that field replaces the tap', () => {
    let d = typed('four exercises');
    expect(quickOptions(d).count).toBe(4);
    d = tapCount(d, 5);
    expect(quickOptions(d).count).toBe(5);
    d = typed('six exercises', d);
    expect(quickOptions(d).count).toBe(6);
    expect(d.taps.count).toBeUndefined();
  });

  it('typing around a phrase that still says the same thing leaves the tap alone', () => {
    let d = tapCount(typed('four exercises'), 5);
    d = typed('four exercises please', d);
    expect(quickOptions(d).count).toBe(5);
    d = typed('easy four exercises please', d);
    expect(quickOptions(d).count).toBe(5);
    expect(quickOptions(d).effort).toBe('light');
  });

  it('typing keystroke by keystroke replaces a tap only once the field is actually mentioned', () => {
    let d = tapCount(EMPTY_DRAFT, 3);
    d = typedByKey('ea', d);
    expect(quickOptions(d).count).toBe(3);
    d = typedByKey('easy and five', typeText(d, ''));
    expect(quickOptions(d).count).toBe(5);
    expect(quickOptions(d).effort).toBe('light');
  });

  describe('a tap survives the half-typed words on the way to a phrase about something else', () => {
    // Every prefix of these parses as something ("4", "3", "four", "ten") that the finished text does not say.
    it.each([
      ['45 min', { minutes: 45 }],
      ['30 min', { minutes: 30 }],
      ['45min', { minutes: 45 }],
      ['legs 30 mins', { minutes: 30 }],
      ['for 45 minutes', { minutes: 45 }],
      ['fourteen exercises', {}],
      ['tender legs', {}],
      ['10 reps of legs', {}],
    ])('tap 6, then "%s" one key at a time: still 6', (text, also) => {
      const d = tapCount(EMPTY_DRAFT, 6);
      const byKey = typedByKey(text, d);
      expect(quickOptions(byKey).count).toBe(6);
      expect(quickOptions(byKey)).toMatchObject(also);
      if (text.includes('legs')) expect(new Set(quickOptions(byKey).focus)).toEqual(new Set(LEGS));
      expect(quickChips(byKey).count.selected).toBe(6);
      // And it is what pasting the same text says.
      expect(quickOptions(byKey)).toEqual(quickOptions(typed(text, d)));
    });

    it('a tap on Auto survives the same way', () => {
      const d = tapCount(EMPTY_DRAFT, null);
      for (const text of ['45 min', 'legs 30 mins', 'fourteen']) {
        expect(quickOptions(typedByKey(text, d)).count, text).toBeUndefined();
        expect(quickChips(typedByKey(text, d)).count.auto, text).toBe(true);
      }
    });

    it('five tapped and "30 min" typed is five exercises and thirty minutes', () => {
      const d = typedByKey('30 min', tapCount(EMPTY_DRAFT, 5));
      expect(quickOptions(d)).toMatchObject({ count: 5, minutes: 30 });
    });

    it('while the half-word is on screen it is what the text says, and the tap is back when it is not', () => {
      let d = tapCount(EMPTY_DRAFT, 6);
      d = typeText(d, '4');
      expect(quickOptions(d).count).toBe(4);
      expect(d.dropped).toEqual({ count: 6 });
      d = typeText(d, '45');
      expect(quickOptions(d).count).toBe(6);
      // Nothing is left waiting once the tap is back.
      expect(d.dropped).toBeUndefined();
      d = typeText(d, '45 min');
      expect(quickOptions(d)).toMatchObject({ count: 6, minutes: 45 });
    });

    it('a count that is really said still takes over from the tap, however it is typed', () => {
      for (const type of [typed, typedByKey]) {
        const d = type('three exercises', tapCount(EMPTY_DRAFT, 5));
        expect(quickOptions(d).count).toBe(3);
        expect(quickChips(d).count.selected).toBe(3);
        expect(type('4 exercises please', tapCount(typed('light'), 6)).taps.count).toBeUndefined();
      }
    });

    it('a time that is really said takes over at once, and not a key later', () => {
      // "4" and "45" are not times without a unit, so the tap stands until "45 m".

      let d = tapMinutes(EMPTY_DRAFT, 30);
      const seen: number[] = [];
      for (const prefix of ['4', '45', '45 ', '45 m', '45 mi', '45 min']) {
        d = typeText(d, prefix);
        seen.push(quickOptions(d).minutes!);
      }
      // "45 mi" is not a time yet, so for that one key the tap stands; "45 min" is 45 again.
      expect(seen).toEqual([30, 30, 30, 45, 30, 45]);
    });

    it('a muscle, an effort and an equipment tap are kept behind what displaces them, and come back with the text gone', () => {
      let focus = toggleFocus(EMPTY_DRAFT, MACRO_MUSCLES.push);
      focus = typedByKey('legs', focus);
      expect(new Set(quickOptions(focus).focus)).toEqual(new Set(LEGS));
      expect(new Set(quickOptions(typed('', focus)).focus)).toEqual(new Set(MACRO_MUSCLES.push));

      let effort = tapEffort(EMPTY_DRAFT, 'normal');
      effort = typedByKey('light', effort);
      expect(quickOptions(effort).effort).toBe('light');
      expect(quickOptions(typed('', effort)).effort).toBe('normal');

      const from = typed('dumbbells and cables');
      let equipment = tapEquipment(from, quickChips(from).equipment[0]);
      expect(quickOptions(equipment).equipment).toEqual(['cable']);
      equipment = typedByKey('machines', equipment);
      expect(quickOptions(equipment).equipment).toEqual(['machine']);
      expect(quickOptions(typed('', equipment)).equipment).toEqual(['cable']);
    });

    it('deleting what displaced a tap, one key at a time, brings it back', () => {
      let d = typedByKey('three exercises', tapCount(EMPTY_DRAFT, 5));
      expect(quickOptions(d).count).toBe(3);
      for (let n = 'three exercises'.length - 1; n >= 0; n--) d = typeText(d, 'three exercises'.slice(0, n));
      expect(quickOptions(d).count).toBe(5);
    });

    it('a tap made after the text displaced one is the later word, and the old one is gone for good', () => {
      let d = typed('three exercises', tapCount(EMPTY_DRAFT, 5));
      d = tapCount(d, 6);
      expect(quickOptions(typed('', d)).count).toBe(6);
      // Auto, too: a tap on Auto since then is not undone by the text going.
      const auto = tapCount(typed('three exercises', tapCount(EMPTY_DRAFT, 5)), null);
      expect(quickOptions(typed('', auto)).count).toBeUndefined();
    });

    it('typed key by key, pasted whole, or pasted over a selection: the same options', () => {
      const starts: [string, QuickDraft][] = [
        ['count 6', tapCount(EMPTY_DRAFT, 6)],
        ['Auto', tapCount(EMPTY_DRAFT, null)],
        ['minutes 30', tapMinutes(EMPTY_DRAFT, 30)],
        ['light', tapEffort(EMPTY_DRAFT, 'light')],
        ['push', toggleFocus(EMPTY_DRAFT, MACRO_MUSCLES.push)],
        ['count 4 typed, 5 tapped', tapCount(typed('four exercises'), 5)],
      ];
      const texts = ['45 min', 'legs 30 mins', 'fourteen', 'for 45 minutes', 'tender legs', 'six exercises', 'easy, three light exercises', 'no legs or arms', 'half an hour of chest', '10 reps of arms'];
      for (const [label, start] of starts) {
        for (const text of texts) {
          expect(quickOptions(typedByKey(text, start)), `${label} + ${text}`).toEqual(quickOptions(typed(text, start)));
        }
      }
    });
  });

  it('deleting the phrase keeps what was tapped, and deleting it with nothing tapped goes back to Auto', () => {
    let d = tapCount(typed('four exercises'), 5);
    d = typed('', d);
    expect(quickOptions(d).count).toBe(5);
    expect(quickOptions(typed('', typed('four exercises'))).count).toBeUndefined();
  });

  it('a tap on Auto beats a typed count until the text says a different one', () => {
    let d = tapCount(typed('four exercises'), null);
    expect(quickChips(d).count).toMatchObject({ auto: true, selected: null });
    expect(quickOptions(d).count).toBeUndefined();
    d = typed('four exercises please', d);
    expect(quickOptions(d).count).toBeUndefined();
    d = typed('three exercises please', d);
    expect(quickOptions(d).count).toBe(3);
  });

  it('a tap on one field leaves the typed value of every other field alone', () => {
    const d = tapCount(typed('tired, no legs, dumbbells'), 4);
    const options = quickOptions(d);
    expect(options).toMatchObject({ count: 4, effort: 'light', minutes: 30, equipment: ['dumbbell'] });
    expect(new Set(options.exclude)).toEqual(new Set(MACRO_MUSCLES.legs));
  });

  it('effort and time follow the same rule', () => {
    let d = tapEffort(typed('light'), 'normal');
    expect(quickOptions(d).effort).toBe('normal');
    d = typed('gentle', d); // still light: nothing new said
    expect(quickOptions(d).effort).toBe('normal');
    d = typed('proper', d);
    expect(quickOptions(d).effort).toBe('normal');
    d = tapMinutes(typed('45 min'), 30);
    expect(quickOptions(d).minutes).toBe(30);
    d = typed('an hour', d);
    expect(quickOptions(d).minutes).toBe(60);
  });

  it('does not change the draft it was given', () => {
    const d = typed('four exercises');
    const snapshot = JSON.stringify(d);
    tapCount(d, 5);
    toggleFocus(d, MACRO_MUSCLES.push);
    typeText(d, 'six');
    tapIncludeNew(d);
    expect(JSON.stringify(d)).toBe(snapshot);
  });
});

describe('the Time chip is lit only while the minutes size the plan', () => {
  it('is lit with no count, and not once a count is typed, tapped or read by the assistant', () => {
    expect(quickChips(EMPTY_DRAFT).minutes.selected).toBe(40);
    expect(quickChips(typed('35 min')).minutes.selected).toBe(35);
    expect(quickChips(typed('four exercises, 35 min')).minutes.selected).toBeNull();
    expect(quickChips(tapCount(EMPTY_DRAFT, 6)).minutes.selected).toBeNull();
    expect(quickChips(setAi(typed('my fancy bits'), { count: 5 })).minutes.selected).toBeNull();
  });

  it('is lit again on Auto, on the minutes that were typed or tapped meanwhile', () => {
    let d = tapCount(typed('35 min'), 5);
    expect(quickChips(d).minutes.selected).toBeNull();
    d = tapCount(d, null);
    expect(quickChips(d).minutes.selected).toBe(35);
    // A Time tap with a count set is remembered, and takes effect when Auto hands the sizing back.
    d = tapMinutes(tapCount(d, 5), 45);
    expect(quickChips(d).minutes.selected).toBeNull();
    expect(quickChips(tapCount(d, null)).minutes.selected).toBe(45);
  });

  it('still offers the typed minutes as a chip, and still hands the generator the minutes', () => {
    const d = typed('4 exercises, 35 min');
    expect(quickChips(d).minutes.values).toEqual([30, 35, 40, 45]);
    expect(quickOptions(d)).toMatchObject({ count: 4, minutes: 35 });
  });
});

describe('focus chips', () => {
  const push = MACRO_MUSCLES.push;
  const pull = MACRO_MUSCLES.pull;
  const lit = (d: QuickDraft) => quickChips(d).focus.macros.filter((m) => m.lit).map((m) => m.name);

  it('Push then Pull adds both, tapping Push again leaves Pull, and Auto clears the focus', () => {
    let d = toggleFocus(EMPTY_DRAFT, push);
    expect(lit(d)).toEqual(['push']);
    d = toggleFocus(d, pull);
    expect(lit(d)).toEqual(['push', 'pull']);
    expect(new Set(quickOptions(d).focus)).toEqual(new Set([...push, ...pull]));
    d = toggleFocus(d, push);
    expect(lit(d)).toEqual(['pull']);
    expect(new Set(quickOptions(d).focus)).toEqual(new Set(pull));
    d = tapFocusAuto(d);
    expect(lit(d)).toEqual([]);
    expect(quickChips(d).focus.auto).toBe(true);
    expect(quickOptions(d).focus).toEqual([]);
  });

  it('the order the chips were tapped in does not reach the generator', () => {
    const a = quickOptions(toggleFocus(toggleFocus(EMPTY_DRAFT, push), pull));
    const b = quickOptions(toggleFocus(toggleFocus(EMPTY_DRAFT, pull), push));
    expect(a).toEqual(b);
  });

  it('Auto beats a typed focus, and typing a different focus takes it back', () => {
    let d = tapFocusAuto(typed('push'));
    expect(quickOptions(d).focus).toEqual([]);
    d = typed('pull', d);
    expect(new Set(quickOptions(d).focus)).toEqual(new Set(pull));
  });

  it('a tap after typing starts from what was typed', () => {
    const d = toggleFocus(typed('push'), pull);
    expect(lit(d)).toEqual(['push', 'pull']);
  });

  it('a macro typed shows as its chip and no single-muscle chips', () => {
    const chips = quickChips(typed('legs'));
    expect(chips.focus.macros.filter((m) => m.lit).map((m) => m.name)).toEqual(['legs']);
    expect(chips.focus.muscles).toEqual([]);
  });

  it('a muscle typed by name is its own removable chip, and removing it leaves the rest', () => {
    let d = typed('calves');
    expect(quickChips(d).focus.muscles).toEqual(['calves']);
    expect(lit(d)).toEqual([]);
    d = toggleFocus(d, push);
    expect(quickChips(d).focus.muscles).toEqual(['calves']);
    expect(lit(d)).toEqual(['push']);
    d = toggleFocus(d, ['calves']);
    expect(quickChips(d).focus.muscles).toEqual([]);
    expect(lit(d)).toEqual(['push']);
  });

  it('two muscles typed are two chips', () => {
    expect(quickChips(typed('chest and calves')).focus.muscles).toEqual(['calves', 'chest']);
  });

  it('Upper lights the macros inside it too, and taking Push out of it unlights Upper', () => {
    let d = typed('upper');
    expect(lit(d)).toEqual(['upper', 'push', 'pull', 'arms']);
    d = toggleFocus(d, push);
    expect(lit(d)).toEqual(['pull']);
    expect(quickChips(d).focus.muscles).toEqual(MACRO_MUSCLES.upper.filter((m) => !pull.includes(m) && !push.includes(m)));
  });
});

describe('exclusions are carried', () => {
  const legs = MACRO_MUSCLES.legs;

  it('no legs reaches the options and survives every tap', () => {
    let d = typed('no legs');
    expect(new Set(quickOptions(d).exclude)).toEqual(new Set(legs));
    d = tapCount(d, 4);
    d = tapEffort(d, 'light');
    d = tapMinutes(d, 45);
    d = toggleFocus(d, MACRO_MUSCLES.push);
    d = tapFocusAuto(d);
    d = tapIncludeNew(d);
    expect(new Set(quickOptions(d).exclude)).toEqual(new Set(legs));
    expect(quickOptions(d)).toMatchObject({ count: 4, effort: 'light', minutes: 45, includeNew: true });
  });

  it('shows as one "legs" chip, and removing it lets the muscles back', () => {
    const d = typed('no legs');
    const chips = quickChips(d).excluded;
    expect(chips.map((c) => [c.key, c.label])).toEqual([['legs', 'legs']]);
    expect(quickOptions(removeExcluded(d, 'legs')).exclude).toBeUndefined();
  });

  it('a single muscle excluded is its own chip', () => {
    const chips = quickChips(typed('no calves')).excluded;
    expect(chips.map((c) => c.key)).toEqual(['calves']);
  });

  it('a whole upper body excluded is one chip, not four', () => {
    expect(quickChips(typed('no upper')).excluded.map((c) => c.key)).toEqual(['upper']);
  });

  it('reads "no legs and no core" as Legs and Core, and removing one leaves the other excluded', () => {
    const d = typed('no legs and no core');
    expect(quickChips(d).excluded.map((c) => c.key)).toEqual(['core', 'legs']);
    const after = removeExcluded(d, 'legs');
    expect(quickChips(after).excluded.map((c) => c.key)).toEqual(['core']);
    expect(new Set(quickOptions(after).exclude)).toEqual(new Set(MACRO_MUSCLES.core));
  });

  it('keeps a muscle excluded while another chip still covers it', () => {
    // Push (chest, shoulders, triceps) and Arms (biceps, triceps, forearms) share the triceps.
    const d = typed('no push and no arms');
    expect(quickChips(d).excluded.map((c) => c.key)).toEqual(['push', 'arms']);
    const after = removeExcluded(d, 'push');
    expect(new Set(quickOptions(after).exclude)).toEqual(new Set(MACRO_MUSCLES.arms));
    expect(quickOptions(after).exclude).toContain('triceps');
  });

  it('says the same muscles the same way however they were asked for', () => {
    // Lower is the legs and the lower back, and Core includes the lower back: the same set as Legs and Core.
    expect(quickChips(typed('no lower and no core')).excluded.map((c) => c.key)).toEqual(['core', 'legs']);
  });

  it('asking for muscles that were ruled out lifts the exclusion, so the two never both stand', () => {
    const d = toggleFocus(typed('no legs'), legs);
    expect(quickOptions(d).exclude).toBeUndefined();
    expect(new Set(quickOptions(d).focus)).toEqual(new Set(legs));
  });

  it('asking for other muscles leaves the exclusion be', () => {
    const d = toggleFocus(typed('no legs'), MACRO_MUSCLES.push);
    expect(new Set(quickOptions(d).exclude)).toEqual(new Set(legs));
  });

  describe('a muscle is never both asked for and ruled out', () => {
    it.each([
      ['typed whole', (d: QuickDraft) => typed('no legs, no arms', d)],
      ['typed on a key at a time', (d: QuickDraft) => typedOn(', no arms', d)],
    ])('Legs tapped over "no legs" stays lifted while the exclusion is edited, %s', (_label, edit) => {
      let d = toggleFocus(typed('no legs'), LEGS);
      expect(quickChips(d).excluded).toEqual([]);
      d = edit(d);
      const o = quickOptions(d);
      expect(new Set(o.focus)).toEqual(new Set(LEGS));
      expect(new Set(o.exclude)).toEqual(new Set(MACRO_MUSCLES.arms));
      const chips = quickChips(d);
      expect(chips.excluded.map((c) => c.key)).toEqual(['arms']);
      expect(chips.focus.macros.filter((m) => m.lit).map((m) => m.name)).toEqual(['legs']);
      expectNoOverlap(d);
    });

    it.each([
      ['typed whole', typed],
      ['typed key by key', typedByKey],
    ])('Legs tapped and then "no legs" typed: the later word wins, Legs is not lit and the exclusion stands, %s', (_label, type) => {
      const d = type('no legs', toggleFocus(EMPTY_DRAFT, LEGS));
      const chips = quickChips(d);
      expect(chips.focus.macros.filter((m) => m.lit)).toEqual([]);
      expect(chips.focus.auto).toBe(true);
      expect(chips.excluded.map((c) => c.key)).toEqual(['legs']);
      expect(quickOptions(d).focus).toEqual([]);
      expect(new Set(quickOptions(d).exclude)).toEqual(new Set(LEGS));
      expectNoOverlap(d);
    });

    it('a muscle the edit newly rules out is not lifted with the one the tap lifted: Legs and Chest tapped, then "no chest"', () => {
      let d = toggleFocus(typed('no legs'), LEGS);
      d = toggleFocus(d, ['chest']);
      expect(quickOptions(d).exclude).toBeUndefined();
      d = typedOn(', no chest, no arms', d);
      expect(new Set(quickOptions(d).focus)).toEqual(new Set(LEGS));
      expect(new Set(quickOptions(d).exclude)).toEqual(new Set(['chest', ...MACRO_MUSCLES.arms]));
      expectNoOverlap(d);
    });

    it('an exclusion that comes back from behind the text is older than a focus tapped since', () => {
      // "No core" from the chips is displaced by a new phrase; Core is tapped; the phrase goes.
      let d = removeExcluded(typed('no legs, no core'), 'legs');
      d = typed('no arms', d);
      expect(new Set(quickOptions(d).exclude)).toEqual(new Set(MACRO_MUSCLES.arms));
      d = toggleFocus(d, MACRO_MUSCLES.core);
      d = typed('', d);
      expect(new Set(quickOptions(d).focus)).toEqual(new Set(MACRO_MUSCLES.core));
      expect(quickOptions(d).exclude).toBeUndefined();
      expectNoOverlap(d);
    });

    it('only the muscles the text rules out give way: Push tapped, "no triceps" typed, is chest and shoulders', () => {
      const d = typedByKey('no triceps', toggleFocus(EMPTY_DRAFT, MACRO_MUSCLES.push));
      expect(quickOptions(d).focus).toEqual(['chest', 'shoulders']);
      expect(quickOptions(d).exclude).toEqual(['triceps']);
      expectNoOverlap(d);
    });

    it('a tap outranked on the way through a longer phrase is back once the text is finished: Legs, then "no lower back"', () => {
      // "no lower" is the legs and the lower back; "no lower back" is the lower back alone.
      const d = typedByKey('no lower back', toggleFocus(EMPTY_DRAFT, LEGS));
      expect(new Set(quickOptions(d).focus)).toEqual(new Set(LEGS));
      expect(quickOptions(d).exclude).toEqual(['lower back']);
      expect(quickChips(d).focus.macros.filter((m) => m.lit).map((m) => m.name)).toEqual(['legs']);
      expectNoOverlap(d);
    });

    it('taking the exclusion chip away lets the muscles be chosen, and does not light up a tap it outranked', () => {
      const d = removeExcluded(typed('no legs', toggleFocus(EMPTY_DRAFT, LEGS)), 'legs');
      expect(quickOptions(d).exclude).toBeUndefined();
      expect(quickOptions(d).focus).toEqual([]);
      expect(quickChips(d).focus.auto).toBe(true);
    });

    it('a focus typed after the exclusion was edited by its chips is the later word: "no legs, no core", Legs off, then "core"', () => {
      let d = removeExcluded(typed('no legs, no core'), 'legs');
      expect(new Set(quickOptions(d).exclude)).toEqual(new Set(MACRO_MUSCLES.core));
      d = typed('core', d);
      expect(new Set(quickOptions(d).focus)).toEqual(new Set(MACRO_MUSCLES.core));
      expect(quickOptions(d).exclude).toBeUndefined();
      expectNoOverlap(d);
    });

    it('holds over a long run of taps and typing, a key at a time', () => {
      // A small seeded generator of its own: the domain has none to borrow, and the run must repeat.
      let state = 20260930;
      const next = (n: number): number => {
        state = (Math.imul(state, 1664525) + 1013904223) | 0;
        return (state >>> 8) % n;
      };
      const phrases = ['no legs', 'legs', 'no legs or arms', 'push', 'no triceps', 'lower back', 'no lower back', 'core', 'no core, legs', 'arms and no biceps', 'upper', 'no upper', 'chest, no legs', '4 exercises', 'light', '45 min', 'no barbell', 'dumbbells'];
      const macros = Object.values(MACRO_MUSCLES);
      let steps = 0;
      for (let run = 0; run < 300; run++) {
        let d: QuickDraft = EMPTY_DRAFT;
        for (let step = 0; step < 14; step++) {
          const pick = next(9);
          if (pick <= 2) d = typedByKey(phrases[next(phrases.length)], pick === 0 ? typeText(d, '') : d);
          else if (pick === 3) d = typeText(d, phrases[next(phrases.length)]);
          else if (pick === 4) d = toggleFocus(d, macros[next(macros.length)]);
          else if (pick === 5) d = tapFocusAuto(d);
          else if (pick === 6) d = tapCount(d, [null, 3, 5][next(3)]);
          else if (pick === 7) {
            const chips = quickChips(d).excluded;
            if (chips.length) d = removeExcluded(d, chips[next(chips.length)].key);
          } else d = typeText(d, d.text.slice(0, next(d.text.length + 1)));
          expectNoOverlap(d, `run ${run} step ${step} "${d.text}"`);
          steps++;
        }
      }
      expect(steps).toBe(4200);
    });
  });

  it('typing a new exclusion replaces a tap that removed the old one', () => {
    let d = removeExcluded(typed('no legs'), 'legs');
    expect(quickOptions(d).exclude).toBeUndefined();
    d = typed('no legs and no core', d);
    expect(new Set(quickOptions(d).exclude)).toEqual(new Set([...legs, ...MACRO_MUSCLES.core]));
  });
});

describe('equipment chips', () => {
  it('shows nothing when equipment is not limited', () => {
    expect(quickChips(EMPTY_DRAFT).equipment).toEqual([]);
  });

  it('a short allow-list reads as itself, and removing the last one means any equipment', () => {
    let d = typed('dumbbells');
    expect(quickChips(d).equipment).toEqual([{ equipment: 'dumbbell', allowed: true, label: 'dumbbell' }]);
    expect(quickOptions(d).equipment).toEqual(['dumbbell']);
    d = tapEquipment(d, quickChips(d).equipment[0]);
    expect(quickOptions(d).equipment).toBeUndefined();
    expect(quickChips(d).equipment).toEqual([]);
  });

  it('three allowed kinds still read as themselves, and four read as what they leave out', () => {
    const three = typed('dumbbells, cables and machines');
    expect(quickChips(three).equipment.map((c) => [c.label, c.allowed])).toEqual([['dumbbell', true], ['machine', true], ['cable', true]]);
    const four = typed('dumbbells, cables, machines and barbells');
    const chips = quickChips(four).equipment;
    expect(chips.every((c) => !c.allowed)).toBe(true);
    expect(chips.map((c) => c.label)).toEqual(['No bodyweight', 'No kettlebell', 'No other']);
  });

  it('two allowed kinds are two chips, and removing one leaves the other', () => {
    let d = typed('dumbbells and cables');
    expect(quickChips(d).equipment.map((c) => c.equipment)).toEqual(['dumbbell', 'cable']);
    d = tapEquipment(d, quickChips(d).equipment[0]);
    expect(quickOptions(d).equipment).toEqual(['cable']);
  });

  it('"no barbell" reads as one "No barbell" chip, and removing it allows every kind again', () => {
    let d = typed('no barbell');
    const chips = quickChips(d).equipment;
    expect(chips).toEqual([{ equipment: 'barbell', allowed: false, label: 'No barbell' }]);
    expect(quickOptions(d).equipment).not.toContain('barbell');
    expect(quickOptions(d).equipment).toHaveLength(6);
    d = tapEquipment(d, chips[0]);
    expect(quickOptions(d).equipment).toBeUndefined();
  });

  it('survives a tap on another field', () => {
    const d = tapCount(typed('dumbbells'), 4);
    expect(quickOptions(d).equipment).toEqual(['dumbbell']);
  });
});

describe('include new', () => {
  it('is off, is a tap only, and the typed line cannot switch it on', () => {
    expect(EMPTY_DRAFT.includeNew).toBe(false);
    expect(quickOptions(typed('new exercises please, something I have never done')).includeNew).toBe(false);
    const on = tapIncludeNew(EMPTY_DRAFT);
    expect(quickOptions(on).includeNew).toBe(true);
    expect(quickChips(on).includeNew).toBe(true);
    expect(quickOptions(typed('four exercises', on)).includeNew).toBe(true);
    expect(quickOptions(tapIncludeNew(on)).includeNew).toBe(false);
  });
});

describe("the assistant's reading", () => {
  /** The words the rules cannot read are "fancy bits"; the rules read four and light. */
  const RULED = 'four light exercises for my fancy bits';
  const ruled = (): QuickDraft => typed(RULED);
  const read = (ai: Partial<QuickOptions> | null, from: QuickDraft = ruled()): QuickDraft => setAi(from, ai);

  it('fills only what the typed line left unset', () => {
    const d = read({ count: 6, minutes: 45, effort: 'normal', focus: ['biceps'], equipment: ['dumbbell'] });
    expect(quickOptions(d)).toEqual({ count: 4, effort: 'light', minutes: 45, focus: ['biceps'], equipment: ['dumbbell'], includeNew: false });
    expect(quickChips(d).count.selected).toBe(4);
    expect(quickChips(d).effort).toBe('light');
    expect(quickChips(d).focus.muscles).toEqual(['biceps']);
  });

  it('sets every field when the typed line said nothing', () => {
    const d = read({ count: 5, minutes: 30, effort: 'light', focus: ['chest', 'triceps'] }, typed('my fancy bits'));
    expect(quickOptions(d)).toMatchObject({ count: 5, minutes: 30, effort: 'light', focus: ['chest', 'triceps'] });
    expect(quickChips(d).count.selected).toBe(5);
    // The assistant's count is a count like any other: the minutes it read size nothing.
    expect(quickChips(d).minutes.selected).toBeNull();
    expect(quickOptions(d).minutes).toBe(30);
  });

  it('leaves the rules\' minutes alone when "tired" already said 30', () => {
    expect(quickOptions(read({ minutes: 45 }, typed('tired, fancy bits'))).minutes).toBe(30);
  });

  it('a muscle the rules ruled out is not brought back by the assistant', () => {
    const d = read({ focus: ['quads', 'chest'] }, typed('no legs, fancy bits'));
    expect(quickOptions(d).focus).toEqual(['chest']);
    expect([...quickOptions(d).exclude!].sort()).toEqual([...MACRO_MUSCLES.legs].sort());
    expect(quickOptions(read({ focus: ['calves'] }, typed('no calves, fancy bits'))).focus).toEqual([]);
  });

  it('takes nothing from a model that read nothing', () => {
    expect(quickOptions(read(null))).toEqual(quickOptions(ruled()));
    expect(quickOptions(read({}))).toEqual(quickOptions(ruled()));
  });

  describe('a tap wins over it, field by field', () => {
    const asked = (): QuickDraft => read({ count: 5, minutes: 30, effort: 'normal', focus: ['biceps'], equipment: ['dumbbell'] }, typed('my fancy bits'));

    it('a chosen value stands', () => {
      const o = quickOptions(tapEffort(tapMinutes(tapCount(asked(), 3), 45), 'light'));
      expect(o).toMatchObject({ count: 3, minutes: 45, effort: 'light' });
    });

    it('Auto is a choice: a count or a focus tapped to Auto is not filled back in', () => {
      const d = tapFocusAuto(tapCount(asked(), null));
      expect(quickOptions(d).count).toBeUndefined();
      expect(quickOptions(d).focus).toEqual([]);
      expect(quickChips(d).count.auto).toBe(true);
      expect(quickChips(d).focus.auto).toBe(true);
      // The fields nobody tapped are still the assistant's.
      expect(quickOptions(d)).toMatchObject({ minutes: 30, effort: 'normal', equipment: ['dumbbell'] });
    });

    it('the last chip of a list taken away leaves that list empty, not the assistant\'s', () => {
      const d = asked();
      const chip = quickChips(d).equipment[0]!;
      expect(quickOptions(tapEquipment(d, chip)).equipment).toBeUndefined();
      expect(quickOptions(toggleFocus(d, ['biceps'])).focus).toEqual([]);
    });

    it('a focus chip the assistant lit is tapped like any other: off, and on again', () => {
      const off = toggleFocus(asked(), ['biceps']);
      expect(quickChips(off).focus.auto).toBe(true);
      expect(quickOptions(toggleFocus(off, ['biceps'])).focus).toEqual(['biceps']);
    });
  });

  describe('it is tied to the text it read', () => {
    it('any change to the text drops it', () => {
      const d = read({ count: 5, focus: ['biceps'] }, typed('my fancy bits'));
      const more = typeText(d, 'my fancy bits please');
      expect(more.ai).toBeNull();
      expect(quickOptions(more)).toEqual(quickOptions(typed('my fancy bits please')));
      // Typing the old words back does not bring the reading back.
      expect(quickOptions(typeText(more, 'my fancy bits'))).toEqual(quickOptions(typed('my fancy bits')));
    });

    it('text that comes out the same leaves it be', () => {
      const d = read({ count: 5 }, typed('my fancy bits'));
      expect(typeText(d, 'my fancy bits').ai).toEqual({ count: 5 });
      expect(quickOptions(typeText(d, 'my fancy bits')).count).toBe(5);
    });

    it('a reading of nothing takes the layer away', () => {
      const d = read({ count: 5 }, typed('my fancy bits'));
      expect(quickOptions(d).count).toBe(5);
      expect(setAi(d, null).ai).toBeNull();
      expect(quickOptions(setAi(d, null)).count).toBeUndefined();
    });

    it('a tap does not drop it', () => {
      const d = tapEffort(read({ count: 5, focus: ['biceps'] }, typed('my fancy bits')), 'light');
      expect(quickOptions(d)).toMatchObject({ count: 5, focus: ['biceps'], effort: 'light' });
    });

    it('is gone from the very first keystroke after it', () => {
      let d = read({ count: 5 }, typed('my fancy bits'));
      d = typeText(d, 'my fancy bit');
      expect(quickOptions(d).count).toBeUndefined();
    });
  });

  describe('it can only ever set options', () => {
    it('never switches Include new on, and never excludes a muscle', () => {
      const d = read({ includeNew: true, exclude: ['legs'], count: 5 } as unknown as Partial<QuickOptions>, typed('my fancy bits'));
      expect(Object.keys(d.ai ?? {})).toEqual(['count']);
      expect(quickOptions(d).includeNew).toBe(false);
      expect(quickOptions(d).exclude).toBeUndefined();
      expect(quickChips(d).excluded).toEqual([]);
      expect(quickChips(d).includeNew).toBe(false);
    });

    it('an Include new the owner tapped stands, and an exclusion they typed is kept', () => {
      const d = read({ focus: ['chest'], includeNew: false } as Partial<QuickOptions>, tapIncludeNew(typed('no calves, fancy bits')));
      expect(quickOptions(d)).toMatchObject({ includeNew: true, exclude: ['calves'], focus: ['chest'] });
    });

    it('carries no exercise and no weight, whatever the reply held', () => {
      const d = read({ exercises: ['Bench Press (Barbell)'], weights: [100], count: 5 } as unknown as Partial<QuickOptions>, typed('my fancy bits'));
      expect(d.ai).toEqual({ count: 5 });
      expect(Object.keys(quickOptions(d)).sort()).toEqual(['count', 'effort', 'focus', 'includeNew', 'minutes']);
      expect(JSON.stringify(quickOptions(d))).not.toMatch(/Bench|100/);
    });

    it('keeps its own copy of the lists it was given', () => {
      const focus: QuickOptions['focus'] = ['biceps'];
      const d = read({ focus }, typed('my fancy bits'));
      focus.push('chest');
      expect(quickOptions(d).focus).toEqual(['biceps']);
    });
  });

  describe('what it added', () => {
    it('names the fields that the typed line and the taps left open', () => {
      expect(aiFills(read({ count: 6, focus: ['biceps'], minutes: 45 }))).toEqual(['minutes', 'focus']);
    });

    it('is empty when everything it read was already decided, or there is no reading', () => {
      expect(aiFills(read({ count: 6, effort: 'normal' }))).toEqual([]);
      expect(aiFills(read({}))).toEqual([]);
      expect(aiFills(ruled())).toEqual([]);
      expect(aiFills(read(null))).toEqual([]);
    });

    it('does not count a field a tap has decided', () => {
      expect(aiFills(tapFocusAuto(read({ focus: ['biceps'] })))).toEqual([]);
      expect(aiFills(tapMinutes(read({ minutes: 45 }), 30))).toEqual([]);
    });
  });
});
