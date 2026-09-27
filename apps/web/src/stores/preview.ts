// 演出プレビュー（spec/43）: Debug 画面・留守中サマリーからの再生要求をホールの盤面へ渡す（ホールのタブへ切り替えて流す）。
import type { AwaySummary, JackpotKind, LotteryHoldColor } from '@ph/core';
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

/** 変動の後に当たり・ハズレを見せる時間。 */
export const PREVIEW_TAIL_MS = 3500;

export interface PreviewRequest {
  readonly pattern: string;
  readonly hit: boolean;
  /** 分岐の通し番号（留守中リプレイは Engine の保留の番号そのもの）。 */
  readonly serial: number;
  readonly color: LotteryHoldColor;
  /** 変動時間（省略時はパターンの基準の尺）。 */
  readonly durationMs?: number | undefined;
  readonly kind?: JackpotKind | undefined;
  readonly rounds?: number | undefined;
  /** 変動開始で保留が割れる演出を必ず見せる（Debug。省略時は通し番号の見せ方どおり, D-075）。 */
  readonly breaks?: boolean | undefined;
  /** 留守中リプレイの当たりの時刻（ホールに「リプレイ」と出す）。 */
  readonly replayAt?: number | undefined;
}

export const usePreview = create<{ readonly request: PreviewRequest | null }>(() => ({ request: null }));

export function requestPreview(r: PreviewRequest): void {
  usePreview.setState({ request: r });
}

/**
 * 留守中サマリーの最も熱い当たりを、Engine が決めた変動のまま流す要求（spec/22 AwaySummary）。
 * 通し番号・パターン・変動時間が同じなので演出の分岐と尺もその場で見ていた時と同じになる。
 */
export function replayRequest(away: AwaySummary): PreviewRequest | null {
  const r = away.replay;
  if (!r) return null;
  return {
    pattern: r.pattern,
    hit: true,
    serial: r.entry,
    color: r.color,
    durationMs: r.endsAt - r.startedAt,
    kind: r.kind,
    rounds: r.rounds,
    replayAt: r.startedAt,
  };
}
