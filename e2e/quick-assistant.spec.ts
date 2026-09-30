import { expect, test, type Locator, type Page } from '@playwright/test';
import { fresh } from './fresh';

/**
 * The Short session sheet's assistant fallback (src/ui/QuickSessionSheet.tsx, src/state/quickIntent.ts)
 * against `window.__ironNanoFake`, the documented stand-in for the native Nano plugin on the web
 * build (src/state/nano.ts). Everything from that seam inward is real: the parser's residue, the
 * assistant store's status read through the plugin, the strict-options prompt and its settings, the
 * timeout, the reply parser, the draft's layers and the plan drawn from them.
 *
 * What cannot run here is NanoPlugin.java and the model itself. How the real model reads a typed line
 * ("something for my fancy bits"), and how often it answers in JSON at all, is verified only on the
 * phone. These tests prove that whatever a model says, only options reach the plan, only where the
 * typed line and the taps left them open, and only when the owner taps.
 *
 * Every wait is on a signal only its event produces: a chip's `aria-pressed` or presence, the line's
 * text, the button's label. An absence is asserted only after the thing that would have ended it.
 * The plan is drawn from a random seed, so rows are checked for what they are (a muscle, a count),
 * never for a name.
 */

interface FakeConfig {
  status: { state: string; detail: string };
  /** What `generate` answers with. */
  reply?: string;
  /** Hold the answer until the test calls `__releaseQuick()`. */
  gate?: boolean;
  /** Never answer. */
  never?: boolean;
  /** The page's limit on the model, in place of twenty seconds (`window.__quickIntentTimeoutMs`). */
  timeoutMs?: number;
}

interface QuickLog {
  generated: { system: string; prompt: string; maxOutputTokens?: number; temperature?: number; model?: string }[];
  /** Times the plugin was asked its status. */
  statusReads: number;
}

const READY = { state: 'ready', detail: 'AVAILABLE · default' };
const TYPED = 'four light exercises for my fancy bits';
const RESIDUE = 'Not read: fancy, bits';

async function setFakeNano(page: Page, cfg: FakeConfig): Promise<void> {
  await page.addInitScript((c: FakeConfig) => {
    const w = window as unknown as Record<string, unknown>;
    const log: QuickLog = { generated: [], statusReads: 0 };
    w.__quickLog = log;
    if (c.timeoutMs) w.__quickIntentTimeoutMs = c.timeoutMs;
    w.__ironNanoFake = {
      // The plugin reads this once per status call, which is what makes the calls countable.
      get status() {
        log.statusReads++;
        return c.status;
      },
      generate: async (opts: QuickLog['generated'][number]) => {
        log.generated.push({ ...opts });
        if (c.never) return new Promise<{ text: string }>(() => undefined);
        if (c.gate) await new Promise<void>((resolve) => (w.__releaseQuick = resolve));
        return { text: c.reply ?? '' };
      },
    };
  }, cfg);
}

const quickLog = (page: Page): Promise<QuickLog> => page.evaluate(() => (window as unknown as { __quickLog: QuickLog }).__quickLog);
const releaseModel = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as { __releaseQuick: () => void }).__releaseQuick());

async function openSheet(page: Page): Promise<void> {
  await page.getByTestId('short-session').click();
  await expect(page.getByTestId('quick-preview')).toBeVisible();
}

const notRead = (page: Page): Locator => page.getByTestId('quick-not-read');
const readButton = (page: Page): Locator => page.getByTestId('quick-read-assistant');
const rowsOf = (page: Page): Locator => page.locator('[data-testid^="quick-row-"]');

async function expectPressed(page: Page, testId: string, pressed = true): Promise<void> {
  await expect(page.getByTestId(testId)).toHaveAttribute('aria-pressed', String(pressed));
}

/** The muscle on each preview row: the first part of its last line. */
async function rowMuscles(page: Page): Promise<string[]> {
  return (await rowsOf(page).allInnerTexts()).map((t) => t.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)!.split(' · ')[0]!);
}

async function rowNames(page: Page): Promise<string[]> {
  return (await rowsOf(page).allInnerTexts()).map((t) => t.split('\n')[0]!.trim());
}

