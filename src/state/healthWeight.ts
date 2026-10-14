import { db } from '@/db/db';
import { getSettings, importHealthWeights, saveSettings } from '@/db/repo';
import { toDateKey } from '@/domain/dates';
import { HEALTH_WEIGHT_DAYS, weightsToImport } from '@/domain/healthWeight';
import { healthAccess, readWeightSamples, requestHealthAccess, type HealthAccess } from '@/platform/health';

/**
 * Bodyweight from Health Connect into the log, while Settings → Health Connect has it on: the last
 * 90 days on each read, for the days with no reading of the owner's own and none they deleted.
 * Read when Home opens and when the app comes back to the front, like the steps.
 */

let inFlight: Promise<number> | null = null;

/** Reads and writes once; how many readings were added. Nothing happens while it is off or not allowed. */
export function syncHealthWeight(now: () => Date = () => new Date()): Promise<number> {
  inFlight ??= (async () => {
    try {
      const settings = await getSettings();
      if (!settings.healthWeight) return 0;
      if ((await healthAccess('weight')) !== 'granted') return 0;
      const at = now();
      const samples = await readWeightSamples(at, HEALTH_WEIGHT_DAYS);
      if (!samples) return 0;
      const have = await db.bodyweight.toArray();
      const skip = new Set([...have.map((b) => b.date), ...(settings.healthWeightSkip ?? [])]);
      return await importHealthWeights(weightsToImport(samples, skip, toDateKey(at)));
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Turns the read on (asking Health Connect for weight first) or off. Returns what Health Connect said. */
export async function setHealthWeight(on: boolean): Promise<HealthAccess | 'off'> {
  if (!on) {
    await saveSettings({ healthWeight: false });
    return 'off';
  }
  const access = await requestHealthAccess('weight');
  if (access === 'granted') {
    await saveSettings({ healthWeight: true });
    await syncHealthWeight();
  }
  return access;
}
