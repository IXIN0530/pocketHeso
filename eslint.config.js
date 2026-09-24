// 決定論ルールと依存方向を機械的に検査する（AGENTS.md「絶対ルール」, ref/conventions, spec/10）。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const nondeterministic = [
  { object: 'Math', property: 'random', message: '乱数は RNGStream 経由（決定論）' },
  { object: 'Date', property: 'now', message: '時刻は引数で受け取る（決定論）' },
  { object: 'crypto', property: 'getRandomValues', message: '乱数は RNGStream 経由（決定論）' },
];
const bannedMath = ['sin', 'cos', 'tan', 'atan2', 'exp', 'log', 'pow', 'hypot', 'cbrt'].map((property) => ({
  object: 'Math',
  property,
  message: 'Core では + - * / sqrt のみ（事前計算表を使う）',
}));
const browserGlobals = ['window', 'document', 'navigator', 'localStorage', 'indexedDB', 'setTimeout', 'setInterval']
  .map((name) => ({ name, message: 'Core/claims はブラウザ API に依存しない' }));
const newDate = { selector: "NewExpression[callee.name='Date']", message: '時刻は引数で受け取る（決定論）' };

/** 依存方向（spec/10）: 上 → 下のみ。 */
const importBan = (...pkgs) => ({
  patterns: pkgs.map((p) => ({ group: [`@ph/${p}`, `@ph/${p}/*`], message: `この層から @ph/${p} は import できない（spec/10）` })),
});

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'logs/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.es2023 } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['tools/**/*.ts', 'eslint.config.js', '**/vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...nondeterministic, ...bannedMath],
      'no-restricted-globals': ['error', ...browserGlobals],
      'no-restricted-syntax': [
        'error',
        newDate,
        { selector: "BinaryExpression[operator='**']", message: '** は禁止（乗算か事前計算表）' },
        { selector: "AssignmentExpression[operator='**=']", message: '**= は禁止（乗算か事前計算表）' },
      ],
      'no-restricted-imports': ['error', importBan('shared', 'claims', 'fx', 'web', 'pachisim')],
    },
  },
  {
    files: ['packages/claims/src/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...nondeterministic],
      'no-restricted-globals': ['error', ...browserGlobals],
      'no-restricted-syntax': ['error', newDate],
      'no-restricted-imports': ['error', importBan('shared', 'fx', 'web', 'pachisim')],
    },
  },
  {
    files: ['packages/shared/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', importBan('claims', 'fx', 'web', 'pachisim')] },
  },
  {
    files: ['packages/fx/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', importBan('claims', 'web', 'pachisim')] },
  },
  {
    files: ['tools/pachisim/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', importBan('shared', 'claims', 'fx', 'web')] },
  },
);
