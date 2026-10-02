/**
 * The on-device coach (Gemini Nano on the phone, the fuller variant — see docs/MERGE_PLAN.md P5d).
 * Pure: which of the owner's data goes into a question, and the words around it. No IO, no clock.
 *
 * The model reads a few thousand tokens at most, so the data is offered as a ladder: the fullest
 * context first, then smaller ones. The caller counts each rung's tokens on the phone and sends
 * the first that fits. Every rung carries a label saying what it holds, so the screen can state
 * what the answer was based on rather than let a cut pass unseen.
 *
 * Numbers come from the owner's own log in the same words as Copy for Claude (`./claudeSummary`):
 * food is averaged over logged days only, with the count beside it.
 */
import {
  buildBodyweightBlock,
  buildFoodBlock,
  buildRoutinesBlock,
  buildTrainingBlock,
  fmtDayHeading,
  type ClaudeSummaryInput,
  type SummarySession,
  type SummarySet,
} from './claudeSummary';
import { windowStart } from './checkin';
import { expandAbbreviations } from './exerciseMatch';
import { fmtSetsLine } from './format';
import { routineToText, type BuiltRoutine } from './routineBuilder';
import { countsForVolume } from './sets';

export type CoachMode = 'ask' | 'routine';

export interface CoachTurn {
  role: 'user' | 'coach';
  text: string;
}

export interface CoachRung {
  text: string;
  /** What this rung holds, e.g. "training 8 weeks · food 4 weeks · bodyweight 8 weeks". */
  label: string;
}

/** Turns of earlier conversation carried into a prompt: the last three questions and their answers. */
export const THREAD_TURNS = 6;

/** The widest window for training as a whole; a named exercise gets all the history loaded. */
const FULL_TRAINING_DAYS = 56;

export function buildCoachSystemPrompt(mode: CoachMode): string {
  if (mode === 'routine') {
    return [
      "You write gym routines for the user's training app.",
      'Reply with the routine only, in exactly this format and nothing else:',
      "a line with the routine's name, then one exercise per line as: Exercise name 3x8-10 @ 60kg",
      "For more than one routine, leave a blank line before each routine's name.",
      "Use kilograms. Use the user's working weights below where they fit the reps; leave the weight out when there is none.",
    ].join('\n');
  }
  return [
    'You answer questions for the user of their gym and food app. British English; weights in kilograms.',
    'Answer what was asked, briefly.',
    "For questions about the user's own training, food or bodyweight, use their data below and quote the dates and sets the answer rests on. Never make up a number of theirs. Say \"Not in your data.\" only when asked for a number of theirs that is not logged.",
    'For anything else, such as what works a muscle, why an exercise or a rep range suits a goal, or what an exercise is, answer from general training knowledge.',
    'If a routine the app built is below, the app chose its exercises and wrote its reasons. Explain the routine from those reasons, and say nothing about it that they do not support.',
    'Ask the user nothing. No encouragement, no motivational lines, no tips beyond what was asked.',
  ].join('\n');
}

/** How much of a built routine's reasons a prompt carries. */
export type RoutineDetail = 'full' | 'lines' | 'text';

/**
 * The routine the app built, for the model to explain: the routine as the app writes it, then why,
 * from the reasons the builder recorded. `lines` leaves out each exercise's own reason and `text`
 * leaves out the reasons altogether, for when the prompt has to be smaller.
 */
export function buildRoutineBlock(routines: readonly BuiltRoutine[], detail: RoutineDetail = 'full'): string {
  if (routines.length === 0) return '';
  const parts = ['Routine the app built:', routineToText(routines)];
  if (detail !== 'text') {
    const several = routines.length > 1;
    const why: string[] = [];
    for (const r of routines) {
      const prefix = several ? `${r.name}: ` : '';
      if (detail === 'full') for (const row of r.rows) why.push(`${prefix}${row.name}: ${row.reason}`);
      for (const line of r.reasonLines) why.push(`${prefix}${line}`);
    }
    parts.push('', 'Why:', ...why);
  }
  return parts.join('\n');
}

/**
 * The prompt sent with one rung of context: the data, the routine the app built when there is one,
 * the last three exchanges, then the question.
 */
