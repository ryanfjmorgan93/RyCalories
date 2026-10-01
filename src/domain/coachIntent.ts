/**
 * Which of the coach's two jobs a typed message is — pure. No IO, no clock, no model call.
 *
 * "Give me a routine solely designed to build 3D shoulders" is a routine to be built, and the app's
 * own generator builds it. "Why have you chosen this?" is a question, and goes to the on-device
 * model with the routine and its reasons in front of it. One box does both, so something has to
 * decide, and it has to decide the same way every time and without a model: a small model asked to
 * route its own input is the thing that made "I want 3d shoulders" come back as "Not in your data."
 *
 * Where the words are ambiguous the answer is a question: a routine built when it was not asked for
 * is a screen of exercises to dismiss, a question answered when it was not asked is one more tap.
 */
import { parseQuickRequest } from './quickRequest';

export type CoachRoute = 'build' | 'ask';

export interface CoachRouteContext {
  /** The coach's last reply was a routine it built. Lets "more rear delts" mean what it means after one. */
  lastWasRoutine: boolean;
}

/** Words that open a question. */
const QUESTION_STARTERS = new Set([
  'why', 'what', 'whats', "what's", 'how', 'hows', "how's", 'which', 'when', 'where', 'who', 'whose',
  'is', 'are', 'am', 'was', 'were', 'do', 'does', 'did', 'should', 'can', 'could', 'would', 'will', 'shall',
]);

/** Verbs that ask for something to be made. */
const BUILD_VERBS = new Set(['give', 'gimme', 'make', 'build', 'write', 'create', 'plan', 'design', 'draft', 'generate', 'prepare', 'construct', 'programme', 'program']);
/** "put together", "sort out", "set up", "come up with": the verb and the word that completes it. */
const PHRASAL_VERBS: [string, string][] = [['put', 'together'], ['sort', 'out'], ['sort', 'me'], ['set', 'up'], ['come', 'up'], ['throw', 'together']];
/** "I want", "I need", "I'd like": what a person says before the thing they want made. */
const WANT_VERBS = new Set(['want', 'need', 'wanna', 'like']);

/** What a request for a routine calls one. */
const ROUTINE_NOUNS = new Set([
  'routine', 'routines', 'workout', 'workouts', 'session', 'sessions', 'split', 'splits', 'programme', 'programmes', 'program', 'programs',
  'plan', 'plans', 'day', 'days', 'exercise', 'exercises', 'ppl',
]);
const EXERCISE_NOUNS = new Set(['exercise', 'exercises']);

/** Words that open a message without saying anything. */
const FILLERS = new Set(['ok', 'okay', 'right', 'so', 'well', 'yeah', 'yes', 'yep', 'hey', 'hi', 'please', 'pls', 'plz', 'just', 'then', 'and', 'also', 'now', 'actually', 'alright', 'cool', 'thanks', 'thank']);
/** What a person says in front of the thing they now want instead: "Doesn't matter, I want 3d shoulders". */
const CHANGE_OF_MIND = new Set(["doesn't", 'doesnt', 'matter', 'matters', 'never', 'mind', 'nah', 'no', 'nope', 'fine', 'but', 'instead', 'rather', 'forget', 'it', 'that']);
/** What may sit around a muscle in a follow-up and still leave it a request for that muscle: "more rear delts", "add calves". */
const FOLLOW_UP_WORDS = new Set([
  ...CHANGE_OF_MIND, 'more', 'less', 'add', 'adding', 'extra', 'another', 'only', 'just', 'switch', 'swap', 'change', 'include', 'with', 'without',
  'make', 'it', 'a', 'an', 'the', 'some', 'bit', 'of', 'focus', 'on', 'for', 'to', 'i', 'want', 'need', 'id', "i'd", 'like', 'me', 'give',
  'try', 'something', 'with', 'in', 'and', 'or', 'please', 'ok', 'okay', 'actually', 'yeah', 'yes',
]);
/** What may describe a routine named without a verb: "a new chest routine". */
const DESCRIBING_WORDS = new Set(['new', 'fresh', 'different', 'better', 'simple', 'basic', 'good', 'great', 'decent', 'solid', 'proper', 'full', 'whole']);
/** Said anywhere after "I want" or "I need", these make it a question about the thing, not a request for it. */
const KNOWING = new Set(['know', 'understand', 'explain', 'why', 'how', 'whether', 'wondering', 'curious', 'learn', 'ask', 'check', 'see', 'hear']);

const POLITE = new Set(['can', 'could', 'would', 'will']);

