import { expect, test, type Page } from '@playwright/test';
import { clickIfPresent, fresh, logOneSet } from './fresh';

/**
 * A routine with sessions is archived when deleted, not removed. It used to vanish from every
 * screen with no way back; the Routines screen now lists it under "Archived · N" with Restore.
 */

/** Complete a real session on Lower (Hinge), so deleting that routine has history to protect. */
async function completeHingeSession(page: Page): Promise<void> {
  await page.getByTestId('start-Lower (Hinge)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
  await logOneSet(page, page.getByTestId('exercise-card-Romanian Deadlift (Barbell)'), 110, 8);
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);
}

test('a routine with sessions can be deleted, found under Archived, and restored to the end of the list', async ({ page }) => {
  await fresh(page);
  await completeHingeSession(page);

  await page.goto('/routines');
  const hingeMore = page.getByTestId('routine-more-Lower (Hinge)');
  await expect(hingeMore).toBeVisible();
  // Nothing is archived yet, so there is no Archived section at all.
  await expect(page.getByTestId('archived-toggle')).toHaveCount(0);

  await hingeMore.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  // Gone from the list, present under Archived · 1, collapsed.
  await expect(hingeMore).toBeHidden();
  const toggle = page.getByTestId('archived-toggle');
  await expect(toggle).toHaveText('Archived · 1');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const restore = page.getByTestId('restore-routine-Lower (Hinge)');
  await expect(restore).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(restore).toBeVisible();
  // Still archived, so still out of the active list.
  await expect(hingeMore).toHaveCount(0);

  await restore.click();

  // Back in the list, and last in it: the seed had it first, restoring puts it after the others.
  await expect(hingeMore).toBeVisible();
  await expect(page.locator('[data-testid^="routine-more-"]').last()).toHaveAttribute('data-testid', 'routine-more-Lower (Hinge)');
  // And gone from Archived, section and all, now that nothing is archived.
  await expect(toggle).toHaveCount(0);
  await expect(restore).toHaveCount(0);

  // It is a real routine again after a reload, not just a repainted list.
  await page.reload();
  await expect(hingeMore).toBeVisible();
  await expect(page.locator('[data-testid^="routine-more-"]').last()).toHaveAttribute('data-testid', 'routine-more-Lower (Hinge)');
});
