import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Served from the root of https://recto.antheasolve.com/.
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
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Verso2Recto',
        short_name: 'Recto',
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
