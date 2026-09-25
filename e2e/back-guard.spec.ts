import { expect, test } from '@playwright/test';
import { fresh } from './fresh';

/**
 * Back — the arrow, and through it the Android back gesture (src/state/overlays.ts) — asks before
 * throwing away food that was never saved. The gesture itself cannot be fired from Playwright;
 * it runs the same TopBar action these tests press, and Escape (below) drives the same sheet
 * stack the gesture closes first.
 */

test('an unsaved meal asks before back discards it; Keep and Escape keep it', async ({ page }) => {
  await fresh(page);
  await page.goto('/food/new');
  await page.getByTestId('empty-add-food').click();
  await page.getByTestId('food-name').fill('Toast');
  await page.getByTestId('food-grams').fill('100');
  await page.getByTestId('food-kcal').fill('250');
  await page.getByTestId('food-protein').fill('8');
  await page.getByTestId('food-carbs').fill('45');
  await page.getByTestId('food-fat').fill('3');
  await page.getByTestId('save-food').click();
  await expect(page.getByText('Toast', { exact: true })).toBeVisible();

  const back = page.locator('header').getByRole('button', { name: 'Back' });
  const discard = page.getByRole('dialog').filter({ hasText: 'Discard this meal?' });

  await back.click();
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Keep' }).click();
  await expect(discard).toHaveCount(0);
  await expect(page).toHaveURL(/\/food\/new/);
  await expect(page.getByText('Toast', { exact: true })).toBeVisible();

  // Escape closes the question, as the back gesture would, and nothing else.
  await back.click();
  await expect(discard).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(discard).toHaveCount(0);
  await expect(page).toHaveURL(/\/food\/new/);
  await expect(page.getByText('Toast', { exact: true })).toBeVisible();

  await back.click();
  await discard.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/food$/);
  await expect(page.getByTestId('add-meal-button')).toBeVisible();
});

test('an empty new meal goes straight back with no question', async ({ page }) => {
  await fresh(page);
  await page.goto('/food/new');
  await expect(page.getByTestId('empty-add-food')).toBeVisible();
  await page.locator('header').getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/food$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('an unsaved recipe asks before back discards it', async ({ page }) => {
  await fresh(page);
  await page.goto('/food/recipes/new');
  await page.getByTestId('recipe-add-ingredients').click();
  await page.getByTestId('picker-search').fill('egg');
  await page.getByTestId('picker-result-0').click();
  await expect(page.getByTestId('review-row-0')).toBeVisible();

  await page.locator('header').getByRole('button', { name: 'Back' }).click();
  const discard = page.getByRole('dialog').filter({ hasText: 'Discard this recipe?' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/food\/recipes$/);
});

test('an edited recipe asks before back throws away a changed portion count; an untouched one goes straight back', async ({ page }) => {
  await fresh(page);
  await page.goto('/food/recipes/new');
  await page.getByTestId('recipe-add-ingredients').click();
  await page.getByTestId('picker-search').fill('egg');
  await page.getByTestId('picker-result-0').click();
  await page.getByTestId('review-row-0').click();
  await page.getByTestId('question-count').fill('2');
  await page.getByTestId('question-next').click();
  await page.getByTestId('recipe-name').fill('Omelette');
  await expect(page.getByTestId('review-total-kcal')).toBeVisible();
  await page.getByTestId('recipe-save').click();
  await page.waitForURL(/\/food\/recipes$/);

  const openEdit = async () => {
    await page.getByTestId('recipe-more-Omelette').click();
    await page.getByTestId('recipe-edit').click();
    await expect(page).toHaveURL(/\/food\/recipes\/[0-9a-f-]+\/edit/);
    await expect(page.getByTestId('recipe-name')).toHaveValue('Omelette');
  };
  const back = page.locator('header').getByRole('button', { name: 'Back' });

  // Untouched: straight back, no question.
  await openEdit();
  await back.click();
  await expect(page).toHaveURL(/\/food\/recipes$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Only the portions changed: that is still a change worth asking about.
  await openEdit();
  await page.getByTestId('share-made').fill('4');
  await back.click();
  const discard = page.getByRole('dialog').filter({ hasText: 'Discard your changes?' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Keep' }).click();
  await expect(discard).toHaveCount(0);
  await expect(page.getByTestId('share-made')).toHaveValue('4');
});
