import { expect, test, type Locator, type Page } from '@playwright/test';
import { lastUserText, messageBody, text, toolUse, type FakeReply } from '../src/test/fakeClaude';
import { clickIfPresent, fresh, logOneSet, readRawIron } from './fresh';

/**
 * Claude in the app (src/ai, the coach sheet, the coach's moments), on the built app. The Anthropic
 * API is never reached: every request to api.anthropic.com is answered here with canned Messages
 * API JSON (the shapes of src/test/fakeClaude.ts), CORS preflight included, and the key is a fake
 * one put in localStorage before the app boots.
 */

const KEY = 'sk-ant-test-0123456789abcdefGHIJKLmnop';
const BENCH = 'Bench Press (Barbell)';

const SET_LINE = 'Smooth first set. Three more at 65 kilos.';
const EXERCISE_LINE = 'Bench done, and it felt good. Up it goes next time.';
const SESSION_LINE = 'Solid push session. Records and an increase to show for it.';

interface Seen {
  body: Record<string, any>;
}

/** Answers every request to the Anthropic API with `reply(body, n)`; the requests seen are returned live. */
async function mockClaude(page: Page, reply: (body: Record<string, any>, n: number) => FakeReply): Promise<Seen[]> {
  const seen: Seen[] = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const body = request.postDataJSON() as Record<string, any>;
    seen.push({ body });
    const canned = reply(body, seen.length - 1);
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(messageBody(canned, String(body.model))) });
  });
  return seen;
}

/** The coach's short lines by moment (they are the Haiku requests); anything else is silence. */
function momentReply(body: Record<string, any>): FakeReply {
  const said = lastUserText(body);
  if (said.includes('has just logged a set')) return { content: [text(SET_LINE)] };
  if (said.includes('finished the last set of an exercise')) return { content: [text(EXERCISE_LINE)] };
  if (said.includes('finished their session')) return { content: [text(SESSION_LINE)] };
  return { content: [text('')] };
}

const isHaiku = (body: Record<string, any>) => String(body.model).includes('haiku');

/** A key in localStorage before the app boots (and again after `fresh` clears storage and reloads). */
async function withKey(page: Page): Promise<void> {
  await page.addInitScript((key) => localStorage.setItem('iron.claudeKey', key), KEY);
}

async function startPush(page: Page): Promise<Locator> {
  await fresh(page);
  await page.getByTestId('start-Upper (Push)').click();
  const card = page.getByTestId(`exercise-card-${BENCH}`);
  await expect(card).toContainText('4 sets of 6–8 · 65 kg');
  return card;
}

/** One set, typed and ticked, and nothing else: the rest timer is left running. */
async function tickSet(card: Locator, weight: number, reps: number): Promise<void> {
  await card.getByTestId('weight-input').fill(String(weight));
  await card.getByTestId('reps-input').fill(String(reps));
  await card.getByTestId('set-done').click();
}

