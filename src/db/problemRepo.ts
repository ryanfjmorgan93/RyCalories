/**
 * Problem reports on the phone (src/domain/problemReports.ts says what one holds). Written by the
 * coach's report_problem tool and by the error capture; read and shared from Settings.
 */
import { db } from './db';
import { uuid } from '@/domain/ids';
import { cleanProblem, isRepeat, PROBLEM_REPORTS_MAX, type ProblemInput } from '@/domain/problemReports';
import type { ProblemReport } from '@/domain/types';

/** Keeps a report; null when it said nothing, or repeats an error already kept today. The oldest go past the cap. */
export async function addProblemReport(input: ProblemInput, now: Date = new Date()): Promise<ProblemReport | null> {
  const clean = cleanProblem(input);
  if (!clean) return null;
  return db.transaction('rw', db.problemReports, async () => {
    const existing = await db.problemReports.orderBy('at').toArray();
    if (isRepeat(existing, clean, now)) return null;
    const report: ProblemReport = { id: uuid(), at: now.toISOString(), ...clean };
    await db.problemReports.put(report);
    const over = existing.length + 1 - PROBLEM_REPORTS_MAX;
    if (over > 0) await db.problemReports.bulkDelete(existing.slice(0, over).map((r) => r.id));
    return report;
  });
}

/** Every report, newest first. */
export async function listProblemReports(): Promise<ProblemReport[]> {
  return (await db.problemReports.orderBy('at').toArray()).reverse();
}

export async function clearProblemReports(): Promise<void> {
  await db.problemReports.clear();
}
