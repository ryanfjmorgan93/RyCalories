/**
 * The coach's picture of the owner: a compact text snapshot, built from the data the app already
 * has and sent with every Claude call.
 *
 * Two parts, because of prompt caching (a prefix match — see src/ai/persona.ts):
 *   - `stable`: what changes rarely, in an order that does not move. Coach notes, routines, body
 *     scans, goals, and the training / food / bodyweight history up to yesterday. Sent right after
 *     the persona with a cache breakpoint, so a follow-up message pays a tenth of the price for it.
 *   - `volatile`: what changes by the minute. The time, today's food, today's weigh-in, the live
 *     session, and what the coach has already said today. Sent after the breakpoint, never cached.
 *
 * The history text is not written again here: it is the "Copy for Claude" summary's own section
 * builders (src/domain/claudeSummary.ts) over `loadClaudeSummaryInput`, in the owner's own words.
 * The whole snapshot is held to about 6K tokens; if the history would push it over, the detail
 * steps down (daily food lines become averages, then fewer sessions) rather than the notes or the
 * live session being cut.
 */
import {
  buildBodyweightBlock,
  buildFoodBlock,
  buildRoutinesBlock,
  buildTrainingBlock,
  type ClaudeSummaryInput,
} from '@/domain/claudeSummary';
import { addDays, daysBetween, isoToDateKey, toDateKey } from '@/domain/dates';
import { displayMacros, type Macros } from '@/domain/food';
import { fmtKg, fmtNum, fmtSetsLine, fmtTime, plural, targetLine } from '@/domain/format';
import { DEFAULT_SETTINGS, type BodyScan, type CoachMessage, type CoachNote, type Exercise, type MealItem, type RoutineExercise, type Session, type Settings } from '@/domain/types';
import { loadClaudeSummaryInput } from '@/db/claudeSummaryQueries';
import { db } from '@/db/db';
import { SUPPLEMENT_TIME_LABEL, supplementDay, supplementLabel } from '@/domain/supplements';
import { mealsOnDay } from '@/db/foodRepo';
import { completedSessions } from '@/db/historyQueries';
import { getActiveSession, getSettings, routineItems, setsForSlot } from '@/db/repo';
import { dayView } from '@/db/todayQueries';
import type { PlanOverridePatch } from './types';

/** The most the snapshot should run to. Tokens are estimated from characters (see `estimateTokens`). */
export const MAX_CONTEXT_TOKENS = 6000;

/** Characters per token, set low on purpose: the current tokenizers count ordinary English at roughly 3.5 to 4. */
const CHARS_PER_TOKEN = 3.2;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** How much of a note's id the coach is shown, and so gives back to forget it. */
const NOTES_SHORT_ID = 8;

export interface CoachContext {
  stable: string;
  volatile: string;
  /** Both parts, in the order they are sent. */
  text: string;
  /** Estimated tokens in `text`. */
  tokens: number;
}

export interface ContextOptions {
  /** The moment the snapshot is for. Defaults to now. */
  now?: Date;
  settings?: Settings;
  /** Overrides MAX_CONTEXT_TOKENS. */
  maxTokens?: number;
}

type SessionWithOverrides = Session & { planOverrides?: Record<string, PlanOverridePatch> };

// ---------------------------------------------------------------------------
// Pure section builders (exported for tests)

/** The short id the coach is shown for a note, and later gives back to forget it. */
export function noteShortId(id: string): string {
  return id.slice(0, NOTES_SHORT_ID);
}

