/**
 * What a typed message asks of the coach — pure. No IO, no clock, no model call.
 *
 * "Give me a routine solely designed to build 3D shoulders" is a routine to be built, and the app's
 * own generator builds it. "Why have you chosen this?" is a question, and goes to the on-device
 * model with the routine and its reasons in front of it. "Add biceps" said with a routine on screen
 * is neither: it changes that routine, and the app's own generator does that too. One box does all
 * three, so something has to decide, and it has to decide the same way every time and without a
 * model: a small model asked to route its own input is the thing that made "I want 3d shoulders"
 * come back as "Not in your data."
 *
 * Where the words are ambiguous the answer is a question. A routine built when it was not asked for
 * is a screen of exercises to dismiss, and a question answered when a routine was asked for costs
 * the owner retyping it, so the phrases people really open a request with ("can I get a leg day",
 * "chuck me some arms", "looking for a chest workout") are read as requests, and a trailing question
 * mark after a routine is read as a question about it.
 *
 * A routine stays the subject until the conversation is cleared or another is built: the owner may
 * ask why, and still say "make it shorter" after.
 */
import { parseQuickRequest, type RoutineSplit } from './quickRequest';
import { routineRequestFrom } from './routineBuilder';
import { EQUIPMENT_KINDS, type Equipment, type MuscleGroup } from './types';

/**
 * 'build' makes a routine from the words alone; 'edit' changes the routine on screen; 'ask' is a
 * question for the model.
 */
export type CoachRoute = 'build' | 'edit' | 'ask';

export interface CoachRouteContext {
  /**
   * A routine the coach built is the subject: the latest routine in the conversation has exercises
   * in it and the conversation has not been cleared. Questions since do not end it.
   */
  lastWasRoutine: boolean;
}

// ---------------------------------------------------------------------------
// Vocabulary

/** Words that open a question. */
const QUESTION_STARTERS = new Set([
  'why', 'what', 'whats', "what's", 'how', 'hows', "how's", 'which', 'when', 'where', 'who', 'whose',
  'is', 'are', 'am', 'was', 'were', 'do', 'does', 'did', 'should', 'can', 'could', 'would', 'will', 'shall',
]);

/** Verbs that ask for something to be made. */
const BUILD_VERBS = new Set(['give', 'gimme', 'make', 'build', 'write', 'create', 'plan', 'design', 'draft', 'generate', 'prepare', 'construct', 'programme', 'program']);
/** "put together", "sort out", "set up", "come up with": the verb and the word that completes it. */
const PHRASAL_VERBS: [string, string][] = [
  ['put', 'together'], ['sort', 'out'], ['sort', 'me'], ['set', 'up'], ['set', 'me'], ['come', 'up'], ['throw', 'together'], ['whip', 'up'], ['knock', 'up'], ['knock', 'out'], ['cook', 'up'],
];
/** "chuck me", "get us", "do me": a verb that asks for something to be made only with "me" or "us" after it. */
const OBJECT_VERBS = new Set(['chuck', 'bung', 'lob', 'whack', 'sling', 'throw', 'get', 'hook', 'fix', 'do', 'hand', 'serve']);
/** "I want", "I need", "I'd like": what a person says before the thing they want made. */
const WANT_VERBS = new Set(['want', 'need', 'wanna', 'like']);

/** What a request for a routine calls one. */
const ROUTINE_NOUNS = new Set([
  'routine', 'routines', 'workout', 'workouts', 'session', 'sessions', 'sesh', 'seshes', 'split', 'splits', 'programme', 'programmes', 'program', 'programs',
  'plan', 'plans', 'day', 'days', 'exercise', 'exercises', 'ppl', 'regime', 'regimen',
]);
const EXERCISE_NOUNS = new Set(['exercise', 'exercises']);
/** Said in front of "plan" or "routine", these make it a plan for something that is not a gym routine. */
const NOT_TRAINING = new Set([
  'meal', 'meals', 'diet', 'nutrition', 'food', 'eating', 'calorie', 'calories', 'macro', 'macros', 'recipe', 'recipes', 'progression', 'budget', 'holiday', 'shopping',
  'study', 'revision', 'supplement', 'supplements',
]);

