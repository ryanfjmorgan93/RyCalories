/**
 * The state behind the Short session sheet's typed line and chips — pure. No IO, no clock, no
 * random source.
 *
 * Two things set an option: the typed request (`parseQuickRequest`, on every change) and a tap on a
 * chip. The last action wins, field by field: a tap stands until the typed text next changes what
 * it says about that field, and typing a phrase that says nothing new about a field leaves the
 * owner's tap on it alone. Muscles are a set: a focus chip is lit when all of its muscles are in it,
 * and tapping it adds or removes those muscles, so "Push, then Pull" is both and tapping Push again
 * leaves Pull.
 *
 * Typing a phrase that says something different about a field replaces the tap on it, but only for
 * as long as it says it. The sheet hears every keystroke, and a half-typed word ("4" on the way to
 * "45 min", "four" on the way to "fourteen") says things the finished phrase does not: a tap a
 * keystroke displaced is kept behind the text (`dropped`) and comes back the moment the text stops
 * saying anything about that field, so the tap is the same whether the words were typed or pasted.
 * A muscle is never both asked for and ruled out: the later word wins, and a muscle the owner lifted
 * from an exclusion by tapping its chip stays lifted while the exclusion is edited around it.
 *
 * A third layer sits behind both: what the on-device assistant read from the typed line, on the
 * owner's tap (`ai`). It fills only the fields the typed text and the taps both leave unset — a tap
 * on Auto, or on the last chip of a list, is a choice and is left alone too — and only the five
 * fields `mergeIntent` lets it set: never an exclusion, never `includeNew`, never an exercise or a
 * weight. It is tied to the text it read, so any change to the text drops it.
 *
 * `quickOptions` is what the generator is given: the typed options and the taps merged, through
 * `resolveOptions`, so what was typed but not tapped (an exclusion, an equipment limit) is carried
 * and never dropped on the way.
 */
import { DEFAULT_MINUTES, MACRO_MUSCLES, mergeIntent, parseQuickRequest, resolveOptions, type Effort, type QuickOptions } from './quickRequest';
import { EQUIPMENT_KINDS, MUSCLE_GROUPS, type Equipment, type MuscleGroup } from './types';

export type MacroName = keyof typeof MACRO_MUSCLES;

/** The focus chips beyond Auto, in the order they read. */
export const FOCUS_MACROS: readonly MacroName[] = ['upper', 'lower', 'push', 'pull', 'arms', 'core', 'legs'];

/** Fixed chips. A typed value outside them shows as one more, beside them. */
export const COUNT_CHIPS: readonly number[] = [3, 4, 5, 6];
export const MINUTES_CHIPS: readonly number[] = [30, 40, 45];

/**
 * What the owner last tapped, per field. `null` on the count and an empty list elsewhere are a tap
 * on Auto (or on the last chip of a list): a choice, not an absence.
 */
export interface QuickTaps {
  count?: number | null;
  minutes?: number;
  effort?: Effort;
  focus?: MuscleGroup[];
  exclude?: MuscleGroup[];
  equipment?: Equipment[];
}

export interface QuickDraft {
  text: string;
  taps: QuickTaps;
  /** Taps the text displaced, per field, each waiting for the text to stop saying anything about its field. Absent when there are none. */
  dropped?: QuickTaps;
  /** Only ever a tap: neither the typed line nor the assistant can switch it on. */
  includeNew: boolean;
  /** What the assistant read from `text`; absent or null until it has been asked, and dropped when the text changes. */
  ai?: Partial<QuickOptions> | null;
}

export const EMPTY_DRAFT: QuickDraft = { text: '', taps: {}, includeNew: false };

const TAPPABLE = ['count', 'minutes', 'effort', 'focus', 'exclude', 'equipment'] as const;

/** The only fields the assistant may set: the ones `parseIntentReply` reads and `mergeIntent` fills. */
const AI_FIELDS = ['count', 'minutes', 'effort', 'focus', 'equipment'] as const;

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x) => b.includes(x));
  return a === b;
}

/** The muscles in the order `MUSCLE_GROUPS` lists them, once each, so the order they were tapped in never reaches the generator. */
function canonical(muscles: readonly MuscleGroup[]): MuscleGroup[] {
  return MUSCLE_GROUPS.filter((m) => muscles.includes(m));
}

function canonicalEquipment(list: readonly Equipment[]): Equipment[] {
  return EQUIPMENT_KINDS.filter((e) => list.includes(e));
}

// ---------------------------------------------------------------------------
// Typing