/** Type the request as a person does, and stop at the button that only a ready assistant shows. */
async function typeAndWaitForButton(page: Page, text: string): Promise<void> {
  await page.getByTestId('quick-request').pressSequentially(text);
  await expect(readButton(page)).toBeVisible();
}

test('words the rules read leave no Not read line and no button, and the assistant is not asked about them', async ({ page }) => {
  await setFakeNano(page, { status: READY });
  await fresh(page);
  await openSheet(page);
  // Opening the sheet does not ask the assistant anything.
  expect((await quickLog(page)).statusReads).toBe(0);

  // One input event, so one render: the chips and the line below them are drawn from the same state,
  // and once the chips read the typed words the line is what those words leave, which is nothing.
  await page.getByTestId('quick-request').fill('four light exercises');
  await expectPressed(page, 'quick-count-4');
  await expectPressed(page, 'quick-effort-light');
  await expect(notRead(page)).toHaveCount(0);
  await expect(readButton(page)).toHaveCount(0);
  const log = await quickLog(page);
  expect(log.statusReads).toBe(0);
  expect(log.generated).toEqual([]);

  // Words the rules cannot read bring the line, and the first status read of the sheet with them.
  // The line being present first is what makes its later absence, below, a change and not a wait.
  await page.getByTestId('quick-request').fill(TYPED);
  await expect(notRead(page)).toHaveText(RESIDUE);
  await expect(readButton(page)).toBeVisible();
  expect((await quickLog(page)).statusReads).toBe(1);

  // And taking them away takes the line and the button away again.
  await page.getByTestId('quick-request').fill('four light exercises');
  await expect(notRead(page)).toHaveCount(0);
  await expect(readButton(page)).toHaveCount(0);
  const after = await quickLog(page);
  expect(after.statusReads).toBe(1);
  expect(after.generated).toEqual([]);
});

test('words the rules cannot read show as Not read, with a button, and nothing has been asked of the model', async ({ page }) => {
  await setFakeNano(page, { status: READY });
  await fresh(page);
  await openSheet(page);

  // Keystroke by keystroke: the status is not asked about on each one.
  await typeAndWaitForButton(page, TYPED);
  await expect(notRead(page)).toHaveText(RESIDUE);
  await expect(readButton(page)).toHaveText('Read with assistant');
  await expect(readButton(page)).toBeEnabled();
  // The button appearing is the moment an unprompted call would already have happened.
  const log = await quickLog(page);
  expect(log.generated).toEqual([]);
  expect(log.statusReads).toBe(1);
  // The rules' reading stands as typed.
  await expectPressed(page, 'quick-count-4');
  await expectPressed(page, 'quick-effort-light');
});

test('a tap reads the line once: rules win over the reply, the reply fills what is open, the plan follows, the line and button go', async ({ page }) => {
  await setFakeNano(page, { status: READY, reply: '{"focus":["biceps"],"count":6}', gate: true });
  await fresh(page);
  await openSheet(page);
  await typeAndWaitForButton(page, TYPED);

  await readButton(page).click();
  await expect(readButton(page)).toHaveText('Reading…');
  await expect(readButton(page)).toBeDisabled();
  await expect.poll(async () => (await quickLog(page)).generated.length).toBe(1);
  const sent = (await quickLog(page)).generated[0]!;
  expect(sent.prompt).toContain(TYPED);
  // The default model (no variant asked for), kept short and the same every time.
  expect(sent).toMatchObject({ maxOutputTokens: 120, temperature: 0 });
  expect(sent).not.toHaveProperty('model');
  // While it runs nothing has changed.
  await expectPressed(page, 'quick-count-4');
  await expect(page.getByTestId('quick-focus-biceps')).toHaveCount(0);

  await releaseModel(page);
  await expectPressed(page, 'quick-focus-biceps');

  // The typed four stands over the assistant's six.
  await expectPressed(page, 'quick-count-4');
  await expectPressed(page, 'quick-count-6', false);
  await expectPressed(page, 'quick-effort-light');
  // What the reply filled is read, so there is nothing left to offer.
  await expect(notRead(page)).toHaveCount(0);
  await expect(readButton(page)).toHaveCount(0);
  // The plan is for those options: only biceps, and the whole of them that the owner has.
  const muscles = await rowMuscles(page);
  expect(muscles.length).toBeGreaterThan(0);
  expect(muscles.every((m) => m === 'biceps'), muscles.join(', ')).toBe(true);
  // One call, and nothing after it.
  expect((await quickLog(page)).generated).toHaveLength(1);
});

