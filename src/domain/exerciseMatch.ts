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

/** Best score for a candidate: the best of its name and every alias. */
function bestCandidateScore(query: string, candidate: MatchCandidate): number {
  let best = scoreAgainst(query, candidate.name);
  for (const alias of candidate.aliases ?? []) {
    const s = scoreAgainst(query, alias);
    if (s > best) best = s;
  }
  return best;
}

/** Deterministic tie-break: higher score, then shorter candidate name, then id. */
function isBetter(a: { score: number; candidate: MatchCandidate }, b: { score: number; candidate: MatchCandidate }): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.candidate.name.length !== b.candidate.name.length) return a.candidate.name.length < b.candidate.name.length;
  return a.candidate.id < b.candidate.id;
}

export function matchExercise(name: string, candidates: MatchCandidate[]): ExerciseMatch | null {
  const key = normaliseName(name);
  if (!key || candidates.length === 0) return null;

  let exactBest: { score: number; candidate: MatchCandidate } | null = null;
  for (const c of candidates) {
    const isExact = normaliseName(c.name) === key || (c.aliases ?? []).some((a) => normaliseName(a) === key);
    if (!isExact) continue;
    const entry = { score: 1, candidate: c };
    if (!exactBest || isBetter(entry, exactBest)) exactBest = entry;
  }
  if (exactBest) return { id: exactBest.candidate.id, score: 1, via: 'exact' };

  let fuzzyBest: { score: number; candidate: MatchCandidate } | null = null;
  for (const c of candidates) {
    const score = bestCandidateScore(name, c);
    if (score <= EXERCISE_MATCH_THRESHOLD) continue;
    const entry = { score, candidate: c };
    if (!fuzzyBest || isBetter(entry, fuzzyBest)) fuzzyBest = entry;
  }
  if (!fuzzyBest) return null;
  return { id: fuzzyBest.candidate.id, score: fuzzyBest.score, via: 'fuzzy' };
}
