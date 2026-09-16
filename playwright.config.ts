import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Y4M_PATH } from './e2e/fixtures/ean13';

// Overridable so two suites can run side by side (each worktree of a parallel build gets its own port).
const PORT = Number(process.env.PW_PORT ?? 4173);

// The sandbox ships a pre-installed Chromium at a fixed path; CI installs its own. Only pin an
// executable when one is actually there, so the same config works in both.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

// Chromium wants an absolute path for the fake video capture file. global-setup.ts draws it
// before any project launches a browser.
const y4mPath = resolve(process.cwd(), Y4M_PATH);

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
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Pixel 7'],
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'app',
      testIgnore: /barcode\.spec\.ts/,
    },
    {
      name: 'camera',
      testMatch: /barcode\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        // Pre-grant camera so getUserMedia resolves against the fake device with no permission
        // prompt to drive through.
        permissions: ['camera'],
        // The fake video device only paints frames in full Chromium. Playwright's default headless
        // build is the reduced "headless shell", on which the camera never yields a frame and the
        // decode times out (reproduced locally, and exactly what CI showed). In CI, where no
        // executable is pinned, `channel: 'chromium'` selects the full build that
        // `playwright install chromium` also downloads.
        ...(executablePath ? {} : { channel: 'chromium' as const }),
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4mPath}`],
        },
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    // Never reuse: a server left over from an earlier run serves that run's dist, so a suite can
    // go green against code that is no longer in the working tree. A rebuild costs a few seconds.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
