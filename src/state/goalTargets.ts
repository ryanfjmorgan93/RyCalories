/**
 * Keeps the daily targets in step with the goal (domain/goalTargets.ts): reads the latest scan,
 * weigh-in, measured maintenance, steps and the sessions actually logged, works the targets out and
 * saves them when they changed. Runs at start-up, after a scan is saved, and when the goal is picked. Does nothing
 * without a goal: then the targets are the owner's own.
 */
import { db } from '@/db/db';
import { getSettings, saveSettings } from '@/db/repo';
import { trendWindow } from '@/db/trendQueries';
import { addDays, toDateKey } from '@/domain/dates';
import { estimateMaintenance } from '@/domain/energy';
import { maintenanceNeedsText } from '@/domain/energyText';
import { GOALS, goalTargets } from '@/domain/goalTargets';
import { stepWeek } from '@/domain/steps';
import type { Settings } from '@/domain/types';
import { refreshSteps, stepsSnapshot } from './steps';

/** The maintenance window read for a measured figure, and for the lifting logged: four weeks, as Progress shows it. */
const WINDOW_DAYS = 28;

/** A session longer than this counts as this: one left open overnight is not ten hours of lifting. */
const MAX_SESSION_MIN = 180;

export async function refreshGoalTargets(now: Date = new Date()): Promise<Settings | null> {
  let settings = await getSettings();
  if (!settings.goal) return null;
  const today = toDateKey(now);
  await refreshSteps(() => now).catch(() => undefined);

  const since = addDays(today, -(WINDOW_DAYS - 1));
  const [scans, weighIn, sessions, window] = await Promise.all([
    db.bodyScans.orderBy('date').toArray(),
    db.bodyweight.orderBy('date').last(),
    db.sessions.toArray(),
    trendWindow(today, WINDOW_DAYS, settings),
  ]);
  const scan = scans.at(-1);
  const weightKg = weighIn?.kg ?? scan?.weightKg;
  const m = estimateMaintenance(window.trend.days, window.bodyweight, { today });
  const steps = stepsSnapshot(today);
  // Sessions logged in the window with a real length (a coach-filled one has none).
  const lengths = sessions
    .filter((s) => s.endedAt && s.source !== 'coach' && toDateKey(new Date(s.startedAt)) >= since && toDateKey(new Date(s.startedAt)) <= today)
    .map((s) => Math.min(MAX_SESSION_MIN, (s.durationSec ?? (Date.parse(s.endedAt!) - Date.parse(s.startedAt)) / 1000) / 60))
    .filter((min) => min > 0);

  const t =
    weightKg === undefined
      ? null
      : goalTargets({
          goal: settings.goal,
          weightKg,
          leanMassKg: scan?.leanMassKg,
          bmrKcal: scan?.bmrKcal,
          stepsPerDay: steps ? (stepWeek(steps, 0).average ?? undefined) : undefined,
          training: { sessions: lengths.length, minutes: Math.round(lengths.reduce((a, b) => a + b, 0)), days: WINDOW_DAYS },
          measured:
            m.basis === 'ok' && m.intakeAvg !== null && m.deltaKg !== null
              ? { intakeAvg: m.intakeAvg, loggedDays: m.loggedDays, totalDays: m.totalDays, deltaKg: m.deltaKg, spanDays: m.spanDays }
              : undefined,
          measuredGate: maintenanceNeedsText(m) ?? undefined,
        });

  const patch: Partial<Settings> = t
    ? (() => {
        const rate = (GOALS.find((g) => g.goal === settings.goal)!.ratePct / 100) * weightKg!;
        return {
          calorieStart: t.kcal,
          calorieCeiling: t.kcal,
          proteinTarget: t.protein,
          proteinTargetLegDay: t.protein,
          carbTarget: t.carbs,
          fatTarget: t.fat,
          // The pace the bodyweight card judges against: the goal's rate, give or take 0.1 kg.
          weeklyGainTargetMin: Math.round((rate - 0.1) * 100) / 100,
          weeklyGainTargetMax: Math.round((rate + 0.1) * 100) / 100,
          targetsBasis: t.lines,
        };
      })()
    : { targetsBasis: ['Log a weigh-in and import an InBody scan to estimate the targets, or log food and weigh in for 4 weeks to measure them.'] };
  const changed = (Object.keys(patch) as (keyof Settings)[]).some((k) => JSON.stringify(settings[k]) !== JSON.stringify(patch[k]));
  if (!changed) return settings;
  // A held target needs a start day; the first one is today.
  if (t && !settings.calorieStartDate) patch.calorieStartDate = today;
  settings = await saveSettings(patch);
  return settings;
}
