/**
 * Reminders on the phone: read the owner's data, plan with `planReminders`, and hand the result to
 * Android as scheduled local notifications. No network, no model, and nothing without the system's
 * notification permission (the same permission the rest-over notification uses).
 *
 * The plan is a snapshot, so it is redone whenever it could have gone stale: at boot, and each time
 * the app goes to the background (where the owner has just logged something, or not). Every run
 * first cancels Iron's own pending reminders, found by their id range, and schedules the fresh plan;
 * the rest-over notification (id 7001, src/state/native.ts) is outside that range and untouched.
 */
import { App as CapacitorApp } from '@capacitor/app';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { db } from '@/db/db';
import { sumItems } from '@/db/foodRepo';
import { muscleSetRowsFrom } from '@/db/volumeQueries';
import { isoToDateKey, mondayOf, toDateKey } from '@/domain/dates';
import { isStaleSession } from '@/domain/session';
import { isReminderId, planReminders, resolveReminders, type ReminderInput } from '@/domain/reminders';
import { supplementDay, supplementLabel } from '@/domain/supplements';
import { isNative } from '@/state/native';

/** Its own channel, so Iron's reminders can be silenced in system settings apart from the rest timer. */
const CHANNEL_ID = 'iron-reminders';

/** Everything `planReminders` reads, from the database. Reads only; never seeds or writes. */
export async function loadReminderInput(now: Date): Promise<ReminderInput> {
  const today = toDateKey(now);

  const meals = await db.meals.where('date').aboveOrEqual(today).toArray();
  const items = meals.length ? await db.mealItems.where('mealId').anyOf(meals.map((m) => m.id)).toArray() : [];
  const itemsByMeal = new Map<string, typeof items>();
  for (const item of items) itemsByMeal.set(item.mealId, [...(itemsByMeal.get(item.mealId) ?? []), item]);

  const [sets, sessions, exercises, weights, supplements, supplementLogs] = await Promise.all([
    db.setLogs.toArray(),
    db.sessions.toArray(),
    db.exercises.toArray(),
    db.bodyweight.where('date').aboveOrEqual(mondayOf(today)).toArray(),
    db.supplements.toArray(),
    db.supplementLogs.where('date').aboveOrEqual(today).toArray(),
  ]);
  const takenOn: Record<string, string[]> = {};
  for (const l of supplementLogs) (takenOn[l.date] ??= []).push(l.supplementId);

  let lastSessionDate: string | null = null;
  for (const s of sessions) {
    // A session still going counts (no "time to train" mid-workout); one left open for hours does not.
    if (!s.endedAt && isStaleSession(s.startedAt, now.getTime())) continue;
    const day = isoToDateKey(s.endedAt ?? s.startedAt);
    if (lastSessionDate === null || day > lastSessionDate) lastSessionDate = day;
  }

  return {
    meals: meals.map((m) => ({ date: m.date, loggedAt: m.loggedAt, kcal: sumItems(itemsByMeal.get(m.id) ?? []).kcal })),
    lastSessionDate,
    muscleRows: muscleSetRowsFrom(sets, sessions, exercises),
    bodyweightDates: weights.map((w) => w.date),
    supplements: { labels: supplementDay(supplements, [], today).items.map(({ supplement }) => ({ id: supplement.id, label: supplementLabel(supplement) })), takenOn },
  };
}

async function cancelOwnPending(): Promise<void> {
  const { notifications } = await LocalNotifications.getPending();
  const ours = notifications.filter((n) => isReminderId(n.id));
  if (ours.length > 0) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
}

async function ensureChannel(): Promise<string | undefined> {
  try {
    await LocalNotifications.createChannel({ id: CHANNEL_ID, name: 'Reminders', description: 'Food, training and weigh-in reminders', importance: 3 });
    return CHANNEL_ID;
  } catch {
    return undefined; // the default channel still delivers them
  }
}

export type RescheduleOutcome = 'scheduled' | 'off' | 'no-permission' | 'unsupported' | 'failed';

// One run at a time: boot and a quick background can overlap, and a cancel from one must not land
// between the other's cancel and schedule.
let chain: Promise<unknown> = Promise.resolve();

/**
 * Replace Iron's pending reminders with the plan for the next seven days. Safe to call from
 * anywhere and as often as wanted; resolves with what it did, and never rejects.
 */
export function rescheduleReminders(now: Date = new Date()): Promise<RescheduleOutcome> {
  const run = chain.then(() => reschedule(now));
  chain = run.catch(() => undefined);
  return run;
}

async function reschedule(now: Date): Promise<RescheduleOutcome> {
  if (!isNative()) return 'unsupported';
  try {
    // Read the row directly: getSettings would seed a missing one, which is a write this has no business making.
    const prefs = resolveReminders((await db.settings.get('settings'))?.reminders);
    if (!prefs.food.on && !prefs.training.on && !prefs.weighIn.on && !prefs.supplements.on) {
      await cancelOwnPending();
      return 'off';
    }
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return 'no-permission';

    const plan = planReminders(await loadReminderInput(now), now, prefs);
    await cancelOwnPending();
    if (plan.length === 0) return 'scheduled';
    const channelId = await ensureChannel();
    const notifications: LocalNotificationSchema[] = plan.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      schedule: { at: p.at, allowWhileIdle: true },
      smallIcon: 'ic_stat_iron',
      ...(channelId ? { channelId } : {}),
    }));
    await LocalNotifications.schedule({ notifications });
    return 'scheduled';
  } catch {
    return 'failed';
  }
}

let started = false;

/** Plan now, and again every time the app goes to the background. Once per launch; a no-op off the phone. */
export function startReminders(): void {
  if (started || !isNative()) return;
  started = true;
  void rescheduleReminders();
  void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) void rescheduleReminders();
  }).catch(() => {
    /* no listener means no replanning on background; boot still planned once */
  });
}