function tokenise(text: string): string[] {
  const s = text.toLowerCase().replace(/[‘’ʼ`´]/g, "'");
  return s.match(/\d+|[a-z]+(?:'[a-z]+)*/g) ?? [];
}

/** Whether the words from `i` on open with a verb that asks for something to be made, and how many words it takes. */
function readBuildVerb(tokens: string[], i: number): number {
  const t = tokens[i];
  if (t === undefined) return 0;
  if (BUILD_VERBS.has(t)) return 1;
  for (const [a, b] of PHRASAL_VERBS) if (t === a && tokens[i + 1] === b) return 2;
  return 0;
}

/** "I want", "I need", "we need", "I'd like", "I would like", "I wanna": how many words, else 0. */
function readWant(tokens: string[], i: number): number {
  let j = i;
  const who = tokens[j];
  if (who === 'i' || who === 'we' || who === 'id' || who === "i'd" || who === "i'm" || who === 'im') j++;
  else if (who !== undefined && WANT_VERBS.has(who)) return 1;
  else return 0;
  if (tokens[j] === 'would' || tokens[j] === 'really' || tokens[j] === 'just') j++;
  if (tokens[j] === 'am' || tokens[j] === 'looking') return 0;
  const v = tokens[j];
  return v !== undefined && WANT_VERBS.has(v) ? j - i + 1 : 0;
}

/** What the words say about a routine: the muscles, a split, a routine noun, and how a count of exercises was asked. */
function reading(tokens: string[], text: string) {
  const parsed = parseQuickRequest(text);
  const muscles = (parsed.options.focus?.length ?? 0) > 0;
  const split = parsed.split !== undefined;
  const noun = tokens.some((t) => ROUTINE_NOUNS.has(t));
  const countedExercises = parsed.options.count !== undefined && tokens.some((t) => EXERCISE_NOUNS.has(t));
  return { parsed, muscles, split, noun, countedExercises };
}

/**
 * Whether the message is a routine to build or a question to answer. A message that asks for a
 * routine, a workout, a split or some exercises to be made, or names a muscle in the way a request
 * does, is a build; everything else, and anything the words leave open, is a question.
 */
export function routeCoachMessage(text: string, ctx: CoachRouteContext): CoachRoute {
  if (typeof text !== 'string') return 'ask';
  let tokens = tokenise(text);
  if (tokens.length === 0) return 'ask';

  let i = 0;
  while (i < tokens.length && FILLERS.has(tokens[i]!)) i++;
  tokens = tokens.slice(i);
  if (tokens.length === 0) return 'ask';
  const rest = (from: number): string[] => tokens.slice(from);

  // "Can you build me a back routine": asked politely, still asked for.
  let polite = false;
  if (POLITE.has(tokens[0]!) && (tokens[1] === 'you' || tokens[1] === 'u')) {
    let j = 2;
    while (j < tokens.length && FILLERS.has(tokens[j]!)) j++;
    const verb = readBuildVerb(tokens, j);
    if (verb > 0) {
      const r = reading(rest(j + verb), rest(j + verb).join(' '));
      return r.muscles || r.split || r.noun ? 'build' : 'ask';
    }
    polite = true;
  }

  const first = tokens[0]!;
  if (polite || QUESTION_STARTERS.has(first)) return 'ask';

  const r = reading(tokens, tokens.join(' '));

  // "Give me a routine…", "make me a push day", "build 3D shoulders", "put together a split".
  const verb = readBuildVerb(tokens, 0);
  if (verb > 0) {
    const after = reading(rest(verb), rest(verb).join(' '));
    return after.muscles || after.split || after.noun ? 'build' : 'ask';
  }

  // "I want 3d shoulders", "I need a push routine", "Doesn't matter, I want 3d shoulders".
  let at = 0;
  while (at < tokens.length && (CHANGE_OF_MIND.has(tokens[at]!) || FILLERS.has(tokens[at]!))) at++;
  const want = readWant(tokens, at);
  if (want > 0) {
    const after = rest(at + want);
    if (after.some((t) => KNOWING.has(t))) return 'ask';
    const w = reading(after, after.join(' '));
    // "to build", "to do", "to train": the verb after "want to" is the request.
    const later = after[0] === 'to' ? after.slice(1) : after;
    const v = readBuildVerb(later, 0);
    const wv = reading(later, later.join(' '));
    if (v > 0) return wv.muscles || wv.split || wv.noun ? 'build' : 'ask';
    return w.muscles || w.split || w.noun ? 'build' : 'ask';
  }

  // "routine for chest", "workout for my back": the noun and what it is for.
  for (let k = 0; k < tokens.length - 1; k++) {
    if (ROUTINE_NOUNS.has(tokens[k]!) && !EXERCISE_NOUNS.has(tokens[k]!) && (tokens[k + 1] === 'for' || tokens[k + 1] === 'to' || tokens[k + 1] === 'targeting' || tokens[k + 1] === 'focused')) {
      // "my routine for chest" is the owner's own, talked about.
      if (!tokens.slice(0, k).some((t) => t === 'my' || t === 'mine' || t === 'current' || t === 'this' || t === 'that' || t === 'your')) return 'build';
    }
  }

  // "5 exercises for chest", "six exercises for 3d shoulders".
  if (r.countedExercises && (r.muscles || r.split)) return 'build';

  // "push routine", "a leg day", "ppl", "new full body workout": a routine named, with no verb to ask for it.
  const possessive = tokens.some((t) => t === 'my' || t === 'mine' || t === 'current' || t === 'your' || t === 'this' || t === 'that');
  if (!possessive && (r.split || (r.noun && r.muscles))) {
    const extra = r.parsed.residue.filter((w) => !FOLLOW_UP_WORDS.has(w) && !DESCRIBING_WORDS.has(w));
    if (extra.length === 0) return 'build';
  }

  // After a routine: "more rear delts", "shoulders", "add calves", "no legs".
  if (ctx.lastWasRoutine && (r.muscles || r.split || (r.parsed.options.exclude?.length ?? 0) > 0)) {
    const extra = r.parsed.residue.filter((w) => !FOLLOW_UP_WORDS.has(w));
    if (extra.length === 0) return 'build';
  }

  return 'ask';
}
