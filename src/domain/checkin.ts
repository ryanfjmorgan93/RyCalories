/**
 * Fortnightly check-in (§9). Pure: builds the plain-text check-in and bodyweight stats
 * from data the screen has already loaded. No IO here.
 */
import { addDays } from './dates';
import { fmtNum, fmtRange, fmtReps, fmtWeight } from './format';
import type { Bodyweight, ExerciseKind, ProgressionMode } from './types';

export interface CheckInLift {
  name: string;
  /** Working weight in kg (added kg for bodyweight_plus); null when calibrating. */
  weight: number | null;
  mode: ProgressionMode;
  kind: ExerciseKind;
  repMin: number;
  repMax: number;
  targetSets: number;
  /** Working-set reps from the most recent completed session containing the lift. */
  lastSessionReps?: number[];
}

export interface CheckInNiggle {
  /** YYYY-MM-DD */
  date: string;
  tag: string;
  severity: number;
  note?: string;
}

export interface CheckInSession {
  /** YYYY-MM-DD */
  date: string;
  title: string;
}

export interface CheckInInput {
  /** Last day of the window, YYYY-MM-DD. */
  asOf: string;
  /** Window length in days, including asOf. */
  days: number;
  lifts: CheckInLift[];
  /** Every bodyweight reading; the window filter is applied here. */
  bodyweights: Bodyweight[];
  niggles: CheckInNiggle[];
  sessions: CheckInSession[];
}

export interface CheckInBodyweight {
  first: number | null;
  last: number | null;
  avg: number | null;
  delta: number | null;
  readings: number;
}

export interface CheckIn {
  text: string;
  bodyweight: CheckInBodyweight;
  /** Session titles in the window with counts, most frequent first. */
  sessionCounts: { title: string; count: number }[];
  /** First day of the window, YYYY-MM-DD. */
  from: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 Sep" or "8 Sep 2026" from a YYYY-MM-DD key. Deterministic (no locale/timezone). */
export function fmtDateKey(key: string, withYear = false): string {
  const [y, m, d] = key.split('-').map(Number);
  const month = MONTHS[(m ?? 1) - 1] ?? '';
  return withYear ? `${d} ${month} ${y}` : `${d} ${month}`;
}

/** Inclusive window start for `days` days ending on `asOf`. */
export function windowStart(asOf: string, days: number): string {
  return addDays(asOf, -(Math.max(1, days) - 1));
}

export function inWindow(date: string, asOf: string, days: number): boolean {
  const key = date.slice(0, 10);
  return key >= windowStart(asOf, days) && key <= asOf;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Signed delta: "+0.6", "-0.4", "0". */
export function fmtDelta(n: number): string {
  const r = round1(n);
  if (r > 0) return `+${fmtNum(r)}`;
  return fmtNum(r);
}

export function bodyweightStats(bodyweights: Bodyweight[], asOf: string, days: number): CheckInBodyweight {
  const inRange = bodyweights.filter((b) => inWindow(b.date, asOf, days)).sort((a, b) => a.date.localeCompare(b.date));
  if (inRange.length === 0) return { first: null, last: null, avg: null, delta: null, readings: 0 };
  const first = inRange[0].kg;
  const last = inRange[inRange.length - 1].kg;
  const avg = round1(inRange.reduce((s, b) => s + b.kg, 0) / inRange.length);
  return { first, last, avg, delta: round1(last - first), readings: inRange.length };
}

export function liftLine(l: CheckInLift): string {
  if (l.mode === 'calibrating' || l.weight === null) return `- ${l.name}: calibrating`;
  const parts = [fmtWeight(l.kind, l.weight), `${l.targetSets} × ${fmtRange(l.repMin, l.repMax)}`];
  if (l.lastSessionReps && l.lastSessionReps.length > 0) parts.push(`last ${fmtReps(l.lastSessionReps)}`);
  return `- ${l.name}: ${parts.join(' · ')}`;
}

export function sessionCounts(sessions: CheckInSession[]): { title: string; count: number }[] {
  const m = new Map<string, number>();
  for (const s of sessions) m.set(s.title, (m.get(s.title) ?? 0) + 1);
  return [...m.entries()].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count);
}

export function buildCheckIn(input: CheckInInput): CheckIn {
  const { asOf, days } = input;
  const from = windowStart(asOf, days);
  const bodyweight = bodyweightStats(input.bodyweights, asOf, days);
  const sessions = input.sessions.filter((s) => inWindow(s.date, asOf, days));
  const niggles = input.niggles.filter((n) => inWindow(n.date, asOf, days)).sort((a, b) => a.date.localeCompare(b.date));
  const counts = sessionCounts(sessions);

  const lines: string[] = [];
  lines.push(`Check-in – ${fmtDateKey(asOf, true)} (last ${days} days)`);

  lines.push('Lifts');
  if (input.lifts.length === 0) lines.push('- none');
  for (const l of input.lifts) lines.push(liftLine(l));

  lines.push('Bodyweight');
  if (bodyweight.readings === 0 || bodyweight.first === null || bodyweight.last === null || bodyweight.avg === null || bodyweight.delta === null) {
    lines.push('- none');
  } else {
    const n = bodyweight.readings;
    lines.push(
      `- ${fmtNum(bodyweight.first)} → ${fmtNum(bodyweight.last)} kg (${fmtDelta(bodyweight.delta)}), avg ${fmtNum(bodyweight.avg)} over ${n} reading${n === 1 ? '' : 's'}`,
    );
  }

  const breakdown = counts.length ? ` (${counts.map((c) => `${c.title} ×${c.count}`).join(', ')})` : '';
  lines.push(`Sessions: ${sessions.length}${breakdown}`);

  lines.push('Niggles');
  if (niggles.length === 0) lines.push('- none');
  for (const n of niggles) {
    lines.push(`- ${fmtDateKey(n.date)}: ${n.tag} (${n.severity})${n.note ? ` – ${n.note}` : ''}`);
  }

  return { text: lines.join('\n'), bodyweight, sessionCounts: counts, from };
}
