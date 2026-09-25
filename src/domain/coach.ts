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

/** Turns of earlier conversation carried into a prompt: the last question and its answer. */
const THREAD_TURNS = 2;

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
    "You answer questions about the user's own training and food, using the data from their training app below.",
    'Answer only what is asked, as briefly as the question allows. British English; weights in kilograms.',
    'Quote the dates and sets from the data that the answer rests on. Never make up a number.',
    'If the data does not answer the question, say "Not in your data."',
    'No tips, encouragement or motivational lines.',
  ].join('\n');
}

/** The prompt sent with one rung of context: the data, the last exchange, then the question. */
export function buildCoachPrompt(context: string, thread: CoachTurn[], question: string): string {
  const parts: string[] = [];
  if (context) parts.push(context);
  for (const t of thread.slice(-THREAD_TURNS)) parts.push(`${t.role === 'user' ? 'User' : 'Coach'}: ${t.text}`);
  parts.push(`User: ${question.trim()}`);
  return parts.join('\n\n');
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
 * start from. One line per exercise, newest session first.
 */
export function buildWorkingWeightsBlock(input: ClaudeSummaryInput): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const s of input.training.sessions) {
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
