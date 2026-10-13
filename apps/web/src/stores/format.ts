// 数値と時間の日本語表記（spec/40 文言）。

const UNITS: readonly [number, string][] = [
  [1e16, '京'],
  [1e12, '兆'],
  [1e8, '億'],
  [1e4, '万'],
];

/**
 * 数値: 1万未満はそのまま（桁区切り・小数は digits 桁まで）、以降は有効3桁で `1.23万 / 45.6億 / 789兆 / 1.23京`、1e20 以上は `1.2e20`。
 * 単位つきは切り捨て（持ち玉と価格を比べた時に「足りるように見えて買えない」を出さない）。
 */
export function formatNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) {
    return '—';
  }
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e20) {
    return sign + a.toExponential(1).replace('e+', 'e');
  }
  for (const [unit, name] of UNITS) {
    if (a >= unit) {
      const v = a / unit;
      const d = v >= 100 ? 0 : v >= 10 ? 1 : 2;
      const f = 10 ** d;
      return `${sign}${(Math.floor(v * f + 1e-7) / f).toFixed(d)}${name}`;
    }
  }
  const f = 10 ** digits;
  return sign + (Math.floor(a * f + 1e-7) / f).toLocaleString('ja-JP', { maximumFractionDigits: digits });
}

/** 経過時間: 「3日4時間」「5時間02分」「12分」「40秒」。 */
export function formatSpan(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(s / 60);
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  if (d > 0) {
    return `${d}日${h % 24}時間`;
  }
  if (h > 0) {
    return `${h}時間${String(min % 60).padStart(2, '0')}分`;
  }
  return min > 0 ? `${min}分` : `${s}秒`;
}

/** 時刻: 今日なら「14:05」、それ以外は「9/24 14:05」。 */
export function formatTime(ms: number, now: number): string {
  const d = new Date(ms);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return new Date(now).toDateString() === d.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** 残り時間を「1:12:05」（時:分:秒）で。 */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s % 60)}`;
}
