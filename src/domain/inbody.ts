/**
 * InBody body-scan import: a CSV read into `BodyScan` rows, and the comparisons the Progress card
 * shows. Pure — no IO, no clock, no database.
 *
 * The parser is deliberately liberal about what it accepts and strict about what it keeps:
 *
 * - The file may start with a UTF-8 byte-order mark, use a comma, semicolon, tab or pipe, and put a
 *   few title lines above the header. The header row is the first one that has a date column and at
 *   least one measure; a file laid out the other way round (one column per scan) is read too.
 * - Headers are matched by meaning, not spelling: case, spaces, punctuation and a unit in brackets
 *   are all ignored, and each measure has the several names InBody's own exports, its result sheets
 *   and its phone app use ("Skeletal Muscle Mass", "SMM"; "Percent Body Fat", "PBF", "Body Fat %").
 *   Columns it does not know are ignored. See `SCALAR_ALIASES` and `segmentTarget` for the full set.
 * - A cell that is empty, "-" or "n/a" is missing, never zero. A value outside what a human body can
 *   be is dropped as missing rather than stored.
 * - Pounds, from the header ("Weight(lb)") or a units column, are converted to kilograms. A file
 *   with no unit anywhere is read as kilograms and says so.
 * - Dates may be `yyyyMMddHHmmss`, `yyyy.MM.dd`, ISO, `dd/MM/yyyy` or a written month. `03/04/2024`
 *   is ambiguous: it is read day first unless the same file proves month first, and either way the
 *   result carries a `dateNote` saying which. Times are taken as written, so a scan is on the
 *   calendar day the machine printed whatever the phone's time zone is.
 * - One scan per date: when two rows share a date the later scan of the day wins (or the later row,
 *   when neither has a time), and the other is reported as skipped.
 */
import Papa from 'papaparse';
import { round2 } from './bodyweight';
import { daysBetween } from './dates';
import type { BodyLimb, BodyScan } from './types';

export type ParsedScan = Omit<BodyScan, 'id' | 'importedAt'>;

export interface SkippedRow {
  /** 1-based line of the file (the header is the first line of a plain file). 0 means the file as a whole. */
  row: number;
  reason: string;
}

export interface ParsedInbody {
  /** Oldest first, at most one per date. */
  scans: ParsedScan[];
  skipped: SkippedRow[];
  /** What was assumed or converted about units, when anything was. */
  unitsNote?: string;
  /** Which way round an ambiguous date such as 03/04/2024 was read, when the file had one. */
  dateNote?: string;
}

// ---------------------------------------------------------------------------
// Bytes to text

/**
 * File bytes as text. UTF-16 files (what Excel's "Unicode text" writes) are told apart by their
 * byte-order mark; everything else is UTF-8, falling back to Windows-1252 when the bytes are not
 * valid UTF-8 (a CSV saved by an old Windows tool). The UTF-8 BOM is left for the parser to strip.
 */
export function decodeInbodyBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// ---------------------------------------------------------------------------
// Headers

type Unit = 'kg' | 'lb' | 'pct' | 'l' | 'kcal' | 'kj' | 'cm2' | 'other';

type ScalarField =
  | 'weightKg'
  | 'skeletalMuscleKg'
  | 'bodyFatKg'
  | 'bodyFatPct'
  | 'leanMassKg'
  | 'totalBodyWaterL'
  | 'bmrKcal'
  | 'visceralFatLevel'
  | 'ecwRatio'
  | 'inbodyScore'
  | 'phaseAngle';

type SegKind = 'lean' | 'fat';

type Target =
  | { type: 'date' }
  | { type: 'time' }
  | { type: 'unit' }
  | { type: 'scalar'; field: ScalarField }
  | { type: 'seg'; kind: SegKind; limb: BodyLimb };

interface Column {
  index: number;
  target: Target;
  unit: Unit | null;
  /** Lower is a better match when two columns claim the same target. */
  rank: number;
  /** The header text as it was written, for notes. */
  label: string;
}

function classifyUnit(inner: string): Unit {
  const u = inner.toLowerCase().replace(/\s+/g, '').replace(/²/g, '2');
  if (/^(kg|kgs|kilo|kilos|kilogram|kilograms)$/.test(u)) return 'kg';
  if (/^(lb|lbs|pound|pounds)$/.test(u)) return 'lb';
  if (u === '%' || /^(pct|percent|percentage)$/.test(u)) return 'pct';
  if (/^(l|litre|litres|liter|liters)$/.test(u)) return 'l';
  if (/^(kcal|cal|calories)$/.test(u)) return 'kcal';
  if (u === 'kj') return 'kj';
  if (u === 'cm2') return 'cm2';
  return 'other';
}

