import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  quickChips,
  quickOptions,
  removeExcluded,
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
import { MACRO_MUSCLES } from './quickRequest';

const typed = (text: string, from: QuickDraft = EMPTY_DRAFT): QuickDraft => typeText(from, text);
/** Keystroke by keystroke, as the sheet receives it. */
function typedByKey(text: string, from: QuickDraft = EMPTY_DRAFT): QuickDraft {
  let d = from;
  for (let i = 1; i <= text.length; i++) d = typeText(d, text.slice(0, i));
  return d;
}

describe('typing sets the chips', () => {
  it('reads the whole request into the options and the chips', () => {
    const d = typed("can't be bothered today, give me four exercises that are lightweight");
    const chips = quickChips(d);
    expect(chips.count.selected).toBe(4);
    expect(chips.count.auto).toBe(false);
    expect(chips.effort).toBe('light');
    expect(chips.minutes.selected).toBe(30);
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
