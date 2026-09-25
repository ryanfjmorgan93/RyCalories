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
// "-", "•", "1.", "2)", and superset positions "A1.", "B2)", "C1:", "1a." — the letter-digit pair
// is how a chatbot numbers exercises it wants done back to back.
const BULLET_PREFIX_RE = /^\s*(?:[-*•–—]|\d+[a-z]?[.)]|[A-Za-z]\d{1,2}[.):]?)\s+/;
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

/**
 * Lines that are advice about the routine, not part of it: "Warm-up: 5 min bike", "Cool down",
 * "Tempo 3-1-1", "Rest 90s between sets", "Notes: …", "Progression: …", "Deload …". "Tempo" is a
 * note only with its count after it — "Tempo squat" is an exercise.
 */
const NOTE_LINE_RE = /^(?:warm[\s-]?ups?|cool[\s-]?downs?|rest(?![\s-]*pause)|notes?|progression|deload)\b|^tempo\s*:?\s*(?:\d|$)/i;

/**
 * A note that is only a label ("Warm-up:", "**Cool-down (5 min)**") opens a block: the lines under
 * it are the warm-up, not the routine, up to the next heading or blank line.
 */
const NOTE_BLOCK_RE = /^(?:warm[\s-]?ups?|cool[\s-]?downs?|notes?)$/i;

/**
 * Labels that group exercises inside one day — "Superset 1:", "Superset A", "Giant set", "Tri-set",
 * "Circuit (3 rounds):", "Main lifts:", "Accessories:", "Finisher:". They are not a new routine, so
 * the day's name stands. A label with an exercise after it ("Superset: Bench 3x10, Row 3x10") keeps
 * the exercise.
 */
const SECTION_LABEL_RE =
  /^(?:(?:super|giant|tri|compound)[\s-]?sets?|circuits?|main(?:\s+(?:lifts?|work|sets?))?|accessor(?:y|ies)(?:\s+(?:work|lifts?))?|finishers?)\b(?:\s+[A-Za-z]?\d{0,2}\b)?\s*(?:\([^()]*\))?\s*(?:[:.-]\s*|$)/i;

/** What can follow a group label and still be only the label: "Superset 1: 3 rounds", "Circuit - x3". */
const ROUNDS_ONLY_RE = /^(?:\d+\s*(?:rounds?|times|circuits?)|x\s*\d+)(?:\s+through)?\.?$/i;

/** "Warm-up (10 min):" → "Warm-up". */
function bareLabel(s: string): string {
  return s.replace(/\([^()]*\)/g, ' ').replace(/[:.\-\s]+$/, '').trim();
}

// ---------------------------------------------------------------------------
// Numbers: weight, then sets/reps/seconds

/** "80", "62.5", "62,5", optionally a range "70-80" / "70 to 80". */
const KG_NUMBER = String.raw`(\d+(?:[.,]\d+)?)(?:\s*(?:-|to)\s*\d+(?:[.,]\d+)?)?`;

/**
 * A range ("@ 70-80kg") starts at its lower end: the engine adds weight from wherever the routine
 * starts, and a start the owner cannot lift for the prescribed reps is the one mistake it cannot
 * walk back. The whole range is consumed either way, so "-80kg" never lands in the name.
 */
const WEIGHT_PATTERNS: RegExp[] = [
  // "@ 80kg", "@80 kg", "@ 70-80kg"
  new RegExp(String.raw`@\s*${KG_NUMBER}\s*kgs?\b`, 'i'),
  // "at 80 kg"
  new RegExp(String.raw`\bat\s+${KG_NUMBER}\s*kgs?\b`, 'i'),
  // ", 80kg"
  new RegExp(String.raw`,\s*${KG_NUMBER}\s*kgs?\b`, 'i'),
  // "@ 100" — a bare number after @ is kg.
  new RegExp(String.raw`@\s*${KG_NUMBER}(?![\d.,])`, 'i'),
];

/**
 * "4x6-8", "4 x 6-8", "3 sets of 8-10", "3 sets x 10 reps", "3x30s", "3 x 45 sec", "3x1 min",
 * "5x5" — the exercise's own name never contains these numbers, so whatever this matches is
 * removed from the line before the leftover text becomes the name. Group 4 is a seconds unit,
 * group 5 a minutes unit. A bare "m" is not minutes: on a carry it is metres.
 */
const SETS_REPS_SOURCE = String.raw`(\d+)\s*(?:sets?)?\s*(?:x|of)\s*(\d+(?:[.,]\d+)?)(?:\s*(?:-|to)\s*(\d+(?:[.,]\d+)?))?(?:\s*(?:(seconds?|secs?|s)|(minutes?|mins?)))?\b(?:\s*reps?)?`;
const SETS_REPS_RE = new RegExp(SETS_REPS_SOURCE, 'i');

/**
 * "3xAMRAP", "3 x max", "3 sets of max reps", "3 sets to failure", "3 sets, AMRAP": the sets are
 * known, the reps are "as many as you can", which is no number at all — the exercise keeps its
 * own rep range.
 */
