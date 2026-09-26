import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Self-hosts the MediaPipe WASM runtime (module build, used by the vision
 * worker) under /mediapipe/ — no third-party CDN on the hot path, and the
 * service worker can cache it after first use.
 */
function mediapipeRuntime(): Plugin {
  const dir = 'node_modules/@mediapipe/tasks-vision/wasm';
  const files = ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm'];
  return {
    name: 'friday-mediapipe-runtime',
    configureServer(server) {
      server.middlewares.use('/mediapipe', (req, res, next) => {
        const f = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (!files.includes(f)) return next();
        res.setHeader('Content-Type', f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(join(dir, f)).pipe(res);
      });
    },
    generateBundle() {
      for (const f of files) this.emitFile({ type: 'asset', fileName: `mediapipe/${f}`, source: readFileSync(join(dir, f)) });
    },
  };
}

/**
 * `VITE_BASE` lets the same build be served from a sub-path
 * (e.g. GitHub Pages: /F.R.I.D.A.Y.-Camera/). Defaults to the domain root.
 */
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    mediapipeRuntime(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'F.R.I.D.A.Y. — AI Vision',
        short_name: 'F.R.I.D.A.Y.',
        description: '現実世界を見るための AI インターフェース。カメラ映像に AI の認識・検索・記憶を HUD として重ねます。',
        lang: 'ja',
        start_url: base,
        scope: base,
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'portrait',
        background_color: '#03060d',
        theme_color: '#03060d',
        categories: ['photo', 'productivity', 'utilities'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        screenshots: [
          { src: 'screenshot-narrow.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'ランドマークを認識する F.R.I.D.A.Y. の HUD' },
          { src: 'screenshot-wide.jpg', sizes: '1920x1200', type: 'image/jpeg', form_factor: 'wide', label: 'タブレット / デスクトップの FULL HUD' },
        ],
        shortcuts: [
          { name: 'TRANSLATE', short_name: '翻訳', url: `${base}?mode=translate`, icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
          { name: 'MEMORY', short_name: 'メモリー', url: `${base}?sheet=memory`, icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        globIgnores: ['**/screenshot-*', '**/mediapipe/**'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // On-device vision: MediaPipe WASM runtime + model, cached after first use.
            urlPattern: ({ url }) => url.pathname.includes('/mediapipe/') || url.hostname === 'storage.googleapis.com',
            handler: 'CacheFirst',
            options: { cacheName: 'friday-vision-models', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'friday-fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ url }) => url.hostname.endsWith('open-meteo.com'),
            handler: 'NetworkFirst',
            options: { cacheName: 'friday-weather', networkTimeoutSeconds: 5, expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 6 } },
          },
        ],
      },
    }),
  ],
  // Module workers so the vision worker can lazy-load MediaPipe.
  worker: { format: 'es' },
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never);
