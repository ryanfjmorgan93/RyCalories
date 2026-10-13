/**
 * The phone side of reminders against a real (fake-indexeddb) database and the real planner. The one
 * thing replaced is the native boundary, @capacitor/local-notifications and the app-state plugin,
 * which cannot run here; the tests say what Iron asks of them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  getPending: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn(),
  createChannel: vi.fn(),
}));
const appPlugin = vi.hoisted(() => ({ addListener: vi.fn() }));
const native = vi.hoisted(() => ({ on: true }));

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: plugin }));
vi.mock('@capacitor/app', () => ({ App: appPlugin }));
vi.mock('@/state/native', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/state/native')>()), isNative: () => native.on }));

import { loadReminderInput, rescheduleReminders, startReminders } from './reminders';
import { db } from '@/db/db';
import { addMeal } from '@/db/foodRepo';
import { logBodyweight, saveSettings, wipeAll } from '@/db/repo';
import { fromPortion } from '@/domain/food';
import { REMINDER_ID_FIRST, REMINDER_ID_LAST } from '@/domain/reminders';
import type { Exercise, Session, SetLog } from '@/domain/types';

// Monday 12 October 2026, 09:00 local time.
const NOW = new Date(2026, 9, 12, 9, 0);
const iso = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();

const QUADS: Exercise = {
  id: 'ex-quads',
  name: 'Leg press',
  kind: 'reps',
  muscleGroup: 'quads',
  isCompound: true,
  isLowerBody: true,
  defaultRestSec: 150,
  defaultIncrement: 5,
  unilateral: false,
  createdAt: iso(1, 8),
};

async function seedSession(day: number): Promise<void> {
  const session: Session = { id: 'sess-1', routineId: '', title: 'Legs', startedAt: iso(day, 17), endedAt: iso(day, 18) };
  const set: SetLog = { id: 'set-1', sessionId: 'sess-1', routineExerciseId: null, exerciseId: QUADS.id, index: 0, type: 'working', weight: 100, reps: 8, completedAt: iso(day, 17, 30) };
  await db.exercises.put(QUADS);
  await db.sessions.put(session);
  await db.setLogs.put(set);
}

beforeEach(async () => {
  vi.clearAllMocks();
  native.on = true;
  plugin.checkPermissions.mockResolvedValue({ display: 'granted' });
  plugin.getPending.mockResolvedValue({ notifications: [] });
  plugin.cancel.mockResolvedValue(undefined);
  plugin.schedule.mockResolvedValue({ notifications: [] });
  plugin.createChannel.mockResolvedValue(undefined);
  await wipeAll();
});

describe('loadReminderInput', () => {
  it('reads today\'s meals with their calories, the last finished session, the sets, and this week\'s weigh-ins', async () => {
    await addMeal({ name: 'Breakfast', date: '2026-10-12' }, [{ name: 'Oats', portion: '80 g', nutrition: fromPortion({ kcal: 300, protein: 10, carbs: 50, fat: 6 }) }]);
    await addMeal({ name: 'Lunch', date: '2026-10-12' }, [
      { name: 'Rice', portion: '1 cup', nutrition: fromPortion({ kcal: 400, protein: 8, carbs: 80, fat: 1 }) },
      { name: 'Chicken', portion: '150 g', nutrition: fromPortion({ kcal: 250, protein: 45, carbs: 0, fat: 5 }) },
    ]);
    await addMeal({ name: 'Yesterday', date: '2026-10-11' }, [{ name: 'Pizza', portion: '1', nutrition: fromPortion({ kcal: 900, protein: 30, carbs: 100, fat: 40 }) }]);
    await seedSession(9);
    await logBodyweight('2026-10-11', 81); // the Sunday before this week
    await logBodyweight('2026-10-13', 81.4);

    const input = await loadReminderInput(NOW);
    expect(input.meals.map((m) => [m.date, m.kcal]).sort()).toEqual([
      ['2026-10-12', 300],
      ['2026-10-12', 650],
    ]);
    expect(input.lastSessionDate).toBe('2026-10-09');
    expect(input.muscleRows).toEqual([{ muscleGroup: 'quads', type: 'working', completedAt: iso(9, 17, 30) }]);
    expect(input.bodyweightDates).toEqual(['2026-10-13']);
  });

  it('ignores a session that never finished, and is empty on a blank database', async () => {
    expect(await loadReminderInput(NOW)).toEqual({ meals: [], lastSessionDate: null, muscleRows: [], bodyweightDates: [], supplements: { labels: [], takenOn: {} } });
    await db.sessions.put({ id: 's', routineId: '', title: 'Open', startedAt: iso(11, 17) });
    expect((await loadReminderInput(NOW)).lastSessionDate).toBeNull();
  });
});

describe('rescheduleReminders', () => {
  it('cancels Iron\'s own pending reminders and not the rest timer\'s, then schedules the plan', async () => {
    plugin.getPending.mockResolvedValue({ notifications: [{ id: 7001 }, { id: 8103 }, { id: 8120 }, { id: 99 }] });
    await addMeal({ name: 'Lunch', date: '2026-10-12' }, [{ name: 'Rice', portion: '1', nutrition: fromPortion({ kcal: 1450, protein: 40, carbs: 200, fat: 30 }) }]);
    // addMeal stamps the real clock; pin it to lunchtime so the evening rule cannot depend on when the suite runs.
    await db.meals.toCollection().modify({ loggedAt: iso(12, 13) });

    expect(await rescheduleReminders(NOW)).toBe('scheduled');

    expect(plugin.cancel).toHaveBeenCalledTimes(1);
    expect(plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 8103 }, { id: 8120 }] });
    const { notifications } = plugin.schedule.mock.calls[0][0] as { notifications: { id: number; title: string; body: string; schedule: { at: Date; allowWhileIdle: boolean }; channelId?: string }[] };
    expect(notifications.length).toBeGreaterThan(7);
    for (const n of notifications) {
      expect(n.id).toBeGreaterThanOrEqual(REMINDER_ID_FIRST);
      expect(n.id).toBeLessThanOrEqual(REMINDER_ID_LAST);
      expect(n.schedule.allowWhileIdle).toBe(true);
      expect(n.schedule.at.getTime()).toBeGreaterThan(NOW.getTime());
      expect(n.channelId).toBe('iron-reminders');
    }
    expect(notifications.find((n) => n.title === 'Food')!.body).toBe("Log today's food: 1,450 kcal so far");
    // Cancelled before scheduled, so an old plan never outlives the new one.
    expect(plugin.cancel.mock.invocationCallOrder[0]).toBeLessThan(plugin.schedule.mock.invocationCallOrder[0]);
  });

  it('plans from the saved preferences', async () => {
    await saveSettings({ reminders: { food: { on: false, time: '20:30' }, training: { on: false, time: '17:30', afterDays: 2 }, weighIn: { on: true, weekday: 3, time: '07:15' }, supplements: { on: false, time: '08:30' } } });
    await rescheduleReminders(NOW);
    const { notifications } = plugin.schedule.mock.calls[0][0] as { notifications: { title: string; schedule: { at: Date } }[] };
    expect(notifications.map((n) => n.title)).toEqual(['Weigh-in']);
    const at = notifications[0].schedule.at;
    expect([at.getDay(), at.getHours(), at.getMinutes()]).toEqual([3, 7, 15]);
  });

  it('does nothing at all without notification permission', async () => {
    plugin.checkPermissions.mockResolvedValue({ display: 'denied' });
    expect(await rescheduleReminders(NOW)).toBe('no-permission');
    expect(plugin.cancel).not.toHaveBeenCalled();
    expect(plugin.schedule).not.toHaveBeenCalled();
  });

  it('cancels what it had scheduled when every reminder is switched off, without asking for permission', async () => {
    plugin.getPending.mockResolvedValue({ notifications: [{ id: 8100 }] });
    await saveSettings({ reminders: { food: { on: false, time: '20:30' }, training: { on: false, time: '17:30', afterDays: 2 }, weighIn: { on: false, weekday: 1, time: '12:00' }, supplements: { on: false, time: '08:30' } } });
    expect(await rescheduleReminders(NOW)).toBe('off');
    expect(plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 8100 }] });
    expect(plugin.schedule).not.toHaveBeenCalled();
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
  });

  it('is a no-op off the phone', async () => {
    native.on = false;
    expect(await rescheduleReminders(NOW)).toBe('unsupported');
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
    expect(plugin.schedule).not.toHaveBeenCalled();
  });

  it('carries on with the default channel when one cannot be created', async () => {
    plugin.createChannel.mockRejectedValue(new Error('no channels'));
    expect(await rescheduleReminders(NOW)).toBe('scheduled');
    const { notifications } = plugin.schedule.mock.calls[0][0] as { notifications: { channelId?: string }[] };
    expect(notifications.every((n) => n.channelId === undefined)).toBe(true);
  });

  it('reports a failure rather than throwing', async () => {
    plugin.schedule.mockRejectedValue(new Error('boom'));
    expect(await rescheduleReminders(NOW)).toBe('failed');
  });

  it('does not seed or change settings by running', async () => {
    const before = await db.settings.get('settings');
    await rescheduleReminders(NOW);
    expect(await db.settings.get('settings')).toEqual(before);
  });

  it('runs overlapping calls one after another', async () => {
    const order: string[] = [];
    plugin.getPending.mockImplementation(async () => {
      order.push('cancel-start');
      await new Promise((r) => setTimeout(r, 5));
      order.push('cancel-end');
      return { notifications: [] };
    });
    plugin.schedule.mockImplementation(async () => {
      order.push('schedule');
    });
    await Promise.all([rescheduleReminders(NOW), rescheduleReminders(NOW)]);
    expect(order).toEqual(['cancel-start', 'cancel-end', 'schedule', 'cancel-start', 'cancel-end', 'schedule']);
  });
});

describe('startReminders', () => {
  it('plans at once, replans when the app goes to the background and not when it comes back, and listens once', async () => {
    let onState: (s: { isActive: boolean }) => void = () => undefined;
    appPlugin.addListener.mockImplementation(async (_event: string, cb: (s: { isActive: boolean }) => void) => {
      onState = cb;
      return { remove: vi.fn() };
    });

    startReminders();
    startReminders();
    await vi.waitFor(() => expect(plugin.schedule).toHaveBeenCalledTimes(1));
    expect(appPlugin.addListener).toHaveBeenCalledTimes(1);
    expect(appPlugin.addListener.mock.calls[0][0]).toBe('appStateChange');

    onState({ isActive: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(plugin.schedule).toHaveBeenCalledTimes(1);

    onState({ isActive: false });
    await vi.waitFor(() => expect(plugin.schedule).toHaveBeenCalledTimes(2));
  });
});

describe('loadReminderInput: supplements', () => {
  it('reads the checklist in list order and today\'s ticks onward', async () => {
    const { addSupplement, toggleSupplementTaken } = await import('@/db/supplementRepo');
    const c = await addSupplement({ name: 'Creatine', dose: '5 g', time: 'any' });
    const d = await addSupplement({ name: 'Vitamin D', time: 'morning' });
    if (!c.ok || !d.ok) throw new Error('not added');
    await toggleSupplementTaken(d.supplement.id, '2026-10-12');
    await toggleSupplementTaken(c.supplement.id, '2026-10-11');
    const { supplements } = await loadReminderInput(NOW);
    expect(supplements?.labels.map((l) => l.label)).toEqual(['Vitamin D', 'Creatine 5 g']);
    expect(supplements?.takenOn).toEqual({ '2026-10-12': [d.supplement.id] });
  });
});
