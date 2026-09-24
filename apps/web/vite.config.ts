import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 配信は Vercel のルート `/`（D-021）。PWA は spec/41。
export default defineConfig({
  // ホーム画面 Web アプリは start_url から起動し `?spike=` を保持しないため、本番以外では本体にスパイクへの入口を出す。
  define: { __SHOW_SPIKES__: JSON.stringify(process.env.VERCEL_ENV !== 'production') },
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
