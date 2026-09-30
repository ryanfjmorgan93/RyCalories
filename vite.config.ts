import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

// Which CI run and commit this build came from. Every build used to report "Iron 0.1.0", so when a
// fix did not show up on the phone there was no way to tell whether the phone had the build with
// the fix. Empty outside CI.
const buildRun = process.env.GITHUB_RUN_NUMBER ?? '';
const buildSha = (process.env.GITHUB_SHA ?? '').slice(0, 7);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_RUN__: JSON.stringify(buildRun),
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Iron',
        short_name: 'Iron',
        description: 'Personal workout logger with automatic double progression.',
        theme_color: '#0a0a0b',
        background_color: '#0a0a0b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'en-GB',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,ico,woff2,wasm}'],
        // The exercise catalogue's photographs (about 6.6 MB, a thousand files) stay out of the
        // precache: the install would fetch all of them for the few an owner ever opens. The
        // Android shell never registers this worker (src/main.tsx), so it carries them on disk.
        // On the web a frame is cached the first time it is shown (the route below).
        globIgnores: ['catalogue/**'],
        runtimeCaching: [
          {
            // A regular expression only matches a cross-origin URL from its first character, so this is same-origin only.
            urlPattern: /\/catalogue\/[^/]+\/\d+\.webp$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'iron-catalogue',
              // Every frame the catalogue has (two each for about 540 entries) fits: the cache is
              // bounded by what is on disk, never by how long the app has been installed.
              expiration: { maxEntries: 1200 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
        navigateFallback: '/index.html',
        // Capacitor rewrites cross-origin GETs to a same-origin proxy path and lets its own
        // WebViewLocalServer answer them, which is how the label lookup gets past CORS on Android.
        // Being same-origin, that path is inside this service worker's scope, so keep the
        // navigation fallback away from it — serving index.html in place of a product record would
        // kill the lookup silently.
        navigateFallbackDenylist: [/^\/_capacitor_http_interceptor_/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { sourcemap: false, target: 'es2022' },
});
