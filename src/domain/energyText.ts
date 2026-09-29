/**
 * The words for a maintenance estimate. Pure: a `Maintenance` in, plain strings out.
 *
 * Each line states a fact and stops. A figure always comes with the days and weigh-ins it stands
 * on; a gated estimate says which input fell short and by how much, and nothing about what to do.
 */

import { fmtDateKey } from './checkin';
import { MIN_SPAN_DAYS, loggedDaysNeeded, type Maintenance } from './energy';
import { fmtNum, fmtSignedKg } from './format';

/** "≈ 2,600 kcal a day". Null when the estimate is gated. */
export function maintenanceFigureText(m: Maintenance): string | null {
  return m.maintenanceKcal === null ? null : `≈ ${fmtNum(m.maintenanceKcal)} kcal a day`;
}

/** "1–5 Sep", "28 Aug–3 Sep" or "5 Sep": the days a group of weigh-ins fell on. */
export function dateRangeText(from: string, to: string): string {
  if (from === to) return fmtDateKey(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8, 10))}–${fmtDateKey(to)}`;
  return `${fmtDateKey(from)}–${fmtDateKey(to)}`;
}

/** "22 of 28 days logged · weigh-ins 1–7 Sep (3) and 19–25 Sep (2)". Null when gated. */
export function maintenanceBasisText(m: Maintenance): string | null {
  if (m.basis !== 'ok' || !m.startRange || !m.endRange) return null;
  const start = `${dateRangeText(m.startRange.from, m.startRange.to)} (${m.weighInsStart})`;
  const end = `${dateRangeText(m.endRange.from, m.endRange.to)} (${m.weighInsEnd})`;
  return `${m.loggedDays} of ${m.totalDays} days logged · weigh-ins ${start} and ${end}`;
}

/** "At your logged 2,400 a day, about −0.2 kg a week". Null when gated. */
export function maintenanceRateText(m: Maintenance): string | null {
  if (m.rateAtIntakeKgPerWeek === null || m.intakeAvg === null) return null;
  const rate = Math.round(m.rateAtIntakeKgPerWeek * 10) / 10;
  // fmtSignedKg would say "no change" here, which reads as nonsense after "about".
  const kg = rate === 0 ? '0 kg' : fmtSignedKg(rate);
  return `At your logged ${fmtNum(Math.round(m.intakeAvg))} a day, about ${kg} a week`;
}

/** The one fact that stands in for the figure when there is none. Null when there is a figure. */
export function maintenanceGateText(m: Maintenance): string | null {
  switch (m.basis) {
    case 'ok':
      return null;
    case 'window_too_short':
      return 'Needs the 4 or 8 week window';
    case 'too_few_weighins':
      if (m.weighInsStart === 0 && m.weighInsEnd === 0) return 'No weigh-ins in the first and last weeks';
      return m.weighInsStart === 0 ? 'No weigh-in in the first week of the window' : 'No weigh-in in the last week of the window';
    case 'too_short':
      return `Needs ${MIN_SPAN_DAYS} days between weigh-ins (${m.spanDays})`;
    case 'too_few_logged_days':
      return `Needs ${loggedDaysNeeded(m.totalDays)} of ${m.totalDays} days logged (${m.loggedDays} of ${m.totalDays})`;
  }
}