test('a chip the owner taps wins over what the assistant read, and is not reopened', async ({ page }) => {
  await setFakeNano(page, { status: READY, reply: '{"focus":["biceps"],"effort":"normal","minutes":45}' });
  await fresh(page);
  await openSheet(page);
  await typeAndWaitForButton(page, 'light exercises for my fancy bits');

  await readButton(page).click();
  await expectPressed(page, 'quick-focus-biceps');
  await expectPressed(page, 'quick-minutes-45');
  // The typed "light" stands over the assistant's "normal".
  await expectPressed(page, 'quick-effort-light');
  await expectPressed(page, 'quick-effort-normal', false);

  // Focus tapped to Auto, and the time tapped: the owner's choices, and the reading does not come back.
  await page.getByTestId('quick-focus-auto').click();
  await expectPressed(page, 'quick-focus-auto');
  await page.getByTestId('quick-minutes-30').click();
  await expectPressed(page, 'quick-minutes-30');
  await expectPressed(page, 'quick-minutes-45', false);
  await expect(page.getByTestId('quick-focus-biceps')).toHaveCount(0);
});

test('typing drops what the assistant read, and the line and button come back for the new words, unasked', async ({ page }) => {
  await setFakeNano(page, { status: READY, reply: '{"focus":["biceps"]}' });
  await fresh(page);
  await openSheet(page);
  await typeAndWaitForButton(page, TYPED);
  await readButton(page).click();
  await expectPressed(page, 'quick-focus-biceps');

  await page.getByTestId('quick-request').fill(`${TYPED} please`);
  await expect(page.getByTestId('quick-focus-biceps')).toHaveCount(0);
  await expectPressed(page, 'quick-count-4');
  await expect(readButton(page)).toBeVisible();
  await expect(notRead(page)).toHaveText('Not read: fancy, bits');
  // Coming back is not a call: the model has been asked once, by the first tap.
  expect((await quickLog(page)).generated).toHaveLength(1);
});

test('a reply holding exercises, weights, an exclusion and Include new changes nothing but the count', async ({ page }) => {
  // Names and weights that no catalogue or history holds, so a row showing either can only have come from the reply.
  await setFakeNano(page, {
    status: READY,
    reply: '{"exercises":["Zzyzx Press","Bench"],"weights":[987.5,100],"exclude":["quads"],"includeNew":true,"count":5}',
  });
  await fresh(page);
  await openSheet(page);
  const typed = 'light exercises for my fancy bits';
  await typeAndWaitForButton(page, typed);

  await readButton(page).click();
  await expectPressed(page, 'quick-count-5');

  // Nothing else moved: the rules' "light", no muscle chosen or ruled out, Include new as it was.
  await expectPressed(page, 'quick-effort-light');
  await expectPressed(page, 'quick-focus-auto');
  await expectPressed(page, 'quick-minutes-40');
  await expect(page.getByTestId('quick-include-new')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('[data-testid^="quick-exclude-"]')).toHaveCount(0);
  await expect(page.getByTestId('quick-request')).toHaveValue(typed);

  // The plan has the five the count asked for and none of the reply's: no exercise, no weight, no "New".
  await expect(rowsOf(page)).toHaveCount(5);
  const texts = await rowsOf(page).allInnerTexts();
  for (const text of texts) {
    expect(text).not.toMatch(/zzyzx|987/i);
    expect(text).not.toMatch(/\b100 kg\b/);
  }
  expect(await rowNames(page)).not.toContain('Bench');
  await expect(page.locator('[data-testid^="quick-new-"]')).toHaveCount(0);
  expect((await quickLog(page)).generated).toHaveLength(1);
});

