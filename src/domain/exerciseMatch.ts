/**
 * Matches a pasted routine's exercise names against the app's exercise library. Pure — no IO, no
 * clock, no database — so it can be tested against real seed data directly.
 */
import { tokenScore, tokens } from './products';

export interface MatchCandidate {
  id: string;
  name: string;
  aliases?: string[];
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
  [/\bpull[\s-]?down\b/gi, 'pulldown'],
  [/\bpush[\s-]?down\b/gi, 'pushdown'],
  [/\bpull[\s-]?up\b/gi, 'pull up'],
  [/\bchin[\s-]?up\b/gi, 'chin up'],
];

function expandAbbreviations(s: string): string {
  let out = s;
  for (const [re, replacement] of ABBREVIATION_PATTERNS) out = out.replace(re, replacement);
  return out;
}

const PARENTHETICAL_RE = /\([^()]*\)/g;

/** Score `query` against one piece of candidate text, trying with and without parentheses. */
function scoreAgainst(query: string, text: string): number {
  const a = tokens(expandAbbreviations(query));
  const b = tokens(expandAbbreviations(text));
  const withParens = tokenScore(a, b);
  const aStripped = tokens(expandAbbreviations(query.replace(PARENTHETICAL_RE, ' ')));
  const bStripped = tokens(expandAbbreviations(text.replace(PARENTHETICAL_RE, ' ')));
  const withoutParens = tokenScore(aStripped, bStripped);
  return Math.max(withParens, withoutParens);
}

interface Scored {
  score: number;
  /** The score came from the candidate's own name, not one of its aliases. */
  ownName: boolean;
  candidate: MatchCandidate;
}

/** Best score for a candidate: the best of its name and every alias. */
function bestCandidateScore(query: string, candidate: MatchCandidate): Scored {
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
 * Higher score first; at the same score, a candidate matched on its own name beats one matched
 * only through an alias ("Curl" is a curl before it is Neck's "Neck Curl" alias).
 */
function compare(a: Scored, b: Scored): number {
  if (Math.abs(a.score - b.score) > SCORE_EPSILON) return b.score - a.score;
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

  // Fuzzy: a guess the owner confirms. When two different exercises are equally good answers
  // ("Calf raise" against Seated and Standing Calf Raise, "Press" against every press), no guess
  // is honest, so the row is left for the owner to choose instead of picking one by name length.
  const fuzzy = candidates.map((c) => bestCandidateScore(name, c)).filter((s) => s.score > EXERCISE_MATCH_THRESHOLD);
  if (fuzzy.length === 0) return null;
  fuzzy.sort(compare);
  const [best, runnerUp] = fuzzy;
  if (runnerUp && compare(best!, runnerUp) === 0) return null;
  return { id: best!.candidate.id, score: best!.score, via: 'fuzzy' };
}
