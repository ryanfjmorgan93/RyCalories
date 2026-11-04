/**
 * Where a squat, bench or deadlift stands. Pure: no IO, no clock, no database.
 *
 * The levels are the training-status bands of Santos Junior et al. (2021), "Classification and
 * Determination Model of Resistance Training Status", Strength and Conditioning Journal 43(5):77–86:
 * 1RM as a whole % of bodyweight, per sex. Men: bench under 60 beginner, 60–99 intermediate, 100–120
 * advanced, over 120 highly advanced; squat 80 / 120 / over 150; deadlift 100 / 150 / over 180.
 * Women: bench 40 / 60 / over 80; squat 60 / 100 / over 130; deadlift 80 / 120 / over 160.
 * The % is rounded down, as the paper writes whole numbers, so a level is never flattered.
 *
 * Above highly advanced the next marks are real results (liftStandards.ts): the average (median)
 * competition powerlifter of the same sex, age group and weight class, then the top 1%. Only raw
 * (unequipped) lifters are counted; the screen says "competition powerlifter", in plain words.
 *
 * Press and row have no published bands; rows that still name them show nothing.
 */
import { fmtKg, fmtNum } from './format';
import { groupText, type CompareSex, type LiftStanding } from './liftStandards';

export type StrengthStandard = 'squat' | 'bench' | 'deadlift' | 'press' | 'row';

/** The standards an exercise can be given: the ones with published bands. */
export const STRENGTH_STANDARDS: StrengthStandard[] = ['squat', 'bench', 'deadlift'];

type Banded = 'squat' | 'bench' | 'deadlift';

/** The lowest whole % of bodyweight for intermediate, advanced and highly advanced. */
const BANDS: Record<CompareSex, Record<Banded, [number, number, number]>> = {
  male: { squat: [80, 120, 151], bench: [60, 100, 121], deadlift: [100, 150, 181] },
  female: { squat: [60, 100, 131], bench: [40, 60, 81], deadlift: [80, 120, 161] },
};

const LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Highly advanced'] as const;

export interface StrengthStanding {
  level: (typeof LEVELS)[number];
  /** "e1RM 114 kg, 1.44 × bodyweight" */
  head: string;
  /** The next mark and the weight that reaches it, or where it stands among competition powerlifters. */
  next: string | null;
}

/** An estimate counted to the half kilo below, so it never flatters. */
export const e1rmShown = (kg: number) => Math.floor(kg * 2) / 2;

/**
 * Null for a lift with no bands or no bodyweight. `meet` is the lift's standing among raw meet
 * lifters (liftStanding), when a year of birth is set and the table has the group.
 */
export function strengthStanding(input: {
  standard: StrengthStandard;
  sex: CompareSex;
  e1rmKg: number;
  bodyweightKg: number;
  meet?: LiftStanding | null;
}): StrengthStanding | null {
  if (!(input.standard in BANDS.male) || !(input.bodyweightKg > 0)) return null;
  const bands = BANDS[input.sex][input.standard as Banded];
  const e1rm = e1rmShown(input.e1rmKg);
  const pct = Math.floor((100 * e1rm) / input.bodyweightKg + 1e-9);
  const i = bands.filter((b) => pct >= b).length;
  const head = `e1RM ${fmtKg(e1rm)}, ${fmtNum(pct / 100)} × bodyweight`;
  const level = LEVELS[i]!;
  if (i < bands.length) {
    // The lightest half kilo at or over the next band's line.
    const kg = Math.ceil(((bands[i]! * input.bodyweightKg) / 100) * 2 - 1e-9) / 2;
    return { level, head, next: `Next: ${LEVELS[i + 1]} at ${fmtKg(kg)}` };
  }
  const m = input.meet;
  if (!m) return { level, head, next: null };
  const group = groupText(input.sex, m);
  if (e1rm < m.medianKg) return { level, head, next: `Next: the average competition powerlifter (${group}) at ${fmtKg(m.medianKg)}` };
  if (e1rm > m.eliteKg) return { level, head, next: `Top 1% of competition powerlifters (${group})` };
  return { level, head, next: `Stronger than ${m.beatsPct}% of competition powerlifters (${group}). Top 1%: ${fmtKg(m.eliteKg)}` };
}
