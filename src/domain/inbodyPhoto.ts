/**
 * An InBody result sheet that Claude read from a photo, as the scans the import sheet previews
 * (`ParsedInbody`, src/domain/inbody.ts). Pure: no IO, no clock (today is passed in).
 *
 * One photo is one scan. It is dated by the sheet when the sheet shows a date that could be real,
 * and otherwise today, and the owner is told which. Nothing here saves anything: the preview sheet
 * shows the figures for the owner to check against the paper before they are kept.
 */

import { daysBetween } from './dates';
import type { ParsedInbody, ParsedScan } from './inbody';

/** The measures of a sheet, named as `BodyScan` names them (structurally `InbodyReading`, src/ai/vision.ts). */
export interface PhotoReading {
  date?: string;
  weightKg?: number;
  skeletalMuscleKg?: number;
  bodyFatKg?: number;
  bodyFatPct?: number;
  leanMassKg?: number;
  totalBodyWaterL?: number;
  bmrKcal?: number;
  visceralFatLevel?: number;
  ecwRatio?: number;
  inbodyScore?: number;
  phaseAngle?: number;
}

const MEASURES = [
  'weightKg',
  'skeletalMuscleKg',
  'bodyFatKg',
  'bodyFatPct',
  'leanMassKg',
  'totalBodyWaterL',
  'bmrKcal',
  'visceralFatLevel',
  'ecwRatio',
  'inbodyScore',
  'phaseAngle',
] as const;

/** A YYYY-MM-DD that is a real day, not in the future and not before InBody scales existed. */
function plausibleDate(date: string | undefined, today: string): date is string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const real = new Date(Date.UTC(y, m - 1, d));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) return false;
  return y >= 2000 && daysBetween(date, today) >= 0;
}

/** The sheet as one previewable scan, or null when no measure could be read from it. */
export function parsedFromReading(reading: PhotoReading, today: string): ParsedInbody | null {
  const measures: Partial<Record<(typeof MEASURES)[number], number>> = {};
  for (const key of MEASURES) {
    const value = reading[key];
    if (typeof value === 'number' && Number.isFinite(value)) measures[key] = value;
  }
  if (Object.keys(measures).length === 0) return null;

  const printed = reading.date;
  const dated = plausibleDate(printed, today);
  const scan: ParsedScan = { date: dated ? printed : today, source: 'photo', ...measures };
  const result: ParsedInbody = { scans: [scan], skipped: [] };
  if (!dated) {
    result.dateNote = reading.date
      ? "The date on the sheet didn't look right, so today's date is used."
      : "The sheet shows no date, so today's date is used.";
  }
  return result;
}
