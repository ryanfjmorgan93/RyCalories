import { beforeEach, describe, expect, it } from 'vitest';
import { calendarData } from './calendarQueries';
import { db } from './db';
import { finishSession, resetToSeed, saveSettings, startSession } from './repo';
import { SEED_ROUTINE_IDS } from './seed';

const HINGE = SEED_ROUTINE_IDS['Lower (Hinge)'];

beforeEach(async () => {
  await resetToSeed();
});

async function completedSessionOn(dateIso: string): Promise<void> {
  const session = await startSession(HINGE);
  await db.sessions.update(session.id, { startedAt: dateIso });
  await finishSession(session.id, { choices: [] });
}

describe('calendarData', () => {
  it('builds a streak against weeklySessionTarget and reports this week’s completed count', async () => {
    await saveSettings({ weeklySessionTarget: 1 });
    // A completed session in each of the last three weeks (Mondays), including this week.
    await completedSessionOn('2026-08-24T18:00:00.000Z'); // Mon 24 Aug — 3 weeks ago
    await completedSessionOn('2026-08-31T18:00:00.000Z'); // Mon 31 Aug — 2 weeks ago
    await completedSessionOn('2026-09-07T18:00:00.000Z'); // Mon 7 Sep — this week

    const settings = (await db.settings.get('settings'))!;
    const data = await calendarData(4, '2026-09-08', settings);

    expect(data.weeklyTarget).toBe(1);
    expect(data.streak).toBe(3);
    expect(data.line).not.toBe('');
    expect(data.thisWeek).toBe(1);
    // 4 weeks × 7 days.
    expect(data.grid).toHaveLength(4);
    expect(data.grid[0]).toHaveLength(7);
    // The grid's last week contains 8 Sep with a session logged.
    const lastWeek = data.grid[data.grid.length - 1];
    const day = lastWeek.find((d) => d.date === '2026-09-07')!;
    expect(day.sessions).toHaveLength(1);
  });

  it('does not count a session that never finished', async () => {
    const session = await startSession(HINGE);
    await db.sessions.update(session.id, { startedAt: '2026-09-07T18:00:00.000Z' });

    const settings = (await db.settings.get('settings'))!;
    const data = await calendarData(1, '2026-09-08', settings);
    expect(data.thisWeek).toBe(0);
  });
});
