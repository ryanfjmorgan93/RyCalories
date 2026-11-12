import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { liftStanding, type LiftTable } from '../src/domain/liftStandards';
import { strengthStanding } from '../src/domain/standards';
import { clickIfPresent, fresh } from './fresh';

/**
 * In a session, the squat shows its level under its name once Settings → About you has a sex and
 * a year of birth: a real finished session, the real committed table, the seed's 74 kg.
 */

const table = JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/liftStandards.json', import.meta.url)), 'utf8')) as LiftTable;

async function startLower(page: Page) {
  await page.goto('/');
  await page.getByTestId('start-Lower (Squat)').click();
  await clickIfPresent(page.getByRole('button', { name: 'Start anyway' }));
  await expect(page).toHaveURL(/\/session\//);
  return page.getByTestId('exercise-card-Barbell Back Squat');
}

test('the squat shows its level and the next mark under its name in the session', async ({ page }) => {
  await fresh(page);
  const first = await startLower(page);
  await first.getByTestId('weight-input').fill('140');
  await first.getByTestId('reps-input').fill('5');
  await first.getByTestId('set-done').click();
  await clickIfPresent(page.getByTestId('rest-timer').getByRole('button', { name: 'Skip' }));
  await page.getByTestId('finish-session').click();
  await clickIfPresent(page.getByRole('dialog').getByRole('button', { name: 'Finish', exact: true }));
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByTestId('save-session').click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/settings');
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

  const card = await startLower(page);
  const line = card.getByTestId('strength-line');
  await expect(line).toContainText('× bodyweight');
  const e1rmKg = Number((await line.textContent())!.match(/e1RM ([\d.]+) kg/)![1]);
  const meet = liftStanding(table, { sex: 'male', age: 30, bodyweightKg: 74, lift: 'squat', e1rmKg })!;
  expect(meet.weightClass).toBe('74');
  const s = strengthStanding({ standard: 'squat', sex: 'male', e1rmKg, bodyweightKg: 74, meet })!;
  // 140 × 5 is well over 1.5 × 74 kg: highly advanced, and competition powerlifters come next.
  expect(s.level).toBe('Highly advanced');
  await expect(line).toContainText(`${s.level} · ${s.head}`);
  await expect(line).toContainText(s.next!);
  await expect(line).toContainText('the average competition powerlifter (men 24–34, 74 kg)');
});
