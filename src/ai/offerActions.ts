/**
 * The coach's offers and the supplement ticks. Proposing targets and suggesting a supplement
 * change nothing: they check the request and hand back what to offer, and the chat shows it with a
 * button the owner taps (docs/adr/0004: the coach never overwrites the owner's own figures).
 * Ticking supplements is the owner's own statement ("took my creatine"), so it writes, like
 * logging a weight.
 */
import { db } from '@/db/db';
import { getSettings } from '@/db/repo';
import { markSupplementsTaken } from '@/db/supplementRepo';
import { recentDayProblem, toDateKey } from '@/domain/dates';
import { fmtNum } from '@/domain/format';
import { calorieTargetOn } from '@/domain/nutrition';
import { cleanSupplementDose, cleanSupplementName, findSupplement, SUPPLEMENT_TIMES, supplementDay, supplementLabel } from '@/domain/supplements';
import type { SupplementTime } from '@/domain/types';
import type { SupplementSuggestion } from './types';

export interface OfferResult {
  ok: boolean;
  result: string;
  description?: string;
}

export interface ProposeTargetsInput {
  calories?: number;
  protein?: number;
}

export interface SuggestSupplementInput {
  name: string;
  dose?: string;
  time?: SupplementTime;
  why: string;
}

export interface TickSupplementsInput {
  names?: string[];
  all?: boolean;
  date?: string;
}

/** The same bounds the weekly review holds a proposed target to (src/ai/moments.ts). */
export const CALORIE_TARGET_RANGE: [number, number] = [1200, 6000];
export const PROTEIN_TARGET_RANGE: [number, number] = [40, 400];

const within = (n: unknown, [lo, hi]: [number, number]): n is number => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

export function createOfferActions(now: () => Date = () => new Date()) {
  const today = () => toDateKey(now());

  return {
    async proposeTargets(input: ProposeTargetsInput): Promise<OfferResult & { targets?: { calories?: number; protein?: number } }> {
      const wantCal = input.calories !== undefined;
      const wantPro = input.protein !== undefined;
      if (!wantCal && !wantPro) return { ok: false, result: 'Propose a calorie target, a protein target, or both.' };
      if (wantCal && !within(input.calories, CALORIE_TARGET_RANGE)) return { ok: false, result: `A daily calorie target must be between ${fmtNum(CALORIE_TARGET_RANGE[0])} and ${fmtNum(CALORIE_TARGET_RANGE[1])} kcal.` };
      if (wantPro && !within(input.protein, PROTEIN_TARGET_RANGE)) return { ok: false, result: `A daily protein target must be between ${PROTEIN_TARGET_RANGE[0]} and ${PROTEIN_TARGET_RANGE[1]} g.` };
      const settings = await getSettings();
      const targets: { calories?: number; protein?: number } = {};
      const same: string[] = [];
      if (wantCal) {
        const kcal = Math.round(input.calories!);
        const current = calorieTargetOn(today(), settings);
        if (current?.kcal === kcal && settings.calorieCeiling === kcal) same.push(`calories are already ${fmtNum(kcal)}`);
        else targets.calories = kcal;
      }
      if (wantPro) {
        const g = Math.round(input.protein!);
        if (settings.proteinTarget === g) same.push(`protein is already ${g} g`);
        else targets.protein = g;
      }
      if (targets.calories === undefined && targets.protein === undefined) return { ok: true, result: `Nothing to offer: ${same.join(' and ')}.` };
      const parts = [targets.calories !== undefined ? `${fmtNum(targets.calories)} kcal` : null, targets.protein !== undefined ? `${targets.protein} g protein` : null].filter(Boolean);
      return {
        ok: true,
        result: `Offered ${parts.join(' and ')} as buttons under your reply. Nothing has changed: the owner taps to use them.${same.length ? ` (Already set: ${same.join(', ')}.)` : ''}`,
        targets,
      };
    },

    async suggestSupplement(input: SuggestSupplementInput): Promise<OfferResult & { suggestion?: SupplementSuggestion }> {
      const name = cleanSupplementName(input.name ?? '');
      if (!name) return { ok: false, result: 'Name the supplement.' };
      const why = (input.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
      if (!why) return { ok: false, result: 'Give one short reason for the suggestion.' };
      const held = findSupplement(await db.supplements.toArray(), name);
      if (held) return { ok: true, result: `${supplementLabel(held)} is already on their list.` };
      const time = input.time && SUPPLEMENT_TIMES.includes(input.time) ? input.time : 'any';
      const suggestion: SupplementSuggestion = { name, dose: cleanSupplementDose(input.dose), time, why };
      return { ok: true, result: `Offered to add ${supplementLabel(suggestion)} to their list. Nothing is added until the owner taps Add.`, suggestion };
    },

    async tickSupplements(input: TickSupplementsInput): Promise<OfferResult> {
      const day = input.date ?? today();
      const wrongDay = recentDayProblem(day, today(), 7);
      if (wrongDay) return { ok: false, result: wrongDay };
      const supplements = await db.supplements.toArray();
      const list = supplementDay(supplements, [], day).items.map((i) => i.supplement);
      if (list.length === 0) return { ok: false, result: 'Their supplement list is empty. They add supplements on Home.' };
      const picked = input.all ? list : [];
      const unknown: string[] = [];
      for (const n of input.names ?? []) {
        const s = findSupplement(list, n);
        if (s) picked.push(s);
        else unknown.push(n);
      }
      if (picked.length === 0) return { ok: false, result: `None of those is on their list. It has: ${list.map((s) => s.name).join(', ')}.` };
      const fresh = await markSupplementsTaken(
        picked.map((s) => s.id),
        day,
      );
      const names = [...new Set(picked.map((s) => s.name))];
      const when = day === today() ? 'today' : day;
      const missing = unknown.length ? ` Not on the list: ${unknown.join(', ')}.` : '';
      if (fresh === 0) return { ok: true, result: `Already ticked ${when}: ${names.join(', ')}.${missing}` };
      return { ok: true, result: `Ticked ${when}: ${names.join(', ')}.${missing}`, description: `Supplements ticked${day === today() ? '' : ` (${day})`}: ${names.join(', ')}` };
    },
  };
}

export type OfferActions = ReturnType<typeof createOfferActions>;
