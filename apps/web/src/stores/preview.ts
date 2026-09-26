// Debug の演出プレビュー（spec/43）: Debug 画面からの再生要求をホールの盤面へ渡す（ホールのタブへ切り替えて流す）。
import type { LotteryHoldColor } from '@ph/core';
import { create } from 'zustand';

/** 演出プレビューの4本（通常リーチ / SP / 激アツ / 確定）。当該保留の色も見せる。 */
export const PREVIEWS: readonly { pattern: string; label: string; color: LotteryHoldColor; alwaysHit?: boolean }[] = [
  { pattern: 'reach_n', label: '通常リーチ', color: 'blue' },
  { pattern: 'sp_reach', label: 'SP', color: 'green' },
  { pattern: 'spsp_gekiatsu', label: '激アツ', color: 'red' },
  { pattern: 'kakutei', label: '確定', color: 'gold', alwaysHit: true },
];

/** プレビューの通し番号の基数（Engine の保留 < 1e9・ボーナス保留 1e9〜 と重ならない）。 */
export const PREVIEW_SERIAL_BASE = 2000000000;

export interface PreviewRequest {
  readonly pattern: string;
  readonly hit: boolean;
  readonly serial: number;
  readonly color: LotteryHoldColor;
}

export const usePreview = create<{ readonly request: PreviewRequest | null }>(() => ({ request: null }));

export function requestPreview(r: PreviewRequest): void {
  usePreview.setState({ request: r });
}
