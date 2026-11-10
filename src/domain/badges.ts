/**
 * Badges: the marks the owner has passed, and the next one on each ladder. Pure: no IO, no clock,
 * no database.
 *
 * Nothing here is stored. A badge is read off what was trained, so it follows the data: a set
 * corrected or a session deleted takes back what only it had reached. What is left "to go" is
 * rounded up, never down.
 *
 * Four kinds of ladder: sessions finished, tonnes lifted (the sum of every summary's "kg lifted"),
 * the total level (level.ts), and, for a barbell lift, the heaviest counted set in 20 kg steps
 * from a plate a side. A barbell is the same 20 kg bar everywhere; a machine's stack is not.
 */
import { fmtKg, fmtNum } from './format';

export interface BadgeFacts {
  /** Sessions finished with at least one set that counts. */
  sessions: number;
  /** kg × reps over every set that counts for volume. */
  liftedKg: number;
  totalLevel: number;
  /** Barbell lifts, each with its heaviest counted set. */
  lifts: { id: string; name: string; kg: number }[];
}

export interface Ladder {
  id: string;
  title: string;
  /** The badges held, lowest first: "10 sessions", "100 kg Bench Press (Barbell)". */
  earned: string[];
  /** The same marks as they sit on the ladder: "10", "100 kg". */
  chips: string[];
  /** The next mark, what is left to it, and how far from the last mark it is (0 to under 1). */
  next: { name: string; chip: string; toGo: string; done: number } | null;
}

const SESSIONS = [10, 25, 50, 100, 250, 500];
const TONNES = [10, 50, 100, 250, 500, 1000];
const LEVELS = [5, 10, 15, 25, 35, 50, 75, 100];
/** One plate a side on a 20 kg bar, then every 20 kg. */
const PLATES = [60, 80, 100, 120, 140, 160, 180, 200, 220];

function ladder(
  id: string,
  title: string,
  marks: readonly number[],
  value: number,
  text: { name: (mark: number) => string; chip: (mark: number) => string; toGo: (left: number) => string },
): Ladder {
  // The hair is for a sum of kilos landing a float under a mark it has reached.
  const held = marks.filter((m) => value + 1e-9 >= m);
  const mark = marks[held.length];
  const from = held[held.length - 1] ?? 0;
  return {
    id,
    title,
    earned: held.map(text.name),
    chips: held.map(text.chip),
    next: mark === undefined ? null : { name: text.name(mark), chip: text.chip(mark), toGo: text.toGo(mark - value), done: Math.max(0, (value - from) / (mark - from)) },
  };
}

/** Every ladder, in a fixed order: sessions, tonnes, total level, then the barbell lifts by name. */
export function ladders(f: BadgeFacts): Ladder[] {
  const count = (n: number) => `${fmtNum(n)} to go`;
  return [
    ladder('sessions', 'Sessions', SESSIONS, f.sessions, { name: (m) => `${fmtNum(m)} sessions`, chip: fmtNum, toGo: count }),
    ladder('tonnes', 'Tonnes lifted', TONNES, f.liftedKg / 1000, {
      name: (m) => `${fmtNum(m)} tonnes lifted`,
      chip: (m) => `${fmtNum(m)} t`,
      // Up to the next tenth of a tonne, so the last stretch is never understated.
      toGo: (left) => `${fmtNum(Math.ceil(left * 10 - 1e-9) / 10)} t to go`,
    }),
    ladder('level', 'Total level', LEVELS, f.totalLevel, { name: (m) => `Total level ${m}`, chip: fmtNum, toGo: count }),
    ...[...f.lifts]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((lift) => ladder(`lift:${lift.id}`, lift.name, PLATES, lift.kg, { name: (m) => `${fmtKg(m)} ${lift.name}`, chip: fmtKg, toGo: (left) => `${fmtKg(left)} to go` })),
  ];
}

export const badgeCount = (all: readonly Ladder[]) => all.reduce((n, l) => n + l.earned.length, 0);

/** The next badge nearest to being reached, by how far along its step it is; the earlier ladder on a tie. */
export function nearestBadge(all: readonly Ladder[]): NonNullable<Ladder['next']> | null {
  return all.reduce<Ladder['next']>((best, l) => (l.next && (!best || l.next.done > best.done) ? l.next : best), null);
}

/** What `after` holds that `before` did not: for each ladder that moved, the highest mark it reached. */
export function newBadges(before: readonly Ladder[], after: readonly Ladder[]): string[] {
  const had = new Map(before.map((l) => [l.id, l.earned.length]));
  return after.flatMap((l) => (l.earned.length > (had.get(l.id) ?? 0) ? [l.earned[l.earned.length - 1]!] : []));
}
