import { create } from 'zustand';
import { toDateKey } from '@/domain/dates';
import type { StepDay } from '@/domain/steps';
import { readStepDays, requestStepsAccess, stepsAccess, type StepsAccess } from '@/platform/health';

/**
 * The week of steps Health Connect last gave, and whether Iron may read them. Read when Home opens
 * and again when the app comes back to the front; never stored in the database (Health Connect is
 * the record, Iron only shows it). The coach's context reads the same snapshot.
 */
interface StepsState {
  access: StepsAccess | 'loading';
  /** Oldest first, today last; null until read, or when the read failed. */
  days: StepDay[] | null;
}

export const useStepsStore = create<StepsState>(() => ({ access: 'loading', days: null }));

let inFlight: Promise<void> | null = null;

/** Re-reads access and, when granted, the week. One read at a time. */
export function refreshSteps(now: () => Date = () => new Date()): Promise<void> {
  inFlight ??= (async () => {
    try {
      const access = await stepsAccess();
      const days = access === 'granted' ? await readStepDays(now()) : null;
      useStepsStore.setState({ access, days });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Shows Health Connect's permission screen, then reads the week if it was allowed. */
export async function askForSteps(now: () => Date = () => new Date()): Promise<StepsAccess> {
  const access = await requestStepsAccess();
  useStepsStore.setState({ access, days: access === 'granted' ? await readStepDays(now()) : null });
  return access;
}

/** Today's and the week's steps as last read, for the coach; null when there is nothing to say, or the week read does not end on `today`. */
export function stepsSnapshot(today: string = toDateKey()): StepDay[] | null {
  const { access, days } = useStepsStore.getState();
  return access === 'granted' && days && days.at(-1)?.date === today && days.some((d) => d.steps !== null) ? days : null;
}