/**
 * A header reduced to its words and its unit: "Percent Body Fat(%)" is `percent body fat` + pct,
 * "SkeletalMuscleMass_kg" is `skeletal muscle mass` + kg, "ECW/TBW" is `ecw tbw`.
 */
export function normaliseHeader(raw: string): { words: string; unit: Unit | null } {
  let s = raw.replace(/^﻿/, '').trim();
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  let unit: Unit | null = null;
  for (const m of s.matchAll(/[(\[]([^)\]]*)[)\]]/g)) {
    const u = classifyUnit(m[1]);
    if (unit === null || unit === 'other') unit = u;
  }
  s = s.replace(/[(\[][^)\]]*[)\]]/g, ' ');
  if (s.includes('%')) {
    unit = unit ?? 'pct';
    s = s.replace(/%/g, ' ');
  }
  const words = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const last = words[words.length - 1];
  if (words.length > 1 && last && /^(kg|kgs|lb|lbs|pounds|kilograms)$/.test(last)) {
    if (unit === null) unit = classifyUnit(last);
    words.pop();
  }
  return { words: words.join(' ').replace(/\bin body\b/g, 'inbody'), unit };
}

/** Whole-body measures. Earlier names in a list are the better match. */
const SCALAR_ALIASES: [ScalarField, string[]][] = [
  ['weightKg', ['weight', 'body weight', 'bodyweight', 'wt', 'weight total']],
  ['skeletalMuscleKg', ['skeletal muscle mass', 'smm', 'skeletal muscle', 'skeletal muscle weight', 'sk muscle mass', 'muscle mass', 'muscle']],
  ['bodyFatKg', ['body fat mass', 'bfm', 'fat mass', 'body fat weight', 'body fat kg']],
  [
    'bodyFatPct',
    [
      'percent body fat',
      'pbf',
      'body fat percentage',
      'body fat percent',
      'percentage body fat',
      'body fat pct',
      'body fat rate',
      'body fat ratio',
      'fat percentage',
      'fat percent',
      'bf percent',
    ],
  ],
  ['leanMassKg', ['lean body mass', 'lbm', 'fat free mass', 'ffm', 'lean mass', 'lean body weight']],
  ['totalBodyWaterL', ['total body water', 'tbw', 'body water', 'total water']],
  ['bmrKcal', ['bmr', 'basal metabolic rate', 'basal metabolism', 'metabolic rate', 'basal metabolic rate bmr']],
  ['visceralFatLevel', ['visceral fat level', 'vfl', 'visceral fat', 'visceral fat rating', 'visceral fat grade', 'visceral level']],
  [
    'ecwRatio',
    ['ecw tbw', 'ecw tbw ratio', 'ecw ratio', 'ecw to tbw', 'ecw tbw analysis', 'extracellular water ratio', 'extracellular water total body water'],
  ],
  ['inbodyScore', ['inbody score', 'inbody points', 'inbody point', 'inbody pt', 'score', 'body score']],
  ['phaseAngle', ['phase angle', 'pha']],
];

const SCALAR_BY_WORDS = new Map<string, { field: ScalarField; rank: number }>();
for (const [field, names] of SCALAR_ALIASES) names.forEach((n, i) => SCALAR_BY_WORDS.set(n, { field, rank: i }));

/** "Body fat" with nothing else: a mass in kg or lb, a percentage with %, and a guess without. */
const BARE_FAT = new Set(['body fat', 'fat', 'bf']);

const DATE_NAMES: [string, number][] = [
  ['test date time', 0],
  ['test datetime', 0],
  ['date time', 1],
  ['datetime', 1],
  ['test date', 1],
  ['measurement date', 1],
  ['scan date', 1],
  ['date of test', 1],
  ['date of measurement', 1],
  ['measured at', 1],
  ['tested at', 1],
  ['date', 2],
  ['timestamp', 3],
  ['time stamp', 3],
  ['recorded at', 3],
  ['created at', 4],
];
const DATE_BY_WORDS = new Map(DATE_NAMES);

const TIME_NAMES = new Set(['time', 'test time', 'time of test', 'measurement time', 'scan time']);
const UNIT_NAMES = new Set(['unit', 'units', 'weight unit', 'weight units', 'mass unit', 'unit of measure', 'unit of weight', 'uom', 'measurement unit']);

