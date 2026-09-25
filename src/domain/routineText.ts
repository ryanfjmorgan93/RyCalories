/**
 * Parses a routine pasted from a chatbot answer (Claude, in practice — see docs/MERGE_PLAN.md)
 * into routines and exercise lines. Pure: no IO, no clock, no matching against the exercise
 * library (that's `./exerciseMatch`).
 *
 * The input is free text a person copied out of a chat reply, so this has to tolerate whatever
 * shape that reply took: markdown emphasis and headings, numbered or bulleted lists, an intro
 * sentence, a closing note, mixed dash characters, "×" instead of "x". None of that is malformed —
 * it's exactly what asking an LLM for a routine produces.
 */

export interface ParsedRoutineLine {
  raw: string;
  name: string;
  sets?: number;
  repMin?: number;
  repMax?: number;
  /** The rep numbers are seconds (e.g. "3x30s"), not reps. */
  seconds?: boolean;
  weightKg?: number;
}

export interface ParsedRoutine {
  name: string;
  exercises: ParsedRoutineLine[];
}

// ---------------------------------------------------------------------------
// Line normalisation

const BOLD_RE = /\*\*(.+?)\*\*/g;
const UNDERSCORE_EMPHASIS_RE = /__(.+?)__/g;
const MARKDOWN_HEADING_PREFIX_RE = /^\s{0,3}#{1,6}\s+/;
const BULLET_PREFIX_RE = /^\s*(?:[-*•–—]|\d+[.)])\s+/;
const DASH_RE = /[–—]/g;

/** Strip markdown emphasis/heading/bullet markers, normalise dashes and "×", collapse whitespace. */
function normaliseLine(raw: string): string {
  let s = raw;
  s = s.replace(BOLD_RE, '$1');
  s = s.replace(UNDERSCORE_EMPHASIS_RE, '$1');
  s = s.replace(MARKDOWN_HEADING_PREFIX_RE, '');
  s = s.replace(BULLET_PREFIX_RE, '');
  s = s.replace(/×/g, 'x');
  s = s.replace(DASH_RE, '-');
  return s.replace(/\s+/g, ' ').trim();
}

const MARKDOWN_HEADING_LINE_RE = /^#{1,6}\s+\S/;
const FULLY_BOLD_LINE_RE = /^(\*\*[^*]+\*\*|__[^_]+__)$/;
const DAY_PREFIX_RE = /^(day|week|workout|session|routine)\b/i;

// ---------------------------------------------------------------------------
// Numbers: weight, then sets/reps/seconds

const WEIGHT_PATTERNS: RegExp[] = [
  // "@ 80kg", "@80 kg"
  /@\s*(\d+(?:[.,]\d+)?)\s*kg\b/i,
  // "at 80 kg"
  /\bat\s+(\d+(?:[.,]\d+)?)\s*kg\b/i,
  // ", 80kg"
  /,\s*(\d+(?:[.,]\d+)?)\s*kg\b/i,
  // "@ 100" — a bare number after @ is kg.
  /@\s*(\d+(?:[.,]\d+)?)\b/i,
];

/**
 * "4x6-8", "4 x 6-8", "3 sets of 8-10", "3 sets x 10 reps", "3x30s", "3 x 45 sec", "5x5" — the
 * exercise's own name never contains these numbers, so whatever this matches is removed from the
 * line before the leftover text becomes the name.
 */
const SETS_REPS_RE =
  /(\d+)\s*(?:sets?)?\s*(?:x|of)\s*(\d+(?:[.,]\d+)?)(?:\s*(?:-|to)\s*(\d+(?:[.,]\d+)?))?\s*(seconds|secs|sec|s)?\b(?:\s*reps?)?/i;

