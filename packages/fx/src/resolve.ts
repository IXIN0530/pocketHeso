import { RNGStream } from '@ph/core';
import type { Cue, CueSheet } from '@ph/shared';

export interface ResolveOptions {
  readonly seed: number;
  /** 変動・当たりの通し番号（同じ seed・serial なら同じ分岐）。 */
  readonly serial: number;
  /** 設定の強度 1〜3（spec/43 `fx.intensity`）。 */
  readonly intensity: number;
}

export interface ResolvedCues {
  /** at 昇順（同時刻はシートの記述順）。 */
  readonly cues: readonly Cue[];
  /** 分岐ごとに選んだ option の index（branches の順。ログ比較用）。 */
  readonly picks: readonly number[];
}

/**
 * CueSheet の分岐を決めて、再生するキュー列にする。
 * 分岐の乱数は RNGStream(seed, 'presentation', serial) のみ（Core の抽選結果には触れない）。
 * 強度で落とすキューも分岐は必ず引くので、強度を変えても他の分岐はずれない。
 */
export function resolveCueSheet(sheet: CueSheet, opts: ResolveOptions): ResolvedCues {
  const rng = new RNGStream(opts.seed, 'presentation', opts.serial);
  const all: Cue[] = [...sheet.cues];
  const picks: number[] = [];
  for (const branch of sheet.branches) {
    const i = rng.pick(branch.options.map((o) => o.weight));
    picks.push(i);
    all.push(...(branch.options[i]?.cues ?? []));
  }
  const cues = all.filter((c) => (c.min_intensity ?? 1) <= opts.intensity);
  // Array.prototype.sort は安定（同時刻は記述順のまま）。
  cues.sort((a, b) => a.at - b.at);
  return { cues, picks };
}
