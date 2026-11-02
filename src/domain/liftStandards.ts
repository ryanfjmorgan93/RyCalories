/**
 * Where a squat, bench or deadlift stands against raw lifters at powerlifting meets of the same
 * sex, age group and weight class. The table (src/data/liftStandards.json, built by hand from
 * OpenPowerlifting with scripts/lift-standards.py) is passed in. Pure: no IO, no clock.
 *
 * Body fat plays no part: meet results record bodyweight, never body fat.
 */

export type MeetLift = 'squat' | 'bench' | 'deadlift';
export type CompareSex = 'male' | 'female';

export interface LiftTable {
  date: string;
  /** The percentiles each cell's `kg` holds, ascending; the last is the elite line (99). */
  pcts: number[];
  classes: Record<'M' | 'F', string[]>;
  bands: string[];
  /** "M|24-34|83|squat" → how many lifters, and their best lift at each of `pcts`. */
  cells: Record<string, { n: number; kg: number[] }>;
}

export interface LiftStanding {
  band: string;
  weightClass: string;
  /** Lifters in the group. */
  n: number;
  /** The top 1%'s line. */
  eliteKg: number;
  /** Rounded down; 0 is below the bottom 5%, 99 is the top 1%. */
  beatsPct: number;
}

export function ageBand(age: number, bands: readonly string[]): string | null {
  for (const b of bands) {
    const [lo, hi] = b.split('-').map(Number);
    if (age >= lo! && age <= hi!) return b;
  }
  return null;
}

/** The IPF class a bodyweight falls in: the lightest whose limit it is within, else the open-ended one. */
export function weightClassFor(bodyweightKg: number, classes: readonly string[]): string {
  return classes.find((c) => !c.endsWith('+') && bodyweightKg <= Number(c)) ?? classes[classes.length - 1]!;
}

/**
 * The share of the group whose best is below `kg`, rounded down so it never flatters: the highest
 * percentile strictly under it, then straight-line to the next.
 */
function beats(kg: number, pcts: readonly number[], values: readonly number[]): number {
  let i = -1;
  while (i + 1 < values.length && values[i + 1]! < kg) i++;
  if (i < 0) return 0;
  if (i === values.length - 1) return pcts[i]!;
  const frac = (kg - values[i]!) / (values[i + 1]! - values[i]!);
  return Math.min(pcts[i + 1]!, Math.floor(pcts[i]! + frac * (pcts[i + 1]! - pcts[i]!)));
}

/** Null when the table has no group for this sex, age, class and lift (fewer than 20 lifters). */
export function liftStanding(
  table: LiftTable,
  input: { sex: CompareSex; age: number; bodyweightKg: number; lift: MeetLift; e1rmKg: number },
): LiftStanding | null {
  const sex = input.sex === 'male' ? 'M' : 'F';
  const band = ageBand(input.age, table.bands);
  if (!band || !(input.bodyweightKg > 0)) return null;
  const weightClass = weightClassFor(input.bodyweightKg, table.classes[sex]);
  const cell = table.cells[`${sex}|${band}|${weightClass}|${input.lift}`];
  if (!cell) return null;
  return { band, weightClass, n: cell.n, eliteKg: cell.kg[cell.kg.length - 1]!, beatsPct: beats(input.e1rmKg, table.pcts, cell.kg) };
}

export function standingText(s: LiftStanding): string {
  if (s.beatsPct >= 99) return 'Top 1% of raw lifters at meets';
  if (s.beatsPct < 5) return 'Beats fewer than 5% of raw lifters at meets';
  return `Beats ${s.beatsPct}% of raw lifters at meets`;
}

/** "Men 24–34, 83 kg class"; the oldest band reads "80+". */
export function groupText(sex: CompareSex, s: Pick<LiftStanding, 'band' | 'weightClass'>): string {
  const band = s.band.endsWith('-999') ? `${s.band.split('-')[0]}+` : s.band.replace('-', '–');
  return `${sex === 'male' ? 'Men' : 'Women'} ${band}, ${s.weightClass} kg class`;
}
