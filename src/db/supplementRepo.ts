/**
 * The supplement checklist's writes. A tick is one row per supplement per day; ticking again
 * removes it, so a mis-tap is undone by the same tap. Taking a supplement off the list archives
 * it, so past ticks keep their name in a backup.
 */
import { db } from './db';
import { nowIso, toDateKey } from '@/domain/dates';
import { uuid } from '@/domain/ids';
import { cleanSupplementDose, cleanSupplementName, findSupplement } from '@/domain/supplements';
import type { Supplement, SupplementTime } from '@/domain/types';

export interface SupplementInput {
  name: string;
  dose?: string;
  time: SupplementTime;
  source?: Supplement['source'];
}

export type AddSupplementResult = { ok: true; supplement: Supplement; existed: boolean } | { ok: false; reason: 'empty' };

/**
 * Add a supplement to the end of its time of day. A name already on the list is not added twice:
 * the one there is returned as it is.
 */
export async function addSupplement(input: SupplementInput): Promise<AddSupplementResult> {
  const name = cleanSupplementName(input.name);
  if (!name) return { ok: false, reason: 'empty' };
  return db.transaction('rw', db.supplements, async () => {
    const all = await db.supplements.toArray();
    const held = findSupplement(all, name);
    if (held && held.name.toLowerCase() === name.toLowerCase()) return { ok: true as const, supplement: held, existed: true };
    const order = Math.max(-1, ...all.filter((s) => !s.archived && s.time === input.time).map((s) => s.order)) + 1;
    const supplement: Supplement = {
      id: uuid(),
      name,
      dose: cleanSupplementDose(input.dose),
      time: input.time,
      order,
      createdAt: nowIso(),
      source: input.source ?? 'owner',
    };
    await db.supplements.add(supplement);
    return { ok: true as const, supplement, existed: false };
  });
}

/** Change a supplement's name, dose or time of day. */
export async function updateSupplement(id: string, patch: Partial<Pick<Supplement, 'name' | 'dose' | 'time'>>): Promise<void> {
  // modify, not update: a cleared dose has to lose the key, and update({ dose: undefined }) keeps it.
  await db.supplements
    .where('id')
    .equals(id)
    .modify((s) => {
      if (patch.name !== undefined) {
        const name = cleanSupplementName(patch.name);
        if (name) s.name = name;
      }
      if ('dose' in patch) {
        const dose = cleanSupplementDose(patch.dose);
        if (dose === undefined) delete s.dose;
        else s.dose = dose;
      }
      if (patch.time !== undefined) s.time = patch.time;
    });
}

/** Take a supplement off the list. Its past ticks stay. */
export async function removeSupplement(id: string): Promise<void> {
  await db.supplements.update(id, { archived: true });
}

/** Tick or untick a supplement for a day (today unless given). Returns whether it is now ticked. */
export async function toggleSupplementTaken(supplementId: string, date = toDateKey()): Promise<boolean> {
  return db.transaction('rw', db.supplementLogs, async () => {
    const held = await db.supplementLogs.where('date').equals(date).filter((l) => l.supplementId === supplementId).toArray();
    if (held.length > 0) {
      await db.supplementLogs.bulkDelete(held.map((l) => l.id));
      return false;
    }
    await db.supplementLogs.add({ id: uuid(), date, supplementId, takenAt: nowIso() });
    return true;
  });
}

/** Mark supplements taken for a day without unticking any already ticked. Returns how many were newly ticked. */
export async function markSupplementsTaken(supplementIds: readonly string[], date = toDateKey()): Promise<number> {
  return db.transaction('rw', db.supplementLogs, async () => {
    const held = new Set((await db.supplementLogs.where('date').equals(date).toArray()).map((l) => l.supplementId));
    const fresh = [...new Set(supplementIds)].filter((id) => !held.has(id));
    const at = nowIso();
    await db.supplementLogs.bulkAdd(fresh.map((supplementId) => ({ id: uuid(), date, supplementId, takenAt: at })));
    return fresh.length;
  });
}