/** Words that open a message without saying anything: greetings, thanks, assent. */
const GREETINGS = new Set([
  'ok', 'okay', 'right', 'so', 'well', 'yeah', 'yes', 'yep', 'hey', 'hi', 'hello', 'hiya', 'yo', 'oi', 'mate', 'bro', 'buddy', 'pal', 'cheers', 'ta', 'please', 'pls', 'plz',
  'alright', 'cool', 'thanks', 'thank', 'sup', 'coach', 'morning', 'evening', 'afternoon',
]);
/** Words that ride in front of a request and change nothing about it, though "also" and "just" say how a muscle is meant. */
const LEAD_FILLERS = new Set(['just', 'then', 'and', 'also', 'now', 'actually']);
const FILLERS = new Set([...GREETINGS, ...LEAD_FILLERS]);
/** What a person says in front of the thing they now want instead: "Doesn't matter, I want 3d shoulders". */
const CHANGE_OF_MIND = new Set(["doesn't", 'doesnt', 'matter', 'matters', 'never', 'mind', 'nah', 'no', 'nope', 'fine', 'but', 'instead', 'rather', 'forget', 'it', 'that']);
/** What may sit around a muscle in a follow-up and still leave it a request for that muscle: "more rear delts", "add calves". */
const FOLLOW_UP_WORDS = new Set([
  ...CHANGE_OF_MIND, 'more', 'less', 'add', 'adding', 'extra', 'another', 'only', 'just', 'switch', 'swap', 'change', 'include', 'with', 'without',
  'make', 'it', 'a', 'an', 'the', 'some', 'bit', 'of', 'focus', 'on', 'for', 'to', 'i', 'want', 'need', 'id', "i'd", 'like', 'me', 'give',
  'try', 'something', 'with', 'in', 'and', 'or', 'please', 'ok', 'okay', 'actually', 'yeah', 'yes',
]);
/** What may describe a routine named without a verb: "a new chest routine". */
const DESCRIBING_WORDS = new Set([
  'new', 'fresh', 'different', 'better', 'simple', 'basic', 'good', 'great', 'decent', 'solid', 'proper', 'full', 'whole',
  'beginner', 'beginners', 'intermediate', 'advanced', 'hypertrophy', 'strength', 'mass', 'size', 'killer', 'intense', 'tough', 'home', 'gym', 'hardcore', 'brutal',
]);
/** Said anywhere after "I want" or "I need", these make it a question about the thing, not a request for it. */
const KNOWING = new Set(['know', 'understand', 'explain', 'why', 'how', 'whether', 'wondering', 'curious', 'learn', 'ask', 'check', 'see', 'hear']);

const POLITE = new Set(['can', 'could', 'would', 'will']);
/** The routine said to be about: "my routine", "this leg day", "the routine". Said of the owner's own, not asked for. */
const POINTING = new Set(['this', 'that', 'these', 'those', 'my', 'mine', 'your', 'the', 'current', 'last', 'previous', 'same']);
/** What may sit between "my" and "routine" and leave it the routine pointed at: "my current routine". */
const POINTING_ADJECTIVES = new Set(['current', 'last', 'previous', 'same', 'new', 'own', 'whole', 'full', 'usual', 'old', 'existing']);

/**
 * Whether a routine noun is the one on screen or the owner's own, by what stands before it: "this
 * routine", "my current routine", "the routine". A "that" after it ("a routine that makes me…") says
 * nothing of which routine it is.
 */
function pointsAtRoutine(tokens: string[]): boolean {
  // "make it 5 exercises", "make this a push day": what follows the verb is the thing on screen.
  if (tokens[0] !== undefined && REFERENCES.has(tokens[0])) return true;
  return tokens.some((t, i) => {
    if (!ROUTINE_NOUNS.has(t) || EXERCISE_NOUNS.has(t)) return false;
    const before = tokens[i - 1];
    if (before !== undefined && POINTING.has(before)) return true;
    const two = tokens[i - 2];
    return before !== undefined && two !== undefined && POINTING_ADJECTIVES.has(before) && POINTING.has(two);
  });
}
const POSSESSIVE = new Set(['my', 'mine', 'current', 'your', 'this', 'that']);
/** Said of what is on screen, as opposed to a request to change it. */
const REFERENCES = new Set(['it', 'this', 'that', 'these', 'those', 'them']);
/** A statement, not a request: "my routine is shorter". */
const STATEMENT_VERBS = new Set(['is', 'are', 'was', 'were', 'am', 'has', 'had', 'did', 'does']);

