/**
 * Assembles `AssistantContext` from live data for the on-device assistant. Read-only.
 */
import { db } from './db';
import { nextSessionPlan } from './planQueries';
import { bestsForExercise } from './recordsQueries';
import { exerciseHistory, outcomesForRoutineExercise, routineItems, sessionDetail, stallStatus } from './repo';
import { dayView } from './todayQueries';
import { weeklyDelta } from '@/domain/bodyweight';
import { fmtDate, fmtKg, fmtSetsLine } from '@/domain/format';
import { prescribe } from '@/domain/prescription';
import { countsForProgression } from '@/domain/sets';
import type { AssistantContext } from '@/domain/assistant';
import type { RoutineExercise, Settings } from '@/domain/types';

const LAST_SESSIONS_CAP = 3;

export interface GatherContextOpts {
  today: string;
  settings: Settings;
  exerciseId?: string;
  sessionId?: string;
  routineId?: string;
}

export async function gatherContext(opts: GatherContextOpts): Promise<AssistantContext> {
  const { today, settings, exerciseId, sessionId, routineId } = opts;
  const ctx: AssistantContext = { today };

  if (exerciseId) {
    const exercise = await db.exercises.get(exerciseId);
    if (exercise) {
      const inRoutine = routineId ? (await routineItems(routineId)).find((i) => i.exercise.id === exerciseId)?.rx : undefined;
      const rx: RoutineExercise | undefined = inRoutine ?? (await db.routineExercises.where('exerciseId').equals(exerciseId).first());

      const stall = rx ? await stallStatus(rx.id) : null;
      const stallLine = stall?.kind === 'stalled' ? `stalled ${stall.sessions} sessions at ${fmtKg(stall.weight)}` : undefined;

      let prescriptionLine: string | undefined;
      if (rx) {
        const lastOutcome = (await outcomesForRoutineExercise(rx.id))[0] ?? null;
        prescriptionLine = prescribe({
          rx,
          kind: exercise.kind,
          equipment: exercise.equipment,
          lastOutcome,
          stall,
          deload: false,
          settings,
        }).line;
      }

      const history = await exerciseHistory(exerciseId);
      const lastSessions = history.slice(0, LAST_SESSIONS_CAP).map((h) => {
        const counted = h.sets.filter((s) => countsForProgression(s.type));
        return { date: fmtDate(h.session.startedAt), sets: counted.length ? fmtSetsLine(counted, exercise.kind) : 'no working sets' };
      });

      const bests = await bestsForExercise(exerciseId);
      const bestsParts: string[] = [];
      if (bests.weight !== null) bestsParts.push(`best ${fmtKg(bests.weight)}`);
      if (bests.e1rm !== null) bestsParts.push(`e1RM ${fmtKg(bests.e1rm)}`);

      ctx.exercise = {
        name: exercise.name,
        muscleGroup: exercise.muscleGroup,
        cue: rx?.cue,
        notes: exercise.notes,
        prescription: prescriptionLine,
        lastSessions,
        bests: bestsParts.length ? bestsParts.join(' · ') : undefined,
        stall: stallLine,
      };
    }
  }

  if (sessionId) {
    const session = await db.sessions.get(sessionId);
    if (session) {
      const detail = await sessionDetail(sessionId);
      const elapsedMin = Math.max(0, Math.round((Date.now() - Date.parse(session.startedAt)) / 60000));
      const logged = (detail?.groups ?? []).map((g) => {
        const counted = g.sets.filter((s) => countsForProgression(s.type));
        const line = counted.length ? fmtSetsLine(counted, g.exercise.kind) : 'no working sets';
        return `${g.exercise.name} ${line}`;
      });
      ctx.session = { title: session.title, elapsedMin, logged };
    }
  }

  if (routineId) {
    const plan = await nextSessionPlan(routineId, settings);
    if (plan) {
      ctx.plan = {
        routine: plan.routine.name,
        exercises: plan.items.map((i) => `${i.exercise.name} ${i.prescription.line}`),
      };
    }
  }

  const bwRows = await db.bodyweight.toArray();
  if (bwRows.length > 0) {
    const sorted = [...bwRows].sort((a, b) => b.date.localeCompare(a.date));
    const delta = weeklyDelta(bwRows, today);
    ctx.bodyweight = { latestKg: sorted[0].kg, weeklyDeltaKg: delta?.deltaKg };
  }

  const day = await dayView(today, settings, today);
  ctx.nutrition = {
    kcal: Math.round(day.eaten.kcal),
    kcalTarget: day.calories?.kcal,
    proteinG: Math.round(day.eaten.protein),
    proteinTargetG: day.proteinTarget,
  };

  return ctx;
}
