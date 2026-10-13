import { expect, test, type Page } from '@playwright/test';
import { accentFromHue, EMBER } from '../src/domain/accent';
import { quoteOfTheDay, welcomeLine } from '../src/domain/dailyQuote';
import { fresh } from './fresh';

/**
 * Look A in the built app: the robot renders are bundled and drawn, and the colour wheel in
 * Settings → Look recolours everything that reads --c-accent, and keeps it across a reload.
 * Nothing here is mocked: the renders are fetched from the preview server as the app would, the
 * colour is read back from the page's computed styles, and the saved hue from IndexedDB itself.
 */

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** The colour actually painted on the active tab's bar, a plain `bg-accent` element. */
const activeBar = (page: Page) => page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"] span.bg-accent');

async function storedHue(page: Page): Promise<number | null> {
  return page.evaluate(
    () =>
      new Promise<number | null>((resolve) => {
        const req = indexedDB.open('iron');
        req.onsuccess = () => {
          const get = req.result.transaction('settings').objectStore('settings').get('settings');
          get.onsuccess = () => {
            resolve(get.result?.accentHue ?? null);
            req.result.close();
          };
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
  );
}

test('the most rested routine leads Home with its lead lift as a robot render', async ({ page }) => {
  await fresh(page);
  const hero = page.locator('[data-testid^="routine-card-"]').first().getByTestId('exercise-hero');
  await expect(hero).toHaveAttribute('data-render', 'robot');
  const img = hero.locator('img');
  await expect(img).toHaveAttribute('src', /^\/robots\/[a-z0-9-]+\.webp$/);
  // Served by the build and decoded, not just named.
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
});

test('the colour wheel recolours the app, survives a reload, and resets to ember', async ({ page }) => {
  await fresh(page);
  await page.goto('/settings');
  await expect(page.getByTestId('accent-value')).toHaveText('Ember');
  await expect(activeBar(page)).toHaveCSS('background-color', rgb(EMBER.accent));

  const blue = accentFromHue(200).accent;
  expect(blue).not.toBe(EMBER.accent);
  await page.getByTestId('accent-hue').fill('200');
  await expect(page.getByTestId('accent-value')).toHaveText(blue.toUpperCase());
  await expect(activeBar(page)).toHaveCSS('background-color', rgb(blue));

  // Saved once the slider is still; wait on the stored row itself, then reload.
  await expect.poll(() => storedHue(page)).toBe(200);
  await page.reload();
  await expect(page.getByTestId('accent-value')).toHaveText(blue.toUpperCase());
  await expect(activeBar(page)).toHaveCSS('background-color', rgb(blue));

  await page.getByTestId('accent-reset').click();
  await expect(page.getByTestId('accent-value')).toHaveText('Ember');
  await expect(activeBar(page)).toHaveCSS('background-color', rgb(EMBER.accent));
  await expect.poll(() => storedHue(page)).toBeNull();
});

test('Home opens with a welcome for the time of day and the day\'s quote', async ({ page }) => {
  await fresh(page);
  const hour = await page.evaluate(() => new Date().getHours());
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(welcomeLine(hour));
  const q = quoteOfTheDay(today);
  await expect(page.getByTestId('quote-of-the-day')).toContainText(q.text);
  await expect(page.getByTestId('quote-of-the-day')).toContainText(q.author);
});

test('the muscle map draws the satin robot, front and back, from the build', async ({ page }) => {
  await fresh(page);
  await page.goto('/progress');
  const images = page.locator('svg[aria-label="Muscle map, front and back"] image');
  await expect(images).toHaveCount(2);
  for (const href of ['/body/front.webp', '/body/back.webp']) {
    const res = await page.request.get(href);
    expect(res.status(), href).toBe(200);
    expect(res.headers()['content-type']).toContain('image/webp');
  }
});