test('a reply that is not options reads as "Nothing more read", leaves the chips as typed, and offers nothing more', async ({ page }) => {
  await setFakeNano(page, { status: READY, reply: 'I cannot help with that.' });
  await fresh(page);
  await openSheet(page);
  await typeAndWaitForButton(page, TYPED);

  await readButton(page).click();
  await expect(notRead(page)).toHaveText('Nothing more read');
  // Same render as the line: the button is gone with it.
  await expect(readButton(page)).toHaveCount(0);
  await expectPressed(page, 'quick-count-4');
  await expectPressed(page, 'quick-effort-light');
  await expectPressed(page, 'quick-focus-auto');
  expect((await quickLog(page)).generated).toHaveLength(1);
});

test('a reply that adds nothing the typed line left open reads as "Nothing more read"', async ({ page }) => {
  await setFakeNano(page, { status: READY, reply: '{"count":6,"effort":"normal"}' });
  await fresh(page);
  await openSheet(page);
  await typeAndWaitForButton(page, TYPED);

  await readButton(page).click();
  await expect(notRead(page)).toHaveText('Nothing more read');
  await expectPressed(page, 'quick-count-4');
  await expectPressed(page, 'quick-count-6', false);
  await expectPressed(page, 'quick-effort-light');
});

test('a model that never answers ends in the plain fact, with the button back to try again', async ({ page }) => {
  await setFakeNano(page, { status: READY, never: true, timeoutMs: 500 });
  await fresh(page);
  await openSheet(page);
  await typeAndWaitForButton(page, TYPED);

  await readButton(page).click();
  // The line held "Not read: …" until now: only the limit running out can change it to this.
  await expect(notRead(page)).toHaveText('The model did not answer.');
  await expect(readButton(page)).toHaveText('Read with assistant');
  await expect(readButton(page)).toBeEnabled();
  await expectPressed(page, 'quick-count-4');
  await expect(page.getByTestId('quick-focus-biceps')).toHaveCount(0);
  expect((await quickLog(page)).generated).toHaveLength(1);
});

test('an answer for words that have since changed is dropped', async ({ page }) => {
  await setFakeNano(page, { status: READY, reply: '{"focus":["biceps"]}', gate: true });
  await fresh(page);
  await openSheet(page);
  await typeAndWaitForButton(page, TYPED);

  await readButton(page).click();
  await expect(readButton(page)).toHaveText('Reading…');
  await page.getByTestId('quick-request').fill(`${TYPED} and more`);
  await releaseModel(page);

  // The call has ended: the button is back, for the words now in the box.
  await expect(readButton(page)).toHaveText('Read with assistant');
  await expect(readButton(page)).toBeEnabled();
  await expect(page.getByTestId('quick-focus-biceps')).toHaveCount(0);
  await expectPressed(page, 'quick-focus-auto');
  await expect(notRead(page)).toContainText('Not read:');
});

for (const state of ['unavailable', 'downloadable', 'downloading']) {
  test(`with the assistant ${state}, the line shows and there is no button and no word about the model`, async ({ page }) => {
    await setFakeNano(page, { status: { state, detail: `${state.toUpperCase()} · samsung SM-F971B` } });
    await fresh(page);
    await openSheet(page);

    await page.getByTestId('quick-request').pressSequentially(TYPED);
    await expect(notRead(page)).toHaveText(RESIDUE);
    // The status has been asked, once, and nothing on screen says what it answered: the absence of a
    // button would be satisfied by being early. So one more word is typed once the read is known to
    // have happened, and its appearing in the line (a render after the answer was taken in) is the
    // signal that the screen has caught up with everything before it.
    await expect.poll(async () => (await quickLog(page)).statusReads).toBe(1);
    await page.getByTestId('quick-request').pressSequentially(' zonk');
    await expect(notRead(page)).toHaveText(`${RESIDUE}, zonk`);

    await expect(readButton(page)).toHaveCount(0);
    await expect(page.getByRole('dialog')).not.toContainText(/assistant|model|download|unavailable|samsung/i);
    expect((await quickLog(page)).statusReads).toBe(1);
    expect((await quickLog(page)).generated).toEqual([]);
  });
}
