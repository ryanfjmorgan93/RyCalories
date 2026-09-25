/**
 * "Copy for Claude" plain-text export (see docs/MERGE_PLAN.md). Pure: builds the export text from
 * data the screen has already loaded — no IO, no clock. `asOf` is passed in throughout.
 *
 * Nothing here leaves the device on its own: the screen puts this text on the clipboard or hands
 * it to the Android share sheet, same as every other export in the app.
 */
import { fmtDateKey, inWindow, windowStart } from './checkin';
import { addDays } from './dates';
import { ZERO, addMacros, type Macros } from './food';
import { fmtNum, fmtSetsLine, plural } from './format';
import { countsForVolume } from './sets';
import type { Bodyweight, ExerciseKind, SetType } from './types';

export interface SummarySet {
  type: SetType;
  weight: number;
  reps?: number;
  seconds?: number;
  distanceM?: number;
}

export interface SummaryExercise {
  name: string;
  kind: ExerciseKind;
  sets: SummarySet[];
}

export interface SummarySession {
  /** YYYY-MM-DD */
  date: string;
  title: string;
  minutes: number | null;
  deload?: boolean;
  exercises: SummaryExercise[];
}

export interface SummaryFoodDay {
  date: string;
  /** null = nothing logged that day. */
  macros: Macros | null;
}

export interface SummaryRoutine {
  name: string;
  items: { name: string; line: string }[];
}

export interface ClaudeSummaryInclude {
  training: boolean;
  food: boolean;
  bodyweight: boolean;
  routines: boolean;
}

export interface ClaudeSummaryInput {
  /** YYYY-MM-DD */
  asOf: string;
  include: ClaudeSummaryInclude;
  /** Sessions inside the window, newest first. */
  training: { days: number; sessions: SummarySession[] };
  food: { days: number; perDay: SummaryFoodDay[]; calorieTarget: number | null; proteinTarget: number | null; proteinTargetLegDay?: number | null };
  /** Any order; filtered to the window here. */
  bodyweight: { days: number; readings: Bodyweight[] };
  routines: SummaryRoutine[];
}

export interface ClaudeSummaryCounts {
  sessions: number;
  foodDays: number;
  foodDaysLogged: number;
  weighIns: number;
  routines: number;
}

const CLOSING_LINE = 'If you write me a routine, put its name on one line, then one exercise per line as: Exercise name 3x8-10 @ 60kg';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Weekday for a YYYY-MM-DD key. Computed from `Date.UTC` and read back with `getUTCDay`, which is
 * timezone-independent (the UTC calendar day is fixed regardless of where this runs) rather than
 * relying on `Intl` or the local clock.
 */
function weekdayOf(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()];
}

/** "Tue 23 Sep" or "Tue 23 Sep 2026". */
export function fmtDayHeading(key: string, withYear = false): string {
  return `${weekdayOf(key)} ${fmtDateKey(key, withYear)}`;
}

/** "31 Jul – 25 Sep", with the year added to both ends only when they differ. */
function fmtRangeHeading(from: string, to: string): string {
  const withYear = from.slice(0, 4) !== to.slice(0, 4);
  return `${fmtDateKey(from, withYear)} – ${fmtDateKey(to, withYear)}`;
}

const intFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** Whole kcal/grams, thousands-separated: "2,410". */
function fmtInt(n: number): string {
  return intFmt.format(Math.round(n));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function filteredBodyweight(input: ClaudeSummaryInput): Bodyweight[] {
  const { asOf, bodyweight } = input;
  return bodyweight.readings
    .filter((b) => inWindow(b.date, asOf, bodyweight.days))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The section builders below are shared with the on-device coach (`./coach`), which reads the same
 * data in the same words but has to fit it into a few thousand tokens: `heading` names a training
 * block narrowed to some exercises, and `detail` drops per-day lines while keeping the counts that
 * say what an average covers.
 */
export function buildTrainingBlock(input: ClaudeSummaryInput, heading = 'TRAINING'): string {
  const { asOf, training } = input;
  const from = windowStart(asOf, training.days);
  const lines = [`${heading} · ${fmtRangeHeading(from, asOf)} · ${plural(training.sessions.length, 'session')}`];
  if (training.sessions.length === 0) {
    lines.push('No sessions in this window.');
    return lines.join('\n');
  }
  for (const s of training.sessions) {
    const head = [fmtDayHeading(s.date), s.title];
    if (s.minutes !== null) head.push(`${s.minutes} min`);
    if (s.deload) head.push('deload');
    lines.push(head.join(' · '));
    for (const ex of s.exercises) {
      const counted = ex.sets.filter((st) => countsForVolume(st.type));
      if (counted.length === 0) continue;
      lines.push(`  ${ex.name}: ${fmtSetsLine(counted, ex.kind)}`);
    }
  }
  return lines.join('\n');
}

export function buildFoodBlock(input: ClaudeSummaryInput, detail: 'days' | 'averages' = 'days'): string {
  const { asOf, food } = input;
  const from = windowStart(asOf, food.days);
  const loggedDays = food.perDay.filter((d) => d.macros !== null);
  const loggedCount = loggedDays.length;
  const lines = [`FOOD · ${fmtRangeHeading(from, asOf)} · ${loggedCount} of ${plural(food.days, 'day')} logged`];
  if (loggedCount === 0) {
    lines.push('Nothing logged in this window.');
    return lines.join('\n');
  }
  const sum = loggedDays.reduce((acc, d) => addMacros(acc, d.macros as Macros), ZERO);
  const avg: Macros = {
    kcal: sum.kcal / loggedCount,
    protein: sum.protein / loggedCount,
    carbs: sum.carbs / loggedCount,
    fat: sum.fat / loggedCount,
  };
  lines.push(
    `Averages over the ${plural(loggedCount, 'logged day')}: ${fmtInt(avg.kcal)} kcal · protein ${fmtInt(avg.protein)} g · carbs ${fmtInt(avg.carbs)} g · fat ${fmtInt(avg.fat)} g`,
  );
  const targets: string[] = [];
  if (food.calorieTarget != null) targets.push(`${fmtInt(food.calorieTarget)} kcal`);
  if (food.proteinTarget != null) {
    let p = `protein ${fmtInt(food.proteinTarget)} g`;
    if (food.proteinTargetLegDay != null) p += ` (leg days ${fmtInt(food.proteinTargetLegDay)} g)`;
    targets.push(p);
  }
  if (targets.length > 0) lines.push(`Targets: ${targets.join(' · ')}`);
  if (detail === 'averages') return lines.join('\n');
  const sorted = [...food.perDay].sort((a, b) => b.date.localeCompare(a.date));
  for (const d of sorted) {
    if (d.macros === null) {
      lines.push(`${fmtDayHeading(d.date)}: not logged`);
    } else {
      lines.push(
        `${fmtDayHeading(d.date)}: ${fmtInt(d.macros.kcal)} kcal · P ${fmtInt(d.macros.protein)} · C ${fmtInt(d.macros.carbs)} · F ${fmtInt(d.macros.fat)}`,
      );
    }
  }
  return lines.join('\n');
}

export function buildBodyweightBlock(input: ClaudeSummaryInput, detail: 'entries' | 'summary' = 'entries'): string {
  const { asOf, bodyweight } = input;
  const from = windowStart(asOf, bodyweight.days);
  const readings = filteredBodyweight(input);
  const lines = [`BODYWEIGHT · ${fmtRangeHeading(from, asOf)} · ${plural(readings.length, 'weigh-in')}`];
  if (readings.length === 0) {
    lines.push('No weigh-ins in this window.');
    return lines.join('\n');
  }
  const first = readings[0];
  const latest = readings[readings.length - 1];
  let stat = `Latest ${fmtNum(latest.kg)} kg (${fmtDateKey(latest.date)})`;
  if (readings.length > 1) {
    const from7 = addDays(latest.date, -6);
    const within7 = readings.filter((b) => b.date >= from7 && b.date <= latest.date);
    const avg7 = within7.reduce((s, b) => s + b.kg, 0) / within7.length;
    stat += ` · 7-day average ${fmtNum(round1(avg7))} kg`;
  }
  stat += ` · first in window ${fmtNum(first.kg)} kg (${fmtDateKey(first.date)})`;
  lines.push(stat);
  if (detail === 'summary') return lines.join('\n');
  const entries = readings.map((b) => `${fmtDateKey(b.date)} ${fmtNum(b.kg)}`);
  for (let i = 0; i < entries.length; i += 7) lines.push(entries.slice(i, i + 7).join(' · '));
  return lines.join('\n');
}

export function buildRoutinesBlock(input: ClaudeSummaryInput): string {
  const lines = ['ROUTINES'];
  if (input.routines.length === 0) {
    lines.push('No routines.');
    return lines.join('\n');
  }
  for (const r of input.routines) {
    lines.push(`${r.name}: ${r.items.map((i) => `${i.name} ${i.line}`).join('; ')}`);
  }
  return lines.join('\n');
}

function computeCounts(input: ClaudeSummaryInput): ClaudeSummaryCounts {
  return {
    sessions: input.training.sessions.length,
    foodDays: input.food.days,
    foodDaysLogged: input.food.perDay.filter((d) => d.macros !== null).length,
    weighIns: filteredBodyweight(input).length,
    routines: input.routines.length,
  };
}

export function buildClaudeSummary(input: ClaudeSummaryInput): { text: string; words: number; counts: ClaudeSummaryCounts } {
  const counts = computeCounts(input);
  const blocks: string[] = [`Iron export · ${fmtDayHeading(input.asOf, true)} · weights in kg`];
  if (input.include.training) blocks.push(buildTrainingBlock(input));
  if (input.include.food) blocks.push(buildFoodBlock(input));
  if (input.include.bodyweight) blocks.push(buildBodyweightBlock(input));
  if (input.include.routines) blocks.push(buildRoutinesBlock(input));
  blocks.push(CLOSING_LINE);
  const text = blocks.join('\n\n');
  const words = text.split(/\s+/).filter(Boolean).length;
  return { text, words, counts };
}