function tokenise(text: string): string[] {
  const s = text.toLowerCase().replace(/[‘’ʼ`´]/g, "'");
  return s.match(/\d+|[a-z]+(?:'[a-z]+)*/g) ?? [];
}

/** Whether the message ends in a question mark. */
function endsAsked(text: string): boolean {
  return /\?[\s"')\]]*$/.test(text);
}

/** Whether the words from `i` on open with a verb that asks for something to be made, and how many words it takes. */
function readBuildVerb(tokens: string[], i: number): number {
  const t = tokens[i];
  if (t === undefined) return 0;
  if (BUILD_VERBS.has(t)) return 1;
  for (const [a, b] of PHRASAL_VERBS) if (t === a && tokens[i + 1] === b) return 2;
  if (OBJECT_VERBS.has(t) && (tokens[i + 1] === 'me' || tokens[i + 1] === 'us')) return 2;
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

/** "looking for", "I'm looking for", "I'm after", "in the mood for", "could do with", "fancy": how many words, else 0. */
function readLookingFor(tokens: string[], i: number): number {
  let j = i;
  const who = tokens[j];
  if (who === "i'm" || who === 'im') j++;
  else if (who === 'i' && tokens[j + 1] === 'am') j += 2;
  if (tokens[j] === 'looking' && tokens[j + 1] === 'for') return j - i + 2;
  if (j > i && tokens[j] === 'after') return j - i + 1;
  if (j === i) {
    if (tokens[j] === 'in' && tokens[j + 1] === 'the' && tokens[j + 2] === 'mood' && tokens[j + 3] === 'for') return 4;
    if (tokens[j] === 'could' && tokens[j + 1] === 'do' && tokens[j + 2] === 'with') return 3;
    if (tokens[j] === 'fancy') return 1;
  }
  return 0;
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

/** Whether the words name a routine, and nothing but a routine: "a chest workout", "a leg day", "a beginner chest routine". */
function namesRoutine(tokens: string[]): boolean {
  const r = reading(tokens, tokens.join(' '));
  if (!(r.split || r.noun || r.muscles)) return false;
  if (tokens.some((t) => POSSESSIVE.has(t) || NOT_TRAINING.has(t))) return false;
  return r.parsed.residue.every((w) => FOLLOW_UP_WORDS.has(w) || DESCRIBING_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// Edits

/**
 * What a message asks of the routine on screen. Each part is optional and a message may carry
 * several ("add biceps and make it 8 exercises"); `readEdit` is null when it carries none.
 */
export interface EditIntent {
  /** "give me another one": the same request again, with another seed. */
  shuffle?: true;
  /** "swap the front raise for something else": the words naming the row, and what was said to put in its place. */
  swap?: { target: string[]; replacement: string[] };
  /** "drop the front raise": the words naming the row. */
  remove?: { target: string[] };
  muscles?: {
    /** "just chest", "make it a push day": these are the muscles now. */
    replace?: MuscleGroup[];
    /** "add biceps", "more rear delts": these join those the routine is for. */
    add?: MuscleGroup[];
    /** "no legs", "drop the legs": these are ruled out. */
    exclude?: MuscleGroup[];
    /** "swap legs for arms": these leave the routine, ruled out of nothing. */
    out?: MuscleGroup[];
  };
  /** "make it push pull legs". */
  split?: RoutineSplit;
  /** "make it 5 exercises" is `to`; "fewer" and "two more" are `by`. */
  count?: { to?: number; by?: number };
  /** "30 mins" is `to`; "shorter" and "longer" are `by`. */
  minutes?: { to?: number; by?: 'shorter' | 'longer' };
  /** "harder" is +1, "easier" is -1. */
  effort?: 1 | -1;
  /** "dumbbells only", "no barbell": `add` says they join what was allowed, as in "with cables too". */
  equipment?: { list: Equipment[]; add: boolean };
  /** Whatever else the typed words said that a request carries and this module does not name, read by the request parser. */
  extras: Record<string, unknown>;
}

const SWAP_VERBS = new Set(['swap', 'swop', 'replace', 'change', 'switch', 'substitute', 'sub', 'exchange']);
const REMOVE_VERBS = new Set(['remove', 'drop', 'delete', 'cut', 'ditch', 'lose', 'scrap', 'bin', 'skip']);
const REMOVE_PHRASES: [string, string][] = [['take', 'out'], ['get', 'rid'], ['leave', 'out'], ['take', 'off']];
const NEGATION_LEADS = new Set(['no', 'without', 'skip', 'not', 'avoid']);
/** Said about a muscle, these join it to the routine rather than make it the whole of it. */
const ADD_CUES = new Set(['add', 'adding', 'also', 'extra', 'plus', 'include', 'including', 'more']);
/** Words the typed request parser leaves unread that an edit is allowed to use. */
const EDIT_WORDS = new Set([
  ...FOLLOW_UP_WORDS, 'also', 'plus', 'fewer', 'instead', 'harder', 'tougher', 'heavier', 'easier', 'lighter', 'gentler', 'shorter', 'longer', 'quicker', 'faster', 'briefer',
  'again', 'different', 'else', 'other', 'redo', 'shuffle', 'reshuffle', 'mix', 'up', 'fresh', 'new', 'one', 'two', 'three',
  'four', 'five', 'drop', 'remove', 'delete', 'cut', 'ditch', 'lose', 'scrap', 'bin', 'skip', 'replace', 'substitute', 'take', 'out', 'get', 'rid', 'leave', 'off', 'little',
  'version', 'versions', 'option', 'alternative', 'than', 'go', 'keep', 'much', 'now', 'increase', 'decrease', 'reduce', 'higher', 'lower',
]);
/** Words that are an edit's only when something asked for sets, intensity or time: "chest volume" is a question about the log. */
const EDIT_WORDS_WITH_EFFORT = new Set(['sets', 'volume', 'intense', 'intensity']);
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
/** Words that say nothing of what to change. */
const NOISE = new Set([
  'a', 'an', 'the', 'it', 'make', 'give', 'me', 'us', 'please', 'some', 'bit', 'little', 'exercise', 'exercises', 'move', 'moves', 'lift', 'lifts', 'to', 'be', 'of', 'i', 'want',
  'need', 'like', 'id', 'that', 'this', 'routine', 'workout', 'session', 'my', 'now', 'just', 'then', 'and', 'also', 'actually', 'much',
]);
/** What a row is called in the owner's words that names no exercise. */
const NOT_A_ROW = new Set(['weight', 'weights', 'fat', 'muscle', 'mass', 'kilos', 'kg', 'time', 'sets', 'set', 'reps', 'volume', 'rest']);
/** Words round the name of a row that are not part of it. */
const ROW_NOISE = new Set(['the', 'a', 'an', 'my', 'that', 'this', 'these', 'those', 'your', 'current', 'out', 'of', 'exercise', 'exercises', 'move', 'moves', 'lift', 'lifts', 'one', 'it', 'up', 'please']);
/** Said of what to put in a row's place that names nothing in particular. */
const GENERIC_REPLACEMENT = new Set(['something', 'anything', 'else', 'other', 'different', 'another', 'new', 'one', 'ones', 'a', 'an', 'the', 'alternative', 'version', 'variation', 'option', 'similar', 'instead', 'like', 'please', 'it', 'up']);
const TIME_PHRASE = /(^|\s)(min|mins|minute|minutes|hour|hours|hr|hrs)(\s|$)|half (an |a )?hour|(an|a) hour/;

/** The words naming a row, with what surrounds them taken off. */
function rowWords(words: string[]): string[] {
  return words.filter((w) => !ROW_NOISE.has(w));
}

function indexOfPair(tokens: string[], a: string, b: string): number {
  for (let i = 0; i < tokens.length - 1; i++) if (tokens[i] === a && tokens[i + 1] === b) return i;
  return -1;
}

/** "swap X for Y": X, and what was said to put in its place. "Something else instead of X" has X after "instead of". */
function splitSwap(rest: string[]): { target: string[]; replacement: string[] } {
  const instead = indexOfPair(rest, 'instead', 'of');
  if (instead >= 0) return { target: rest.slice(instead + 2), replacement: rest.slice(0, instead) };
  const at = rest.findIndex((w) => w === 'for' || w === 'with' || w === 'to' || w === 'into' || w === 'by');
  return at === -1 ? { target: rest, replacement: [] } : { target: rest.slice(0, at), replacement: rest.slice(at + 1) };
}

/** The muscles a phrase names and nothing else: "the legs", "rear delts", but not "shoulder press". */
function onlyMuscles(words: string[]): MuscleGroup[] {
  const p = parseQuickRequest(words.join(' '));
  return p.residue.length === 0 && p.split === undefined ? (p.options.focus ?? []) : [];
}

/** The equipment a phrase names and nothing else: "the barbell", "dumbbells and cables". */
function onlyEquipment(words: string[]): Equipment[] {
  const p = parseQuickRequest(words.join(' '));
  return p.residue.length === 0 && p.split === undefined && (p.options.focus?.length ?? 0) === 0 ? (p.options.equipment ?? []) : [];
}

/** The relative change in the number of exercises a message asks for: "more", "two fewer", "add another". Undefined when it asks none. */
function countDelta(t: string[]): number | undefined {
  const content = t.filter((w) => !NOISE.has(w) || NUMBER_WORDS[w] !== undefined);
  const n = (w: string | undefined): number | undefined => (w === undefined ? undefined : NUMBER_WORDS[w] ?? (/^\d+$/.test(w) ? Number(w) : undefined));
  const [a, b, c] = content;
  const sign = (w: string | undefined): 1 | -1 | 0 => (w === 'more' || w === 'extra' ? 1 : w === 'fewer' || w === 'less' ? -1 : 0);
  if (content.length === 1) {
    if (a === 'more' || a === 'extra') return 1;
    if (a === 'fewer' || a === 'less') return -1;
  }
  if (content.length === 2) {
    if (n(a) !== undefined && sign(b) !== 0) return n(a)! * sign(b);
    if (a === 'add' && (b === 'another' || b === 'extra' || b === 'more')) return 1;
    if (a === 'add' && n(b) !== undefined) return n(b)!;
    if (a === 'another' && b === 'more') return 1;
  }
  if (content.length === 3 && a === 'add' && n(b) !== undefined && sign(c) > 0) return n(b)!;
  return undefined;
}

/** What the words ask for in sets: "more sets", "less volume", "make it harder". +1, -1, or nothing. */
function effortStep(t: string[]): 1 | -1 | undefined {
  if (t.includes('harder') || t.includes('tougher') || t.includes('heavier')) return 1;
  if (t.includes('easier') || t.includes('lighter') || t.includes('gentler')) return -1;
  const about = t.includes('sets') || t.includes('volume') || t.includes('intense') || t.includes('intensity');
  if (about) {
    if (t.some((w) => w === 'more' || w === 'extra' || w === 'add' || w === 'increase' || w === 'higher')) return 1;
    if (t.some((w) => w === 'less' || w === 'fewer' || w === 'lower' || w === 'reduce' || w === 'cut')) return -1;
  }
  if (t[0] === 'make' && t.length <= 4 && t.includes('it')) {
    if (t.includes('hard') || t.includes('heavy')) return 1;
    if (t.includes('easy') || t.includes('light') || t.includes('gentle')) return -1;
  }
  return undefined;
}

/** What the words ask for in length: "shorter", "quicker", "longer". */
function lengthStep(t: string[]): 'shorter' | 'longer' | undefined {
  if (t.some((w) => w === 'shorter' || w === 'quicker' || w === 'faster' || w === 'briefer')) return 'shorter';
  if (t.includes('less') && t.includes('time')) return 'shorter';
  if (t.includes('short') && t.includes('on') && t.includes('time')) return 'shorter';
  if (t.includes('longer')) return 'longer';
  if (t.includes('more') && t.includes('time')) return 'longer';
  if (t[0] === 'make' && t.length <= 4 && t.includes('it') && (t.includes('quick') || t.includes('short') || t.includes('brief'))) return 'shorter';
  return undefined;
}

const HANDLED = new Set(['focus', 'exclude', 'count', 'equipment', 'split', 'minutes']);

/**
 * What the message asks of the routine on screen, or null when it asks nothing of it: a question, a
 * whole new request, or words this does not read. Only asked of a message sent with a routine as its
 * subject. A request that names a muscle, or a split, and a routine ("give me a chest routine") is a
 * new routine whatever else it says; "chest", "add biceps" and "make it a push day" change this one.
 */
export function readEdit(text: string): EditIntent | null {
  if (typeof text !== 'string') return null;
  const original = tokenise(text);
  const thanked = original.some((w) => w === 'thanks' || w === 'thank');
  let t = [...original];
  let k = 0;
  while (k < t.length && GREETINGS.has(t[k]!)) k++;
  t = t.slice(k);
  // "can you swap the front raise": the polite words are not part of the request.
  let polite = false;
  if (POLITE.has(t[0] ?? '') && (t[1] === 'you' || t[1] === 'u' || t[1] === 'ya')) {
    polite = true;
    k = 2;
    while (k < t.length && GREETINGS.has(t[k]!)) k++;
    t = t.slice(k);
  }
  if (t.length === 0) return null;
  if (t.some((w) => STATEMENT_VERBS.has(w))) return null;

  let at = 0;
  while (at < t.length && (CHANGE_OF_MIND.has(t[at]!) || FILLERS.has(t[at]!))) at++;
  // "I want", "I'd like to": a request in the owner's own words, and its verb after "to".
  const want = readWant(t, at);
  const lookingFor = readLookingFor(t, at);
  const verb = readBuildVerb(t, at);
  const pointsAtIt = t.slice(at + Math.max(verb, want, lookingFor)).some((w) => REFERENCES.has(w));
  const explicit = (want > 0 || lookingFor > 0 || verb > 0) && !pointsAtIt;

  const intent: EditIntent = { extras: {} };

  // What the typed words say to the request parser, whole. Whatever it reads beyond the fields this module names is the
  // request's own (a movement ruled out, say), and a "no front raises" it reads that way is that, not a row to drop.
  const parsed = parseQuickRequest(t.join(' '));
  const fresh = routineRequestFrom(parsed);
  const extras = Object.entries(fresh).filter(([key, value]) => !HANDLED.has(key) && value !== undefined && !(Array.isArray(value) && value.length === 0));

  // "Something else instead of the press": a swap, said with any verb.
  const insteadOf = indexOfPair(t, 'instead', 'of');
  // The verb of a swap or a removal, past the "no" and "I want to" that may be before it.
  let v = at + (want > 0 ? want : 0);
  if (t[v] === 'to') v++;
  const swapVerb = SWAP_VERBS.has(t[v] ?? '');
  const phrasalRemove = REMOVE_PHRASES.some(([a, b]) => t[v] === a && t[v + 1] === b);
  const removeVerb = REMOVE_VERBS.has(t[v] ?? '') || phrasalRemove;
  // A "no" or "without" that opens the message, or ends the run of "no, …" that does.
  const negation = t.slice(0, at + 1).findIndex((w) => NEGATION_LEADS.has(w));

  const sets = t.includes('sets') || t.includes('volume') || t.includes('intense') || t.includes('intensity');

  if (insteadOf >= 0 && !swapVerb) {
    const { target, replacement } = splitSwap(t);
    const words = rowWords(target);
    if (words.length === 0) return null;
    intent.swap = { target: words, replacement };
    return intent;
  }

  if (swapVerb && !sets) {
    let from = v + 1;
    if (t[from] === 'out') from++;
    const { target, replacement } = splitSwap(t.slice(from));
    const words = rowWords(target);
    if (words.length === 0 || words.every((w) => REFERENCES.has(w))) {
      // "swap it for 3d shoulders", "switch to legs": no row is named, and what it is swapped for is muscles.
      const named = parseQuickRequest(replacement.join(' '));
      if ((named.options.focus?.length ?? 0) > 0 || named.split !== undefined) {
        const focus = named.options.focus ?? [];
        if (focus.length > 0) intent.muscles = { replace: focus };
        if (named.split) intent.split = named.split;
        return intent;
      }
      // "change it", "switch it up", "swap it for something else": another routine.
      if (replacement.every((w) => GENERIC_REPLACEMENT.has(w))) {
        intent.shuffle = true;
        return intent;
      }
      return null;
    }
    if (words.some((w) => NOT_A_ROW.has(w))) return null;
    const out = onlyMuscles(words);
    if (out.length > 0) {
      // "swap legs for arms": muscles for muscles.
      const named = onlyMuscles(replacement);
      if (named.length === 0) return null;
      intent.muscles = { out, add: named };
      return intent;
    }
    intent.swap = { target: words, replacement };
    return intent;
  }

  if (removeVerb && !sets && extras.length === 0) {
    let from = v + (phrasalRemove ? 2 : 1);
    if (t[from] === 'out' || t[from] === 'off') from++;
    const words = rowWords(t.slice(from));
    if (words.length === 0) {
      const n = NUMBER_WORDS[t[from] ?? ''];
      if (t[from] === 'one' || n !== undefined) intent.count = { by: -(n ?? 1) };
      else return null;
      return intent;
    }
    if (words.some((w) => NOT_A_ROW.has(w))) return null;
    const muscles = onlyMuscles(words);
    const kit = onlyEquipment(words);
    if (muscles.length > 0) intent.muscles = { exclude: muscles };
    else if (kit.length > 0) intent.equipment = { list: EQUIPMENT_KINDS.filter((e) => !kit.includes(e)), add: false };
    else if (words.length === 1 && NUMBER_WORDS[words[0]!] !== undefined) intent.count = { by: -NUMBER_WORDS[words[0]!]! };
    else if (words.length === 1 && words[0] === 'couple') intent.count = { by: -2 };
    // "cut it down", "trim it": a shorter one.
    else if (words.length === 1 && (words[0] === 'down' || words[0] === 'back')) intent.minutes = { by: 'shorter' };
    else intent.remove = { target: words };
    return intent;
  }

  // "no front raises", "without the face pull": a negation and what is not a muscle names a row.
  if (negation >= 0) {
    const rest = rowWords(t.slice(negation + 1).filter((w) => !FILLERS.has(w) && !FOLLOW_UP_WORDS.has(w)));
    if (
      extras.length === 0 &&
      rest.length > 0 &&
      (parsed.options.exclude?.length ?? 0) === 0 &&
      (parsed.options.equipment?.length ?? 0) === 0 &&
      onlyMuscles(rest).length === 0 &&
      !rest.some((w) => NOT_A_ROW.has(w) || EDIT_WORDS.has(w))
    ) {
      intent.remove = { target: rest };
      return intent;
    }
  }

  // Shuffle: another one, again, something else, a different one.
  const SHUFFLE_KEYS = new Set(['another', 'again', 'different', 'redo', 'reshuffle', 'shuffle', 'else', 'other', 'new', 'fresh']);
  const SHUFFLE_WORDS = new Set([
    ...SHUFFLE_KEYS, 'give', 'me', 'us', 'a', 'an', 'the', 'it', 'this', 'one', 'ones', 'try', 'something', 'routine', 'workout', 'version', 'option', 'variation', 'alternative',
    'please', 'mix', 'switch', 'up', 'more', 'time', 'make', 'go', 'have', 'lets', "let's", 'show', 'i', 'want', 'need', 'like', 'id', "i'd", 'to', 'see', 'and', 'then', 'now', 'just', 'actually',
    'gimme', 'get', 'chuck', 'bung', 'lob', 'sling', 'whack', 'throw', 'hit', 'do',
  ]);
  const shuffleWords = t.length > 0 && t.every((w) => SHUFFLE_WORDS.has(w));
  const wantsShuffle = shuffleWords && (t.some((w) => SHUFFLE_KEYS.has(w)) || (t.includes('mix') && t.includes('up')) || (t.includes('switch') && t.includes('up')));
  if (wantsShuffle && !thanked && !(t.includes('more') && !t.includes('again'))) {
    intent.shuffle = true;
    return intent;
  }

  // From here on the typed request parser reads the muscles, a split, equipment, a count and a length.
  const focus = parsed.options.focus ?? [];
  const exclude = parsed.options.exclude ?? [];
  const split = parsed.split;
  const noun = t.some((w) => ROUTINE_NOUNS.has(w) && !EXERCISE_NOUNS.has(w));
  const ref = t.some((w) => REFERENCES.has(w));
  const addCue = t.some((w, i) => ADD_CUES.has(w) || (i === 0 && w === 'with'));
  const onMuscles = focus.length > 0 || exclude.length > 0 || split !== undefined;
  // A request that names the routine, or asks for it in so many words, is a routine of its own.
  const wholeRequest = onMuscles && ((explicit && (noun || !addCue)) || (noun && !ref && !addCue));
  if (wholeRequest) return null;

  const hasVerbOrCue = addCue || t.some((w) => SWAP_VERBS.has(w) || w === 'make' || NEGATION_LEADS.has(w) || w === 'instead');
  // "this leg day", "my shoulders": a noun phrase about the owner's own, not an instruction.
  if (onMuscles && !hasVerbOrCue && t.some((w) => POSSESSIVE.has(w))) return null;
  // "can you do legs" asks whether, and "can you chest" is nothing: a muscle asked politely is changed only with a verb to say how.
  if (polite && onMuscles && !hasVerbOrCue) return null;

  const step = effortStep(t);
  const by = lengthStep(t);
  const delta = onMuscles || sets ? undefined : countDelta(t);
  const bigCount = t.some((w, i) => /^1[12]$/.test(w) && EXERCISE_NOUNS.has(t[i + 1] ?? ''));
  const unread = parsed.residue.filter(
    (w) => !EDIT_WORDS.has(w) && !(step !== undefined && EDIT_WORDS_WITH_EFFORT.has(w)) && !(by !== undefined && w === 'time') && !(bigCount && /^1[12]$/.test(w)),
  );
  if (unread.length > 0) return null;

  if (focus.length > 0 || exclude.length > 0) {
    intent.muscles = {};
    if (focus.length > 0) intent.muscles[addCue ? 'add' : 'replace'] = focus;
    if (exclude.length > 0) intent.muscles.exclude = exclude;
  }
  if (split) intent.split = split;

  const timed = parsed.read.some((r) => TIME_PHRASE.test(r));
  if (timed && parsed.options.minutes !== undefined) intent.minutes = { to: parsed.options.minutes };
  else if (by) intent.minutes = { by };

  // "two more" and "four fewer" are changes; the request parser reads their numbers as counts.
  if (delta !== undefined) intent.count = { by: delta };
  else if (bigCount) intent.count = { to: Number(t.find((w) => /^1[12]$/.test(w))) };
  else if (parsed.options.count !== undefined && !timed) intent.count = { to: parsed.options.count };

  if (step !== undefined) intent.effort = step;

  if ((parsed.options.equipment?.length ?? 0) > 0) intent.equipment = { list: parsed.options.equipment!, add: addCue };

  // What the request parser read beyond what is named here travels with the edit, and joins what the routine already holds.
  const negated = NEGATION_LEADS.has(t[0] ?? '') || removeVerb;
  const hasPart = Object.keys(intent).some((key) => key !== 'extras');
  if (extras.length > 0 && (hasPart || negated)) intent.extras = Object.fromEntries(extras);
  const parts = Object.keys(intent).filter((key) => key !== 'extras').length > 0 || Object.keys(intent.extras).length > 0;
  return parts ? intent : null;
}

// ---------------------------------------------------------------------------
// Routing

/** The first words of a message that say what to do: used to tell "harder?" from "make it harder?". */
const IMPERATIVES = new Set([
  ...BUILD_VERBS, ...SWAP_VERBS, ...REMOVE_VERBS, 'add', 'include', 'shuffle', 'redo', 'try', 'put', 'take', 'get', 'leave', 'throw', 'chuck', 'bung', 'lob',
]);

/**
 * Whether the message is a routine to build, the routine on screen to change, or a question to
 * answer. A message that asks for a routine, a workout, a split or some exercises to be made, or
 * names a muscle in the way a request does, is a build; with a routine as the subject, a message
 * that asks for it to be changed is an edit; everything else, and anything the words leave open, is
 * a question. A question mark after a follow-up makes it a question about the routine.
 */
export function routeCoachMessage(text: string, ctx: CoachRouteContext): CoachRoute {
  if (typeof text !== 'string') return 'ask';
  const asked = endsAsked(text);
  let tokens = tokenise(text);
  if (tokens.length === 0) return 'ask';

  let i = 0;
  while (i < tokens.length && FILLERS.has(tokens[i]!)) i++;
  tokens = tokens.slice(i);
  if (tokens.length === 0) return 'ask';
  const rest = (from: number): string[] => tokens.slice(from);

  // "Can you build me a back routine", "can you do me a shoulder session": asked politely, still asked for.
  let polite = false;
  if (POLITE.has(tokens[0]!) && (tokens[1] === 'you' || tokens[1] === 'u' || tokens[1] === 'ya')) {
    let j = 2;
    while (j < tokens.length && FILLERS.has(tokens[j]!)) j++;
    const verb = readBuildVerb(tokens, j);
    if (verb > 0) {
      const r = reading(rest(j + verb), rest(j + verb).join(' '));
      const pointing = pointsAtRoutine(rest(j + verb)) && !r.muscles && !r.split;
      if (ctx.lastWasRoutine && readEdit(text) !== null) return 'edit';
      return (r.muscles || r.split || r.noun) && !pointing && !rest(j + verb).some((t) => NOT_TRAINING.has(t)) ? 'build' : 'ask';
    }
    if (ctx.lastWasRoutine && readEdit(text) !== null) return 'edit';
    polite = true;
  }

  // "Can I get a leg day", "could I have a chest routine", "can we do chest": asked as a favour, and a request.
  if ((tokens[0] === 'can' || tokens[0] === 'could') && (tokens[1] === 'i' || tokens[1] === 'we') && (tokens[2] === 'get' || tokens[2] === 'have')) {
    return namesRoutine(rest(3)) ? 'build' : 'ask';
  }
  if ((tokens[0] === 'can' || tokens[0] === 'could' || tokens[0] === 'shall') && tokens[1] === 'we' && tokens[2] === 'do' && !asked) {
    return namesRoutine(rest(3)) ? 'build' : 'ask';
  }

  const first = tokens[0]!;
  const verb = readBuildVerb(tokens, 0);
  if (polite || (verb === 0 && QUESTION_STARTERS.has(first))) return 'ask';

  // A routine on screen: a message that asks for it to change.
  if (ctx.lastWasRoutine && readEdit(text) !== null) {
    return asked && !IMPERATIVES.has(first) ? 'ask' : 'edit';
  }

  const r = reading(tokens, tokens.join(' '));

  // "Give me a routine…", "make me a push day", "build 3D shoulders", "put together a split", "chuck me some arms".
  if (verb > 0) {
    const after = reading(rest(verb), rest(verb).join(' '));
    const pointing = pointsAtRoutine(rest(verb));
    if (rest(verb).some((t) => NOT_TRAINING.has(t))) return 'ask';
    return after.muscles || after.split || (after.noun && !pointing) ? 'build' : 'ask';
  }

  // "I want 3d shoulders", "I need a push routine", "Doesn't matter, I want 3d shoulders", "looking for a chest workout".
  let at = 0;
  while (at < tokens.length && (CHANGE_OF_MIND.has(tokens[at]!) || FILLERS.has(tokens[at]!))) at++;
  const looking = readLookingFor(tokens, at);
  if (looking > 0) return namesRoutine(rest(at + looking)) ? 'build' : 'ask';
  const want = readWant(tokens, at);
  if (want > 0) {
    const after = rest(at + want);
    if (after.some((t) => KNOWING.has(t))) return 'ask';
    if (after.some((t) => NOT_TRAINING.has(t))) return 'ask';
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
      if (!tokens.slice(0, k).some((t) => POSSESSIVE.has(t))) return 'build';
    }
  }

  // "5 exercises for chest", "six exercises for 3d shoulders".
  if (r.countedExercises && (r.muscles || r.split)) return 'build';

  // "push routine", "a leg day", "ppl", "new full body workout": a routine named, with no verb to ask for it.
  const possessive = tokens.some((t) => POSSESSIVE.has(t));
  if (!possessive && (r.split || (r.noun && r.muscles))) {
    const extra = r.parsed.residue.filter((w) => !FOLLOW_UP_WORDS.has(w) && !DESCRIBING_WORDS.has(w));
    if (extra.length === 0) return 'build';
  }

  return 'ask';
}
