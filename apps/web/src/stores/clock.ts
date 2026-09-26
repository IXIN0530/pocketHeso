// 画面側の時刻の窓口（spec/40: now は UI スレッドの Date.now()）。
// Debug（`?debug=1&x=60` など, spec/40）では時間を倍速で進め、本番のセーブと混ざらないよう別の DB を使う。

/** Debug で選べる時間倍率。 */
export const DEBUG_SCALES = [1, 60, 3600] as const;
export const DEBUG_DB_NAME = 'pocketheso-debug';

/** 時間倍率に対応する DB 名（1 は本番の既定 DB = undefined）。 */
export function dbNameFor(scale: number): string | undefined {
  return scale === 1 ? undefined : DEBUG_DB_NAME;
}

export interface Clock {
  /** 1 以外なら Debug の時計（別 DB）。 */
  readonly scale: number;
  now(): number;
  /** 時計を at 以降に揃える（前回の Debug で先へ進めた DB を開いた時用）。 */
  catchUp(at: number): void;
}

export function makeClock(scale: number, real: () => number = Date.now): Clock {
  let realBase = real();
  let simBase = realBase;
  const now = () => simBase + Math.floor((real() - realBase) * scale);
  return {
    scale,
    now,
    catchUp(at) {
      const t = now();
      if (at > t) {
        realBase = real();
        simBase = at;
      }
    },
  };
}

/** URL から時間倍率を読む（`?debug=1` が無い・不正な値は 1）。 */
export function debugScaleFrom(search: string): number {
  const q = new URLSearchParams(search);
  if (q.get('debug') !== '1') {
    return 1;
  }
  const x = Number(q.get('x'));
  return (DEBUG_SCALES as readonly number[]).includes(x) ? x : 1;
}

export const clock: Clock = makeClock(typeof location === 'undefined' ? 1 : debugScaleFrom(location.search));
