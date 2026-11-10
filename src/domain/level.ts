/**
 * An exercise's Level: the owner's best set against where they started on it. Pure: no IO, no
 * clock, no database.
 *
 * No open table ranks a cable row or a lateral raise against other people, and one gym's machine
 * is not another's, so a Level compares the owner only with themselves; squat, bench and deadlift
 * keep their real ranks beside it (standards.ts). A set's size is weight × (1 + reps ÷ 30): the
 * Epley shape, used only to put their own sets in order (more weight or more reps is more). It is
 * never shown as a one-rep max, so it holds at 15 reps where an e1RM would be a guess.
 *
 * The start is the best set of the first three sessions, so one light first day cannot make every
 * later level cheap. Each level is 5% over the start, and the % is rounded down.
 */
import { fmtWeight } from './format';
import type { RecordSession } from './records';
import { countsForRecords } from './sets';
import type { ExerciseKind } from './types';

/** How many sessions set the start. */
export const START_SESSIONS = 3;
/** The % over the start that each level takes. */
const STEP = 5;

interface LevelSet {
  weight: number;
  reps: number;
}

export interface Level {
  level: number;
  /** Whole % the best set is over the start, rounded down. */
  gainPct: number;
  /** 0 to under 1: how far the best set is from this level's line to the next. */
  fill: number;
  best: LevelSet;
  start: LevelSet;
  /** Sessions still to come before the start is set; 0 once it is. */
  startIn: number;
}

/**
 * Null for a carry or a hold (no reps), with no counted set, or for a bodyweight lift with no
 * weigh-in. `sessions` in any order; one with no counted set is not a session here.
 */
export function levelFor(kind: ExerciseKind, sessions: readonly RecordSession[], opts: { bodyweightKg?: number } = {}): Level | null {
  if (kind === 'carry' || kind === 'timed') return null;
  if (kind === 'bodyweight_plus' && opts.bodyweightKg === undefined) return null;
  const size = (s: LevelSet) => ((kind === 'bodyweight_plus' ? opts.bodyweightKg! : 0) + s.weight) * (1 + s.reps / 30);
  // By more than float noise: 20 × 10 and 25 × 2 are the same size, and the earlier of two equal sets stands.
  const bigger = (a: LevelSet, b: LevelSet) => size(a) > size(b) + 1e-9;
  // Each session's best set, oldest first.
  const bests = [...sessions]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .flatMap((session) => {
      let top: LevelSet | null = null;
      for (const s of session.sets) {
        if (!countsForRecords(s.type) || !s.reps || s.reps < 1) continue;
        const set = { weight: s.weight, reps: s.reps };
        if (size(set) > 0 && (top === null || bigger(set, top))) top = set;
      }
      return top ? [top] : [];
    });
  if (bests.length === 0) return null;
  const top = (sets: LevelSet[]) => sets.reduce((a, b) => (bigger(b, a) ? b : a));
  const best = top(bests);
  if (bests.length < START_SESSIONS) return { level: 1, gainPct: 0, fill: 0, best, start: best, startIn: START_SESSIONS - bests.length };
  const start = top(bests.slice(0, START_SESSIONS));
  const gain = (100 * (size(best) - size(start))) / size(start);
  const gainPct = Math.floor(gain + 1e-9);
  const level = 1 + Math.floor(gainPct / STEP);
  // gain is under the next level's line, so the bar is never full before the level is reached.
  return { level, gainPct, fill: Math.max(0, gain - (level - 1) * STEP) / STEP, best, start, startIn: 0 };
}

/** What the card says: the level, what it rests on, and the line the next one starts at. */
export function levelText(l: Level, kind: ExerciseKind): { head: string; detail: string; next: string | null } {
  const head = `Level ${l.level}`;
  const set = (s: LevelSet) => `${fmtWeight(kind, s.weight)} × ${s.reps}`;
  if (l.startIn > 0) return { head, detail: `your first ${START_SESSIONS} sessions set the start (${START_SESSIONS - l.startIn} done)`, next: null };
  const next = `Level ${l.level + 1} at ${l.level * STEP}%`;
  // The very set, not one as big: nothing has beaten the start yet.
  if (l.best === l.start) return { head, detail: `start ${set(l.start)}`, next };
  return { head, detail: `best ${set(l.best)}, ${l.gainPct}% over your start of ${set(l.start)}`, next };
}

/** The levels a change crossed, or null when it crossed none. */
export function levelUp(from: Level | null, to: Level | null): { from: number; to: number } | null {
  const was = from?.level ?? 1;
  return to && to.level > was ? { from: was, to: to.level } : null;
}
