/**
 * Weekly training volume by muscle group, and per-muscle recency. Read-only queries; call from
 * useLiveQuery.
 */
import { db } from './db';
import {
  muscleRecency as muscleRecencyFromRows,
  weeklySetsByMuscle as weeklySetsByMuscleFromRows,
  type MuscleSetRow,
} from '@/domain/volume';
import type { MuscleGroup, Settings } from '@/domain/types';

async function muscleSetRows(): Promise<MuscleSetRow[]> {
  const [sets, sessions, exercises] = await Promise.all([db.setLogs.toArray(), db.sessions.toArray(), db.exercises.toArray()]);
  const completedIds = new Set(sessions.filter((s) => s.endedAt).map((s) => s.id));
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const rows: MuscleSetRow[] = [];
  for (const s of sets) {
    if (!completedIds.has(s.sessionId)) continue;
    const ex = exerciseById.get(s.exerciseId);
    if (!ex) continue;
    rows.push({ muscleGroup: ex.muscleGroup, type: s.type, completedAt: s.completedAt });
  }
  return rows;
}

/** Sets per muscle group in the local week (Monday–Sunday) containing `weekStart`, completed sessions only. */
export async function weeklySetsByMuscle(weekStart: string): Promise<Partial<Record<MuscleGroup, number>>> {
  return weeklySetsByMuscleFromRows(await muscleSetRows(), weekStart);
}

/** Days since the most recent counted set per muscle group, as of `today`. */
export async function muscleRecency(today: string): Promise<Partial<Record<MuscleGroup, number>>> {
  return muscleRecencyFromRows(await muscleSetRows(), today);
}

export interface WeeklySetsRow {
  muscleGroup: MuscleGroup;
  sets: number;
  target: number | null;
}

/** Every muscle group with sets logged this week, or a weekly target, sorted by sets desc. */
export async function weeklySetsTable(weekStart: string, settings: Settings): Promise<WeeklySetsRow[]> {
  const bySets = await weeklySetsByMuscle(weekStart);
  const targets = settings.weeklySetTargets ?? {};
  const groups = new Set<MuscleGroup>([...(Object.keys(bySets) as MuscleGroup[]), ...(Object.keys(targets) as MuscleGroup[])]);
  const rows: WeeklySetsRow[] = [...groups].map((g) => ({ muscleGroup: g, sets: bySets[g] ?? 0, target: targets[g] ?? null }));
  rows.sort((a, b) => b.sets - a.sets);
  return rows;
}
