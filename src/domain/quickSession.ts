/**
 * Builds a short session on demand from what the owner already does — pure. No IO, no clock, no
 * database, and no `Math.random`: the caller passes a seed, and the same input with the same seed
 * always gives the same plan, whatever order the database handed the candidates back in.
 *
 * Weights never come from anywhere but the owner's own history: a candidate carries the working
 * weight it already has, or has none and is prescribed as calibrating ("you pick the weight").
 */
import { roundKg } from './engine';
import { deloadLoad } from './prescription';
import { DEFAULT_MINUTES, type QuickOptions } from './quickRequest';
import { restSecondsFor, type RestDefaults } from './rest';
import type { StrengthStandard } from './standards';
import { DEFAULT_SETTINGS, MUSCLE_GROUPS, type Equipment, type ExerciseKind, type MuscleGroup, type ProgressionMode, type Settings } from './types';

export interface Candidate {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment?: Equipment;
  kind: ExerciseKind;
  isCompound: boolean;
  isLowerBody: boolean;
  unilateral: boolean;
  defaultIncrement: number;
  defaultRestSec: number;
  standard?: StrengthStandard;
  level?: 'beginner' | 'intermediate' | 'expert';
  /** A row in the owner's database, or a catalogue entry never done that would become one. */
  origin: 'own' | 'catalogue';
  catalogueSlug?: string;
  /** Whole days since this exercise was last logged. Absent = never. */
  daysSinceUsed?: number;
  /** What the owner already does for it: their routine's prescription or their last top set. */
  base?: { sets: number; repMin: number; repMax: number; weightKg: number | null; mode: ProgressionMode };
}

export interface QuickInput {
  candidates: Candidate[];
  /** Whole days since each muscle group was last trained. Absent = never. */
  recency: Partial<Record<MuscleGroup, number>>;
  /** Working sets in the current week, per muscle group. */
  weeklySets: Partial<Record<MuscleGroup, number>>;
  weeklyTargets?: Partial<Record<MuscleGroup, number>>;
  settings: Pick<Settings, 'restCompoundSec' | 'restIsolationSec' | 'restCarrySec' | 'barKg' | 'plates'>;
  /** Actual over modelled duration from recent sessions (`paceFactor`). 1 when there is no history. */
  pace: number;
}

export interface QuickRow {
  candidate: Candidate;
  sets: number;
  repMin: number;
  repMax: number;
  /** kg; null when the owner has to pick it (calibrating). */
  weightKg: number | null;
  mode: ProgressionMode;
  restSec: number;
  /** Days since the row's muscle group was last trained; null = never. */
  daysSince: number | null;
}

export interface QuickPlan {
  rows: QuickRow[];
  /** Whole minutes, never clamped into the window the count was derived from. */
  estimateMin: number;
  /** How many fewer exercises than asked for there are. */
  shortfall: number;
  /** Typed focus muscles no exercise could be found for. Never silently swapped for another muscle. */
  unmet: MuscleGroup[];
  /** True when the two-day recovery rule had to be dropped because no muscle was left. */
  relaxed: boolean;
  focus: MuscleGroup[];
  seed: number;
}

/** A light session's weight as a fraction of the working weight, and never above it. */
export const LIGHT_FRACTION = 0.65;

const SETUP_SEC = 60;
const WORK_SEC_PER_SET = 40;
const MIN_ROWS = 3;
const MAX_ROWS = 8;
const MAX_PER_MUSCLE = 2;
const MAX_CATALOGUE = 2;
/** The derived count aims to reach the minutes target without going past this, where it can. */
const TIME_CEILING_MIN = 45;
const RECOVERY_DAYS = 2;
const NEED_DAYS_CAP = 14;
const DEFICIT_WEIGHT = 2;
/** With a catalogue and an own exercise for the same muscle, catalogue ones share this fraction of the own weight. */
const CATALOGUE_SHARE = 0.5;
const LIGHT_SETS_COMPOUND = 3;
const LIGHT_SETS_ISOLATION = 2;
const LIGHT_REPS: [number, number] = [10, 15];
const COMPOUND_DEFAULT: { sets: number; repMin: number; repMax: number } = { sets: 3, repMin: 8, repMax: 10 };
const ISOLATION_DEFAULT: { sets: number; repMin: number; repMax: number } = { sets: 3, repMin: 10, repMax: 15 };
/** Hinge patterns load the lower back too heavily for a session the owner did not want to do. */
const HINGE_PATTERN = /deadlift|good.?morning|romanian|rdl|hyperextension|back extension/i;

