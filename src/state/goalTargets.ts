/**
 * Keeps the daily targets in step with the goal (domain/goalTargets.ts): reads the latest scan,
 * weigh-in, measured maintenance, steps and training, works the targets out and saves them when
 * they changed. Runs at start-up, after a scan is saved, and when the goal is picked. Does nothing
 * without a goal: then the targets are the owner's own.
 */
import { db } from '@/db/db';
import { getSettings, listRoutines, saveSettings } from '@/db/repo';
import { trendWindow } from '@/db/trendQueries';
import { toDateKey } from '@/domain/dates';
import { estimateMaintenance } from '@/domain/energy';
import { GOALS, goalTargets } from '@/domain/goalTargets';
import { stepWeek } from '@/domain/steps';
import type { Settings } from '@/domain/types';
import { refreshSteps, stepsSnapshot } from './steps';

/** The maintenance window read for a measured figure: four weeks, as Progress shows it. */
const WINDOW_DAYS = 28;

export async function refreshGoalTargets(now: Date = new Date()): Promise<Settings | null> {
  let settings = await getSettings();
  if (!settings.goal) return null;
  const today = toDateKey(now);
  await refreshSteps(() => now).catch(() => undefined);

  const [scans, weighIn, routines, window] = await Promise.all([
    db.bodyScans.orderBy('date').toArray(),
    db.bodyweight.orderBy('date').last(),
    listRoutines(),
    trendWindow(today, WINDOW_DAYS, settings),
  ]);
  const scan = scans.at(-1);
  const weightKg = weighIn?.kg ?? scan?.weightKg;
  const m = estimateMaintenance(window.trend.days, window.bodyweight, { today });
  const steps = stepsSnapshot(today);
  const minutes = routines.map((r) => r.targetMinutes).filter((x): x is number => typeof x === 'number' && x > 0);

  const t =
    weightKg === undefined
      ? null
      : goalTargets({
          goal: settings.goal,
          weightKg,
          leanMassKg: scan?.leanMassKg,
          bmrKcal: scan?.bmrKcal,
          stepsPerDay: steps ? (stepWeek(steps, 0).average ?? undefined) : undefined,
          sessionsPerWeek: settings.weeklySessionTarget ?? 3,
          sessionMinutes: minutes.length > 0 ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : 60,
          measured: m.basis === 'ok' && m.maintenanceKcal !== null ? { kcal: m.maintenanceKcal, days: m.totalDays } : undefined,
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
    : { targetsBasis: ['Log a weigh-in and import an InBody scan, or log two weeks of food and weigh-ins, to work the targets out.'] };
  const changed = (Object.keys(patch) as (keyof Settings)[]).some((k) => JSON.stringify(settings[k]) !== JSON.stringify(patch[k]));
  if (!changed) return settings;
  // A held target needs a start day; the first one is today.
  if (t && !settings.calorieStartDate) patch.calorieStartDate = today;
  settings = await saveSettings(patch);
  return settings;
}
