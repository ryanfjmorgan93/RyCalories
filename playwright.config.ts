import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const PORT = 4173;

// The sandbox ships a pre-installed Chromium at a fixed path; CI installs its own. Only pin an
// executable when one is actually there, so the same config works in both.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  // One retry in CI only: a genuine flake should not block a build, but it still shows in the
  // report, and locally a flake must fail so it gets fixed rather than absorbed.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Pixel 7'],
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    // Never reuse: a server left over from an earlier run serves that run's dist, so a suite can
    // go green against code that is no longer in the working tree. A rebuild costs a few seconds.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