const NOT_A_SEGMENT_MEASURE = new Set(['percent', 'percentage', 'pct', 'ratio', 'ecw', 'tbw', 'evaluation', 'rate', 'ideal', 'normal', 'control', 'target']);

/** Which segment a header names, when it is a limb or trunk lean or fat mass. */
function segmentTarget(words: string, unit: Unit | null): Target | null {
  if (unit === 'pct') return null;
  const t = words.split(' ');
  if (t.some((w) => NOT_A_SEGMENT_MEASURE.has(w))) return null;
  const has = (w: string) => t.includes(w);
  const arm = has('arm') || has('arms');
  const leg = has('leg') || has('legs');
  const right = has('right') || has('r') || has('ra') || has('rl');
  const left = has('left') || has('l') || has('la') || has('ll');
  let limb: BodyLimb | null = null;
  if (has('trunk') || has('torso') || has('tr')) limb = 'trunk';
  else if (has('ra') || (right && arm)) limb = 'rightArm';
  else if (has('la') || (left && arm)) limb = 'leftArm';
  else if (has('rl') || (right && leg)) limb = 'rightLeg';
  else if (has('ll') || (left && leg)) limb = 'leftLeg';
  if (!limb) return null;
  const lean = has('lean');
  const fat = has('fat');
  if (lean === fat) return null;
  return { type: 'seg', kind: lean ? 'lean' : 'fat', limb };
}

function matchHeader(raw: string, index: number): Column | null {
  const { words, unit } = normaliseHeader(raw);
  if (!words) return null;
  const col = (target: Target, rank: number, u: Unit | null = unit): Column => ({ index, target, unit: u, rank, label: raw.trim() });

  const dateRank = DATE_BY_WORDS.get(words);
  if (dateRank !== undefined) return col({ type: 'date' }, dateRank);
  if (TIME_NAMES.has(words)) return col({ type: 'time' }, 0);
  if (UNIT_NAMES.has(words)) return col({ type: 'unit' }, 0);
  // "Date of birth" and its kin are not the date of a scan; any other header that says date or time is a weak candidate.
  const tokens = words.split(' ');
  if (tokens.some((w) => w === 'birth' || w === 'dob' || w === 'born' || w === 'age')) return null;

  if (BARE_FAT.has(words)) {
    const mass = unit === 'kg' || unit === 'lb';
    return col({ type: 'scalar', field: mass ? 'bodyFatKg' : 'bodyFatPct' }, 9);
  }
  const scalar = SCALAR_BY_WORDS.get(words);
  if (scalar) {
    if (scalar.field === 'visceralFatLevel' && unit === 'cm2') return null; // visceral fat AREA, a different measure
    return col({ type: 'scalar', field: scalar.field }, scalar.rank);
  }
  if (words.startsWith('phase angle') && !segmentTarget(words, unit)) {
    const wholeBody = tokens.includes('wb') || tokens.includes('whole') || tokens.some((w) => w.startsWith('50'));
    const limbed = tokens.some((w) => ['right', 'left', 'arm', 'leg', 'trunk', 'ra', 'la', 'rl', 'll'].includes(w));
    if (limbed) return null;
    return col({ type: 'scalar', field: 'phaseAngle' }, wholeBody ? 1 : 5);
  }
  const seg = segmentTarget(words, unit);
  if (seg) return col(seg, 0);
  if (tokens.includes('date') || tokens.includes('timestamp')) return col({ type: 'date' }, 8);
  return null;
}

function targetKey(t: Target): string {
  switch (t.type) {
    case 'scalar':
      return `scalar:${t.field}`;
    case 'seg':
      return `seg:${t.kind}:${t.limb}`;
    default:
      return t.type;
  }
}

interface Layout {
  headerIndex: number;
  columns: Map<string, Column>;
}

function layoutOf(headerRow: string[], headerIndex: number): Layout | null {
  const best = new Map<string, Column>();
  headerRow.forEach((raw, i) => {
    const c = matchHeader(raw ?? '', i);
    if (!c) return;
    const key = targetKey(c.target);
    const cur = best.get(key);
    if (!cur || c.rank < cur.rank) best.set(key, c);
  });
  if (!best.has('date')) return null;
  let measures = 0;
  for (const k of best.keys()) if (k.startsWith('scalar:') || k.startsWith('seg:')) measures++;
  if (measures === 0) return null;
  return { headerIndex, columns: best };
}

// ---------------------------------------------------------------------------
// Cells

