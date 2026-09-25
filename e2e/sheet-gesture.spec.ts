import { expect, test, type Page } from '@playwright/test';
import { centreOf, fresh, swipe } from './fresh';

/**
 * Pull a sheet down to close it (src/ui/components/Sheet.tsx), with real touch input through
 * Chromium's own pipeline (see `swipe` in fresh.ts) — so native scrolling, touch-action and the
 * browser claiming a gesture all behave as on the phone.
 *
 * Every "it stayed open" below is asserted only after a positive signal that the gesture has been
 * handled — the panel's recorded drag states, or a list's scroll position having moved — so none
 * of them can pass merely because nothing has happened yet.
 */

const PUSH_A = '/routines/144fdfb0-e94c-5661-a373-bf8085237abf';

/** Every value the topmost panel's data-drag-state takes from now on, in order. */
async function recordDragStates(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const panels = document.querySelectorAll('[data-testid="sheet-panel"]');
    const panel = panels[panels.length - 1]!;
    const w = window as unknown as { __dragStates: string[] };
    w.__dragStates = [];
    new MutationObserver(() => w.__dragStates.push(panel.getAttribute('data-drag-state') ?? '')).observe(panel, {
      attributes: true,
      attributeFilter: ['data-drag-state'],
    });
  });
  return () => page.evaluate(() => (window as unknown as { __dragStates: string[] }).__dragStates.slice());
}

async function openAddFood(page: Page) {
  await fresh(page);
  await page.goto('/food/new');
  await page.getByTestId('empty-add-food').click();
  const title = page.getByRole('dialog').getByText('Add food', { exact: true });
  await expect(title).toBeVisible();
  return title;
}

test('pulling the Add food sheet down by its title closes it', async ({ page }) => {
  const title = await openAddFood(page);
  const from = await centreOf(title);
  await swipe(page, from, { x: from.x, y: from.y + 320 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Back on the meal, which is untouched.
  await expect(page.getByTestId('empty-add-food')).toBeVisible();
});

test('a short, slow pull slides back and the sheet stays open', async ({ page }) => {
  const title = await openAddFood(page);
  const states = await recordDragStates(page);
  const from = await centreOf(title);
  await swipe(page, from, { x: from.x, y: from.y + 50 }, { steps: 12, durationMs: 700 });
  // The panel was dragged, then settled back to rest: the gesture ran to its end.
  await expect.poll(states).toEqual(['dragging', 'settling', 'idle']);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('sheet-panel')).not.toHaveAttribute('style', /translateY/);
});

test('a quick flick closes it well short of the distance', async ({ page }) => {
  const title = await openAddFood(page);
  const from = await centreOf(title);
  await swipe(page, from, { x: from.x, y: from.y + 60 }, { steps: 3, durationMs: 45 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('with reduced motion the pull still closes the sheet', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const title = await openAddFood(page);
  const from = await centreOf(title);
  await swipe(page, from, { x: from.x, y: from.y + 320 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('tapping the handle still closes it', async ({ page }) => {
  await openAddFood(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a scrolled list scrolls back first; only a pull from its top closes the sheet', async ({ page }) => {
  await fresh(page);
  await page.goto(PUSH_A);
  await page.getByTestId('add-exercise').click();
  const dialog = page.getByRole('dialog');
  const list = dialog.getByTestId('sheet-body').locator('.overflow-y-auto').first();
  await expect(list.getByRole('button').first()).toBeVisible();
  const scrollTop = () => list.evaluate((el) => el.scrollTop);
  const states = await recordDragStates(page);

  // Setup, not the thing under test: put the list part-way down. Scrolled by a swipe instead, this
  // step passed locally every time and once left the list at 0 on CI; what is being tested is the
  // pull that follows, which stays real touch input.
  const mid = await centreOf(list);
  await list.evaluate((el) => el.scrollTo({ top: 200 }));
  await expect.poll(scrollTop).toBeGreaterThan(80);

  // Pull down inside the scrolled list: it scrolls back to the top — even though the finger
  // carries on past the top in the same gesture, the sheet does not move.
  await swipe(page, { x: mid.x, y: mid.y - 120 }, { x: mid.x, y: mid.y + 200 }, { holdMs: 300 });
  await expect.poll(scrollTop).toBe(0);
  await expect(dialog).toBeVisible();

  // Now at the top, the same pull closes it. The panel's whole recorded history is this one drag
  // and its exit — proof that neither scroll above ever moved it.
  await swipe(page, { x: mid.x, y: mid.y - 120 }, { x: mid.x, y: mid.y + 200 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(states).toEqual(['dragging', 'settling']);
});

test('stacked sheets: a pull, and Escape, close only the one on top', async ({ page }) => {
  await fresh(page);
  await page.goto(PUSH_A);
  await page.locator('[data-testid^="rx-card-"]').first().getByRole('button').first().click();
  const editorSave = page.getByTestId('rx-save');
  await expect(editorSave).toBeVisible();

  // Pull the confirmation down by its title.
  await page.getByRole('button', { name: 'Remove from routine' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  const confirmTitle = page.getByRole('dialog').last().getByText(/^Remove /);
  const from = await centreOf(confirmTitle);
  await swipe(page, from, { x: from.x, y: from.y + 250 });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(editorSave).toBeVisible();

  // Escape, likewise, closes the confirmation alone — it used to close both at once.
  await page.getByRole('button', { name: 'Remove from routine' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(editorSave).toBeVisible();

  // And once more closes the editor.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a second finger mid-drag hands the sheet back instead of stranding it', async ({ page }) => {
  const title = await openAddFood(page);
  const states = await recordDragStates(page);
  const from = await centreOf(title);
  const cdp = await page.context().newCDPSession(page);
  const t0 = Date.now() / 1000;
  const p1 = (dy: number) => ({ x: from.x, y: from.y + dy, id: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p1(0)], timestamp: t0 });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p1(i * 10)], timestamp: t0 + i * 0.03 });
  }
  // A second finger lands on the panel while the first is still dragging.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [p1(60), { x: from.x + 80, y: from.y + 200, id: 2 }],
    timestamp: t0 + 0.25,
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.3 });
  // Dragged, then handed back to rest — not left hanging mid-drag.
  await expect.poll(states).toEqual(['dragging', 'settling', 'idle']);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('sheet-panel')).not.toHaveAttribute('style', /translateY/);
});
