import { LAUNCH_DIR_COUNT } from '@ph/core';

/**
 * `launch_dirs` 表を生成する（真上を中心に `spreadRad` だけ左右へ振る）。
 * `Math.sin/cos` は生成時のみ可。Core は生成された表を読むだけ。
 */
export function generateLaunchDirs(
  count: number = LAUNCH_DIR_COUNT,
  spreadRad: number = 0.1,
): Array<readonly [number, number]> {
  if (Math.floor(count) !== count || count < 1) {
    throw new Error('count must be a positive int');
  }
  if (!(spreadRad >= 0) || spreadRad > Math.PI) {
    throw new Error('spreadRad out of range');
  }
  const dirs: Array<readonly [number, number]> = [];
  for (let i = 0; i < count; i = i + 1) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const a = t * spreadRad;
    dirs.push([Math.sin(a), -Math.cos(a)]);
  }
  return dirs;
}

/** 小数6桁に丸める（表ファイルの刻み。Core の正規化と一致）。 */
export function round6(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}
