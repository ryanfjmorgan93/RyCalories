/**
 * Daily calories and macros from the owner's goal, their body and how they move. Pure: every input
 * is passed in. Each figure comes with the sum it was made from, so it can be checked.
 *
 * Maintenance (what keeps weight steady):
 *   - measured, when energy.ts has it: the owner's logged intake against their weight trend. This
 *     is the most accurate source there is, so it wins whenever its gates pass;
 *   - otherwise worked out: resting energy from the InBody scan (its BMR; else Cunningham,
 *     500 + 22 × lean mass), × 1.35 for everyday living and digesting food (a sedentary day comes
 *     to about 1.4 × resting with light walking: FAO/WHO/UNU 2004), plus walking at
 *     0.5 kcal per kg per km (ACSM) and about 1,330 steps to the km, plus lifting at about 4 METs
 *     above resting (Compendium of Physical Activities, resistance training ≈ 5 METs).
 * Calories: maintenance, plus or minus the energy for the goal's rate at 7,700 kcal a kg:
 *   lean gain 0.25% of bodyweight a week, faster gain 0.5% (Iraki et al. 2019, 0.25 to 0.5%),
 *   recomp 0, fat loss 0.75% (Helms et al. 2014, 0.5 to 1%).
 * Protein: recomp 2.6 g per kg of lean mass (Barakat et al. 2020: 2.6 to 3.5 for trained lifters),
 *   fat loss 2.7 (Helms et al. 2014: 2.3 to 3.1), gains 2.0 g per kg of bodyweight (Iraki et al.
 *   2019: 1.6 to 2.2). With no lean mass, 2.2 g per kg of bodyweight for recomp and loss.
 * Fat: 25% of calories (20 to 35% is the usual range), never under 0.6 g per kg of bodyweight.
 * Carbs: what is left.
 */
export type Goal = 'lean_gain' | 'faster_gain' | 'recomp' | 'fat_loss';

export const GOALS: { goal: Goal; label: string; ratePct: number }[] = [
  { goal: 'lean_gain', label: 'Lean gain', ratePct: 0.25 },
  { goal: 'faster_gain', label: 'Faster gain', ratePct: 0.5 },
  { goal: 'recomp', label: 'Recomp', ratePct: 0 },
  { goal: 'fat_loss', label: 'Fat loss', ratePct: -0.75 },
];

const KCAL_PER_KG = 7700;
const LIVING_FACTOR = 1.35;
const WALK_KCAL_PER_KG_PER_STEP = 0.5 / 1330;
const LIFT_NET_METS = 4;
const ASSUMED_STEPS = 6000;

export interface TargetInputs {
  goal: Goal;
  /** The latest weigh-in, or the scan's weight. */
  weightKg: number;
  leanMassKg?: number;
  bmrKcal?: number;
  /** Average over the days recorded; absent when steps cannot be read. */
  stepsPerDay?: number;
  sessionsPerWeek: number;
  sessionMinutes: number;
  /** energy.ts, when its gates pass. */
  measured?: { kcal: number; days: number };
}

export interface GoalTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  maintenance: number;
  lines: string[];
}

const n = (v: number) => Math.round(v).toLocaleString('en-GB');
const to5 = (v: number) => Math.round(v / 5) * 5;

/** Null when there is nothing to work maintenance out from: no measured figure, no BMR and no lean mass. */
export function goalTargets(i: TargetInputs): GoalTargets | null {
  const lines: string[] = [];
  let maintenance: number;
  if (i.measured) {
    maintenance = i.measured.kcal;
    lines.push(`Maintenance ${n(maintenance)} kcal: measured from your food and weigh-ins over ${i.measured.days} days.`);
  } else {
    const rmr = i.bmrKcal ?? (i.leanMassKg !== undefined ? 500 + 22 * i.leanMassKg : undefined);
    if (rmr === undefined || !(i.weightKg > 0)) return null;
    const living = rmr * LIVING_FACTOR;
    const steps = i.stepsPerDay ?? ASSUMED_STEPS;
    const walking = steps * i.weightKg * WALK_KCAL_PER_KG_PER_STEP;
    const lifting = (i.sessionsPerWeek * LIFT_NET_METS * i.weightKg * (i.sessionMinutes / 60)) / 7;
    maintenance = Math.round(living + walking + lifting);
    const source = i.bmrKcal !== undefined ? 'your InBody BMR' : `500 + 22 × ${i.leanMassKg} kg lean mass`;
    lines.push(
      `Maintenance ≈${n(maintenance)} kcal: ${n(rmr)} resting (${source}) × ${LIVING_FACTOR} for everyday living and digestion = ${n(living)}, + ${n(walking)} for ${n(steps)} steps a day${i.stepsPerDay === undefined ? ' (assumed: steps not read)' : ''}, + ${n(lifting)} for ${i.sessionsPerWeek} sessions a week of ${i.sessionMinutes} min. Replaced by your measured maintenance once two weeks of food and weigh-ins are in.`,
    );
  }

  const rate = GOALS.find((g) => g.goal === i.goal)!.ratePct;
  const adjust = Math.round(((rate / 100) * i.weightKg * KCAL_PER_KG) / 7);
  const kcal = Math.round((maintenance + adjust) / 50) * 50;
  const weekly = Math.abs((rate / 100) * i.weightKg);
  lines.push(
    rate === 0
      ? `Calories ${n(kcal)}: maintenance, for a recomp.`
      : `Calories ${n(kcal)}: maintenance ${adjust > 0 ? '+' : '−'} ${n(Math.abs(adjust))} to ${adjust > 0 ? 'gain' : 'lose'} ≈${weekly.toFixed(2)} kg a week (${Math.abs(rate)}% of bodyweight, 7,700 kcal a kg).`,
  );

  let protein: number;
  if (i.goal === 'lean_gain' || i.goal === 'faster_gain') {
    protein = to5(2.0 * i.weightKg);
    lines.push(`Protein ${n(protein)} g: 2.0 g per kg of bodyweight (1.6 to 2.2 is the range for gaining).`);
  } else if (i.leanMassKg !== undefined) {
    const perKg = i.goal === 'recomp' ? 2.6 : 2.7;
    protein = to5(perKg * i.leanMassKg);
    lines.push(`Protein ${n(protein)} g: ${perKg} g per kg of lean mass (${i.leanMassKg} kg; ${i.goal === 'recomp' ? '2.6 to 3.5 for a recomp in trained lifters' : '2.3 to 3.1 while losing fat'}).`);
  } else {
    protein = to5(2.2 * i.weightKg);
    lines.push(`Protein ${n(protein)} g: 2.2 g per kg of bodyweight (no lean mass from a scan yet).`);
  }

  const fat = to5(Math.max((kcal * 0.25) / 9, 0.6 * i.weightKg));
  lines.push(`Fat ${n(fat)} g: 25% of calories (20 to 35% is the usual range).`);
  const carbs = Math.max(0, to5((kcal - protein * 4 - fat * 9) / 4));
  lines.push(`Carbs ${n(carbs)} g: the rest (${(carbs / i.weightKg).toFixed(1)} g per kg of bodyweight).`);

  return { kcal, protein, carbs, fat, maintenance, lines };
}
