/**
 * The set the owner just logged, kept for the rest bar's coach line.
 *
 * The exercise card writes it when a set lands (`noteSet`); the rest bar (src/ui/RestTimerBar.tsx)
 * reads it to ask the coach for one line at the "set" moment. In memory only: a set that is no
 * longer fresh, or a reload, is simply no line.
 */
import { create } from 'zustand';
import type { MomentFacts } from '../ai/moments';
import { fmtRange, fmtSetsLine, fmtWeight } from '../domain/format';
import { feelLabel } from '../domain/sets';
import type { Exercise, SetLog } from '../domain/types';

/** What the coach is told about a set: simple values it can read, in the order it reads them. */
export type SetMomentFacts = {
  exercise: string;
  /** The set just logged, as the owner reads it: "100 kg × 8" (or the carry or timed equivalent). */
  set: string;
  setNumber: number;
  /** The exercise's target number of sets, absent for an extra exercise. */
  of: number | null;
  weight: string | null;
  reps: number | null;
  /** The target rep range ("6–8"), absent for an extra exercise. */
  repRange: string | null;
  /** The same slot's sets in the last session: "100 × 8, 8, 7". */
  lastTime: string | null;
  /** Easy, Good or Hard, when the exercise already has an answer. */
  effort: string | null;
};

export interface SetMomentInput {
  exercise: Pick<Exercise, 'name' | 'kind'>;
  set: SetLog;
  /** Which counted set of the exercise this is. */
  setNumber: number;
  /** The target number of sets, when the exercise has a plan. */
  of?: number;
  repMin?: number;
  repMax?: number;
  /** The slot's sets from the last session it was done. */
  previous?: readonly SetLog[];
  /** The logged RIR the exercise's sets already share, if the owner has answered. */
  effortRir?: number | null;
}

/** The facts for the coach's line after a set. Pure. */
export function setMomentFacts(input: SetMomentInput): SetMomentFacts {
  const { exercise, set } = input;
  const kind = exercise.kind;
  const lifts = kind === 'reps' || kind === 'bodyweight_plus';
  const effort = feelLabel(input.effortRir ?? undefined);
  return {
    exercise: exercise.name,
    set: fmtSetsLine([set], kind),
    setNumber: input.setNumber,
    of: input.of ?? null,
    weight: kind === 'timed' ? null : fmtWeight(kind, set.weight),
    reps: lifts && typeof set.reps === 'number' ? set.reps : null,
    repRange: input.repMin !== undefined && input.repMax !== undefined ? fmtRange(input.repMin, input.repMax) : null,
    lastTime: input.previous && input.previous.length > 0 ? fmtSetsLine([...input.previous], kind) : null,
    effort,
  };
}

interface CoachMomentsState {
  /** The latest logged set: the facts, and when. */
  lastSet: { at: number; facts: MomentFacts } | null;
  noteSet: (facts: SetMomentFacts) => void;
  clear: () => void;
}

export const useCoachMoments = create<CoachMomentsState>((set) => ({
  lastSet: null,
  noteSet: (facts) => set({ lastSet: { at: Date.now(), facts } }),
  clear: () => set({ lastSet: null }),
}));

/** How long a logged set stays worth a line: a rest, with room to spare. */
export const SET_MOMENT_FRESH_MS = 10 * 60 * 1000;