/**
 * The text changed. A field the new text says something different about takes the typed value back
 * from any tap on it, and the tap waits in `dropped`; a field it says nothing about, or says the same
 * about, keeps its tap, and a tap that is waiting comes back. Deleting the phrase that set a field
 * leaves whatever was tapped, else Auto. What the assistant read from the old text goes with it: the
 * words it read are gone.
 */
export function typeText(draft: QuickDraft, text: string): QuickDraft {
  if (text === draft.text) return draft;
  const before = parseQuickRequest(draft.text).options;
  const after = parseQuickRequest(text).options;
  const taps: QuickTaps = { ...draft.taps };
  const dropped: QuickTaps = { ...draft.dropped };
  const mutableTaps = taps as Record<string, unknown>;
  const mutableDropped = dropped as Record<string, unknown>;

  for (const field of TAPPABLE) {
    if (after[field] !== undefined) {
      if (field in taps && !same(before[field], after[field])) {
        mutableDropped[field] = taps[field];
        delete taps[field];
      }
    } else if (field in dropped && !(field in taps)) {
      mutableTaps[field] = dropped[field];
      delete dropped[field];
      // An exclusion that comes back is older than a focus tapped since: Legs tapped after "No legs"
      // was displaced does not give way to it.
      if (field === 'exclude' && taps.focus) taps.exclude = taps.exclude!.filter((m) => !taps.focus!.includes(m));
    }
  }

  // A tap that lifted an exclusion ("no legs", then Legs) holds when the exclusion is edited around
  // it: "no legs, no arms" is still no arms and not no legs. What the displaced exclusion tap lifted is
  // what the text excluded and it did not; one the edit newly rules out has no tap behind it, and the
  // reading of the two lists (`effectiveOptions`) lets the exclusion win.
  const displaced = draft.taps.exclude;
  if (displaced && !('exclude' in taps) && taps.focus && after.exclude) {
    const liftedByTap = (before.exclude ?? []).filter((m) => !displaced.includes(m));
    const lifted = taps.focus.filter((m) => liftedByTap.includes(m) && after.exclude!.includes(m));
    if (lifted.length) {
      taps.exclude = after.exclude.filter((m) => !lifted.includes(m));
      delete dropped.exclude;
    }
  }

  const next: QuickDraft = { ...draft, text, taps, ai: null };
  if (Object.keys(dropped).length) next.dropped = dropped;
  else delete next.dropped;
  return next;
}

// ---------------------------------------------------------------------------
// What the taps and the text add up to

/**
 * The typed options with the taps laid over them, and the assistant's reading filling what both left
 * open. Empty lists are left out: an option is either set or absent.
 */
export function effectiveOptions(draft: QuickDraft): Partial<QuickOptions> {
  const parsed = parseQuickRequest(draft.text).options;
  const taps = draft.taps;
  const out: Partial<QuickOptions> = { includeNew: draft.includeNew };

  const count = 'count' in taps ? taps.count : parsed.count;
  if (count !== undefined && count !== null) out.count = count;
  const minutes = taps.minutes ?? parsed.minutes;
  if (minutes !== undefined) out.minutes = minutes;
  const effort = taps.effort ?? parsed.effort;
  if (effort !== undefined) out.effort = effort;
  // A muscle is never both asked for and ruled out, and the later word wins. A typed focus came
  // after any tap on the exclusion, so it beats it; a tap on Legs followed by "no legs" is a focus tap
  // the typed exclusion came after, so the exclusion beats that. A lift the owner tapped on purpose
  // is an exclusion tap (what `toggleFocus` leaves), so it stands. Whatever is left in both, a tap
  // restored from behind the text, is ruled out, as the generator would have it.
  const typedFocus = parsed.focus ?? [];
  let excluded = taps.exclude ?? parsed.exclude ?? [];
  if (taps.exclude !== undefined && taps.focus === undefined) excluded = excluded.filter((m) => !typedFocus.includes(m));
  const exclude = canonical(excluded);
  const focus = canonical((taps.focus ?? typedFocus).filter((m) => !exclude.includes(m)));
  if (focus.length) out.focus = focus;
  if (exclude.length) out.exclude = exclude;
  const equipment = canonicalEquipment(taps.equipment ?? parsed.equipment ?? []);
  if (equipment.length) out.equipment = equipment;

  return draft.ai ? mergeIntent(out, unTapped(draft.ai, taps)) : out;
}

/**
 * The assistant's fields that no tap has spoken for. A tap on a value sets the field itself, so it
 * is already ahead of the assistant; a tap on Auto, or on the last chip of a list, leaves the field
 * empty but is still the owner's choice, and the assistant does not reopen it.
 */