export function buildCoachPrompt(context: string, thread: CoachTurn[], question: string, routineBlock = ''): string {
  const parts: string[] = [];
  if (context) parts.push(context);
  if (routineBlock) parts.push(routineBlock);
  for (const t of thread.slice(-THREAD_TURNS)) parts.push(`${t.role === 'user' ? 'User' : 'Coach'}: ${t.text}`);
  parts.push(`User: ${question.trim()}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Fitting a prompt to the model's limit

/** One way to shape a prompt: how many turns of conversation, which rung of the owner's data, how much of the routine's reasons. */
export interface PromptShape {
  /** Turns of the thread kept: the newest ones, the oldest dropped first. */
  turns: number;
  /** Index into the context ladder. */
  rung: number;
  detail: RoutineDetail;
}

/**
 * Every shape a prompt may take, fullest first. The oldest turns go first, down to the last
 * exchange; then the owner's data shrinks rung by rung; then the routine's reasons; and the last
 * exchange goes only when nothing else is left to drop. The routine itself is never dropped: it is
 * what a "why" is about.
 */
export function promptShapes(threadLength: number, rungCount: number, hasRoutine: boolean): PromptShape[] {
  const whole = Math.min(THREAD_TURNS, Math.max(0, Math.floor(Number.isFinite(threadLength) ? threadLength : 0)));
  const lastExchange = Math.min(2, whole);
  const rungs = Math.max(1, Math.floor(Number.isFinite(rungCount) ? rungCount : 1));
  const shapes: PromptShape[] = [];
  for (let turns = whole; turns > lastExchange; turns -= 2) shapes.push({ turns, rung: 0, detail: 'full' });
  shapes.push({ turns: lastExchange, rung: 0, detail: 'full' });
  for (let rung = 1; rung < rungs; rung++) shapes.push({ turns: lastExchange, rung, detail: 'full' });
  if (hasRoutine) {
    shapes.push({ turns: lastExchange, rung: rungs - 1, detail: 'lines' });
    shapes.push({ turns: lastExchange, rung: rungs - 1, detail: 'text' });
  }
  if (lastExchange > 0) shapes.push({ turns: 0, rung: rungs - 1, detail: hasRoutine ? 'text' : 'full' });
  return shapes;
}

/** Whether a counted prompt, with room left for the reply, is within the model's limit. */
export function fitsLimit(counted: { tokens: number; limit: number }, replyTokens: number): boolean {
  return Number.isFinite(counted.tokens) && Number.isFinite(counted.limit) && counted.tokens + replyTokens <= counted.limit;
}

/**
 * The first shape that fits, trying them in order and stopping at it. `count` is the phone's own
 * token counter for the prompt of that shape; this decides only what to drop next. Null when even
 * the smallest shape is over the limit.
 */
export async function fitCoachPrompt(
  shapes: readonly PromptShape[],
  count: (shape: PromptShape) => Promise<{ tokens: number; limit: number }>,
  replyTokens: number,
): Promise<{ shape: PromptShape; tries: number } | null> {
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i]!;
    if (fitsLimit(await count(shape), replyTokens)) return { shape, tries: i + 1 };
  }
  return null;
}

/** The prompt for a shape, and what it holds, in words, for the screen to say the answer was based on. */
export function shapedPrompt(
  shape: PromptShape,
  ladder: readonly CoachRung[],
  thread: readonly CoachTurn[],
  question: string,
  routines: readonly BuiltRoutine[],
): { prompt: string; label: string } {
  const rung = ladder[Math.min(Math.max(0, shape.rung), ladder.length - 1)] ?? { text: '', label: 'none of your data' };
  const kept = shape.turns > 0 ? thread.slice(-shape.turns) : [];
  const parts = [rung.label];
  if (routines.length > 0) parts.push(shape.detail === 'full' ? 'routine and reasons' : shape.detail === 'lines' ? 'routine and summary' : 'routine only');
  if (kept.length > 0) {
    const exchanges = Math.ceil(kept.length / 2);
    parts.push(`last ${exchanges === 1 ? 'exchange' : `${exchanges} exchanges`}`);
  }
  return { prompt: buildCoachPrompt(rung.text, [...kept], question, buildRoutineBlock(routines, shape.detail)), label: parts.join(' \u00b7 ') };
}

/**
 * Words in exercise names that are also everyday words, or equipment, or a body part: alone they
 * name nothing ("in a row", "leg day", "my bodyweight", "did it dip"). They count only as part of
 * a two-word match — "leg press", "lat pulldown" — never on their own.
 */
const GENERIC_NAME_WORDS = new Set([
  'row', 'dip', 'press', 'fly', 'walk', 'hold', 'raise', 'pull', 'push', 'carry', 'jump', 'step', 'swing',
  'leg', 'arm', 'back', 'chest', 'shoulder', 'hip', 'side', 'front', 'rear', 'lat', 'core', 'neck',
  'bodyweight', 'weighted', 'machine', 'cable', 'barbell', 'dumbbell', 'kettlebell', 'band', 'smith',
  'single', 'one', 'seated', 'standing', 'lying', 'incline', 'decline', 'reverse', 'close', 'wide', 'grip',
  'high', 'low', 'heavy', 'light', 'iso', 'lateral', 'overhead', 'split', 'up', 'down',
]);
function wordList(s: string): string[] {
  return expandAbbreviations(s.replace(/\([^()]*\)/g, ' '))
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/**
 * Exercises in the log that the question names, gym shorthand expanded (so "RDL" is a Romanian
 * deadlift): a distinctive word of the name the question uses ("bench", "squat", "deadlift",
 * "curl"), or two words of the name side by side ("leg press").
 * "Squat" names every squat in the log, which is the honest reading of it.
 */
export function namedExercises(question: string, names: readonly string[]): string[] {
  const asked = wordList(question);
  const askedSet = new Set(asked);
  const askedPairs = new Set(asked.slice(1).map((w, i) => `${asked[i]} ${w}`));
  return [...new Set(names)].filter((name) => {
    const own = wordList(name);
    for (const t of own) {
      if (t.length >= 3 && askedSet.has(t) && !GENERIC_NAME_WORDS.has(t)) return true;
    }
    for (let i = 1; i < own.length; i++) if (askedPairs.has(`${own[i - 1]} ${own[i]}`)) return true;
    return false;
  });
}

function exerciseNames(sessions: readonly SummarySession[]): string[] {
  return [...new Set(sessions.flatMap((s) => s.exercises.map((e) => e.name)))];
}

/** The input with training cut to `days`, and to the exercises `pick` keeps (all when absent). */
function narrowTraining(input: ClaudeSummaryInput, days: number, pick?: (name: string) => boolean): ClaudeSummaryInput {
  const from = windowStart(input.asOf, days);
  const sessions = input.training.sessions
    .filter((s) => s.date >= from && s.date <= input.asOf)
    .map((s) => (pick ? { ...s, exercises: s.exercises.filter((e) => pick(e.name)) } : s))
    .filter((s) => !pick || s.exercises.length > 0);
  return { ...input, training: { days, sessions } };
}

function weeks(days: number): string {
  return days % 7 === 0 ? `${days / 7} ${days === 7 ? 'week' : 'weeks'}` : `${days} days`;
}

function topSet(sets: SummarySet[]): SummarySet | undefined {
  const counted = sets.filter((s) => countsForVolume(s.type));
  return counted.reduce<SummarySet | undefined>((best, s) => {
    if (!best) return s;
    if (s.weight !== best.weight) return s.weight > best.weight ? s : best;
    return (s.reps ?? s.seconds ?? 0) > (best.reps ?? best.seconds ?? 0) ? s : best;
  }, undefined);
}

/**
 * The heaviest counted set of each exercise's most recent session: what a drafted routine should
 * start from. One line per exercise, newest session first. A light quick session is skipped: its
 * weights are a fraction of a working weight by design.
 */
export function buildWorkingWeightsBlock(input: ClaudeSummaryInput): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const s of input.training.sessions) {
    if (s.quick === 'light') continue;
    for (const ex of s.exercises) {
      if (seen.has(ex.name)) continue;
      const top = topSet(ex.sets);
      if (!top) continue;
      seen.add(ex.name);
      lines.push(`${ex.name}: ${fmtSetsLine([top], ex.kind)} (${fmtDayHeading(s.date)})`);
    }
  }
  return ['WORKING WEIGHTS · heaviest set of the latest session', ...(lines.length ? lines : ['No sessions logged.'])].join('\n');
}

function header(input: ClaudeSummaryInput): string {
  return `Your data · ${fmtDayHeading(input.asOf, true)} · weights in kg`;
}

interface RungSpec {
  /** Days of training: every exercise, or with `named` given, the named ones only. */
  trainingDays: number;
  named?: string[];
  /** With `named`: days of the other exercises' training too (0 or absent: none). */
  otherDays?: number;
  food: 'days' | 'averages' | 'none';
  bodyweight: 'entries' | 'summary' | 'none';
  routines: boolean;
  workingWeights?: boolean;
}

function buildRung(input: ClaudeSummaryInput, spec: RungSpec): CoachRung {
  const blocks = [header(input)];
  const label: string[] = [];
  if (spec.workingWeights) {
    blocks.push(buildWorkingWeightsBlock(input));
    label.push('working weights');
  }
  const named = spec.named;
  if (spec.trainingDays > 0 && named) {
    const isNamed = (n: string) => named.includes(n);
    blocks.push(buildTrainingBlock(narrowTraining(input, spec.trainingDays, isNamed), `TRAINING (${named.join(', ')})`));
    label.push(`${named.join(', ')} ${weeks(spec.trainingDays)}`);
    if (spec.otherDays) {
      blocks.push(buildTrainingBlock(narrowTraining(input, spec.otherDays, (n) => !isNamed(n)), 'OTHER TRAINING'));
      label.push(`other training ${weeks(spec.otherDays)}`);
    }
  } else if (spec.trainingDays > 0) {
    blocks.push(buildTrainingBlock(narrowTraining(input, spec.trainingDays)));
    label.push(`training ${weeks(spec.trainingDays)}`);
  }
  if (spec.food !== 'none') {
    blocks.push(buildFoodBlock(input, spec.food));
    label.push(`food ${weeks(input.food.days)}${spec.food === 'averages' ? ' averages' : ''}`);
  }
  if (spec.bodyweight !== 'none') {
    blocks.push(buildBodyweightBlock(input, spec.bodyweight));
    label.push(`bodyweight ${weeks(input.bodyweight.days)}${spec.bodyweight === 'summary' ? ' summary' : ''}`);
  }
  if (spec.routines) {
    blocks.push(buildRoutinesBlock(input));
    label.push('routines');
  }
  return { text: blocks.join('\n\n'), label: label.join(' · ') };
}

/**
 * Candidate contexts for one question, fullest first, each smaller than the one before; the last
 * holds none of the owner's data, so a question can always be sent. `input.training` should hold
 * the longest history wanted (the coach loads 26 weeks): a question naming an exercise gets that
 * exercise's whole history, and it is the last thing cut; other training is 8 weeks at most.
 */
export function coachContextLadder(input: ClaudeSummaryInput, question: string, mode: CoachMode): CoachRung[] {
  const longest = input.training.days;
  const named = namedExercises(question, exerciseNames(input.training.sessions));
  const specs: RungSpec[] = [];

  if (mode === 'routine') {
    specs.push(
      { workingWeights: true, trainingDays: 28, food: 'none', bodyweight: 'summary', routines: true },
      { workingWeights: true, trainingDays: 14, food: 'none', bodyweight: 'none', routines: true },
      { workingWeights: true, trainingDays: 0, food: 'none', bodyweight: 'none', routines: true },
      { workingWeights: true, trainingDays: 0, food: 'none', bodyweight: 'none', routines: false },
    );
  } else {
    const full = Math.min(FULL_TRAINING_DAYS, longest);
    if (named.length > 0) {
      specs.push(
        { trainingDays: longest, named, otherDays: full, food: 'days', bodyweight: 'entries', routines: true },
        // The rest of training shrinks before it goes: a question can name an exercise and still
        // be about the week as a whole.
        { trainingDays: longest, named, otherDays: 28, food: 'averages', bodyweight: 'summary', routines: false },
        { trainingDays: longest, named, otherDays: 14, food: 'averages', bodyweight: 'summary', routines: false },
        { trainingDays: longest, named, food: 'averages', bodyweight: 'summary', routines: false },
        { trainingDays: 84, named, food: 'averages', bodyweight: 'summary', routines: false },
        { trainingDays: 42, named, food: 'none', bodyweight: 'summary', routines: false },
        { trainingDays: 21, named, food: 'none', bodyweight: 'none', routines: false },
        { trainingDays: 7, named, food: 'none', bodyweight: 'none', routines: false },
      );
    } else {
      specs.push(
        { trainingDays: full, food: 'days', bodyweight: 'entries', routines: true },
        { trainingDays: 56, food: 'averages', bodyweight: 'summary', routines: false },
        { trainingDays: 28, food: 'averages', bodyweight: 'summary', routines: false },
        { trainingDays: 14, food: 'averages', bodyweight: 'summary', routines: false },
        { trainingDays: 7, food: 'none', bodyweight: 'none', routines: false },
      );
    }
  }

  const rungs: CoachRung[] = [];
  for (const spec of specs) {
    const rung = buildRung(input, {
      ...spec,
      trainingDays: Math.min(spec.trainingDays, longest),
      otherDays: spec.otherDays === undefined ? undefined : Math.min(spec.otherDays, longest),
    });
    const prev = rungs[rungs.length - 1];
    if (!prev || rung.text.length < prev.text.length) rungs.push(rung);
  }
  rungs.push({ text: '', label: 'none of your data' });
  return rungs;
}