const TRAILING_NOTE_PATTERNS: RegExp[] = [
  // "(each side)", leftover "()" once its numbers are removed from inside.
  /\s*\([^()]*\)\s*$/,
  // "- notes" — a dash with a space on both sides, so a hyphenated exercise name like
  // "Bent-over row" (no space before its hyphen) is never mistaken for a trailing note.
  /\s+-\s+[a-z][a-z '/]*$/i,
  // ", RPE 8"
  /,?\s*rpe\s*\d+(?:[.,]\d+)?\s*$/i,
  // "rest 90s" / ", rest 90"
  /,?\s*rest\s*\d+\s*(?:seconds|secs|sec|s)?\s*$/i,
];

/** Trim, strip trailing annotations left over once the numbers are gone, repeat until stable. */
function cleanName(s: string): string {
  let cur = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 5; i++) {
    let next = cur;
    for (const re of TRAILING_NOTE_PATTERNS) next = next.replace(re, '');
    next = next.trim().replace(/[-,:;]+$/, '').trim();
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

interface ExtractedLine {
  hasNumbers: boolean;
  sets?: number;
  repMin?: number;
  repMax?: number;
  seconds?: boolean;
  weightKg?: number;
  name: string;
}

function toNumber(s: string): number {
  return Number(s.replace(',', '.'));
}

function extractLine(normalized: string): ExtractedLine {
  let s = normalized;
  let weightKg: number | undefined;
  for (const re of WEIGHT_PATTERNS) {
    const m = re.exec(s);
    if (m) {
      weightKg = toNumber(m[1]!);
      s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
      break;
    }
  }

  const m = SETS_REPS_RE.exec(s);
  if (!m) return { hasNumbers: false, name: cleanName(s) };

  const sets = Number(m[1]);
  const repMin = toNumber(m[2]!);
  const repMax = m[3] !== undefined ? toNumber(m[3]) : repMin;
  const seconds = m[4] !== undefined;
  const rest = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
  const result: ExtractedLine = { hasNumbers: true, sets, repMin, repMax, name: cleanName(rest) };
  if (seconds) result.seconds = true;
  if (weightKg !== undefined) result.weightKg = weightKg;
  return result;
}

// ---------------------------------------------------------------------------
// Line classification: exercise (with or without numbers) / heading / prose

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Parse a full pasted routine reply into routines and exercise lines, plus the lines that were
 * neither (prose). Never throws — unparseable text just yields no routines.
 */
export function parseRoutineText(text: string): { routines: ParsedRoutine[]; ignored: string[] } {
  const ignored: string[] = [];
  const routines: ParsedRoutine[] = [];
  let current: ParsedRoutine | null = null;
  let seenMeaningful = false;
  let prevWasBlank = false;

  const rawLines = (text ?? '').split(/\r\n|\r|\n/);
  for (const rawLine of rawLines) {
    if (rawLine.trim() === '') {
      prevWasBlank = true;
      continue;
    }
    const trimmedOriginal = rawLine.trim();
    const wasMarkdownHeadingMarker = MARKDOWN_HEADING_LINE_RE.test(trimmedOriginal);
    const wasFullyBold = FULLY_BOLD_LINE_RE.test(trimmedOriginal);

    const normalized = normaliseLine(rawLine);
    if (normalized === '') {
      prevWasBlank = true;
      continue;
    }
    const isFirstMeaningful = !seenMeaningful;
    const followsBlank = prevWasBlank;
    seenMeaningful = true;
    prevWasBlank = false;

    const extracted = extractLine(normalized);
    if (extracted.hasNumbers) {
      const line: ParsedRoutineLine = { raw: rawLine, name: extracted.name || normalized };
      if (extracted.sets !== undefined) line.sets = extracted.sets;
      if (extracted.repMin !== undefined) line.repMin = extracted.repMin;
      if (extracted.repMax !== undefined) line.repMax = extracted.repMax;
      if (extracted.seconds) line.seconds = true;
      if (extracted.weightKg !== undefined) line.weightKg = extracted.weightKg;
      if (!current) {
        current = { name: 'Pasted routine', exercises: [] };
        routines.push(current);
      }
      current.exercises.push(line);
      continue;
    }

    // No sets pattern. Prose is judged before headings — an over-long or sentence-punctuated line
    // is prose even when it ends with ":" or opens the message (an intro sentence such as "Here's
    // a 3-day upper/lower split, one exercise per line, sets and reps after each name:" is not a
    // heading just because it happens to end that way).
    const endsWithSentencePunct = /[.!?]$/.test(normalized);
    const isProse = endsWithSentencePunct || wordCount(normalized) > 6;
    if (isProse) {
      ignored.push(rawLine);
      continue;
    }

    const endsWithColon = /:$/.test(normalized);
    const isHeading =
      isFirstMeaningful || followsBlank || endsWithColon || wasMarkdownHeadingMarker || wasFullyBold || DAY_PREFIX_RE.test(normalized);
    if (isHeading) {
      current = { name: normalized.replace(/:$/, '').trim(), exercises: [] };
      routines.push(current);
      continue;
    }

    // Short, pattern-less line that is neither a heading nor prose — an exercise named with no
    // numbers at all, e.g. "Face pulls" sat in the middle of a list.
    if (!current) {
      current = { name: 'Pasted routine', exercises: [] };
      routines.push(current);
    }
    current.exercises.push({ raw: rawLine, name: normalized });
  }

  return { routines: routines.filter((r) => r.exercises.length > 0), ignored };
}
