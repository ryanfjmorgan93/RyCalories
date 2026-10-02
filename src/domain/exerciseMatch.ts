/**
 * Matches a pasted routine's exercise names against the app's exercise library. Pure — no IO, no
 * clock, no database — so it can be tested against real seed data directly.
 */
import { tokenScore } from './products';

export interface MatchCandidate {
  id: string;
  name: string;
  aliases?: string[];
  /**
   * The candidate is a library entry the owner has not added yet, not one of their own exercises.
   * At the same score an exercise of theirs beats a library entry, and a library entry never makes
   * an answer ambiguous that one of their own settles.
   */
  library?: boolean;
}

export interface ExerciseMatch {
  id: string;
  score: number;
  via: 'exact' | 'fuzzy';
}

/** Below this, a fuzzy match is a guess, not a confident answer. Accepted only strictly above it. */
export const EXERCISE_MATCH_THRESHOLD = 0.5;

/**
 * Case/whitespace-insensitive match key. Lives here (not `src/db/repo.ts`) so this stays a pure
 * domain module with no database dependency; `repo.ts` imports and re-exports this one function so
 * every caller — including the Hevy importer — keeps exactly the same behaviour.
 */
export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9()+]+/g, ' ')
    .trim();
}

/**
 * Single-token or short-phrase gym shorthand a chatbot or a person typing fast might use. Applied
 * to both the query and every candidate name/alias before scoring, never for the exact pass (which
 * must still match the library's own spelling exactly).
 */
const ABBREVIATION_PATTERNS: [RegExp, string][] = [
  [/\bohp\b/gi, 'overhead press'],
  [/\brdl\b/gi, 'romanian deadlift'],
  [/\bsldl\b/gi, 'stiff leg deadlift'],
  [/\bdb\b/gi, 'dumbbell'],
  [/\bbb\b/gi, 'barbell'],
  [/\bkb\b/gi, 'kettlebell'],
  [/\bbw\b/gi, 'bodyweight'],
  [/\btricep\b/gi, 'triceps'],
  [/\bbicep\b/gi, 'biceps'],
  [/\bpull[\s-]?downs?\b/gi, 'pulldown'],
  [/\bpush[\s-]?downs?\b/gi, 'pushdown'],
  // "Pull-ups", "Pull ups", "Pullups", "Chin up", "Pushups", "Step-Ups": one exercise however it is
  // joined or pluralised. A bare "ups" is three letters, which the plural rule below leaves alone,
  // so without the optional "s" here "Pull ups" matched only entries that also carried an "ups".
  [/\b(pull|push|chin|sit|step)[\s-]?ups?\b/gi, '$1 up'],
  // British English: a push-up is a press-up.
  [/\bpress[\s-]?ups?\b/gi, 'push up'],
];

export function expandAbbreviations(s: string): string {
  let out = s;
  for (const [re, replacement] of ABBREVIATION_PATTERNS) out = out.replace(re, replacement);
  return out;
}

const PARENTHETICAL_RE = /\([^()]*\)/g;

/** Words that say nothing about which exercise it is. Not "bar": 'T-Bar Row' is not a plain row. */
const FILLER = new Set(['the', 'and', 'with', 'of', 'a', 'an', 'in', 'for', 'on']);

/**
 * One word as the matcher compares it: plurals and the two common respellings folded, so 'raises'
 * is 'raise', 'crunches' is 'crunch', 'carries' is 'carry', 'flyes' and 'flies' are 'fly', 'ups' is
 * 'up'. The same fold is applied to the line and to every name, so what matters is only that both
 * sides end up the same.
 */
function stem(w: string): string {
  let s = w;
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.length > 4 && /(?:ch|sh|ss|x)es$/.test(s)) s = s.slice(0, -2);
  else if (s === 'ups') s = 'up';
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s === 'flye' ? 'fly' : s;
}

/**
 * The words of an exercise name, folded (see `stem`). Single letters go ('T-Bar' is bar, 'L-Sit' is
 * sit) but a lone digit stays; "bar" is a word here, unlike in a food label, where it is packaging.
 */
function exerciseTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (FILLER.has(raw)) continue;
    if (raw.length < 2 && !/^[0-9]$/.test(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** The words of a text with and without its parenthetical parts, read once however many names it is scored against. */
interface TextForms {
  withParens: Set<string>;
  withoutParens: Set<string>;
}

const formsCache = new Map<string, TextForms>();
const FORMS_CACHE_MAX = 6000;

function textForms(text: string): TextForms {
  const hit = formsCache.get(text);
  if (hit) return hit;
  const forms: TextForms = {
    withParens: exerciseTokens(expandAbbreviations(text)),
    withoutParens: exerciseTokens(expandAbbreviations(text.replace(PARENTHETICAL_RE, ' '))),
  };
  if (formsCache.size >= FORMS_CACHE_MAX) formsCache.clear();
  formsCache.set(text, forms);
  return forms;
}

/** A query's words, read once with and without its parenthetical parts, so scoring it against hundreds of names does not re-read it for each. */
type QueryForms = TextForms;

function queryForms(query: string): QueryForms {
  return textForms(query);
}

/** Score a query against one piece of candidate text, trying with and without parentheses. */
function scoreAgainst(query: QueryForms, text: string): number {
  const forms = textForms(text);
  return Math.max(tokenScore(query.withParens, forms.withParens), tokenScore(query.withoutParens, forms.withoutParens));
}

interface Scored {
  score: number;
  /** The score came from the candidate's own name, not one of its aliases. */
  ownName: boolean;
  candidate: MatchCandidate;
}

/** Best score for a candidate: the best of its name and every alias. */
function bestCandidateScore(query: QueryForms, candidate: MatchCandidate): Scored {
  const own = scoreAgainst(query, candidate.name);
  let best = own;
  for (const alias of candidate.aliases ?? []) {
    const s = scoreAgainst(query, alias);
    if (s > best) best = s;
  }
  return { score: best, ownName: own >= best, candidate };
}

const SCORE_EPSILON = 1e-9;

/**
 * Higher score first; at the same score, one of the owner's exercises beats a library entry, and
 * a candidate matched on its own name beats one matched only through an alias ("Curl" is a curl
 * before it is Neck's "Neck Curl" alias).
 */
function compare(a: Scored, b: Scored): number {
  if (Math.abs(a.score - b.score) > SCORE_EPSILON) return b.score - a.score;
  const aLibrary = a.candidate.library === true;
  if (aLibrary !== (b.candidate.library === true)) return aLibrary ? 1 : -1;
  if (a.ownName !== b.ownName) return a.ownName ? -1 : 1;
  return 0;
}

export function matchExercise(name: string, candidates: MatchCandidate[]): ExerciseMatch | null {
  const key = normaliseName(name);
  if (!key || candidates.length === 0) return null;

  // Exact: the library's own spelling. A candidate whose name is the key beats one that only
  // carries it as an alias; two identically named exercises fall back to id so the answer is stable.
  const exact: Scored[] = [];
  for (const c of candidates) {
    const ownName = normaliseName(c.name) === key;
    if (ownName || (c.aliases ?? []).some((a) => normaliseName(a) === key)) exact.push({ score: 1, ownName, candidate: c });
  }
  if (exact.length > 0) {
    exact.sort((a, b) => compare(a, b) || (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0));
    return { id: exact[0]!.candidate.id, score: 1, via: 'exact' };
  }

  // Fuzzy: a guess the owner confirms. When two of the owner's own exercises are equally good
  // answers ("Calf raise" against their Seated and Standing Calf Raise), no guess is honest, so the
  // row is left for them to choose. Library entries tied with each other are told apart only by
  // `plainest`, and only when one is plainly the common one.
  const forms = queryForms(name);
  const fuzzy = candidates.map((c) => bestCandidateScore(forms, c)).filter((s) => s.score > EXERCISE_MATCH_THRESHOLD);
  if (fuzzy.length === 0) return null;
  fuzzy.sort(compare);
  const best = fuzzy[0]!;
  const tied = fuzzy.filter((s) => compare(best, s) === 0);
  if (tied.length === 1) return { id: best.candidate.id, score: best.score, via: 'fuzzy' };
  if (best.candidate.library !== true) return null;
  const chosen = plainest(tied);
  return chosen ? { id: chosen.candidate.id, score: chosen.score, via: 'fuzzy' } : null;
}

/** How many words a name has once folded, its bracketed qualifier included: the fewer, the plainer. */
function wordCount(c: MatchCandidate): number {
  return textForms(c.name).withParens.size;
}

/**
 * The names a person means when they write the movement without saying which variant, as the
 * library spells them. "Cable rows" fits Seated, Upright and Elevated Cable Row equally well, and
 * only the first is what is meant. A short list kept by hand because how common an exercise is
 * cannot be read off the library: it holds eighty dumbbell variants for every barbell one.
 */
export const COMMON_EXERCISE_NAMES: readonly string[] = [
  'Arnold Press', 'Back Extension', 'Barbell Curl', 'Barbell Row', 'Barbell Shrug', 'Bulgarian Split Squat', 'Cable Crunch', 'Cable Curl',
  'Cable Fly', 'Cable Lateral Raise', 'Calf Raise', 'Chin-up', 'Close-Grip Bench Press', 'Crunch', 'Deadlift', 'Dip', 'Dumbbell Bench Press',
  'Dumbbell Bent Over Row', 'Dumbbell Fly', 'EZ-Bar Curl', 'Face Pull', 'Front Raise', 'Front Squat', 'Glute Bridge', 'Goblet Squat',
  'Good Morning', 'Hack Squat', 'Hammer Curl', 'Hanging Leg Raise', 'Hip Thrust', 'Incline Bench Press', 'Incline Dumbbell Press', 'Lat Pulldown',
  'Lateral Raise', 'Leg Curl', 'Leg Extension', 'Leg Press', 'Machine Chest Press', 'Machine Shoulder Press', 'One-Arm Dumbbell Row',
  'Overhead Press', 'Pec Deck', 'Plank', 'Preacher Curl', 'Pull-up', 'Push-up', 'Romanian Deadlift', 'Seated Cable Row', 'Seated Calf Raise',
  'Skull Crusher', 'Standing Calf Raise', 'Step-Up', 'Sumo Deadlift', 'T-Bar Row', 'Tricep Pushdown', 'Upright Row', 'Walking Lunge',
];
const COMMON_KEYS = new Set(COMMON_EXERCISE_NAMES.map(normaliseName));

/**
 * Of library entries that answer a line equally well, the plain, common one, or undefined when
 * none stands out. The fewest words come first, since 'Pull-up' is plainer than 'Weighted Pull-up'.
 * Among those, the one name on `COMMON_EXERCISE_NAMES`. Nothing is picked when none is, or when
 * several are: "Rows" is a Barbell, a T-Bar and an Upright Row, and "Press" is every press.
 */
function plainest(tied: Scored[]): Scored | undefined {
  const fewest = Math.min(...tied.map((s) => wordCount(s.candidate)));
  const plain = tied.filter((s) => wordCount(s.candidate) === fewest);
  if (plain.length === 1) return plain[0];
  const common = plain.filter((s) => COMMON_KEYS.has(normaliseName(s.candidate.name)));
  return common.length === 1 ? common[0] : undefined;
}
