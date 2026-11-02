import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { liftStanding, standingText, type LiftTable } from '../src/domain/liftStandards';
import { clickIfPresent, fresh } from './fresh';

/**
 * Progress → Strength compares the squat with raw lifters at meets once Settings → About you has a
 * year of birth and sex: a real finished session, the real committed table, the seed's 74 kg.
 */

const table = JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/liftStandards.json', import.meta.url)), 'utf8')) as LiftTable;

test('a logged squat is compared with raw lifters of the same sex, age group and class', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('start-Lower (Squat)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
  const card = page.getByTestId('exercise-card-Barbell Back Squat');
  await card.getByTestId('weight-input').fill('140');
  await card.getByTestId('reps-input').fill('5');
  await card.getByTestId('set-done').click();
  await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);

  // No year of birth or sex yet: the old bodyweight-multiple line, and a way to add them.
  await page.goto('/progress');
  const strength = page.getByTestId('strength-card');
  await expect(strength).toContainText('Barbell Back Squat');
  await expect(strength).toContainText('× bodyweight');
  await expect(page.getByTestId('meet-squat')).toHaveCount(0);
  await page.getByTestId('meet-settings').click();
  await expect(page).toHaveURL(/\/settings$/);

  const born = new Date().getFullYear() - 30;
  await page.getByTestId('birth-year').fill(String(born));
  await page.getByTestId('birth-year').blur();
  await page.getByTestId('sex-male').click();
  await expect.poll(() => page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('iron');
    open.onsuccess = () => {
      const get = open.result.transaction('settings').objectStore('settings').get('settings');
      get.onsuccess = () => resolve([get.result.birthYear, get.result.sex]);
    };
  }))).toEqual([born, 'male']);

  await page.goto('/progress');
  const meet = page.getByTestId('meet-squat');
  await expect(meet).toContainText('e1RM');
  const e1rmKg = Number((await meet.textContent())!.match(/([\d.]+) kg e1RM/)![1]);
  const expected = liftStanding(table, { sex: 'male', age: 30, bodyweightKg: 74, lift: 'squat', e1rmKg })!;
  expect(expected.weightClass).toBe('74');
  await expect(meet).toContainText(standingText(expected));
  await expect(meet).toContainText(`Elite (top 1%): ${expected.eliteKg} kg · ${expected.n.toLocaleString('en-GB')} lifters`);
  await expect(page.getByTestId('meet-group')).toContainText('Men 24–34, 74 kg class');
  await expect(page.getByTestId('meet-group')).toContainText('Body fat is not part of it');
  await expect(strength.getByText('× bodyweight')).toHaveCount(0);
  await expect(page.getByTestId('meet-settings')).toHaveCount(0);
});
