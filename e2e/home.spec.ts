import { expect, test, type Page } from '@playwright/test';
import { messageBody, text } from '../src/test/fakeClaude';
import { fresh } from './fresh';

/**
 * Home: every routine as a card ordered by how long since what it trains was last trained, the
 * next session's plan on tap, the weekly weigh-in and the Monday review.
 *
 * Time is fixed with Playwright's clock (the date, not the timers), and past training is written
 * straight into IndexedDB because the only other way to have last week's sessions is to wait for
 * them. The Anthropic API is never reached: every request to it is answered here.
 */

const FAKE_KEY = 'sk-ant-api03-HOMESPECHOMESPECHOMESPECHOMESPECabcd';

// 2026-10-07 is a Wednesday and 2026-10-12 the Monday after it.
const WED = new Date(2026, 9, 7, 10, 0, 0);
const THU = new Date(2026, 9, 15, 10, 0, 0);
const MON = new Date(2026, 9, 12, 9, 0, 0);
const TUE = new Date(2026, 9, 13, 9, 0, 0);
const NEXT_MON = new Date(2026, 9, 19, 9, 0, 0);

interface SeedSession {
  routine: string;
  daysAgo: number;
  /** Weight of every set (default 20). */
  weight?: number;
  /** Writes a progression decision for the routine's first exercise, so the next plan shows a change. */
  rose?: { from: number; to: number };
}

/** Finished sessions written straight into the database, dated relative to the page's (fixed) clock. Reload afterwards. */
async function seedSessions(page: Page, seeds: SeedSession[]): Promise<void> {
  await page.evaluate(async (seeds) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('iron');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all = <T>(store: string) =>
      new Promise<T[]>((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
      });
    const routines = await all<{ id: string; name: string }>('routines');
    const rxs = await all<{ id: string; routineId: string; exerciseId: string; order: number }>('routineExercises');
    const tx = db.transaction(['sessions', 'setLogs', 'decisions'], 'readwrite');
    for (const seed of seeds) {
      const routine = routines.find((r) => r.name === seed.routine);
      if (!routine) throw new Error(`no routine ${seed.routine}`);
      const start = new Date();
      start.setDate(start.getDate() - seed.daysAgo);
      start.setHours(12, 0, 0, 0);
      const end = new Date(start.getTime() + 45 * 60_000);
      const sessionId = crypto.randomUUID();
      tx.objectStore('sessions').put({ id: sessionId, routineId: routine.id, title: routine.name, startedAt: start.toISOString(), endedAt: end.toISOString(), durationSec: 2700 });
      rxs
        .filter((rx) => rx.routineId === routine.id)
        .sort((a, b) => a.order - b.order)
        .forEach((rx, i) => {
          tx.objectStore('setLogs').put({
            id: crypto.randomUUID(),
            sessionId,
            routineExerciseId: rx.id,
            exerciseId: rx.exerciseId,
            index: 0,
            type: 'working',
            weight: seed.weight ?? 20,
            reps: 8,
            completedAt: new Date(start.getTime() + (i + 1) * 60_000).toISOString(),
          });
          if (i === 0 && seed.rose) {
            tx.objectStore('decisions').put({
              id: crypto.randomUUID(),
              sessionId,
              routineExerciseId: rx.id,
              fromWeight: seed.rose.from,
              toWeight: seed.rose.to,
              rule: 'increase',
              accepted: true,
              decidedAt: end.toISOString(),
            });
          }
        });
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, seeds);
}

interface ClaudeCall {
  model: string;
  /** The user's message (the facts the app sent). */
  asked: string;
}

/**
 * Answers every request to the Anthropic API: Haiku (the coach line) with `line`, Sonnet (the
 * review) with whatever `review(callNumber)` returns. Nothing leaves the machine.
 */
async function mockClaude(page: Page, replies: { line?: string; review?: (n: number) => { review: string; propose_calories?: number; propose_protein?: number } }): Promise<ClaudeCall[]> {
  const calls: ClaudeCall[] = [];
  let reviews = 0;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await page.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const body = JSON.parse(request.postData() ?? '{}') as { model: string; messages: { role: string; content: unknown }[] };
    const last = [...body.messages].reverse().find((m) => m.role === 'user');
    const asked = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content);
    calls.push({ model: body.model, asked });
    const reply = body.model.includes('haiku') ? (replies.line ?? '') : JSON.stringify(replies.review?.(++reviews) ?? { review: 'A fine week.' });
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(messageBody({ content: [text(reply)] }, body.model)),
    });
  });
  return calls;
}

