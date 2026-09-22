import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

// Mirrors vite.config.ts's `define` block. Nothing under test read these until src/db/autoBackup.ts
// started embedding BUILD_LABEL in backup filenames — that module is reachable from ordinary db
// tests (via src/db/repo.ts's pre-destructive-backup calls), so __APP_VERSION__ etc. must exist
// here too or importing it throws a ReferenceError before a single assertion runs.
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_RUN__: JSON.stringify(''),
    __BUILD_SHA__: JSON.stringify(''),
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
});
