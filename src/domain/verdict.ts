/**
 * The live verdict — what the engine would decide if the session ended right now, and what the
 * current set needs to keep an increase alive. Built entirely on `decide()` (`./engine`) and
 * `countsForProgression` (`./sets`, via `decide()`'s own `workingSets()` filter): this module
 * never re-derives the progression rule, so it can never promise an increase the engine would
 * not actually give.
 *
 * No IO, no clock, no database.
 */
import { decide, type Decision, type EngineRoutineExercise, type EngineSet } from './engine';
import { effortReason, fmtNum, fmtWeight } from './format';
import { feelOf } from './sets';

export interface Verdict {
  /** decide() on the sets logged so far — what the engine would decide if the session ended now. */
  decision: Decision;
  /**
   * Reps needed on the current set (and every remaining one) to keep an increase alive: always
   * `rx.repMax` when an increase is still reachable from here, null once it is not (or never was
   * — calibrating, not a weight exercise, a deload session, or a set already logged below the
   * top of the range).
   */
  repsToGoUp: number | null;
  /** The user-facing line — a fact, never encouragement — or null when nothing should show. */
  line: string | null;
  tone: 'ok' | 'accent' | 'muted' | null;
}

/**
 * Pads the sets logged so far with the sets still needed to reach `rx.targetSets`, each at
 * `rx.repMax` reps and at the same weight `decide()` is already progressing from (`baseWeight`:
 * the weight the real sets agree on, else the heaviest done for the range) — so padding can never
 * manufacture a weight the real sets did not already reach — then asks `decide()` what that would
 * produce. This is the only way this module ever answers "would an increase still happen"; it is
 * never computed by hand.
 */
function projectFullTarget(
  rx: EngineRoutineExercise,
  sets: EngineSet[],
  decision: Decision,
  opts?: { deload?: boolean },
): Decision {
  const remaining = rx.targetSets - decision.workingSets;
  if (remaining <= 0) return decision;
  const padWeight = decision.baseWeight;
  // The padding carries the effort the real sets already share, so a slot answered Easy or Hard
  // before its target was raised is projected the way it will actually be decided.
  const rir = feelOf(sets) ?? undefined;
  const pad: EngineSet[] = Array.from({ length: remaining }, () => ({ type: 'working', weight: padWeight, reps: rx.repMax, rir }));
  return decide(rx, [...sets, ...pad], opts);
}

export function liveVerdict(rx: EngineRoutineExercise, sets: EngineSet[], opts?: { deload?: boolean }): Verdict {
  const decision = decide(rx, sets, opts);

  // Calibrating (no weight prescribed yet), not a weight-producing exercise, or a deload session
  // (prescriptions are reduced and never progressed — see engine.ts) — decide() never gives an
  // increase from here no matter what the reps say, so there is never a line.
  if (decision.rule === 'calibrating' || decision.rule === 'not_applicable' || decision.rule === 'deload') {
    return { decision, repsToGoUp: null, line: null, tone: null };
  }

  const projected = projectFullTarget(rx, sets, decision, opts);
  const w = (n: number) => fmtWeight(rx.kind, n);

  if (projected.rule === 'increase') {
    const remaining = rx.targetSets - decision.workingSets;
    if (remaining <= 0) {
      // The real decision (on the sets actually logged) already earned the increase.
      return { decision, repsToGoUp: rx.repMax, line: `→ ${w(decision.toWeight)} next time`, tone: 'ok' };
    }
    // Still reachable: every set logged so far is at the top of the range, and there is enough
    // of the session left that hitting it the rest of the way would earn the increase.
    return {
      decision,
      repsToGoUp: rx.repMax,
      line: `${remaining} more at ${fmtNum(rx.repMax)} → ${w(projected.toWeight)}`,
      tone: 'accent',
    };
  }

  // Marked Hard at the top of the range: the weight is held on purpose, and the line says why.
  if (decision.rule === 'hold_hard') {
    return { decision, repsToGoUp: null, line: effortReason(decision, rx.kind), tone: 'muted' };
  }

  // Either a set already logged fell short of the top of the range, or there simply are not
  // enough sets left in the target for the rest to rescue it — either way, decide() would not
  // give an increase even in the best case, so this is a hold, named honestly.
  return { decision, repsToGoUp: null, line: `Holding ${w(decision.toWeight)}`, tone: 'muted' };
}
