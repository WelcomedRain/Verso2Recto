import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://welcomedrain.github.io/Verso2Recto/ on Pages, and from
// / during `npm run dev`.
const base = process.env.GITHUB_ACTIONS ? '/Verso2Recto/' : '/';

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
