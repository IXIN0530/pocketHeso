import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages のパス（リポジトリ名。大文字小文字を区別）。フォーク時は PH_BASE で上書き。
const base = process.env['PH_BASE'] ?? '/pocketHeso/';

export default defineConfig({
  base,
  plugins: [react()],
});
