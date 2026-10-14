/**
 * Problem reports: something in the app that did not work, written down on the phone so the owner
 * can share it with whoever fixes the app. Pure: what a report holds, what is cut from it, and the
 * text it is shared as. src/db/problemRepo.ts keeps them; the coach files them (report_problem) and
 * the app files an error nothing caught (src/platform/errorReports.ts).
 *
 * Nothing here sends anything anywhere. A report leaves the phone only when the owner shares it.
 */
import type { ProblemReport, ProblemSource } from './types';

export const PROBLEM_SUMMARY_MAX = 200;
export const PROBLEM_DETAIL_MAX = 4000;
/** The most reports kept; the oldest go first. */
export const PROBLEM_REPORTS_MAX = 100;
/** An error already reported within this long is not reported again. */
export const PROBLEM_REPEAT_MS = 24 * 60 * 60 * 1000;

/** A Claude key, or anything shaped like one: never written into a report (docs/adr/0003). */
const KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]+/g;

/** Text with any key taken out, spaces tidied and cut to `max`. */
export function scrubbed(text: string | undefined, max: number): string {
  return (text ?? '')
    .replace(KEY_PATTERN, '[key removed]')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

export interface ProblemInput {
  source: ProblemSource;
  summary: string;
  detail?: string;
  screen?: string;
  build?: string;
}

/** A report as it is kept: the summary on one line, keys removed, everything cut to length. Null when it says nothing. */
export function cleanProblem(input: ProblemInput): Omit<ProblemReport, 'id' | 'at'> | null {
  const summary = scrubbed(input.summary.split('\n')[0], PROBLEM_SUMMARY_MAX);
  if (summary === '') return null;
  const detail = scrubbed(input.detail, PROBLEM_DETAIL_MAX);
  return {
    source: input.source,
    summary,
    ...(detail ? { detail } : {}),
    ...(input.screen ? { screen: scrubbed(input.screen, 200) } : {}),
    ...(input.build ? { build: input.build } : {}),
  };
}

/** Whether an error report says what one already filed in the last day says: the same error is written down once. */
export function isRepeat(existing: readonly Pick<ProblemReport, 'at' | 'source' | 'summary'>[], next: Pick<ProblemReport, 'source' | 'summary'>, now: Date): boolean {
  if (next.source !== 'error') return false;
  return existing.some((r) => r.source === 'error' && r.summary === next.summary && now.getTime() - Date.parse(r.at) < PROBLEM_REPEAT_MS);
}

const SOURCE_LABEL: Record<ProblemSource, string> = { coach: 'coach', error: 'app error' };

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** The reports as one plain text, newest first, to paste wherever they are going. */
export function problemsText(reports: readonly ProblemReport[], build: string, now: Date): string {
  const sorted = [...reports].sort((a, b) => b.at.localeCompare(a.at));
  const head = `Iron problem reports · ${build} · ${when(now.toISOString())} · ${sorted.length} ${sorted.length === 1 ? 'report' : 'reports'}`;
  const body = sorted.map((r, i) => {
    const lines = [`${i + 1}. ${when(r.at)} · ${SOURCE_LABEL[r.source]} · ${r.summary}`];
    if (r.screen) lines.push(`   Screen: ${r.screen}`);
    if (r.build && r.build !== build) lines.push(`   Build: ${r.build}`);
    if (r.detail) lines.push(...r.detail.split('\n').map((l) => `   ${l}`));
    return lines.join('\n');
  });
  return [head, ...body].join('\n\n');
}
