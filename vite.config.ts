import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { createReadStream, existsSync } from 'node:fs';

/**
 * Serve the real antheasolve.com export at /__sample.html during `npm run dev`,
 * so the editor can be exercised against the actual site without a token.
 *
 * A dev-server middleware rather than a file in public/: anything in public/ is
 * copied into dist and precached by the service worker, which quietly turned a
 * 213 KB app into a 2.2 MB one. Reads straight from the local checkout, so it
 * cannot drift from the real file either.
 */
function devSampleSite(): Plugin {
  const SAMPLE = 'G:/Anthea-Solve/index.html';
  return {
    name: 'recto-dev-sample',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__sample.html', (_req, res, next) => {
        if (!existsSync(SAMPLE)) return next();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        createReadStream(SAMPLE).pipe(res);
      });
    },
  };
}

/**
 * Served from the root of https://recto.antheasolve.com/.
 *
 * The subdomain predates the RectoVeritas name and is unaffected by it.
 *
 * It previously lived at welcomedrain.github.io/Verso2Recto/, which needed a
 * '/Verso2Recto/' base. On its own subdomain the app is at the root, so the
 * base is '/' everywhere — including during `npm run dev`. Getting this wrong
 * does not fail the build: it deploys a page whose every asset 404s.
 *
 * The subdomain is not cosmetic. Browser storage is scoped by host, not by
 * path, so while this app shared welcomedrain.github.io with another Pages
 * site, any script on that site could read the GitHub token stored here.
 */
const base = '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    devSampleSite(),
    VitePWA({
      // 'prompt', not 'autoUpdate'. autoUpdate installs silently and the new
      // version only appears on the NEXT open, so you can sit in a stale build
      // without knowing. Forcing a reload instead would be worse: it can
      // interrupt an edit in progress. Prompting says what happened and lets
      // the reload happen when it suits.
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'RectoVeritas',
        short_name: 'RectoVeritas',
        description: 'Edit a GitHub-hosted site offline, then publish with one button.',
        theme_color: '#ec3013',
        background_color: '#f3f2f2',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell is small; the working copy lives in IndexedDB, not the
        // cache, so nothing here needs to hold a 2 MB page bundle.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api/],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { target: 'es2022' },
});
