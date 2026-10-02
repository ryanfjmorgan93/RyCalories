import { afterEach, describe, expect, it } from 'vitest';
import { leaveExercises, viewRestored, viewToRestore, type ExercisesView } from './exercisesView';

const view: ExercisesView = { scope: 'yours', filter: 'biceps', q: 'curl', pages: 3, scrollY: 1840 };

afterEach(() => viewRestored());

describe('the Exercises list as it was left', () => {
  it('is nothing until the list is left for an exercise', () => {
    expect(viewToRestore()).toBeNull();
  });

  it('is what was left, for the screen that is built next', () => {
    leaveExercises(view);
    expect(viewToRestore()).toEqual(view);
    // Building two screens in a row before the first has settled (StrictMode does) sees the same thing.
    expect(viewToRestore()).toEqual(view);
  });

  it('is offered once: once the screen has it, a later visit opens clean', () => {
    leaveExercises(view);
    viewRestored();
    expect(viewToRestore()).toBeNull();
  });

  it('keeps only the latest place', () => {
    leaveExercises(view);
    leaveExercises({ ...view, q: 'row', scrollY: 40 });
    expect(viewToRestore()).toMatchObject({ q: 'row', scrollY: 40 });
  });
});