async function closeSheet(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function bodyOf(download: Promise<import('@playwright/test').Download>): Promise<string> {
  const file = await download;
  return Buffer.concat((await (await file.createReadStream()).toArray()) as Buffer[]).toString('utf8');
}

test.describe('the key', () => {
  test('a pasted key is masked on screen and never in an export, a backup row or the database', async ({ page }) => {
    await fresh(page);
    await page.goto('/settings');
    const card = page.getByTestId('claude-card');
    await expect(card).toContainText('No key yet');

    const input = page.getByTestId('claude-key-input');
    await expect(input).toHaveAttribute('type', 'password');
    await input.fill(KEY);
    await page.getByTestId('claude-key-save').click();

    // Masked: the kind of key and its last four, never the key.
    await expect(card).toContainText('Key sk-ant-…mnop');
    await expect(input).toHaveValue('');
    expect(await card.innerHTML()).not.toContain(KEY);
    expect(await page.evaluate(() => localStorage.getItem('iron.claudeKey'))).toBe(KEY);

    // The JSON backup, the sets CSV and the database itself do not have it.
    const json = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON backup' }).click();
    const backup = await bodyOf(json);
    expect(JSON.parse(backup).app).toBe('iron');
    expect(backup).not.toContain(KEY);
    expect(backup).not.toContain('sk-ant');

    const csv = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export sets CSV' }).click();
    expect(await bodyOf(csv)).not.toContain('sk-ant');

    expect(JSON.stringify(await readRawIron(page))).not.toContain('sk-ant');
  });

  test('Settings leads with the coach, puts the reminders after the targets, and says what goes to Anthropic', async ({ page }) => {
    await fresh(page);
    await page.goto('/settings');
    await expect(page.getByTestId('claude-card')).toBeVisible();
    await expect(page.getByTestId('reminders-card')).toBeVisible();

    // The order on the page: the coach first, then Data, Backups, Targets, Reminders, About.
    const titles = await page.locator('h2').allTextContents();
    const order = ['Coach', 'Data', 'Backups', 'Targets', 'Reminders', 'About'].map((t) => titles.findIndex((x) => x.trim().toLowerCase() === t.toLowerCase()));
    expect(order.every((i) => i >= 0), titles.join(' | ')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    await expect(page.getByTestId('about-claude-line')).toContainText('what you send to the coach');
    await expect(page.getByTestId('about-claude-line')).toContainText("Anthropic's API");
  });
});

test.describe('the coach in a session', () => {
  test('"only 2 sets of bench today" changes today only: the bench card shows 2 sets, and the thread says what was done', async ({ page }) => {
    await withKey(page);
    const seen = await mockClaude(page, (body) => {
      if (isHaiku(body)) return momentReply(body);
      const last = (body.messages as { content: unknown }[]).at(-1)!;
      const afterTool = Array.isArray(last.content) && (last.content as { type: string }[]).some((b) => b.type === 'tool_result');
      return afterTool
        ? { content: [text('Done: bench is two sets today. Your routine is as it was.')] }
        : { content: [toolUse('toolu_1', 'edit_session', { exercise: BENCH, change: 'sets', sets: 2 })], stop_reason: 'tool_use' };
    });
    const bench = await startPush(page);

    // From the session header, not from Home.
    await page.getByTestId('session-coach').click();
    const sheet = page.getByRole('dialog').filter({ has: page.getByTestId('coach-thread') });
    await expect(sheet).toBeVisible();
    await page.getByTestId('coach-input').fill('only 2 sets of bench today');
    await page.getByTestId('coach-send').click();

    await expect(sheet.getByTestId('coach-bubble')).toContainText('bench is two sets today');
    await expect(sheet.getByTestId('coach-user-bubble')).toHaveText('only 2 sets of bench today');
    await expect(sheet.getByTestId('coach-actions')).toContainText(/Bench Press \(Barbell\).*2 sets/);
    await expect(sheet.getByTestId('coach-error')).toHaveCount(0);

    // Claude was asked as Sonnet, with the owner's words last, and the tool result went back to it.
    const chat = seen.filter((s) => !isHaiku(s.body));
    expect(chat).toHaveLength(2);
    expect(chat[0]!.body.model).toBe('claude-sonnet-5-5');
    expect(lastUserText(chat[0]!.body)).toBe('only 2 sets of bench today');

    await closeSheet(page);
    await expect(bench).toContainText('2 sets of 6–8 · 65 kg · 0 of 2');
    await expect(bench.getByTestId('today-plan-text')).toHaveText('Today: 2 sets');
    // Today only: the saved routine is untouched until "Keep in routine".
    const rx = (await readRawIron(page)).tables.routineExercises as { currentWeight: number; targetSets: number }[];
    expect(rx.filter((r) => r.currentWeight === 65 && r.targetSets === 2)).toHaveLength(0);
  });

  test('after a set the rest bar carries the coach\'s line; after the exercise and the session, theirs', async ({ page }) => {
    await withKey(page);
    const seen = await mockClaude(page, (body) => (isHaiku(body) ? momentReply(body) : { content: [text('')] }));
    const bench = await startPush(page);

    await tickSet(bench, 65, 8);
    const rest = page.getByTestId('rest-timer');
    await expect(rest).toBeVisible();
    await expect(rest.getByTestId('coach-line-set')).toHaveText(SET_LINE);
    // What the coach was told about the set.
    const asked = seen.find((s) => isHaiku(s.body) && lastUserText(s.body).includes('has just logged a set'))!;
    const facts = lastUserText(asked.body);
    expect(facts).toContain(`exercise: ${BENCH}`);
    expect(facts).toContain('setNumber: 1');
    expect(facts).toContain('of: 4');
    expect(facts).toContain('repRange: 6–8');

    // Tapping it opens the conversation.
    await rest.getByTestId('coach-line-set').click();
    await expect(page.getByTestId('coach-thread')).toBeVisible();
    await closeSheet(page);

    // The rest of the exercise; the line for it waits for the effort answer.
    await logOneSet(page, bench, 65, 8);
    await logOneSet(page, bench, 65, 8);
    await logOneSet(page, bench, 65, 8);
    await expect(page.getByTestId('verdict-line')).toBeVisible();
    await expect(page.getByTestId('coach-line-exercise')).toHaveCount(0);
    await bench.getByTestId('feel-Good').click();
    await expect(bench.getByTestId('coach-line-exercise')).toHaveText(EXERCISE_LINE);
    const done = seen.find((s) => isHaiku(s.body) && lastUserText(s.body).includes('finished the last set of an exercise'))!;
    const told = lastUserText(done.body);
    expect(told).toContain(`exercise: ${BENCH}`);
    expect(told).toContain('effort: Good');
    expect(told).toContain('decision:');

    // The session: on the Summary, with what was decided for next time.
    await page.getByTestId('finish-session').click();
    await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
    await expect(page).toHaveURL(/\/summary$/);
    await expect(page.getByTestId('coach-line-session')).toHaveText(SESSION_LINE);
    const wrap = seen.find((s) => isHaiku(s.body) && lastUserText(s.body).includes('finished their session'))!;
    expect(lastUserText(wrap.body)).toContain('nextTime:');
    expect(lastUserText(wrap.body)).toContain(BENCH);
  });
});

test.describe('without the coach', () => {
  test('over the spend cap: no coach line, the sheet says it is paused, the toast says it once, and logging a set still works', async ({ page }) => {
    // Well over the default $15 cap for this calendar month.
    await page.addInitScript(
      ([key]) => {
        localStorage.setItem('iron.claudeKey', key!);
        const d = new Date();
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        localStorage.setItem('iron.claudeSpend', JSON.stringify({ month, usd: 99 }));
      },
      [KEY],
    );
    const seen = await mockClaude(page, (body) => (isHaiku(body) ? { content: [text(SET_LINE)] } : { content: [text('never')] }));
    // Said once, when it was found out: on opening the app over the cap.
    await fresh(page);
    await expect(page.getByTestId('toast')).toContainText("The coach is paused until the 1st: this month's $15 cap is reached. Tracking carries on.");

    await page.getByTestId('start-Upper (Push)').click();
    const bench = page.getByTestId(`exercise-card-${BENCH}`);
    await expect(bench).toContainText('4 sets of 6–8 · 65 kg');
    await tickSet(bench, 65, 8);
    await expect(bench.getByTestId('logged-row')).toHaveCount(1);
    await expect(page.getByTestId('rest-timer')).toBeVisible();
    await expect(page.getByTestId('coach-line-set')).toHaveCount(0);

    // The sheet says why, before a word is typed, and a question gets the same reason.
    await page.getByTestId('session-coach').click();
    await expect(page.getByTestId('coach-unavailable')).toContainText("The coach is paused until the 1st: this month's cap is reached.");
    await page.getByTestId('coach-input').fill('how am I doing?');
    await page.getByTestId('coach-send').click();
    await expect(page.getByTestId('coach-error')).toHaveText("The coach is paused until the 1st: this month's cap is reached.");
    await expect(page.getByTestId('coach-input')).toHaveValue('how am I doing?');
    await closeSheet(page);

    // Tracking carries on: the next set logs, and nothing was ever sent to Claude.
    await logOneSet(page, bench, 65, 8);
    await expect(bench.getByTestId('logged-row')).toHaveCount(2);
    expect(seen).toHaveLength(0);

    // The notice is once a month: a reload does not say it again.
    await page.reload();
    await expect(page.getByTestId(`exercise-card-${BENCH}`)).toBeVisible();
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });

  test('with no key, "build me a push routine" is built by the rules coach and goes to the review', async ({ page }) => {
    const seen = await mockClaude(page, () => ({ content: [text('never asked')] }));
    await fresh(page);
    await page.goto('/progress');
    await page.getByTestId('coach-open').click();
    await expect(page.getByTestId('coach-unavailable')).toContainText('Add your Claude key in Settings');

    await page.getByTestId('coach-input').fill('build me a push routine');
    await page.getByTestId('coach-send').click();
    await expect(page.getByTestId('coach-routine').first()).toBeVisible();
    await expect(page.getByTestId('coach-send')).toHaveText('Send');
    const built = await page.getByTestId('coach-row-name').allTextContents();
    expect(built.length).toBeGreaterThan(0);

    await page.getByTestId('coach-review').first().click();
    const review = page.getByRole('dialog').filter({ hasText: 'Review routine' });
    await expect(review.getByTestId('paste-row')).toHaveCount(built.length);
    await expect(review.getByTestId('paste-save')).toBeVisible();
    expect(seen).toHaveLength(0);
  });

  test('offline with a key, a routine is still built and a question gets the reason', async ({ page }) => {
    await withKey(page);
    const seen = await mockClaude(page, () => ({ content: [text('never asked')] }));
    await fresh(page);
    await page.goto('/progress');
    // The phone says it has no connection. (Assets are not cut: the build is not what is being tested,
    // and the app's own offline start-up is offline.spec.ts.)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
    });
    await page.getByTestId('coach-open').click();
    await expect(page.getByTestId('coach-unavailable')).toContainText('No connection');

    await page.getByTestId('coach-input').fill('give me a chest routine');
    await page.getByTestId('coach-send').click();
    await expect(page.getByTestId('coach-routine')).toHaveCount(1);

    await page.getByTestId('coach-input').fill('how was my week?');
    await page.getByTestId('coach-send').click();
    await expect(page.getByTestId('coach-error')).toContainText('No connection');
    await expect(page.getByTestId('coach-input')).toHaveValue('how was my week?');
    expect(seen).toHaveLength(0);
  });
});
