/** 正式版の切り替え（P8-T1, D-087）。Vercel Production か PH_RELEASE=1 で false（vite.config.ts の define、vitest でも定義される）。 */
declare const __DEV_TOOLS__: boolean;
/** ルート package.json の version（P8-T1）。 */
declare const __APP_VERSION__: string;
