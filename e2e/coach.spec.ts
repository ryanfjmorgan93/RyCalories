import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh, logOneSet } from './fresh';

/**
 * The coach (src/screens/CoachScreen.tsx) against `window.__ironNanoFake`, the documented stand-in
 * for the native Nano plugin on the web build (src/state/nano.ts). Everything from that seam inward
 * is real: the owner's data read from IndexedDB, the context ladder and token fitting, the streamed
 * pieces arriving through the plugin's own `nanoStream` event, the paste review and the save. What
 * cannot run here is NanoPlugin.java and the model itself — whether the Fold 8 serves the fuller
 * variant, and how good and how fast its answers are, is checked on the phone (Settings → Assistant
 * → Coach model names the model and its token limit).
 */

interface FakeConfig {
  statusFull: { state: string; detail: string };
  reply: string[];
  /** Hold the stream after its first piece until the test calls `__releaseCoach()`. */
  gate?: boolean;
  /** Report any prompt holding the ROUTINES block as far over the limit. */
  refuseRoutines?: boolean;
}

const READY_FULL = { state: 'ready', detail: 'AVAILABLE · nano-v4-full · 4000 tokens · samsung SM-F971B' };

async function setFakeNano(page: Page, cfg: FakeConfig): Promise<void> {
  await page.addInitScript((c: FakeConfig) => {
    const w = window as unknown as Record<string, unknown>;
    const log = { counted: [] as string[], streamed: [] as string[] };
    w.__coachLog = log;
    w.__ironNanoFake = {
      status: { state: 'ready', detail: 'AVAILABLE · default' },
      statusFull: c.statusFull,
      generate: async () => ({ text: 'unused' }),
      countTokens: async ({ prompt }: { prompt: string }) => {
        log.counted.push(prompt);
        const tokens = c.refuseRoutines && prompt.includes('ROUTINES') ? 1_000_000 : Math.ceil(prompt.length / 4);
        return { tokens, limit: 4000 };
      },
      generateStream: async ({ prompt }: { prompt: string }, emit: (t: string) => void) => {
        log.streamed.push(prompt);
        emit(c.reply[0]!);
        if (c.gate) await new Promise<void>((resolve) => (w.__releaseCoach = resolve));
        for (const piece of c.reply.slice(1)) emit(piece);
        return { text: c.reply.join('') };
      },
    };
  }, cfg);
}

const coachLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __coachLog: { counted: string[]; streamed: string[] } }).__coachLog);

async function trainRdl(page: Page): Promise<void> {
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await logOneSet(page, card, 110, 8);
  await logOneSet(page, card, 110, 7);
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

test('Ask: the question reads the named exercise\'s own sets, and the answer arrives as it is written', async ({ page }) => {
  await setFakeNano(page, { statusFull: READY_FULL, reply: ['Your RDL ', 'went 110 × 8, then 7.'], gate: true });
  await fresh(page);
  await trainRdl(page);

  await page.goto('/progress');
  await page.getByTestId('coach-open').click();
  await expect(page).toHaveURL(/\/coach$/);
  await page.getByTestId('coach-input').fill('Why has my RDL stalled?');
  await page.getByTestId('coach-send').click();

  // Only the first piece has been sent: it shows, and the rest is not there yet.
  await expect(page.getByTestId('coach-partial')).toHaveText('Your RDL ');
  await expect(page.getByTestId('coach-send')).toBeDisabled();
  const sent = (await coachLog(page)).streamed;
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('TRAINING (Romanian Deadlift (Barbell))');
  expect(sent[0]).toContain('Romanian Deadlift (Barbell): 110 × 8, 7');
  expect(sent[0]).toContain('User: Why has my RDL stalled?');

  await page.evaluate(() => (window as unknown as { __releaseCoach: () => void }).__releaseCoach());
  await expect(page.getByTestId('coach-answer')).toHaveText('Your RDL went 110 × 8, then 7.');
  await expect(page.getByTestId('coach-partial')).toHaveCount(0);
  await expect(page.getByTestId('coach-read')).toContainText('Read: Romanian Deadlift (Barbell) 26 weeks');
});

test('Ask: when the fullest context is too big, the first smaller one that fits is sent, and the screen says which', async ({ page }) => {
  await setFakeNano(page, { statusFull: READY_FULL, reply: ['Two sessions.'], refuseRoutines: true });
  await fresh(page);
  await page.goto('/coach');
  await page.getByTestId('coach-input').fill('How was last week?');
  await page.getByTestId('coach-send').click();
  await expect(page.getByTestId('coach-answer')).toHaveText('Two sessions.');
  await expect(page.getByTestId('coach-read')).toHaveText('Read: training 8 weeks · food 4 weeks averages · bodyweight 8 weeks summary');

  const { counted, streamed } = await coachLog(page);
  expect(counted.length).toBe(2);
  expect(counted[0]).toContain('ROUTINES');
  expect(streamed).toEqual([counted[1]]);
  expect(streamed[0]).not.toContain('ROUTINES');
});

test('Build a routine: the draft opens in the paste review, matched, and saves as a routine', async ({ page }) => {
  await setFakeNano(page, { statusFull: READY_FULL, reply: ['Upper A\nBench press 3x8-10 @ 60kg\n', 'Face pull 3x15'] });
  await fresh(page);
  await page.goto('/routines');
  await page.getByTestId('new-routine').click();
  await page.getByTestId('draft-with-coach').click();
  await expect(page).toHaveURL(/\/coach\?mode=routine$/);
  await expect(page.getByRole('radio', { name: 'Build a routine' })).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId('coach-input').fill('One upper day, 45 minutes');
  await page.getByTestId('coach-send').click();
  await expect(page.getByTestId('coach-read')).toContainText('Read: working weights');
  expect((await coachLog(page)).streamed[0]).toContain('WORKING WEIGHTS');

  await page.getByTestId('coach-review').click();
  const review = page.getByRole('dialog').filter({ hasText: 'Review routine' });
  const rows = review.getByTestId('paste-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByTestId('paste-row-name')).toHaveText('Bench Press (Barbell)');
  await expect(rows.nth(1).getByTestId('paste-row-name')).toHaveText('Face Pull');
  await review.getByTestId('paste-save').click();
  await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/);
  await expect(page.getByTestId('rx-card-Bench Press (Barbell)')).toContainText('3 × 8–10 @ 60 kg');
});

test('when the coach model is not there, the reason is shown and nothing can be sent', async ({ page }) => {
  const detail = 'UNAVAILABLE · samsung SM-F971B · SDK 36 · AICore 2026.9.4';
  await setFakeNano(page, { statusFull: { state: 'unavailable', detail }, reply: ['unused'] });
  await fresh(page);
  await page.goto('/coach');
  await expect(page.getByTestId('coach-status')).toContainText(detail);
  await page.getByTestId('coach-input').fill('How was last week?');
  await expect(page.getByTestId('coach-send')).toBeDisabled();

  await page.goto('/settings');
  await expect(page.getByTestId('coach-model-detail')).toHaveText(detail);
});

test('the Progress header shows Coach and Claude as words, and the title keeps its room at 360 px', async ({ page }) => {
  await setFakeNano(page, { statusFull: READY_FULL, reply: ['unused'] });
  await fresh(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/progress');
  const header = page.locator('header');
  await expect(header.getByTestId('coach-open')).toHaveText('Coach');
  await expect(header.getByTestId('claude-open')).toHaveText('Claude');
  const title = header.getByText('Progress', { exact: true });
  await expect(title).toBeVisible();
  await expect.poll(async () => (await title.boundingBox())?.width ?? 0).toBeGreaterThan(40);
});
