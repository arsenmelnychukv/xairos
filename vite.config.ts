import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// In dev, /api goes to a local PocketBase (npm run pb). In production Caddy
// serves dist/ and proxies /api to PocketBase on the same origin.
export default defineConfig({
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8090', changeOrigin: false },
    },
  },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg', 'icons/favicon.svg', 'icons/badge-96.png'],
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'] },
      manifest: {
        id: '/',
        name: 'xairos',
        short_name: 'xairos',
        description: 'Tasks, calendar, focus and habits.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0C1517',
        theme_color: '#0C1517',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // The worker only exists in builds: test it with `npm run build && npm run preview`.
      devOptions: { enabled: false },
    }),
  ],
});
