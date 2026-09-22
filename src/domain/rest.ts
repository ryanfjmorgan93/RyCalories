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
import type { SetType } from './types';

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