export function notesBlock(notes: readonly CoachNote[]): string {
  const lines = ['COACH NOTES (things you were asked to remember; ids are for the forget tool)'];
  if (notes.length === 0) {
    lines.push('None yet.');
    return lines.join('\n');
  }
  for (const n of [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    lines.push(`[${noteShortId(n.id)}] ${n.text.trim()} (${n.createdAt.slice(0, 10)})`);
  }
  return lines.join('\n');
}

function scanLine(s: BodyScan): string {
  const parts: string[] = [];
  if (s.weightKg !== undefined) parts.push(fmtKg(s.weightKg));
  if (s.skeletalMuscleKg !== undefined) parts.push(`skeletal muscle ${fmtKg(s.skeletalMuscleKg)}`);
  if (s.bodyFatKg !== undefined || s.bodyFatPct !== undefined) {
    const mass = s.bodyFatKg !== undefined ? fmtKg(s.bodyFatKg) : '';
    const pct = s.bodyFatPct !== undefined ? `${fmtNum(s.bodyFatPct)} %` : '';
    parts.push(`body fat ${[mass, pct && (mass ? `(${pct})` : pct)].filter(Boolean).join(' ')}`);
  }
  if (s.leanMassKg !== undefined) parts.push(`lean ${fmtKg(s.leanMassKg)}`);
  if (s.bmrKcal !== undefined) parts.push(`BMR ${fmtNum(s.bmrKcal)} kcal`);
  if (s.visceralFatLevel !== undefined) parts.push(`visceral fat ${fmtNum(s.visceralFatLevel)}`);
  if (s.inbodyScore !== undefined) parts.push(`InBody score ${fmtNum(s.inbodyScore)}`);
  return `${s.date}: ${parts.join(' · ') || 'no measures'}`;
}

function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${fmtNum(r)}` : r < 0 ? `−${fmtNum(Math.abs(r))}` : '0';
}

/** The latest scans (newest first) and what changed between the two most recent. */
export function bodyScansBlock(scans: readonly BodyScan[], limit = 3): string {
  const lines = ['BODY SCANS (InBody)'];
  const sorted = [...scans].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  if (sorted.length === 0) {
    lines.push('No scans imported.');
    return lines.join('\n');
  }
  for (const s of sorted) lines.push(scanLine(s));
  const [latest, previous] = sorted;
  if (latest && previous) {
    const deltas: string[] = [];
    const pair = (label: string, a: number | undefined, b: number | undefined) => {
      if (a !== undefined && b !== undefined) deltas.push(`${label} ${signed(a - b)} kg`);
    };
    pair('weight', latest.weightKg, previous.weightKg);
    pair('skeletal muscle', latest.skeletalMuscleKg, previous.skeletalMuscleKg);
    pair('body fat', latest.bodyFatKg, previous.bodyFatKg);
    if (deltas.length > 0) lines.push(`Change since ${previous.date}: ${deltas.join(' · ')}`);
  }
  return lines.join('\n');
}

/**
 * The owner's own exercises that no routine uses, by name: what the coach can add to a routine or
 * swap in without asking, since a tool only finds exercises the owner already has. Null when there
 * are none.
 */
export function otherExercisesBlock(exercises: readonly Pick<Exercise, 'id' | 'name'>[], usedIds: ReadonlySet<string>, limit = 40): string | null {
  const names = exercises
    .filter((e) => !usedIds.has(e.id))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  if (names.length === 0) return null;
  const shown = names.slice(0, limit);
  return `OTHER EXERCISES THE OWNER HAS (in no routine; the tools can add or swap these)\n${shown.join('; ')}${names.length > limit ? `; and ${names.length - limit} more` : ''}`;
}

export function goalsLine(settings: Settings): string {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const parts = [
    `bodyweight ${fmtNum(s.bodyweightTargetMin)}–${fmtNum(s.bodyweightTargetMax)} kg`,
    `gain ${fmtNum(s.weeklyGainTargetMin)}–${fmtNum(s.weeklyGainTargetMax)} kg a week`,
    `protein ${fmtNum(s.proteinTarget)} g (${fmtNum(s.proteinTargetLegDay)} g on leg days)`,
  ];
  if (s.weeklySessionTarget) parts.push(`${plural(s.weeklySessionTarget, 'session')} a week`);
  return `GOALS: ${parts.join(' · ')}`;
}

function macroLine(m: Macros): string {
  return `${fmtNum(m.kcal)} kcal · P ${fmtNum(m.protein)} · C ${fmtNum(m.carbs)} · F ${fmtNum(m.fat)}`;
}

function itemLine(i: MealItem): string {
  const m = displayMacros(i.nutrition);
  const approx = i.source === 'model' ? '≈' : '';
  const portion = i.portion ? ` ${i.portion}` : '';
  return `${i.name}${portion} (${approx}${fmtNum(m.kcal)} kcal, P ${approx}${fmtNum(m.protein)})`;
}

/** Plan override applied to a routine-exercise, for what the live session is actually asking of the owner today. */
export function effectiveRx(rx: RoutineExercise, override: PlanOverridePatch | undefined): { rx: RoutineExercise; changed: boolean } {
  if (!override) return { rx, changed: false };
  const next = { ...rx };
  if (override.targetSets !== undefined) {
    next.targetSets = override.targetSets;
    next.targetSetsMax = undefined;
  }
  if (override.repMin !== undefined) next.repMin = override.repMin;
  if (override.repMax !== undefined) next.repMax = override.repMax;
  if (override.weight !== undefined) {
    next.currentWeight = override.weight;
    if (next.mode === 'calibrating') next.mode = 'normal';
  }
  return { rx: next, changed: true };
}

// ---------------------------------------------------------------------------
// Live session

async function liveSessionBlock(now: Date): Promise<string | null> {
  const session = (await getActiveSession()) as SessionWithOverrides | undefined;
  if (!session) return null;
  const items = await routineItems(session.routineId);
  const overrides = session.planOverrides ?? {};
  const skipped = new Set(session.skippedRoutineExerciseIds ?? []);
  const swaps = session.swaps ?? {};
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(session.startedAt)) / 60000));
  const tags = [session.deload ? 'deload' : '', session.quick ? `short session (${session.quick})` : ''].filter(Boolean);
  const lines = [`LIVE SESSION · ${session.title} · started ${fmtTime(session.startedAt)}, ${minutes} min ago${tags.length ? ` · ${tags.join(', ')}` : ''}`];

  const nameOf = new Map<string, Exercise>(items.map((it) => [it.exercise.id, it.exercise]));
  const exerciseName = async (id: string): Promise<string> => nameOf.get(id)?.name ?? (await db.exercises.get(id))?.name ?? 'an exercise';

  for (const { rx, exercise } of items) {
    const { rx: eff, changed } = effectiveRx(rx, overrides[rx.id]);
    const sets = (await setsForSlot(session.id, rx.id, exercise.id)).filter((s) => s.type !== 'warmup');
    if (skipped.has(rx.id)) {
      const swapId = swaps[rx.id];
      lines.push(`  ${exercise.name}: ${swapId ? `swapped for ${await exerciseName(swapId)}` : 'skipped today'}`);
      continue;
    }
    const left = Math.max(0, eff.targetSets - sets.length);
    const done = sets.length > 0 ? fmtSetsLine(sets, exercise.kind) : 'none yet';
    const optional = rx.optional ? ' (optional)' : '';
    lines.push(`  ${exercise.name}${optional}: ${targetLine(eff, exercise.kind)}${changed ? ' [changed for today]' : ''} · done: ${done} · ${left === 0 ? 'all sets done' : `${plural(left, 'set')} to go`}`);
  }
  for (const exerciseId of session.extraExerciseIds ?? []) {
    const exercise = nameOf.get(exerciseId) ?? (await db.exercises.get(exerciseId));
    if (!exercise) continue;
    const sets = (await setsForSlot(session.id, null, exerciseId)).filter((s) => s.type !== 'warmup');
    lines.push(`  ${exercise.name} (added today): ${sets.length > 0 ? fmtSetsLine(sets, exercise.kind) : 'none yet'}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Coach lines already said today

async function coachToday(now: Date): Promise<string | null> {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const rows: CoachMessage[] = await db.coachMessages.where('at').aboveOrEqual(startOfDay).toArray();
  const said = rows.filter((m) => m.role === 'coach' && m.text.trim()).sort((a, b) => a.at.localeCompare(b.at)).slice(-6);
  if (said.length === 0) return null;
  const lines = ['WHAT YOU HAVE ALREADY SAID TODAY (do not repeat it; at most one quote a day)'];
  for (const m of said) {
    const text = m.text.trim().replace(/\s+/g, ' ');
    lines.push(`  ${fmtTime(m.at)} ${text.length > 160 ? `${text.slice(0, 157)}…` : text}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The history, in steps from fullest to leanest

export interface Level {
  food: 'days' | 'averages';
  bodyweight: 'entries' | 'summary';
  /** Most sessions to list; Infinity = every session in the window. */
  sessions: number;
}

const LEVELS: Level[] = [
  { food: 'days', bodyweight: 'entries', sessions: Infinity },
  { food: 'averages', bodyweight: 'entries', sessions: Infinity },
  { food: 'averages', bodyweight: 'summary', sessions: Infinity },
  { food: 'averages', bodyweight: 'summary', sessions: 16 },
  { food: 'averages', bodyweight: 'summary', sessions: 10 },
  { food: 'averages', bodyweight: 'summary', sessions: 6 },
  { food: 'averages', bodyweight: 'summary', sessions: 3 },
];

/** The history windows: six weeks of training and bodyweight, three of food. */
const WINDOWS = { trainingDays: 42, foodDays: 21, bodyweightDays: 42 };

/** The history blocks of the stable part, from the summary's own builders, up to yesterday for food and weight. */
export function historyBlocks(input: ClaudeSummaryInput, today: string, level: Level): { bodyweight: string; training: string; food: string } {
  const yesterday = addDays(today, -1);
  const all = input.training.sessions;
  const sessions = all.slice(0, level.sessions);
  // Fewer sessions than the window holds: the heading's range shrinks to what is listed, so it never claims the rest was empty.
  const oldest = sessions[sessions.length - 1];
  const trainingDays = oldest && sessions.length < all.length ? daysBetween(oldest.date, input.asOf) + 1 : input.training.days;
  const training = buildTrainingBlock({ ...input, training: { days: trainingDays, sessions } });
  const food = buildFoodBlock(
    { ...input, asOf: yesterday, food: { ...input.food, days: Math.max(1, input.food.days - 1), perDay: input.food.perDay.filter((d) => d.date < today) } },
    level.food,
  );
  const bodyweight = buildBodyweightBlock(
    { ...input, asOf: yesterday, bodyweight: { days: Math.max(1, input.bodyweight.days - 1), readings: input.bodyweight.readings.filter((b) => b.date < today) } },
    level.bodyweight,
  );
  return { bodyweight, training, food };
}

// ---------------------------------------------------------------------------
// The two parts, and the whole

const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

function budgetChars(opts: ContextOptions): number {
  return (opts.maxTokens ?? MAX_CONTEXT_TOKENS) * CHARS_PER_TOKEN;
}

/**
 * The volatile part: the time, today's food and weigh-in, the live session, and what the coach has
 * already said today. Cheap to build (a handful of small queries), so it is rebuilt for every call.
 */
export async function buildVolatileContext(opts: ContextOptions = {}): Promise<string> {
  const now = opts.now ?? new Date();
  const today = toDateKey(now);
  const settings = opts.settings ?? (await getSettings());
  const [view, todayMeals, live, said, lastFinished, lastMeal, weighIn, supplements, supplementLogs] = await Promise.all([
    dayView(today, settings, today),
    mealsOnDay(today),
    liveSessionBlock(now),
    coachToday(now),
    completedSessions().then((all) => all[0]),
    db.meals.orderBy('date').last(),
    db.bodyweight.where('date').equals(today).first(),
    db.supplements.toArray(),
    db.supplementLogs.where('date').equals(today).toArray(),
  ]);
  const sups = supplementDay(supplements, supplementLogs, today);
  const supplementLine =
    sups.total === 0
      ? 'SUPPLEMENTS: none on the checklist.'
      : `SUPPLEMENTS · ${sups.taken} of ${sups.total} ticked today: ${sups.items.map(({ supplement, taken }) => `${supplementLabel(supplement)} (${SUPPLEMENT_TIME_LABEL[supplement.time].toLowerCase()}, ${taken ? 'taken' : 'not yet'})`).join('; ')}`;

  const sinceSession = lastFinished ? daysBetween(isoToDateKey(lastFinished.startedAt), today) : null;
  const lastFoodDay = todayMeals.length > 0 ? today : lastMeal?.date;
  const sinceFood = lastFoodDay ? daysBetween(lastFoodDay, today) : null;
  const ago = (days: number) => (days <= 0 ? 'today' : `${plural(days, 'day')} ago`);

  const foodLines = [
    `TODAY'S FOOD · eaten ${macroLine(view.eaten)}`,
    `Target: ${view.calories ? `${fmtNum(view.calories.kcal)} kcal` : 'no calorie target set'} · protein ${fmtNum(view.proteinTarget)} g${view.legDay ? ' (leg day)' : ''}`,
  ];
  if (todayMeals.length === 0) foodLines.push('Nothing logged yet today.');
  for (const { meal, items } of todayMeals) {
    foodLines.push(`  ${meal.slot ? cap(meal.slot) : meal.name}: ${items.length > 0 ? items.map(itemLine).join('; ') : 'empty'}`);
  }

  const parts = [
    `NOW: ${new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(now)}`,
    [
      lastFinished && sinceSession !== null ? `Last finished session: ${lastFinished.title}, ${ago(sinceSession)}.` : 'No finished session on record.',
      sinceFood === null ? 'No food has ever been logged.' : `Food last logged ${ago(sinceFood)}.`,
      weighIn ? `Weighed in today: ${fmtKg(weighIn.kg)}.` : 'No weigh-in logged today.',
    ].join(' '),
    foodLines.join('\n'),
    supplementLine,
    live ?? 'No session is live right now.',
    said,
  ].filter((p): p is string => !!p);
  return parts.join('\n\n');
}

/**
 * The stable part: notes, routines, scans, goals and the history up to yesterday, stepped down
 * until it fits the token budget less whatever room the volatile part takes (`volatileChars`).
 */
export async function buildStableContext(opts: ContextOptions & { volatileChars?: number } = {}): Promise<string> {
  const now = opts.now ?? new Date();
  const today = toDateKey(now);
  const settings = opts.settings ?? (await getSettings());
  const budget = budgetChars(opts) - (opts.volatileChars ?? 0);

  const include = { training: true, food: true, bodyweight: true, routines: true };
  const [input, notes, scans, exercises, routineExercises] = await Promise.all([
    loadClaudeSummaryInput(today, include, settings, WINDOWS),
    db.coachNotes.toArray(),
    db.bodyScans.toArray(),
    db.exercises.toArray(),
    db.routineExercises.toArray(),
  ]);

  const head = [`OWNER'S DATA · weights in kg · dates are day, month, year`, goalsLine(settings)].join('\n');
  const others = otherExercisesBlock(exercises, new Set(routineExercises.map((r) => r.exerciseId)));
  const fixed = [head, notesBlock(notes), buildRoutinesBlock(input), ...(others ? [others] : []), bodyScansBlock(scans)];
  let stable = '';
  for (const level of LEVELS) {
    const h = historyBlocks(input, today, level);
    stable = [...fixed, h.bodyweight, h.training, h.food].join('\n\n');
    if (stable.length <= budget) break;
  }
  return stable;
}

/** The context for a Claude call, as of `opts.now`. Reads the database; writes nothing. */
export async function buildCoachContext(opts: ContextOptions = {}): Promise<CoachContext> {
  const settings = opts.settings ?? (await getSettings());
  const o = { ...opts, settings };
  const volatile = await buildVolatileContext(o);
  const stable = await buildStableContext({ ...o, volatileChars: volatile.length });
  const text = `${stable}\n\n${volatile}`;
  return { stable, volatile, text, tokens: estimateTokens(text) };
}
