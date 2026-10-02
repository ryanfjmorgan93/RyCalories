import type { MuscleGroup } from '@/domain/types';

/** How the Exercises list stood when the owner left it for an exercise: what they had asked for and how far down they were. */
export interface ExercisesView {
  scope: 'yours' | 'all';
  filter: 'all' | MuscleGroup;
  q: string;
  /** Pages of rows drawn (`usePaged`), so the rows the scroll position belongs to are there to be scrolled to. */
  pages: number;
  scrollY: number;
}

let left: ExercisesView | null = null;

/**
 * The list was left for an exercise (its page, the form for a new one): Back should find it as it
 * was. Kept for the next time the screen is built and used once. A visit that ends any other way
 * (the top bar's Back, another tab) records nothing, so the list opens clean next time.
 */
export function leaveExercises(view: ExercisesView): void {
  left = view;
}

/** What the screen being built should start from, or null for a clean list. */
export function viewToRestore(): ExercisesView | null {
  return left;
}

/** The screen has been built with it: it is not offered again. */
export function viewRestored(): void {
  left = null;
}