const MISSING = new Set(['', '-', '--', '---', '—', '–', 'n/a', 'na', 'n.a.', 'null', 'none', 'nan', '#n/a', '*']);

function isMissing(cell: string | undefined): boolean {
  return cell === undefined || MISSING.has(cell.trim().toLowerCase());
}

/** What the rest of the file and the column say about a number whose comma could be either kind. */
interface NumberContext {
  /** The file writes decimals with a comma somewhere (a cell like "80,5" or "0,385"). */
  decimalComma: boolean;
  /** Whether a reading is believable for the column it sits in, in the unit the cell is written in. */
  plausible?: (n: number) => boolean;
}

/** The number at the start of a cell, as written: "80.5", "80,5", "1,650", "22 %", "81.4 kg". */
const NUMBER_TOKEN = /^[+-]?\d[\d,]*(?:[.,]\d+)?|^[+-]?\.\d+/;

/**
 * A cell that can only be a decimal comma: one or two digits after the comma ("80,5", "22,40"),
 * four or more, or a leading zero ("0,385"). Three digits after a comma is the one case that could
 * be either, so it is not evidence.
 */
const UNAMBIGUOUS_DECIMAL_COMMA = /^[+-]?(?:0,\d+|\d+,(?:\d{1,2}|\d{4,}))(?![\d,.])/;

function writesDecimalComma(cell: string | undefined): boolean {
  return !isMissing(cell) && UNAMBIGUOUS_DECIMAL_COMMA.test(cell!.trim());
}

/**
 * A number from a cell. Missing or unreadable is undefined.
 *
 * "1,650" is the awkward one: a thousands separator in a file that writes decimals with a dot, a
 * decimal comma in one that does not. A leading zero settles it ("0,385" is a ratio, never 385).
 * Otherwise it is thousands when the number is believable for its column as thousands (1,840 kcal,
 * not 1.84), or when nothing else in the file writes a decimal comma; in a decimal-comma file a
 * reading that is not believable as thousands ("81,250" kg) is the decimal it looks like.
 */
