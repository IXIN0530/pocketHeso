import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// ルート package.json の version を __APP_VERSION__ にする（P8-T1）。
const rootPkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8')) as {
  version?: string;
};
const appVersion = rootPkg.version ?? '0.0.0';
// 正式版は dev と同じコードを定数で切り替える（D-087）: Vercel Production か PH_RELEASE=1 で false。
const devTools = process.env.VERCEL_ENV !== 'production' && process.env.PH_RELEASE !== '1';

// 配信は Vercel のルート `/`（D-021）。PWA は spec/41。
export default defineConfig({
  // ホーム画面 Web アプリは start_url から起動し `?spike=` を保持しないため、本番以外では本体にスパイクへの入口を出す。
  define: {
    __DEV_TOOLS__: JSON.stringify(devTools),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  // Engine Worker は module worker（spec/40）。
  worker: { format: 'es' },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,bin,json,m4a}'] },
      manifest: {
        name: 'PocketHeso',
        short_name: 'PocketHeso',
        description: '良い行動で営業時間を得て、放置で玉が増えるパチンコ放置ゲーム',
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#121630',
        theme_color: '#121630',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
