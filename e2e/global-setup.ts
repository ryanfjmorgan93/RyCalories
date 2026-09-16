import { FIXTURE_CODE, Y4M_PATH, writeY4m } from './fixtures/ean13';

/**
 * Draws the fake camera's barcode video once, before any project runs. Chromium's
 * `--use-file-for-fake-video-capture` flag (see playwright.config.ts's `camera` project) reads
 * this file directly, so it has to exist before the browser launches.
 */
export default async function globalSetup(): Promise<void> {
  writeY4m(Y4M_PATH, FIXTURE_CODE);
}
