/**
 * Whether logging a set should start the rest timer — pure. No IO, no clock.
 *
 * A lone slot always rests after every counted or drop set... except a drop set never starts rest
 * at all (it follows a working set the timer is already running for). A superset only rests once
 * the round comes back around to the member that was just logged — i.e. once no other non-skipped
 * member is still owed a turn ahead of it. That "owed a turn" check must agree with the live
 * screen's `currentKey` rotation (fewest counted sets so far, ties by array order): a member is
 * still owed a turn when it hasn't hit its own target AND has fewer counted sets than the member
 * that was just logged now has.
 */
import type { Exercise, RoutineExercise, SetType, Settings } from './types';

/** The three Settings defaults a rest lookup reads. */
export type RestDefaults = Pick<Settings, 'restCompoundSec' | 'restIsolationSec' | 'restCarrySec'>;

/** Rest seconds an exercise gets from the settings defaults, by its tags alone: carry, else compound or isolation. */
export function restDefaultFor(e: Pick<Exercise, 'kind' | 'isCompound'>, s: RestDefaults): number {
  if (e.kind === 'carry') return s.restCarrySec;
  return e.isCompound ? s.restCompoundSec : s.restIsolationSec;
}

/**
 * Rest seconds after a set of this exercise, in the order the live session has always applied: the
 * routine-exercise's own override, then the exercise's default, then the settings default for its
 * tags. A zero override or default is "not set", not zero seconds of rest.
 */
export function restSecondsFor(
  rx: Pick<RoutineExercise, 'restSecOverride'> | null,
  exercise: Pick<Exercise, 'defaultRestSec' | 'kind' | 'isCompound'>,
  settings: RestDefaults,
): number {
  if (rx?.restSecOverride) return rx.restSecOverride;
  if (exercise.defaultRestSec) return exercise.defaultRestSec;
  return restDefaultFor(exercise, settings);
}

export interface RestGroupMember {
  key: string;
  targetSets: number;
  skipped: boolean;
  /** This member's counted (working/failure) set count, already including the set just logged. */
  counted: number;
}

/**
 * @param members every member of the logged set's group (a lone slot is a group of one).
 * @param loggedKey the slot key the set was logged into.
 * @param loggedSet the set that was just logged (only its `type` matters).
 */
export function shouldStartRest(members: RestGroupMember[], loggedKey: string, loggedSet: { type: SetType }): boolean {
  if (loggedSet.type === 'drop') return false;
  if (members.length <= 1) return true;

  const logged = members.find((m) => m.key === loggedKey);
  const loggedCounted = logged?.counted ?? 0;

  const someoneElseNext = members.some(
    (m) => m.key !== loggedKey && !m.skipped && m.counted < m.targetSets && m.counted < loggedCounted,
  );
  return !someoneElseNext;
}

/**
 * Whether the end-of-rest cue should reach the system notification tray — pure. `restNotify` is the
 * Settings → Rest toggle; `undefined` (settings not loaded yet, or no row) is on, the same default
 * `RestTimerBar` uses for the in-app path, so the two paths never disagree about a fresh install.
 */
export function shouldNotifyRestEnd(settings: Pick<Settings, 'restNotify'> | undefined): boolean {
  return settings?.restNotify ?? true;
}

/** What the notification-permission row can say — the app's own vocabulary, not the plugin's. */
export type NotificationPermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

/**
 * Collapse Capacitor's four permission states onto the three the row distinguishes. Android's
 * 'prompt-with-rationale' (asked once and dismissed, the system will ask again) is still "not
 * asked yet" from the user's side. Anything unrecognised is 'unsupported' rather than guessed at.
 */
export function mapPermissionState(state: string): NotificationPermissionStatus {
  switch (state) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'prompt':
    case 'prompt-with-rationale':
      return 'prompt';
    default:
      return 'unsupported';
  }
}
