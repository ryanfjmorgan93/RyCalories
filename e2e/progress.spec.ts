import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh } from './fresh';

/**
 * The Progress screen's calendar, body map, weekly-sets table, strength card and recent PRs,
 * plus Settings persistence and the exercise-detail chart modes — all against data produced by a
 * real finished session, not a mock.
 */

async function logSets(page: Page, exercise: string, weight: number, reps: number[]) {
  const card = page.getByTestId(`exercise-card-${exercise}`);
  await expect(card).toBeVisible();
  for (const r of reps) {
    await card.getByTestId('weight-input').fill(String(weight));
    await card.getByTestId('reps-input').fill(String(r));
    await card.getByTestId('set-done').click();
    await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
  }
}

async function finishAndSave(page: Page) {
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe('Progress', () => {
  test('calendar, body map, weekly sets, strength and PRs all reflect a finished session', async ({ page }) => {
    await fresh(page);

    const todayKey = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

    // Real prior history for Romanian Deadlift first — a first-ever session never shows a PR, so
    // the "recent-prs" assertion below needs a completed session already on the books. Picked
    // explicitly by name, not via the suggested-session button: the suggestion deliberately avoids
    // two lower-body days in a row, so it would not offer Lower (Hinge) again for the session below.
    await page.getByTestId('start-Lower (Hinge)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await expect(page).toHaveURL(/\/session\//);
    await logSets(page, 'Romanian Deadlift (Barbell)', 90, [8, 8, 8, 8]);
    await finishAndSave(page);

    await page.getByTestId('start-Lower (Hinge)').click();
    await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
    await expect(page).toHaveURL(/\/session\//);
    await logSets(page, 'Romanian Deadlift (Barbell)', 110, [8, 8, 8, 8]);
    await finishAndSave(page);

    await page.goto('/progress');
    await expect(page.getByTestId('calendar-heatmap')).toBeVisible();
    await expect(page.getByTestId(`cal-day-${todayKey}`)).toHaveAttribute('aria-label', /trained/);

    // Body map: hamstrings (Romanian Deadlift's muscle group) was trained this week — tap it and
    // the readout reads its sets, in the default "Sets this week" mode. The region is drawn as a
    // pair of rects (left/right) in one path, so the element's own bounding-box centre falls in
    // the gap between them — click inside the left rect instead of the default centre point.
    const region = page.locator('[data-muscle="hamstrings"]').first();
    const box = await region.boundingBox();
    if (!box) throw new Error('hamstrings region not found');
    await region.click({ position: { x: box.width * 0.2, y: box.height * 0.5 } });
    await expect(page.getByTestId('body-map-readout')).toContainText('hamstrings');
    await expect(page.getByTestId('body-map-readout')).toContainText('sets this week');

    await expect(page.getByTestId('weekly-sets')).toContainText('hamstrings');

    await expect(page.getByTestId('recent-prs')).toContainText('Romanian Deadlift (Barbell)');
    await expect(page.getByTestId('recent-prs')).toContainText('PR');

    // Settings: a plates toggle persists across a reload (a real write, not a mocked one).
    await page.goto('/settings');
    const halfKgChip = page.getByTestId('plates-card').getByRole('button', { name: '0.5 kg', exact: true });
    await halfKgChip.click();
    await expect(halfKgChip).toHaveClass(/bg-fg/);
    await page.reload();
    await expect(page.getByTestId('plates-card').getByRole('button', { name: '0.5 kg', exact: true })).toHaveClass(/bg-fg/);

    // Exercise detail: chart mode switches to e1RM and the records card shows a best.
    await page.goto('/exercises');
    await page.getByTestId('exercise-search').fill('Romanian Deadlift');
    await page.getByRole('button', { name: /Romanian Deadlift/ }).click();
    await expect(page.getByRole('heading', { name: 'Romanian Deadlift (Barbell)' })).toBeVisible();
    await page.getByTestId('chart-mode').getByRole('radio', { name: 'e1RM' }).click();
    await expect(page.getByTestId('chart-mode').getByRole('radio', { name: 'e1RM' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('exercise-records')).toContainText('Best weight');
    await expect(page.getByTestId('exercise-records')).toContainText('110 kg');
  });
});