async function setKey(page: Page): Promise<void> {
  await page.evaluate((key) => localStorage.setItem('iron.claudeKey', key), FAKE_KEY);
}

const sonnet = (calls: ClaudeCall[]) => calls.filter((c) => c.model.includes('sonnet'));
const haiku = (calls: ClaudeCall[]) => calls.filter((c) => c.model.includes('haiku'));

/** A Home with a few days of training behind it. */
async function bootWith(page: Page, now: Date, seeds: SeedSession[] = []): Promise<void> {
  await page.clock.setFixedTime(now);
  await fresh(page);
  if (seeds.length > 0) {
    await seedSessions(page, seeds);
    await page.reload();
    await expect(page.getByTestId('routines-list')).toBeVisible();
  }
}

test.describe('routine cards', () => {
  // Hinge 9 days ago, Pull 6, Push 2; Squat and Arms not done. With the seeded routines that makes:
  // Hinge and Squat both Legs at 9 days (ties keep the routine order), Pull Back at 6, Push Chest at
  // 2, and Arms 2 as well (its biceps and triceps were last worked in Push, Pull is 6).
  const SEEDS: SeedSession[] = [
    { routine: 'Lower (Hinge)', daysAgo: 9 },
    { routine: 'Upper (Pull)', daysAgo: 6, weight: 85, rose: { from: 87.5, to: 90 } },
    { routine: 'Upper (Push)', daysAgo: 2 },
  ];

  test('are ordered by how long since each was trained, each saying so', async ({ page }) => {
    await bootWith(page, WED, SEEDS);
    const cards = page.locator('[data-testid^="routine-card-"]');
    await expect(cards).toHaveCount(5);
    const names = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!.replace('routine-card-', '')));
    expect(names).toEqual(['Lower (Hinge)', 'Lower (Squat)', 'Upper (Pull)', 'Upper (Push)', 'Arms (Day 5)']);

    await expect(page.getByTestId('routine-rest-Lower (Hinge)')).toHaveText('Legs last trained 9 days ago');
    await expect(page.getByTestId('routine-rest-Upper (Pull)')).toHaveText('Back last trained 6 days ago');
    await expect(page.getByTestId('routine-rest-Upper (Push)')).toHaveText('Chest last trained 2 days ago');
  });

  test('show the lead lift\'s top set from last time, and only for a routine that has been done', async ({ page }) => {
    await bootWith(page, WED, SEEDS);
    await expect(page.getByTestId('routine-top-Upper (Pull)')).toHaveText('Last: Lat Pulldown (Machine) 85 kg × 8');
    await expect(page.getByTestId('routine-top-Lower (Squat)')).toHaveCount(0);
    await expect(page.getByTestId('routine-top-Arms (Day 5)')).toHaveCount(0);
  });

  test('never show an archived routine', async ({ page }) => {
    await bootWith(page, WED, SEEDS);
    await page.goto('/routines');
    await page.getByTestId('routine-more-Arms (Day 5)').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('routine-more-Arms (Day 5)')).toBeHidden();
    await page.goto('/');
    await expect(page.locator('[data-testid^="routine-card-"]')).toHaveCount(4);
    await expect(page.getByTestId('routine-card-Arms (Day 5)')).toHaveCount(0);
  });

  test('open on a tap to the next session\'s plan, and Start on the card starts that routine', async ({ page }) => {
    await bootWith(page, WED, SEEDS);
    const toggle = page.getByTestId('routine-toggle-Upper (Pull)');
    await expect(page.getByTestId('routine-plan-Upper (Pull)')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const plan = page.getByTestId('routine-plan-Upper (Pull)');
    const rows = plan.getByTestId('plan-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0).getByTestId('plan-row-name')).toHaveText('Lat Pulldown (Machine)');
    await expect(rows.nth(0).getByTestId('plan-row-weight')).toHaveText('90 kg');
    await expect(rows.nth(0).getByTestId('plan-row-scheme')).toHaveText('4 × 6–8');
    // The weight rose from 87.5 to 90 last time, and the row says so.
    await expect(rows.nth(0).getByTestId('plan-row-change')).toHaveText('+2.5 kg');
    await expect(rows.nth(1).getByTestId('plan-row-name')).toHaveText('Iso-Lateral Row (Machine)');
    await expect(rows.nth(1).getByTestId('plan-row-change')).toHaveCount(0);

    // Another card stays closed, and a second tap closes this one.
    await expect(page.getByTestId('routine-plan-Upper (Push)')).toHaveCount(0);
    await toggle.click();
    await expect(plan).toHaveCount(0);

    await toggle.click();
    await expect(plan).toBeVisible();
    await page.getByTestId('start-Upper (Pull)').click();
    await expect(page).toHaveURL(/\/session\//);
    await expect(page.getByTestId('exercise-card-Lat Pulldown (Machine)')).toBeVisible();
  });

  test('still ask before two lower-body days in a row', async ({ page }) => {
    await bootWith(page, WED, [{ routine: 'Lower (Hinge)', daysAgo: 1 }]);
    await page.getByTestId('start-Lower (Squat)').click();
    const sheet = page.getByRole('dialog').filter({ hasText: 'Two lower-body days in a row' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Pick another' }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/$/);

    await page.getByTestId('start-Lower (Squat)').click();
    await sheet.getByRole('button', { name: 'Start anyway' }).click();
    await expect(page).toHaveURL(/\/session\//);
  });

  test('offer no Start while a session is running, but the plan can still be read', async ({ page }) => {
    await bootWith(page, WED);
    await page.getByTestId('start-Upper (Push)').click();
    await expect(page).toHaveURL(/\/session\//);
    await page.goto('/');
    await expect(page.getByTestId('routines-list')).toBeVisible();
    await expect(page.locator('[data-testid^="start-"]')).toHaveCount(0);
    await expect(page.getByTestId('short-session')).toHaveCount(0);
    await page.getByTestId('routine-toggle-Upper (Pull)').click();
    await expect(page.getByTestId('routine-plan-Upper (Pull)').getByTestId('plan-row')).toHaveCount(4);
  });
});

test.describe('Short session and food', () => {
  test('Short session opens its sheet, and the food card reads out the day and opens Food', async ({ page }) => {
    await bootWith(page, WED);
    await page.getByTestId('short-session').click();
    await expect(page.getByTestId('quick-request')).toBeVisible();
    await page.keyboard.press('Escape');

    const food = page.getByTestId('today-food');
    await expect(food).toContainText('Calories');
    await expect(food).toContainText('Protein');
    // Nothing is trained yet, so the planned first routine (a lower-body one) sets the protein target.
    await expect(food).toContainText('0 / 200 g');
    await expect(food).toContainText('lower-body planned');
    await food.click();
    await expect(page).toHaveURL(/\/food$/);
  });
});

test.describe('the weekly weigh-in', () => {
  test('shows on a Monday with last week\'s reading until a weight is logged, then goes', async ({ page }) => {
    // The first run seeds a reading of 74 kg for the Wednesday the app was first opened.
    await bootWith(page, WED);
    await expect(page.getByTestId('weigh-in-card')).toHaveCount(0);

    await page.clock.setFixedTime(MON);
    await page.reload();
    const card = page.getByTestId('weigh-in-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('weigh-in-last')).toHaveText('Last: 74 kg · 7 Oct');
    // Log is not offered for nothing or for a number that is no weight.
    await expect(page.getByTestId('weigh-in-log')).toBeDisabled();
    await page.getByTestId('weigh-in-input').fill('0');
    await expect(page.getByTestId('weigh-in-log')).toBeDisabled();

    await page.getByTestId('weigh-in-input').fill('74.8');
    await page.getByTestId('weigh-in-log').click();
    await expect(card).toHaveCount(0);
    // Logged for the day, and the bodyweight section is back with it.
    await expect(page.getByText('74.8 kg').first()).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('routines-list')).toBeVisible();
    await expect(page.getByTestId('weigh-in-card')).toHaveCount(0);
  });

  test('stays on later days of the week until it is logged, and is not there for a week already weighed', async ({ page }) => {
    await bootWith(page, WED);
    await page.clock.setFixedTime(THU);
    await page.reload();
    await expect(page.getByTestId('weigh-in-card')).toBeVisible();

    // The Sunday of the week of the first reading: that week is weighed.
    await page.clock.setFixedTime(new Date(2026, 9, 11, 20, 0, 0));
    await page.reload();
    await expect(page.getByTestId('routines-list')).toBeVisible();
    await expect(page.getByTestId('weigh-in-card')).toHaveCount(0);
    await expect(page.getByText('Bodyweight', { exact: true })).toBeVisible();
  });
});

test.describe('the weekly review', () => {
  const review = (n: number) => ({ review: n === 1 ? 'Three sessions and steady protein. Eat a little more. How are you feeling?' : 'A quieter week. How are you doing?', propose_calories: 2400, propose_protein: 190 });

  async function bootMonday(page: Page, replies: Parameters<typeof mockClaude>[1]) {
    const calls = await mockClaude(page, replies);
    await page.clock.setFixedTime(WED);
    await fresh(page);
    // A target has to exist before it can be changed: saving Settings starts the reverse diet.
    await page.goto('/settings');
    await page.getByTestId('save-targets').click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.clock.setFixedTime(MON);
    // Push on the Friday before: inside the week the review looks back over.
    await seedSessions(page, [{ routine: 'Upper (Push)', daysAgo: 3 }]);
    await setKey(page);
    await page.goto('/');
    await expect(page.getByTestId('routines-list')).toBeVisible();
    return calls;
  }

  test('is written on a Monday from the week\'s facts and shows, with the targets it proposes as buttons', async ({ page }) => {
    const calls = await bootMonday(page, { review });
    const card = page.getByTestId('weekly-review');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('weekly-review-text')).toHaveText('Three sessions and steady protein. Eat a little more. How are you feeling?');
    await expect(page.getByTestId('review-use-calories')).toHaveText('Use 2,400 kcal');
    await expect(page.getByTestId('review-use-protein')).toHaveText('Use 190 g protein');

    // One Sonnet request, carrying the past seven days.
    expect(sonnet(calls)).toHaveLength(1);
    const asked = sonnet(calls)[0].asked;
    expect(asked).toContain('- period: 5 Oct to 11 Oct');
    expect(asked).toContain('- sessions: 1');
    expect(asked).toContain('- sessionNames: Upper (Push)');
    expect(asked).toContain('- daysFoodLogged: 0 of 7');
    expect(asked).toContain('- currentProteinTargetGrams: 170');

    // It does not ask again on a reload.
    await page.reload();
    await expect(page.getByTestId('weekly-review')).toBeVisible();
    expect(sonnet(calls)).toHaveLength(1);
  });

  test('"Use 2,400 kcal" saves the calorie target and says what changed; the protein button is still there', async ({ page }) => {
    await bootMonday(page, { review });
    await expect(page.getByTestId('today-food')).toContainText('/ 1,900');
    await page.getByTestId('review-use-calories').click();

    await expect(page.getByTestId('weekly-review-applied')).toHaveText('Calorie target changed from 1,900 to 2,400 kcal from today.');
    await expect(page.getByTestId('review-use-calories')).toHaveCount(0);
    await expect(page.getByTestId('review-use-protein')).toBeVisible();
    await expect(page.getByTestId('today-food')).toContainText('/ 2,400');

    // It is the target now, not just on this screen.
    await page.reload();
    await expect(page.getByTestId('today-food')).toContainText('/ 2,400');
    await expect(page.getByTestId('weekly-review-applied')).toHaveCount(1);
    await expect(page.getByTestId('review-use-calories')).toHaveCount(0);
  });

  test('"Use 190 g protein" moves the daily protein target', async ({ page }) => {
    await bootMonday(page, { review });
    // Home shows the lower-body day's target (200 g) because a lower-body routine is planned next.
    await expect(page.getByTestId('today-food')).toContainText('0 / 200 g');
    await page.getByTestId('review-use-protein').click();
    // The daily target moves to 190 g and the lower-body day keeps its 30 g gap.
    await expect(page.getByTestId('weekly-review-applied')).toHaveText('Protein target changed from 170 g to 190 g (lower-body days 200 g to 220 g).');
    await expect(page.getByTestId('today-food')).toContainText('0 / 220 g');
    await expect(page.getByTestId('review-use-protein')).toHaveCount(0);
  });

  test('"Not now" puts it away for the week, and the next Monday brings a new one', async ({ page }) => {
    const calls = await bootMonday(page, { review });
    await page.getByTestId('review-dismiss').click();
    await expect(page.getByTestId('weekly-review')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('routines-list')).toBeVisible();
    await expect(page.getByTestId('weekly-review')).toHaveCount(0);

    // Later in the same week: still away, and nothing asked for.
    await page.clock.setFixedTime(TUE);
    await page.reload();
    await expect(page.getByTestId('routines-list')).toBeVisible();
    await expect(page.getByTestId('weekly-review')).toHaveCount(0);
    expect(sonnet(calls)).toHaveLength(1);

    await page.clock.setFixedTime(NEXT_MON);
    await page.reload();
    await expect(page.getByTestId('weekly-review-text')).toHaveText('A quieter week. How are you doing?');
    expect(sonnet(calls)).toHaveLength(2);
  });

  test('stays through the week until dismissed, without asking again', async ({ page }) => {
    const calls = await bootMonday(page, { review });
    await expect(page.getByTestId('weekly-review')).toBeVisible();
    await page.clock.setFixedTime(TUE);
    await page.reload();
    await expect(page.getByTestId('weekly-review')).toBeVisible();
    await expect(page.getByTestId('review-use-calories')).toBeVisible();
    expect(sonnet(calls)).toHaveLength(1);
  });

  test('is not written on a day that is not Monday', async ({ page }) => {
    const calls = await mockClaude(page, { review });
    await page.clock.setFixedTime(WED);
    await fresh(page);
    await setKey(page);
    await page.reload();
    await expect(page.getByTestId('routines-list')).toBeVisible();
    await expect(page.getByTestId('weekly-review')).toHaveCount(0);
    expect(sonnet(calls)).toHaveLength(0);
  });

  test('does not appear when Claude cannot be called: no key, no card, no coach line, and Home still works', async ({ page }) => {
    const calls = await mockClaude(page, { review, line: 'You should not see this.' });
    await page.clock.setFixedTime(MON);
    await fresh(page);
    await expect(page.getByTestId('routines-list')).toBeVisible();
    await expect(page.getByTestId('weekly-review')).toHaveCount(0);
    await expect(page.getByTestId('coach-line-open')).toHaveCount(0);
    expect(calls).toHaveLength(0);

    // Everything else is there.
    await expect(page.getByTestId('weigh-in-card')).toHaveCount(0); // first run logged a reading for today
    await expect(page.getByTestId('short-session')).toBeVisible();
    await expect(page.getByTestId('today-food')).toBeVisible();
    await page.getByTestId('start-Upper (Push)').click();
    await expect(page).toHaveURL(/\/session\//);
  });

  test('does not appear when the call fails, and Home still works', async ({ page }) => {
    await page.route('https://api.anthropic.com/**', async (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
    });
    await page.clock.setFixedTime(MON);
    await fresh(page);
    await setKey(page);
    await page.reload();
    await expect(page.getByTestId('routines-list')).toBeVisible();
    await expect(page.getByTestId('weekly-review')).toHaveCount(0);
    await expect(page.getByTestId('coach-line-open')).toHaveCount(0);
    await expect(page.getByTestId('today-food')).toBeVisible();
  });
});

test.describe('the coach line', () => {
  test('shows what the coach says when the app opens, asked with the day\'s facts', async ({ page }) => {
    const calls = await mockClaude(page, { line: 'Back is your most rested region: six days. Pull today?' });
    await page.clock.setFixedTime(WED);
    await fresh(page);
    await seedSessions(page, [{ routine: 'Upper (Pull)', daysAgo: 6 }, { routine: 'Upper (Push)', daysAgo: 2 }]);
    await setKey(page);
    await page.reload();

    const line = page.getByTestId('coach-line-open');
    await expect(line).toHaveText('Back is your most rested region: six days. Pull today?');
    const asked = haiku(calls).map((c) => c.asked).join('\n');
    expect(asked).toContain('- weekday: Wednesday');
    expect(asked).toContain('- timeOfDay: morning');
    expect(asked).toContain('- mostRestedRegion: Back');
    expect(asked).toContain('- daysSinceMostRestedRegion: 6');
    expect(asked).toContain('- daysSinceLastSession: 2');
    expect(asked).toContain('- proteinTargetGrams: 200');
    expect(asked).toContain('- weighInDue: false');
    // Asked once, not once per query that arrived while Home loaded.
    expect(haiku(calls)).toHaveLength(1);
  });

  test('is absent when the coach says nothing', async ({ page }) => {
    await mockClaude(page, { line: '' });
    await page.clock.setFixedTime(WED);
    await fresh(page);
    await setKey(page);
    await page.reload();
    await expect(page.getByTestId('routines-list')).toBeVisible();
    await expect(page.getByTestId('coach-line-open')).toHaveCount(0);
  });
});