const TRAINABLE = new Set<MuscleGroup>(MUSCLE_GROUPS.filter((m) => m !== 'full body' && m !== 'other'));

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** A small seeded generator (mulberry32): 32 bits of state, uniform in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function byId(a: Candidate, b: Candidate): number {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Time

function rowSeconds(row: Pick<QuickRow, 'sets' | 'restSec' | 'candidate'>): number {
  const work = row.sets * WORK_SEC_PER_SET * (row.candidate.unilateral ? 2 : 1);
  return SETUP_SEC + work + Math.max(0, row.sets - 1) * row.restSec;
}

function paceOf(pace: number): number {
  return finite(pace) && pace > 0 ? pace : 1;
}

/**
 * Minutes a plan should take: per exercise 60 s of setup, 40 s per set (doubled when it is done one
 * side at a time) and the rest between sets, times the owner's own pace, to the nearest minute.
 * Never clamped: a plan that cannot fit a window says how long it really is.
 */
export function estimateMinutes(rows: Pick<QuickRow, 'sets' | 'restSec' | 'candidate'>[], pace: number): number {
  const seconds = rows.reduce((sum, r) => sum + rowSeconds(r), 0);
  return Math.round((seconds / 60) * paceOf(pace));
}

const MAX_PACE_SESSION_SEC = 3 * 60 * 60;
const MIN_PACE_SESSIONS = 3;

/**
 * How much slower or faster than modelled the owner's sessions run: the median of actual over
 * modelled duration, from at least three usable sessions, held to 0.6–1.6. A zero, negative or
 * over-three-hour duration is a session left open or logged wrong, and is dropped rather than
 * averaged in. Fewer than three usable sessions is no evidence: 1.
 */
export function paceFactor(sessions: { durationSec: number; modelledSec: number }[]): number {
  const ratios: number[] = [];
  for (const s of sessions) {
    if (!finite(s.durationSec) || !finite(s.modelledSec)) continue;
    if (s.durationSec <= 0 || s.durationSec > MAX_PACE_SESSION_SEC || s.modelledSec <= 0) continue;
    ratios.push(s.durationSec / s.modelledSec);
  }
  if (ratios.length < MIN_PACE_SESSIONS) return 1;
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.min(1.6, Math.max(0.6, median));
}

// ---------------------------------------------------------------------------
// Pool and prescription

function isLightExcluded(c: Candidate): boolean {
  return (c.equipment === 'barbell' && c.isCompound) || HINGE_PATTERN.test(c.name) || c.standard !== undefined;
}

/** Candidates that may be picked at all, in one canonical order. */
function eligiblePool(candidates: Candidate[], options: QuickOptions, light: boolean): Candidate[] {
  const equipment = options.equipment?.length ? new Set<Equipment>(options.equipment) : null;
  const exclude = new Set<MuscleGroup>(options.exclude ?? []);
  return [...candidates].sort(byId).filter((c) => {
    if (c.kind === 'carry' || c.kind === 'timed') return false;
    if (!TRAINABLE.has(c.muscleGroup) || exclude.has(c.muscleGroup)) return false;
    // An exercise with no equipment recorded counts as 'other', so "no barbell" keeps it.
    if (equipment && !equipment.has(c.equipment ?? 'other')) return false;
    if (c.origin === 'catalogue' && (!options.includeNew || c.level === 'expert')) return false;
    if (light && isLightExcluded(c)) return false;
    return true;
  });
}

function baseWeight(c: Candidate): number | null {
  const b = c.base;
  if (!b || b.mode === 'calibrating' || !finite(b.weightKg) || b.weightKg < 0) return null;
  return b.weightKg;
}

function positiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1;
}

interface Prescription {
  sets: number;
  repMin: number;
  repMax: number;
  weightKg: number | null;
  mode: ProgressionMode;
}

function prescribeRow(c: Candidate, light: boolean, barKg: number, plates: number[]): Prescription {
  const known = baseWeight(c);
  const fallback = c.isCompound ? COMPOUND_DEFAULT : ISOLATION_DEFAULT;

  if (light) {
    const sets = c.isCompound ? LIGHT_SETS_COMPOUND : LIGHT_SETS_ISOLATION;
    let weightKg: number | null = null;
    if (known !== null) {
      weightKg = deloadLoad(known, LIGHT_FRACTION, c.defaultIncrement, c.equipment === 'barbell' ? { barKg, plates } : undefined);
      // A bar cannot be loaded below its own weight, so a barbell load that lands above the light
      // load has no honest number: the owner picks it, rather than being handed a heavier one.
      if (weightKg > known * LIGHT_FRACTION + 1e-6) weightKg = null;
    }
    return { sets, repMin: LIGHT_REPS[0], repMax: LIGHT_REPS[1], weightKg, mode: weightKg === null ? 'calibrating' : 'normal' };
  }

  const b = c.base;
  const sets = b && positiveInt(b.sets) ? b.sets : fallback.sets;
  const repsOk = b && positiveInt(b.repMin) && positiveInt(b.repMax) && b.repMax >= b.repMin;
  const repMin = repsOk ? b.repMin : fallback.repMin;
  const repMax = repsOk ? b.repMax : fallback.repMax;
  return { sets, repMin, repMax, weightKg: known === null ? null : roundKg(known), mode: known === null ? 'calibrating' : 'normal' };
}

