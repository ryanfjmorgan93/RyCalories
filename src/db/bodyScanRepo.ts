/**
 * Body scans (InBody): the writes and reads behind the Progress › Body card.
 *
 * One scan per date. Saving a scan for a date that already has one replaces it, which is what makes
 * importing the same file twice harmless. A scan's weight also goes into the bodyweight log, but
 * only for a date that has no reading yet: a morning weigh-in the owner typed in stays theirs.
 */
import { db } from './db';
import { logBodyweight } from './repo';
import { nowIso } from '@/domain/dates';
import { uuid } from '@/domain/ids';
import type { ParsedScan } from '@/domain/inbody';
import type { BodyScan } from '@/domain/types';

export interface SaveScansResult {
  /** Scans written, new and replacing alike. */
  saved: number;
  /** Of those, how many replaced a scan already held for that date. */
  replaced: number;
  /** Bodyweight readings added because the scan's date had none. */
  weightsLogged: number;
}

/** Note on a bodyweight reading that came from a scan, so the log says where it is from. */
export const SCAN_WEIGHT_NOTE = 'InBody scan';

/**
 * Upsert scans by date. If a file somehow holds two for one date, the last one wins, as in the
 * parser. The whole save is one transaction: either every scan lands or none does.
 */
export async function saveScans(scans: readonly ParsedScan[]): Promise<SaveScansResult> {
  const lastPerDate = new Map<string, ParsedScan>();
  for (const s of scans) lastPerDate.set(s.date, s);
  const result: SaveScansResult = { saved: 0, replaced: 0, weightsLogged: 0 };
  if (lastPerDate.size === 0) return result;
  const importedAt = nowIso();
  await db.transaction('rw', [db.bodyScans, db.bodyweight], async () => {
    for (const scan of lastPerDate.values()) {
      const held = await db.bodyScans.where('date').equals(scan.date).toArray();
      const id = held[0]?.id ?? uuid();
      // More than one row for a date can only come from an older bug or a hand-edited backup; keep one.
      for (const extra of held.slice(1)) await db.bodyScans.delete(extra.id);
      const row: BodyScan = { ...scan, id, importedAt };
      await db.bodyScans.put(row);
      result.saved++;
      if (held.length > 0) result.replaced++;
      if (scan.weightKg !== undefined && (await db.bodyweight.where('date').equals(scan.date).count()) === 0) {
        await logBodyweight(scan.date, scan.weightKg, SCAN_WEIGHT_NOTE);
        result.weightsLogged++;
      }
    }
  });
  return result;
}

/** Every scan, oldest first. */
export async function listScans(): Promise<BodyScan[]> {
  return db.bodyScans.orderBy('date').toArray();
}