function unTapped(ai: Partial<QuickOptions>, taps: QuickTaps): Partial<QuickOptions> {
  const out: Partial<QuickOptions> = { ...ai };
  if ('count' in taps) delete out.count;
  if (taps.focus !== undefined) delete out.focus;
  if (taps.equipment !== undefined) delete out.equipment;
  return out;
}

/** What the generator is given. */
export function quickOptions(draft: QuickDraft): QuickOptions {
  return resolveOptions(effectiveOptions(draft));
}

// ---------------------------------------------------------------------------
// The assistant's reading

/**
 * Put what the assistant read into the draft, for the text now in it. Only its five fields are
 * kept, whatever the object holds, so nothing else can reach the generator through here; null
 * takes the layer away. Whether it then changes anything is `aiFills`: the typed line and the taps
 * come first.
 */
export function setAi(draft: QuickDraft, ai: Partial<QuickOptions> | null): QuickDraft {
  if (!ai) return { ...draft, ai: null };
  const kept: Partial<QuickOptions> = {};
  for (const field of AI_FIELDS) {
    const value = ai[field];
    if (value === undefined) continue;
    (kept as Record<string, unknown>)[field] = Array.isArray(value) ? [...value] : value;
  }
  return { ...draft, ai: kept };
}

/** The fields the assistant's reading sets that the typed line and the taps left open. Empty when it adds nothing. */
export function aiFills(draft: QuickDraft): (keyof QuickOptions)[] {
  const before = effectiveOptions({ ...draft, ai: null });
  const after = effectiveOptions(draft);
  return (Object.keys(after) as (keyof QuickOptions)[]).filter((field) => before[field] === undefined);
}

// ---------------------------------------------------------------------------
// Taps

export function tapCount(draft: QuickDraft, count: number | null): QuickDraft {
  return { ...draft, taps: { ...draft.taps, count } };
}

export function tapMinutes(draft: QuickDraft, minutes: number): QuickDraft {
  return { ...draft, taps: { ...draft.taps, minutes } };
}

export function tapEffort(draft: QuickDraft, effort: Effort): QuickDraft {
  return { ...draft, taps: { ...draft.taps, effort } };
}

export function tapIncludeNew(draft: QuickDraft): QuickDraft {
  return { ...draft, includeNew: !draft.includeNew };
}

/** Auto: no muscle asked for, so the generator chooses by need. Exclusions stay. */
export function tapFocusAuto(draft: QuickDraft): QuickDraft {
  return { ...draft, taps: { ...draft.taps, focus: [] } };
}

/**
 * Add `muscles` to the focus, or take them out when they are all in it already. Adding muscles the
 * request ruled out ("no legs", then Legs) lifts that exclusion: the last action wins, and the two
 * cannot both stand.
 */
export function toggleFocus(draft: QuickDraft, muscles: readonly MuscleGroup[]): QuickDraft {
  const options = effectiveOptions(draft);
  const focus = options.focus ?? [];
  const lit = muscles.every((m) => focus.includes(m));
  const taps: QuickTaps = { ...draft.taps, focus: lit ? focus.filter((m) => !muscles.includes(m)) : canonical([...focus, ...muscles]) };
  if (!lit) {
    const exclude = options.exclude ?? [];
    if (exclude.some((m) => muscles.includes(m))) taps.exclude = exclude.filter((m) => !muscles.includes(m));
  }
  return { ...draft, taps };
}

/**
 * Remove an exclusion chip (`MuscleChip.key`): what it alone excluded may be chosen again, and what
 * another chip still excludes stays so. "May be chosen" is all it does: a tap on Legs that "no legs"
 * outranked does not light up again with the chip that was taken away.
 */
export function removeExcluded(draft: QuickDraft, key: string): QuickDraft {
  const excluded = effectiveOptions(draft).exclude ?? [];
  const left = cover(excluded).filter((c) => c.key !== key).flatMap((c) => c.muscles);
  const taps: QuickTaps = { ...draft.taps, exclude: canonical(left) };
  const freed = excluded.filter((m) => !left.includes(m));
  if (taps.focus?.some((m) => freed.includes(m))) taps.focus = taps.focus.filter((m) => !freed.includes(m));
  return { ...draft, taps };
}

/**
 * Remove an equipment chip. An allowed kind leaves the allow-list (the last one leaving means any
 * equipment); a "No x" chip puts x back (everything allowed again means any equipment).
 */
export function tapEquipment(draft: QuickDraft, chip: EquipmentChip): QuickDraft {
  const list = effectiveOptions(draft).equipment ?? [];
  let next = chip.allowed ? list.filter((e) => e !== chip.equipment) : [...list, chip.equipment];
  if (next.length >= EQUIPMENT_KINDS.length) next = [];
  return { ...draft, taps: { ...draft.taps, equipment: next } };
}

