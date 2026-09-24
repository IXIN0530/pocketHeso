import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 配信は Vercel のルート `/`（D-021）。
export default defineConfig({
  plugins: [react()],
});