function parseNumber(cell: string | undefined, ctx: NumberContext): number | undefined {
  if (isMissing(cell)) return undefined;
  const m = NUMBER_TOKEN.exec(cell!.trim());
  if (!m) return undefined;
  let s = m[0];
  const grouped = /^[+-]?(\d{1,3})((?:,\d{3})+)(\.\d+)?$/.exec(s);
  if (grouped) {
    const head = grouped[1]!;
    const groups = grouped[2]!;
    const fraction = grouped[3];
    const asThousands = Number(s.replace(/,/g, ''));
    const couldBeDecimal = groups.length === 4 && fraction === undefined;
    const decimal = couldBeDecimal && (Number(head) === 0 || (ctx.decimalComma && !(ctx.plausible?.(asThousands) ?? false)));
    s = decimal ? s.replace(',', '.') : s.replace(/,/g, '');
  } else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const LB_TO_KG = 0.45359237;

/** Bounds a real adult reading falls inside, in the unit stored. Anything outside is a misread cell, not a body. */
const BOUNDS: Record<ScalarField, [number, number]> = {
  weightKg: [20, 400],
  skeletalMuscleKg: [5, 120],
  bodyFatKg: [0.5, 250],
  bodyFatPct: [1, 75],
  leanMassKg: [10, 250],
  totalBodyWaterL: [10, 200],
  bmrKcal: [500, 6000],
  visceralFatLevel: [0, 40],
  ecwRatio: [0.2, 0.6],
  inbodyScore: [0, 120],
  phaseAngle: [1, 20],
};
const SEG_BOUNDS: Record<SegKind, [number, number]> = { lean: [0.1, 70], fat: [0, 60] };

const MASS_SCALARS = new Set<ScalarField>(['weightKg', 'skeletalMuscleKg', 'bodyFatKg', 'leanMassKg', 'totalBodyWaterL']);

function within(n: number, [lo, hi]: [number, number]): number | undefined {
  return n >= lo && n <= hi ? n : undefined;
}

// ---------------------------------------------------------------------------
// Dates

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

interface Clock {
  h: number;
  mi: number;
  s: number;
}

type RawDate =
  | { kind: 'ymd'; y: number; mo: number; d: number; time?: Clock }
  | { kind: 'xy'; a: number; b: number; y: number; dotted: boolean; time?: Clock };

const TIME_TAIL = '(?:[ T,]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:\\.\\d+)?\\s*([AaPp][Mm])?\\s*(?:Z|[+-]\\d{2}:?\\d{2})?)?\\.?$';
const RE_YMD = new RegExp(`^(\\d{4})[./\\-](\\d{1,2})[./\\-](\\d{1,2})${TIME_TAIL}`);
const RE_XY = new RegExp(`^(\\d{1,2})([./\\-])(\\d{1,2})[./\\-](\\d{4}|\\d{2})${TIME_TAIL}`);
const RE_DMON = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?[ \\-.]+([A-Za-z]{3,9})\\.?,?[ \\-.]+(\\d{4})${TIME_TAIL}`);
const RE_MONDY = new RegExp(`^([A-Za-z]{3,9})\\.? +(\\d{1,2})(?:st|nd|rd|th)?,? +(\\d{4})${TIME_TAIL}`);
const RE_COMPACT = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/;

function clockOf(h: string | undefined, mi: string | undefined, s: string | undefined, ampm: string | undefined): Clock | undefined {
  if (h === undefined || mi === undefined) return undefined;
  let hh = Number(h);
  if (ampm) {
    const pm = ampm.toLowerCase() === 'pm';
    if (hh < 1 || hh > 12) return undefined;
    hh = (hh % 12) + (pm ? 12 : 0);
  }
  const clock = { h: hh, mi: Number(mi), s: s === undefined ? 0 : Number(s) };
  return clock.h <= 23 && clock.mi <= 59 && clock.s <= 59 ? clock : undefined;
}

function monthNumber(name: string): number | null {
  const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return i === -1 ? null : i + 1;
}

function readDateCell(raw: string): RawDate | null {
  const text = raw.trim();
  let m = RE_COMPACT.exec(text);
  if (m) {
    const time = clockOf(m[4], m[5], m[6] ?? '0', undefined);
    return { kind: 'ymd', y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), ...(m[4] !== undefined && time ? { time } : {}) };
  }
  m = RE_YMD.exec(text);
  if (m) {
    const time = clockOf(m[4], m[5], m[6], m[7]);
    return { kind: 'ymd', y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), ...(time ? { time } : {}) };
  }
  m = RE_XY.exec(text);
  if (m) {
    const time = clockOf(m[5], m[6], m[7], m[8]);
    const year = Number(m[4]);
    return { kind: 'xy', a: Number(m[1]), b: Number(m[3]), y: year < 100 ? 2000 + year : year, dotted: m[2] === '.', ...(time ? { time } : {}) };
  }
  m = RE_DMON.exec(text);
  if (m) {
    const mo = monthNumber(m[2]);
    if (!mo) return null;
    const time = clockOf(m[4], m[5], m[6], m[7]);
    return { kind: 'ymd', y: Number(m[3]), mo, d: Number(m[1]), ...(time ? { time } : {}) };
  }
  m = RE_MONDY.exec(text);
  if (m) {
    const mo = monthNumber(m[1]);
    if (!mo) return null;
    const time = clockOf(m[4], m[5], m[6], m[7]);
    return { kind: 'ymd', y: Number(m[3]), mo, d: Number(m[2]), ...(time ? { time } : {}) };
  }
  return null;
}

type DateOrder = 'dmy' | 'mdy';

interface ResolvedDate {
  key: string;
  takenAt?: string;
}

function resolveDate(raw: RawDate, order: DateOrder, timeOnly?: Clock): ResolvedDate | null {
  let y: number;
  let mo: number;
  let d: number;
  if (raw.kind === 'ymd') ({ y, mo, d } = raw);
  else {
    y = raw.y;
    const dayFirst = raw.dotted || raw.a > 12 || (raw.b <= 12 && order === 'dmy');
    if (dayFirst) {
      d = raw.a;
      mo = raw.b;
    } else {
      mo = raw.a;
      d = raw.b;
    }
  }
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const check = new Date(y, mo - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== mo - 1 || check.getDate() !== d) return null;
  const key = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const time = raw.time ?? timeOnly;
  return time ? { key, takenAt: new Date(y, mo - 1, d, time.h, time.mi, time.s).toISOString() } : { key };
}

function readTimeCell(raw: string | undefined): Clock | undefined {
  if (isMissing(raw)) return undefined;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(raw!.trim());
  return m ? clockOf(m[1], m[2], m[3], m[4]) : undefined;
}

// ---------------------------------------------------------------------------
// Delimiter and rows

/** The delimiter a text uses, judged on the lines that look like a table. Comma when nothing else fits. */
function detectDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 12);
  let best = ',';
  let bestScore = -1;
  for (const cand of [',', ';', '\t', '|']) {
    const counts = lines.map((line) => {
      let inQuotes = false;
      let n = 0;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === cand && !inQuotes) n++;
      }
      return n;
    });
    const tally = new Map<number, number>();
    for (const n of counts) if (n > 0) tally.set(n, (tally.get(n) ?? 0) + 1);
    let mode = 0;
    let modeLines = 0;
    for (const [n, c] of tally) if (c > modeLines || (c === modeLines && n > mode)) [mode, modeLines] = [n, c];
    // Lines that agree on the count matter most; a decimal comma in a semicolon file disagrees line to line.
    const score = modeLines * 1000 + mode;
    if (mode > 0 && score > bestScore) {
      best = cand;
      bestScore = score;
    }
  }
  return best;
}

interface FileRow {
  /** 1-based line in the file. */
  line: number;
  cells: string[];
}

function readRows(text: string): FileRow[] {
  let body = text.replace(/^﻿/, '');
  let delimiter: string | undefined;
  const sep = /^\s*sep=(.)\r?\n/i.exec(body);
  let lineOffset = 0;
  if (sep) {
    delimiter = sep[1];
    body = body.slice(sep[0].length);
    lineOffset = 1;
  }
  delimiter ??= detectDelimiter(body);
  const result = Papa.parse<string[]>(body, { delimiter, skipEmptyLines: false });
  const rows: FileRow[] = [];
  result.data.forEach((cells, i) => {
    if (cells.every((c) => c.trim() === '')) return;
    rows.push({ line: i + 1 + lineOffset, cells: cells.map((c) => c.trim()) });
  });
  return rows;
}

function transpose(rows: FileRow[]): FileRow[] {
  const width = Math.max(0, ...rows.map((r) => r.cells.length));
  const out: FileRow[] = [];
  for (let c = 0; c < width; c++) out.push({ line: c + 1, cells: rows.map((r) => r.cells[c] ?? '') });
  return out;
}

function findLayout(rows: FileRow[]): Layout | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const layout = layoutOf(rows[i].cells, i);
    if (layout) return layout;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The parser

interface Candidate {
  scan: ParsedScan;
  row: number;
  takenMs: number | null;
}

/** Parse the text of an InBody CSV export into scans. Never throws on bad input; it reports it. */
export function parseInbodyCsv(text: string): ParsedInbody {
  const rows = readRows(text);
  if (rows.length === 0) return { scans: [], skipped: [{ row: 0, reason: 'The file is empty' }] };

  let layout = findLayout(rows);
  let table = rows;
  if (!layout) {
    const turned = transpose(rows);
    const turnedLayout = findLayout(turned);
    if (turnedLayout) {
      layout = turnedLayout;
      table = turned;
    }
  }
  if (!layout) {
    const headers = rows[0].cells.filter(Boolean).slice(0, 8).join(', ');
    return {
      scans: [],
      skipped: [{ row: 0, reason: `No date column and measures found. First line: ${headers.length > 160 ? `${headers.slice(0, 160)}…` : headers}` }],
    };
  }

  const dateCol = layout.columns.get('date')!;
  const timeCol = layout.columns.get('time');
  const unitCol = layout.columns.get('unit');
  const data = table.slice(layout.headerIndex + 1);

  // First pass over the dates: which way round do the written ones go?
  const rawDates = data.map((r) => (isMissing(r.cells[dateCol.index]) ? null : readDateCell(r.cells[dateCol.index])));
  let dayFirstProved = false;
  let monthFirstProved = false;
  let ambiguousSample: string | null = null;
  for (let i = 0; i < data.length; i++) {
    const rd = rawDates[i];
    if (!rd || rd.kind !== 'xy' || rd.dotted) continue;
    if (rd.a > 12 && rd.b <= 12) dayFirstProved = true;
    else if (rd.b > 12 && rd.a <= 12) monthFirstProved = true;
    else if (rd.a <= 12 && rd.b <= 12 && rd.a !== rd.b && ambiguousSample === null) ambiguousSample = data[i].cells[dateCol.index].split(/[ T]/)[0];
  }
  const order: DateOrder = monthFirstProved && !dayFirstProved ? 'mdy' : 'dmy';

  // Does this file write its decimals with a comma? Decides what a bare "1,250" means.
  const measureCols = [...layout.columns.values()].filter((c) => c.target.type === 'scalar' || c.target.type === 'seg');
  const decimalComma = data.some((r) => measureCols.some((c) => writesDecimalComma(r.cells[c.index])));

  const skipped: SkippedRow[] = [];
  const candidates: Candidate[] = [];
  const assumedKg = new Set<string>();
  const seen = { pounds: false };

  data.forEach((r, i) => {
    const cell = (c: Column | undefined) => (c ? r.cells[c.index] : undefined);
    const dateText = cell(dateCol);
    const raw = rawDates[i];
    if (isMissing(dateText)) {
      skipped.push({ row: r.line, reason: 'No date' });
      return;
    }
    const resolved = raw ? resolveDate(raw, order, readTimeCell(cell(timeCol))) : null;
    if (!resolved) {
      skipped.push({ row: r.line, reason: `Date "${dateText!.length > 40 ? `${dateText!.slice(0, 40)}…` : dateText}" is not one I can read` });
      return;
    }

    const rowUnitText = unitCol ? (cell(unitCol) ?? '').toLowerCase() : '';
    const rowUnit: Unit | null = /\b(lb|lbs|pound|pounds)\b/.test(rowUnitText) ? 'lb' : /\b(kg|kgs|kilo|kilogram|kilograms)\b/.test(rowUnitText) ? 'kg' : null;

    /** The unit a mass cell is written in: from the header, then the row's units column; null when neither says. */
    const massUnit = (col: Column): Unit | null => (col.unit === 'kg' || col.unit === 'lb' ? col.unit : rowUnit);
    /** kg from a mass cell, converting pounds. */
    const asKg = (col: Column, n: number): number => (massUnit(col) === 'lb' ? round2(n * LB_TO_KG) : n);
    /** Remember what the note should say about a mass cell: pounds were converted, or kilograms were assumed because no unit was given. */
    const noteMass = (col: Column, assume = true): void => {
      const unit = massUnit(col);
      if (unit === 'lb') seen.pounds = true;
      else if (unit === null && assume) assumedKg.add(col.label);
    };
    /** A scalar cell's number as stored: kilograms for a mass, litres for water, kcal for energy, a ratio for ECW. */
    const stored = (col: Column, field: ScalarField, n: number): number => {
      // Litres in a kg file, pounds in a pounds file; a litre of water weighs a kilogram.
      if (field === 'totalBodyWaterL') return col.unit === 'l' ? n : asKg(col, n);
      if (MASS_SCALARS.has(field)) return asKg(col, n);
      if (field === 'bmrKcal' && col.unit === 'kj') return Math.round(n / 4.184);
      if (field === 'ecwRatio' && n > 1 && n <= 100) return n / 100;
      return n;
    };

    const scan: ParsedScan = { date: resolved.key, source: 'csv' };
    if (resolved.takenAt) scan.takenAt = resolved.takenAt;
    let measures = 0;
    const put = (field: ScalarField, value: number) => {
      const ok = within(value, BOUNDS[field]);
      if (ok === undefined) return;
      Object.assign(scan, { [field]: ok });
      measures++;
    };

    for (const col of layout!.columns.values()) {
      if (col.target.type === 'scalar') {
        const field = col.target.field;
        const n = parseNumber(cell(col), { decimalComma, plausible: (v) => within(stored(col, field, v), BOUNDS[field]) !== undefined });
        if (n === undefined) continue;
        if (field === 'totalBodyWaterL') {
          if (col.unit !== 'l') noteMass(col, false);
        } else if (MASS_SCALARS.has(field)) noteMass(col);
        put(field, Math.round(stored(col, field, n) * 1000) / 1000);
      } else if (col.target.type === 'seg') {
        const bounds = SEG_BOUNDS[col.target.kind];
        const n = parseNumber(cell(col), { decimalComma, plausible: (v) => within(asKg(col, v), bounds) !== undefined });
        if (n === undefined) continue;
        noteMass(col);
        const kg = within(asKg(col, n), bounds);
        if (kg === undefined) continue;
        const key = col.target.kind === 'lean' ? 'segmentalLeanKg' : 'segmentalFatKg';
        scan[key] = { ...(scan[key] ?? {}), [col.target.limb]: kg };
        measures++;
      }
    }

    if (measures === 0) {
      skipped.push({ row: r.line, reason: 'No readable measurements' });
      return;
    }
    candidates.push({ scan, row: r.line, takenMs: resolved.takenAt ? Date.parse(resolved.takenAt) : null });
  });

  // One scan per date: the later scan of the day wins, or the later row when the times are unknown or equal.
  const byDate = new Map<string, Candidate>();
  for (const c of candidates) {
    const held = byDate.get(c.scan.date);
    if (!held) {
      byDate.set(c.scan.date, c);
      continue;
    }
    const timed = c.takenMs !== null && held.takenMs !== null && c.takenMs !== held.takenMs;
    const newWins = timed ? c.takenMs! > held.takenMs! : true;
    const [winner, loser] = newWins ? [c, held] : [held, c];
    skipped.push({
      row: loser.row,
      reason: timed ? `Same date as row ${winner.row}; the later scan of the day is kept` : `Same date as row ${winner.row}; the last row for a date is kept`,
    });
    byDate.set(c.scan.date, winner);
  }
  skipped.sort((a, b) => a.row - b.row);
  const scans = [...byDate.values()].map((c) => c.scan).sort((a, b) => a.date.localeCompare(b.date));

  const notes: string[] = [];
  if (seen.pounds) notes.push('Weights converted from pounds to kilograms.');
  if (assumedKg.size > 0) {
    const names = [...assumedKg].slice(0, 3).join(', ');
    notes.push(`No unit given for ${names}${assumedKg.size > 3 ? ' and others' : ''}; read as kilograms.`);
  }
  const bareFat = [...layout.columns.values()].find((c) => c.target.type === 'scalar' && c.target.field === 'bodyFatPct' && c.unit === null && BARE_FAT.has(normaliseHeader(c.label).words));
  if (bareFat) notes.push(`"${bareFat.label}" has no unit; read as a percentage.`);

  const result: ParsedInbody = { scans, skipped };
  if (notes.length) result.unitsNote = notes.join(' ');
  if (ambiguousSample !== null) {
    result.dateNote =
      order === 'dmy'
        ? `Dates like ${ambiguousSample} were read day first.`
        : `Dates like ${ambiguousSample} were read month first, because the file has dates that cannot be day first.`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Comparisons

export type ScanFigures = Pick<BodyScan, 'date' | 'weightKg' | 'skeletalMuscleKg' | 'bodyFatKg' | 'bodyFatPct'>;

/** Latest minus earlier for each headline measure; null when either scan lacks it. */
export interface ScanChange {
  weightKg: number | null;
  skeletalMuscleKg: number | null;
  bodyFatKg: number | null;
  bodyFatPct: number | null;
}

export interface ScanComparison<T extends ScanFigures> {
  /** The earlier scan compared against. */
  scan: T;
  /** Whole days between the two scans. */
  days: number;
  change: ScanChange;
}

export interface ScanDeltas<T extends ScanFigures> {
  latest: T | null;
  vsPrevious: ScanComparison<T> | null;
  /** The scan closest to eight weeks before the latest, from six to ten weeks back; null when there is none. */
  vsEightWeeks: ScanComparison<T> | null;
}

const EIGHT_WEEKS = { min: 42, target: 56, max: 70 };

function diff(a: number | undefined, b: number | undefined): number | null {
  return a === undefined || b === undefined ? null : round2(a - b);
}

function compare<T extends ScanFigures>(latest: T, earlier: T): ScanComparison<T> {
  return {
    scan: earlier,
    days: daysBetween(earlier.date, latest.date),
    change: {
      weightKg: diff(latest.weightKg, earlier.weightKg),
      skeletalMuscleKg: diff(latest.skeletalMuscleKg, earlier.skeletalMuscleKg),
      bodyFatKg: diff(latest.bodyFatKg, earlier.bodyFatKg),
      bodyFatPct: diff(latest.bodyFatPct, earlier.bodyFatPct),
    },
  };
}

/** How the newest scan differs from the one before it and from the one about eight weeks back. Any order in; one scan per date assumed. */
export function scanDeltas<T extends ScanFigures>(scans: readonly T[]): ScanDeltas<T> {
  const sorted = [...scans].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  if (!latest) return { latest: null, vsPrevious: null, vsEightWeeks: null };
  const older = sorted.slice(0, -1);
  const previous = older[older.length - 1];
  let eight: T | null = null;
  let eightGap = Infinity;
  for (const s of older) {
    const days = daysBetween(s.date, latest.date);
    if (days < EIGHT_WEEKS.min || days > EIGHT_WEEKS.max) continue;
    const gap = Math.abs(days - EIGHT_WEEKS.target);
    if (gap <= eightGap) {
      eight = s;
      eightGap = gap;
    }
  }
  return {
    latest,
    vsPrevious: previous ? compare(latest, previous) : null,
    vsEightWeeks: eight ? compare(latest, eight) : null,
  };
}