// ---------------------------------------------------------------------------
// What the chips show

export interface MuscleChip {
  /** A macro's name ("legs") or a muscle's ("calves"): what the test id and the label are made from. */
  key: string;
  label: string;
  muscles: MuscleGroup[];
}

export interface EquipmentChip {
  /** The kind this chip is about; `allowed` tells whether it reads as the kind or as "No <kind>". */
  equipment: Equipment;
  allowed: boolean;
  label: string;
}

export interface QuickChips {
  count: { auto: boolean; values: number[]; selected: number | null };
  /** `selected` is null while a count is set: the minutes size the plan only when the count is derived, so no Time chip is lit. */
  minutes: { values: number[]; selected: number | null };
  effort: Effort;
  focus: {
    auto: boolean;
    macros: { name: MacroName; lit: boolean }[];
    /** Muscles in the focus that no lit macro covers: a muscle typed by name, each its own removable chip. */
    muscles: MuscleGroup[];
  };
  excluded: MuscleChip[];
  equipment: EquipmentChip[];
  includeNew: boolean;
}

/**
 * The fewest chips that say `set`: whole macros where the set holds them, the rest as single
 * muscles. Of equally short covers, the one whose macros overlap least, then the one that leaves
 * fewest single muscles ("no legs, no core" reads as Legs and Core, not Lower and abs).
 */
function cover(set: readonly MuscleGroup[]): MuscleChip[] {
  const fits = FOCUS_MACROS.filter((name) => MACRO_MUSCLES[name].every((m) => set.includes(m)));
  let best: { names: MacroName[]; chips: number; overlap: number; singles: number } | null = null;
  for (let mask = 0; mask < 1 << fits.length; mask++) {
    const names = fits.filter((_, i) => mask & (1 << i));
    const covered = new Set(names.flatMap((n) => MACRO_MUSCLES[n]));
    const singles = set.filter((m) => !covered.has(m)).length;
    const chips = names.length + singles;
    const overlap = names.reduce((n, x) => n + MACRO_MUSCLES[x].length, 0) - covered.size;
    const better = !best || chips < best.chips || (chips === best.chips && (overlap < best.overlap || (overlap === best.overlap && singles < best.singles)));
    if (better) best = { names, chips, overlap, singles };
  }
  const names = best?.names ?? [];
  const covered = new Set(names.flatMap((n) => MACRO_MUSCLES[n]));
  return [
    ...names.map((name) => ({ key: name, label: name, muscles: [...MACRO_MUSCLES[name]] })),
    ...MUSCLE_GROUPS.filter((m) => set.includes(m) && !covered.has(m)).map((m) => ({ key: m, label: m, muscles: [m] })),
  ];
}

function withExtras(standard: readonly number[], ...values: (number | undefined)[]): number[] {
  const all = new Set<number>(standard);
  for (const v of values) if (v !== undefined) all.add(v);
  return [...all].sort((a, b) => a - b);
}

export function quickChips(draft: QuickDraft): QuickChips {
  const options = quickOptions(draft);
  const minutes = options.minutes ?? DEFAULT_MINUTES;
  const parsed = parseQuickRequest(draft.text).options;
  const focus = options.focus;

  const macros = FOCUS_MACROS.map((name) => ({ name, lit: MACRO_MUSCLES[name].every((m) => focus.includes(m)) }));
  const covered = new Set(macros.filter((m) => m.lit).flatMap((m) => MACRO_MUSCLES[m.name]));

  const allowed = options.equipment ?? [];
  // A short allow-list reads as itself; a long one reads as what it leaves out.
  const equipment: EquipmentChip[] =
    allowed.length === 0
      ? []
      : allowed.length <= EQUIPMENT_KINDS.length / 2
        ? allowed.map((e) => ({ equipment: e, allowed: true, label: e }))
        : EQUIPMENT_KINDS.filter((e) => !allowed.includes(e)).map((e) => ({ equipment: e, allowed: false, label: `No ${e}` }));

  return {
    // The typed value stays beside the fixed ones after a tap moves off it, so it can be tapped back.
    count: { auto: options.count === undefined, values: withExtras(COUNT_CHIPS, options.count, parsed.count), selected: options.count ?? null },
    minutes: { values: withExtras(MINUTES_CHIPS, minutes, parsed.minutes), selected: options.count === undefined ? minutes : null },
    effort: options.effort,
    focus: { auto: focus.length === 0, macros, muscles: focus.filter((m) => !covered.has(m)) },
    excluded: cover(options.exclude ?? []),
    equipment,
    includeNew: options.includeNew,
  };
}
