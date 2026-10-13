/**
 * The supplement checklist: what the owner takes, and what is ticked on a day. Pure: rows in,
 * the day's list out. src/db/supplementRepo.ts writes; Home shows the day; the reminder planner
 * and the coach read the same day from here so all three agree.
 */
import type { Supplement, SupplementLog, SupplementTime } from './types';

export const SUPPLEMENT_TIMES: readonly SupplementTime[] = ['morning', 'midday', 'evening', 'any'];

export const SUPPLEMENT_TIME_LABEL: Record<SupplementTime, string> = {
  morning: 'Morning',
  midday: 'Midday',
  evening: 'Evening',
  any: 'Any time',
};

/** Longest name and dose kept; a tub label, not a paragraph. */
export const SUPPLEMENT_NAME_MAX = 40;
export const SUPPLEMENT_DOSE_MAX = 24;

export interface SupplementDayItem {
  supplement: Supplement;
  taken: boolean;
}

export interface SupplementDay {
  items: SupplementDayItem[];
  taken: number;
  total: number;
}

/** The list for a day: every supplement still on the list, by time of day then position, with its tick. */
export function supplementDay(supplements: readonly Supplement[], logs: readonly SupplementLog[], date: string): SupplementDay {
  const takenIds = new Set(logs.filter((l) => l.date === date).map((l) => l.supplementId));
  const items = supplements
    .filter((s) => !s.archived)
    .sort((a, b) => SUPPLEMENT_TIMES.indexOf(a.time) - SUPPLEMENT_TIMES.indexOf(b.time) || a.order - b.order || a.name.localeCompare(b.name))
    .map((supplement) => ({ supplement, taken: takenIds.has(supplement.id) }));
  return { items, taken: items.filter((i) => i.taken).length, total: items.length };
}

/** A name tidied for storing: trimmed, single spaces, cut to length. Empty when there is nothing. */
export function cleanSupplementName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, SUPPLEMENT_NAME_MAX);
}

/** A dose tidied for storing; undefined when blank. */
export function cleanSupplementDose(raw: string | undefined): string | undefined {
  const d = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, SUPPLEMENT_DOSE_MAX);
  return d === '' ? undefined : d;
}

/** The key two names are compared on: case, spaces and punctuation ignored ("Vitamin D3" = "vitamin-d3"). */
export function supplementKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9µ]+/g, '');
}

/** The supplement on the list that a name refers to, if any (archived ones are not on the list). */
export function findSupplement(supplements: readonly Supplement[], name: string): Supplement | undefined {
  const key = supplementKey(name);
  if (!key) return undefined;
  const live = supplements.filter((s) => !s.archived);
  return live.find((s) => supplementKey(s.name) === key) ?? live.find((s) => supplementKey(s.name).startsWith(key) || key.startsWith(supplementKey(s.name)));
}

/** "Creatine 5 g", or just the name when there is no dose. */
export function supplementLabel(s: Pick<Supplement, 'name' | 'dose'>): string {
  return s.dose ? `${s.name} ${s.dose}` : s.name;
}
