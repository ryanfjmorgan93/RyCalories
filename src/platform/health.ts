/**
 * Steps from Health Connect, read on the phone. Samsung Health (and any other step counter) writes
 * its steps into Health Connect; Iron asks once for permission to READ steps and nothing else, and
 * reads them on the device. Nothing is written and nothing leaves the phone.
 *
 * On the web there is no Health Connect, and the Steps strip says so. The manifest side is in
 * android/app/src/main/AndroidManifest.xml: the rationale activity Health Connect requires, and
 * the plugin's other health permissions removed so the app declares only READ_STEPS.
 *
 * This is the one part of the app the test suites cannot reach: they run in a browser, where the
 * plugin reports itself unavailable. The maths on the records (src/domain/steps.ts) is tested; the
 * reading is tested against the plugin's documented shapes with the plugin faked, which proves the
 * mapping but not that the phone answers.
 */
import { Capacitor } from '@capacitor/core';
import { Health, type HealthPlugin } from '@capgo/capacitor-health';
import { addDays, toDateKey } from '@/domain/dates';
import { dailySteps, type StepDay } from '@/domain/steps';

export type StepsAccess = 'unavailable' | 'needs-permission' | 'granted';

/** The plugin, swappable for a test. */
let plugin: Pick<HealthPlugin, 'isAvailable' | 'checkAuthorization' | 'requestAuthorization' | 'readSamples'> = Health;
export function setHealthPluginForTest(p: typeof plugin): void {
  plugin = p;
}

const READ = { read: ['steps' as const] };

/** Whether steps can be read here, and whether Iron may. Never prompts. */
export async function stepsAccess(native = Capacitor.isNativePlatform()): Promise<StepsAccess> {
  if (!native) return 'unavailable';
  try {
    const { available } = await plugin.isAvailable();
    if (!available) return 'unavailable';
    const status = await plugin.checkAuthorization(READ);
    return status.readAuthorized.includes('steps') ? 'granted' : 'needs-permission';
  } catch {
    return 'unavailable';
  }
}

/** Opens Health Connect's own permission screen for reading steps. */
export async function requestStepsAccess(native = Capacitor.isNativePlatform()): Promise<StepsAccess> {
  if (!native) return 'unavailable';
  try {
    const status = await plugin.requestAuthorization(READ);
    return status.readAuthorized.includes('steps') ? 'granted' : 'needs-permission';
  } catch {
    return 'unavailable';
  }
}

/** The last `days` days of steps, today last. Null when they cannot be read. */
export async function readStepDays(now: Date, days = 7): Promise<StepDay[] | null> {
  const today = toDateKey(now);
  const [y, m, d] = addDays(today, -(days - 1))
    .split('-')
    .map(Number);
  const from = new Date(y, m - 1, d, 0, 0, 0, 0);
  try {
    // limit 0: every record in the window (the plugin pages through them all).
    const { samples } = await plugin.readSamples({ dataType: 'steps', startDate: from.toISOString(), endDate: now.toISOString(), limit: 0, ascending: true });
    return dailySteps(
      samples.map((s) => ({ value: s.value, startDate: s.startDate, sourceId: s.sourceId, sourceName: s.sourceName })),
      today,
      days,
    );
  } catch {
    return null;
  }
}