/** How likely a candidate is to be chosen, relative to the others for its muscle. Never zero. */
function weightOf(c: Candidate, light: boolean): number {
  let w = 1;
  if (baseWeight(c) !== null) w *= 2;
  if (finite(c.daysSinceUsed) && c.daysSinceUsed < RECOVERY_DAYS) w *= 0.25;
  if (light) {
    if (c.equipment === 'machine' || c.equipment === 'cable') w *= 2;
    if (!c.isCompound) w *= 1.5;
  }
  return w;
}

// ---------------------------------------------------------------------------
// The generator

export function generateQuickSession(input: QuickInput, options: QuickOptions, seed: number): QuickPlan {
  const seedU = finite(seed) ? seed >>> 0 : 0;
  const rng = mulberry32(seedU);
  const light = options.effort === 'light';
  const pace = paceOf(input.pace);

  const restDefaults: RestDefaults = {
    restCompoundSec: positiveOr(input.settings?.restCompoundSec, DEFAULT_SETTINGS.restCompoundSec),
    restIsolationSec: positiveOr(input.settings?.restIsolationSec, DEFAULT_SETTINGS.restIsolationSec),
    restCarrySec: positiveOr(input.settings?.restCarrySec, DEFAULT_SETTINGS.restCarrySec),
  };
  const barKg = positiveOr(input.settings?.barKg, DEFAULT_SETTINGS.barKg!);
  const plates = Array.isArray(input.settings?.plates) ? input.settings.plates! : DEFAULT_SETTINGS.plates!;
  const recency = input.recency ?? {};
  const weeklySets = input.weeklySets ?? {};

  const explicit = finite(options.count) && Math.floor(options.count) >= 1 ? Math.floor(options.count) : undefined;
  const minutesTarget = finite(options.minutes) && options.minutes > 0 ? options.minutes : DEFAULT_MINUTES;
  const ceiling = Math.max(TIME_CEILING_MIN, minutesTarget);

  const pool = eligiblePool(input.candidates ?? [], options, light);
  const rowOf = new Map<string, QuickRow>();
  for (const c of pool) {
    const rx = prescribeRow(c, light, barKg, plates);
    const recent = recency[c.muscleGroup];
    rowOf.set(c.id, {
      candidate: c,
      ...rx,
      restSec: Math.max(0, restSecondsFor(null, { defaultRestSec: finite(c.defaultRestSec) ? c.defaultRestSec : 0, kind: c.kind, isCompound: c.isCompound }, restDefaults)),
      daysSince: finite(recent) ? recent : null,
    });
  }

  const byGroup = new Map<MuscleGroup, Candidate[]>();
  for (const c of pool) {
    const list = byGroup.get(c.muscleGroup);
    if (list) list.push(c);
    else byGroup.set(c.muscleGroup, [c]);
  }

  // One draw per muscle group in a fixed order, so ties between equally needy groups fall out of
  // the seed and not out of the order anything was handed in.
  const jitter = new Map<MuscleGroup, number>(MUSCLE_GROUPS.map((m) => [m, rng()]));

  const needOf = (m: MuscleGroup): number => {
    const days = recency[m];
    const since = finite(days) ? Math.min(NEED_DAYS_CAP, Math.max(0, days)) : NEED_DAYS_CAP;
    const target = input.weeklyTargets?.[m];
    const done = weeklySets[m];
    const deficit = finite(target) && target > 0 ? Math.max(0, target - (finite(done) ? done : 0)) : 0;
    return since + DEFICIT_WEIGHT * deficit;
  };
  const rank = (groups: MuscleGroup[]): MuscleGroup[] =>
    [...groups].sort((a, b) => needOf(b) - needOf(a) || jitter.get(b)! - jitter.get(a)! || MUSCLE_GROUPS.indexOf(a) - MUSCLE_GROUPS.indexOf(b));

  const typed = [...new Set(options.focus ?? [])].filter((m) => !(options.exclude ?? []).includes(m));
  const isTyped = typed.length > 0;
  const withCandidates = (groups: MuscleGroup[]): MuscleGroup[] => groups.filter((m) => (byGroup.get(m)?.length ?? 0) > 0);

  let relaxed = false;
  let ordered: MuscleGroup[];
  if (isTyped) {
    ordered = rank(withCandidates(typed));
  } else {
    const all = withCandidates([...TRAINABLE]);
    const rested = all.filter((m) => !(finite(recency[m]) && recency[m]! < RECOVERY_DAYS));
    if (rested.length > 0 || all.length === 0) {
      ordered = rank(rested);
    } else {
      ordered = rank(all);
      relaxed = true;
    }
  }

  // How many muscle groups to start with: half the exercises, at least two. A derived count is not
  // known yet, so it is estimated from the minutes. Groups are added one by one if these run dry.
  const provisional = explicit ?? Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.round(minutesTarget / 6)));
  const windowSize = Math.max(2, Math.ceil(provisional / 2));
  const active: MuscleGroup[] = isTyped ? [...ordered] : ordered.slice(0, windowSize);
  let nextGroup = active.length;

  const chosen: Candidate[] = [];
  const chosenIds = new Set<string>();
  const perMuscle = new Map<MuscleGroup, number>();
  let catalogueCount = 0;
  let seconds = 0;

  const minutesAt = (sec: number): number => Math.round((sec / 60) * pace);
  const costOf = (c: Candidate): number => rowSeconds(rowOf.get(c.id)!);
  const available = (g: MuscleGroup): Candidate[] => {
    if ((perMuscle.get(g) ?? 0) >= MAX_PER_MUSCLE) return [];
    return (byGroup.get(g) ?? []).filter((c) => !chosenIds.has(c.id) && (c.origin !== 'catalogue' || catalogueCount < MAX_CATALOGUE));
  };

  const weightedPick = (list: Candidate[]): Candidate => {
    const weights = list.map((c) => weightOf(c, light));
    const own = list.reduce((s, c, i) => (c.origin === 'catalogue' ? s : s + weights[i]), 0);
    const cat = list.reduce((s, c, i) => (c.origin === 'catalogue' ? s + weights[i] : s), 0);
    // Never-done exercises are a garnish, not the meal: beside own ones, they share a fixed fraction.
    const scale = own > 0 && cat > 0 ? (own * CATALOGUE_SHARE) / cat : 1;
    const scaled = weights.map((w, i) => (list[i].origin === 'catalogue' ? w * scale : w));
    let r = rng() * scaled.reduce((s, w) => s + w, 0);
    for (let i = 0; i < list.length; i++) {
      if (r < scaled[i]) return list[i];
      r -= scaled[i];
    }
    return list[list.length - 1];
  };

  /**
   * For a derived count: prefer what keeps the plan at or under the ceiling, this slot's muscle
   * first. Failing that, take the cheapest exercise from any muscle in play: it fits if anything
   * does, and overshoots by the least if nothing does.
   */
  const pickForTime = (g: MuscleGroup, avail: Candidate[]): Candidate => {
    const fits = (c: Candidate): boolean => minutesAt(seconds + costOf(c)) <= ceiling;
    const here = avail.filter(fits);
    if (here.length) return weightedPick(here);
    const all = [avail, ...active.filter((h) => h !== g).map(available)].flat();
    const cheapest = Math.min(...all.map(costOf));
    return weightedPick(all.filter((c) => costOf(c) <= cheapest + 1e-9));
  };

  const limit = explicit ?? MAX_ROWS;
  outer: while (chosen.length < limit) {
    let progressed = false;
    for (const g of active) {
      if (chosen.length >= limit) break;
      if (explicit === undefined && chosen.length >= MIN_ROWS && minutesAt(seconds) >= minutesTarget) break outer;
      const avail = available(g);
      if (avail.length === 0) continue;
      const pick = explicit === undefined ? pickForTime(g, avail) : weightedPick(avail);
      chosen.push(pick);
      chosenIds.add(pick.id);
      perMuscle.set(pick.muscleGroup, (perMuscle.get(pick.muscleGroup) ?? 0) + 1);
      if (pick.origin === 'catalogue') catalogueCount++;
      seconds += costOf(pick);
      progressed = true;
    }
    if (!progressed) {
      // A typed focus is all in `active` from the start, so it is never widened; a focus chosen by
      // need runs on to the next muscle group.
      if (nextGroup < ordered.length) {
        active.push(ordered[nextGroup++]);
        continue;
      }
      break;
    }
  }

  // Compound lifts first, then the rest, each in the order they were chosen.
  const rows = chosen.map((c) => rowOf.get(c.id)!).sort((a, b) => Number(b.candidate.isCompound) - Number(a.candidate.isCompound));

  const asked = explicit ?? MIN_ROWS;
  const used = new Set(chosen.map((c) => c.muscleGroup));
  return {
    rows,
    estimateMin: estimateMinutes(rows, pace),
    shortfall: Math.max(0, asked - rows.length),
    unmet: isTyped ? typed.filter((m) => (byGroup.get(m)?.length ?? 0) === 0) : [],
    relaxed,
    focus: isTyped ? typed : active.filter((m) => used.has(m)),
    seed: seedU,
  };
}

function positiveOr(n: unknown, fallback: number): number {
  return finite(n) && n > 0 ? n : fallback;
}