const OPEN_REPS_SOURCE = String.raw`(\d+)\s*(?:sets?)?\s*(?:x|of|,)?\s*(?:amrap|max(?:imum)?|(?:to\s+)?failure)\b(?:\s*reps?)?`;
const OPEN_REPS_RE = new RegExp(OPEN_REPS_SOURCE, 'i');

/** Either shape, anywhere in a line — how a line holding two exercises is recognised. */
const ANY_NUMBERS_RE = new RegExp(`${SETS_REPS_SOURCE}|${OPEN_REPS_SOURCE}`, 'gi');
const HAS_NUMBERS_RE = new RegExp(ANY_NUMBERS_RE.source, 'i');

const TRAILING_NOTE_PATTERNS: RegExp[] = [
  // "(each side)", leftover "()" once its numbers are removed from inside.
  /\s*\([^()]*\)\s*$/,
  // "- notes" — a dash with a space on both sides, so a hyphenated exercise name like
  // "Bent-over row" (no space before its hyphen) is never mistaken for a trailing note.
  /\s+-\s+[a-z][a-z '/]*$/i,
  // ", RPE 8", "RPE 7-8", "@ RPE 8", "RIR 2"
  /,?\s*@?\s*(?:rpe|rir)\s*\d+(?:[.,]\d+)?(?:\s*(?:-|to)\s*\d+(?:[.,]\d+)?)?\s*$/i,
  // "rest 90s", ", rest 60-90 sec", "rest 2 min"
  /,?\s*rest\s*\d+(?:\s*(?:-|to)\s*\d+)?\s*(?:seconds?|secs?|s|minutes?|mins?)?\s*$/i,
  // "each side", "per leg", "/side", "each arm"
  /,?\s*(?:(?:each|per|a)\s+|\/\s*)(?:side|leg|arm|hand)s?\s*$/i,
  // "to failure", "AMRAP", "max reps", "last set AMRAP"
  /,?\s*(?:last\s+set\s+)?(?:(?:to|until)\s+failure|amrap|max\s+reps)\s*$/i,
  // "3-1-1 tempo", "tempo 3-1-1", "tempo 3-0-1-0"
  /,?\s*(?:tempo\s*:?\s*)?\d-\d-\d(?:-\d)?(?:\s*tempo)?\s*$/i,
];

/** Trim, strip trailing annotations left over once the numbers are gone, repeat until stable. */
function cleanName(s: string): string {
  let cur = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 5; i++) {
    let next = cur;
    for (const re of TRAILING_NOTE_PATTERNS) next = next.replace(re, '');
    next = next.trim().replace(/[-,:;.]+$/, '').trim();
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

function takeWeight(s: string): { rest: string; weightKg?: number } {
  for (const re of WEIGHT_PATTERNS) {
    const m = re.exec(s);
    if (m) return { rest: s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length), weightKg: toNumber(m[1]!) };
  }
  return { rest: s };
}

/** Whatever numbers are left once the first set-and-rep group was taken: a back-off set on the same line. */
function stripLeftoverNumbers(s: string): string {
  let out = s.replace(ANY_NUMBERS_RE, ' ');
  for (;;) {
    const { rest, weightKg } = takeWeight(out);
    if (weightKg === undefined) return out;
    out = rest;
  }
}

function extractLine(normalized: string): ExtractedLine {
  const { rest: s, weightKg } = takeWeight(normalized);

  const m = SETS_REPS_RE.exec(s);
  if (m) {
    const minutes = m[5] !== undefined;
    const scale = minutes ? 60 : 1;
    const repMin = Math.round(toNumber(m[2]!) * scale);
    const repMax = m[3] !== undefined ? Math.round(toNumber(m[3]) * scale) : repMin;
    const rest = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    const result: ExtractedLine = { hasNumbers: true, sets: Number(m[1]), repMin, repMax, name: cleanName(stripLeftoverNumbers(rest)) };
    if (m[4] !== undefined || minutes) result.seconds = true;
    if (weightKg !== undefined) result.weightKg = weightKg;
    return result;
  }

  const open = OPEN_REPS_RE.exec(s);
  if (open) {
    const rest = s.slice(0, open.index) + ' ' + s.slice(open.index + open[0].length);
    const result: ExtractedLine = { hasNumbers: true, sets: Number(open[1]), name: cleanName(stripLeftoverNumbers(rest)) };
    if (weightKg !== undefined) result.weightKg = weightKg;
    return result;
  }

  return { hasNumbers: false, name: cleanName(s) };
}

/**
 * "Bench press 3x10, Row 3x10" is two exercises. The cut between two set-and-rep groups goes at
 * the last comma, semicolon, "+" or " / " between them (so "Bench 3x8, 80kg, Row 3x10" keeps its
 * weight on the bench), else at the first " and " / " & " / " then " (so "Clean and press" in the
 * second name is not cut). No separator, or a piece left with no name ("1x5 @ 100kg, 3x8 @ 80kg"
 * is one exercise's top set and back-off) — the line stays whole.
 */
function splitCombined(s: string): string[] {
  const groups = [...s.matchAll(ANY_NUMBERS_RE)];
  if (groups.length < 2) return [s];
  const pieces: string[] = [];
  let from = 0;
  for (let i = 0; i < groups.length - 1; i++) {
    const gapStart = groups[i]!.index! + groups[i]![0].length;
    const gap = s.slice(gapStart, groups[i + 1]!.index!);
    const strong = [...gap.matchAll(/[,;+|]|\s\/\s/g)];
    const weak = /\s(?:and|&|then)\s/i.exec(gap);
    const sep = strong.length > 0 ? strong[strong.length - 1]! : weak;
    if (!sep) continue;
    pieces.push(s.slice(from, gapStart + sep.index!));
    from = gapStart + sep.index! + sep[0].length;
  }
  pieces.push(s.slice(from));
  const trimmed = pieces.map((p) => p.trim()).filter(Boolean);
  if (trimmed.length < 2 || trimmed.some((p) => !extractLine(p).name)) return [s];
  return trimmed;
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

  // Inside a "Warm-up:" / "Cool-down:" / "Notes:" block: its lines are not the routine.
  let inNoteBlock = false;

  const addExercise = (line: ParsedRoutineLine) => {
    if (!current) {
      current = { name: 'Pasted routine', exercises: [] };
      routines.push(current);
    }
    current.exercises.push(line);
  };

  const rawLines = (text ?? '').split(/\r\n|\r|\n/);
  for (const rawLine of rawLines) {
    if (rawLine.trim() === '') {
      prevWasBlank = true;
      inNoteBlock = false;
      continue;
    }
    const trimmedOriginal = rawLine.trim();
    const wasMarkdownHeadingMarker = MARKDOWN_HEADING_LINE_RE.test(trimmedOriginal);
    const wasFullyBold = FULLY_BOLD_LINE_RE.test(trimmedOriginal);

    let normalized = normaliseLine(rawLine);
    if (normalized === '') {
      prevWasBlank = true;
      inNoteBlock = false;
      continue;
    }
    const isFirstMeaningful = !seenMeaningful;
    const followsBlank = prevWasBlank;
    seenMeaningful = true;
    prevWasBlank = false;

    // A superset / section label: skipped, and the routine it sits in carries on.
    const label = SECTION_LABEL_RE.exec(normalized);
    if (label) {
      inNoteBlock = false;
      normalized = normalized.slice(label[0].length).trim();
      if (normalized === '' || ROUNDS_ONLY_RE.test(normalized)) continue;
    }

    if (NOTE_LINE_RE.test(normalized)) {
      ignored.push(rawLine);
      if (NOTE_BLOCK_RE.test(bareLabel(normalized))) inNoteBlock = true;
      continue;
    }

    const looksLikeHeading = wasMarkdownHeadingMarker || wasFullyBold || DAY_PREFIX_RE.test(normalized);
    // A block ends at a heading: marked as one, or a short "Upper A:" with no numbers of its own.
    const endsBlock =
      looksLikeHeading || (/:$/.test(normalized) && wordCount(normalized) <= 6 && !HAS_NUMBERS_RE.test(normalized));
    if (inNoteBlock && !endsBlock) {
      ignored.push(rawLine);
      continue;
    }
    inNoteBlock = false;

    const pieces = splitCombined(normalized);
    const extracted = pieces.map(extractLine);
    // A sentence that happens to hold a set count ("Do 3 sets to failure on the last exercise.")
    // is advice, not an exercise: once its numbers are gone it is still a sentence.
    const isSentence = /[.!?]$/.test(normalized) && wordCount(extracted[0]!.name) > 4;
    if (extracted[0]!.hasNumbers && isSentence) {
      ignored.push(rawLine);
      continue;
    }
    if (extracted[0]!.hasNumbers) {
      extracted.forEach((e, i) => {
        const line: ParsedRoutineLine = { raw: rawLine, name: e.name || pieces[i]! };
        if (e.sets !== undefined) line.sets = e.sets;
        if (e.repMin !== undefined) line.repMin = e.repMin;
        if (e.repMax !== undefined) line.repMax = e.repMax;
        if (e.seconds) line.seconds = true;
        if (e.weightKg !== undefined) line.weightKg = e.weightKg;
        addExercise(line);
      });
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
    const isHeading = !label && (isFirstMeaningful || followsBlank || endsWithColon || looksLikeHeading);
    if (isHeading) {
      current = { name: normalized.replace(/:$/, '').trim(), exercises: [] };
      routines.push(current);
      continue;
    }

    // Short, pattern-less line that is neither a heading nor prose — an exercise named with no
    // numbers at all, e.g. "Face pulls" sat in the middle of a list.
    addExercise({ raw: rawLine, name: extracted[0]!.name || normalized });
  }

  return { routines: routines.filter((r) => r.exercises.length > 0), ignored };
}
