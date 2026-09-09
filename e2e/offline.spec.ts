import { expect, test } from '@playwright/test';

/**
 * §2.1 — installable PWA that works 100% offline. First visit primes the service worker;
 * then we cut the network and reload: the app must still boot, read IndexedDB and log data.
 */
test('app boots and logs a set with the network off', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('next-up')).toBeVisible();
  // Wait for the service worker to be active and precaching complete.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error('no active SW');
  });
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('next-up')).toBeVisible();

  await page.getByTestId('start-session').click();
  await expect(page).toHaveURL(/\/session\//);
  const card = page.getByTestId('exercise-card-Romanian Deadlift (Barbell)');
  await card.getByTestId('weight-input').fill('110');
  await card.getByTestId('reps-input').fill('8');
  await card.getByTestId('set-done').click();
  await expect(card).toContainText('110 × 8');

  // Deep link while offline (navigateFallback → index.html from cache).
  await page.goto('/exercises');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await context.setOffline(false);
});

test('manifest is served and installable metadata is present', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  expect(manifest.lang).toBe('en-GB');
});
