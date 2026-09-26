// 実機（iPhone のショートカット）で生成した受け取りコード（resources/shortcut/README.md の手順, 試験用の鍵）。
// genIso はコード内の gen、days はデコード結果の期待値（distanceM = distM）。

/** 試験用の鍵（本番は PWA が生成する16文字）。 */
export const FIXTURE_KEY = 'abcdefghijklmnop';

export interface ShortcutFixture {
  readonly name: string;
  readonly code: string;
  readonly genIso: string;
  readonly today: string;
  readonly days: readonly { readonly day: string; readonly steps: number; readonly distanceM: number }[];
}

export const SHORTCUT_FIXTURES: readonly ShortcutFixture[] = [
  {
    name: '2026-09-24 夕方（3日とも1万歩超）',
    code:
      'PH1.eyJ2IjoxLCJnZW4iOiIyMDI2LTA5LTI0VDE3OjEzOjU3KzA5OjAwIiwidHoiOiIrMDk6MDAiLCJkYXlzIjpbeyJkIjoiMjAyNi0wOS0yNCIsInN0ZXBzIjoxMDM2OCwiZGlzdE0iOjY2NDF9LHsiZCI6IjIwMjYtMDktMjMiLCJzdGVwcyI6MTAyMzEsImRpc3RNIjo2MDg3fSx7ImQiOiIyMDI2LTA5LTIyIiwic3RlcHMiOjEwMzQwLCJkaXN0TSI6NjEzN31dfQ==.7a66065e3e7c6a40',
    genIso: '2026-09-24T17:13:57+09:00',
    today: '2026-09-24',
    days: [
      { day: '2026-09-24', steps: 10368, distanceM: 6641 },
      { day: '2026-09-23', steps: 10231, distanceM: 6087 },
      { day: '2026-09-22', steps: 10340, distanceM: 6137 },
    ],
  },
];
