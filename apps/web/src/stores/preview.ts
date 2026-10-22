// 演出プレビュー（spec/43）: Debug 画面・留守中サマリーからの再生要求をホールの盤面へ渡す（ホールのタブへ切り替えて流す）。
import type { AwaySummary, JackpotKind, LotteryHoldColor } from '@ph/core';
import { planUpperRush, type UpperRushSpec } from '@ph/fx';
import { create } from 'zustand';
import type { LcdState } from '../board/lcd-timeline.ts';

/** 演出プレビューの4本（通常リーチ / SP / 激アツ / 確定）。当該保留の色も見せる。 */
export const PREVIEWS: readonly { pattern: string; label: string; color: LotteryHoldColor; alwaysHit?: boolean }[] = [
  { pattern: 'reach_n', label: '通常リーチ', color: 'blue' },
  { pattern: 'sp_reach', label: 'SP', color: 'green' },
  { pattern: 'spsp_gekiatsu', label: '激アツ', color: 'red' },
  { pattern: 'kakutei', label: '確定', color: 'gold', alwaysHit: true },
];

/** 上位RUSH・ガセのプレビュー（Debug。変動は省いて大当たりから流す。どの機種でも必ずその流れになる, D-120）。 */
export const UPPER_PREVIEWS: readonly { label: string; upper?: { loops: number }; gase?: true }[] = [
  { label: '上位RUSH（上乗せ 0 回）', upper: { loops: 0 } },
  { label: '上位RUSH（上乗せ 1 回）', upper: { loops: 1 } },
  { label: '上位RUSH（上乗せ 4 回）', upper: { loops: 4 } },
  { label: 'ガセ（割れずに戻る）', gase: true },
];

/** 上位の枝が無い機種でもプレビューできるよう、国道店と同じ値を持つ。 */
export const PREVIEW_UPPER_SPEC: UpperRushSpec = { baseRounds: 10, upperRounds: 10, addRounds: 10, loop1In: 4, loopMax: 4 };

/** プレビューの大当たりの全ラウンド（上位は 基本 + 上位 + 上乗せ×K）。 */
export function upperPreviewRounds(p: { upper?: { loops: number } | undefined }): number {
  return p.upper ? PREVIEW_UPPER_SPEC.baseRounds + PREVIEW_UPPER_SPEC.upperRounds + PREVIEW_UPPER_SPEC.addRounds * p.upper.loops : PREVIEW_UPPER_SPEC.baseRounds;
}

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
  /** 上位RUSH（loops は上乗せの回数 K）・ガセの大当たりから流す（変動は省く, Debug）。 */
  readonly upper?: { readonly loops: number } | undefined;
  readonly gase?: boolean | undefined;
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
    ...(r.upper === true ? { upper: { loops: r.loops ?? 0 } } : {}),
  };
}

/** 上位RUSH・ガセのプレビューの液晶の状態（ST 中の大当たりから。startAt は流し始めの時刻）。 */
export function upperPreviewState(p: PreviewRequest, startAt: number): LcdState {
  const jackpot = { entry: p.serial, kind: 'kakuhen' as const, rounds: upperPreviewRounds(p), startAt, ...(p.upper ? { upper: p.upper } : {}) };
  return { holds: [], spin: null, resolved: null, jackpot, rush: { mode: 'st', chain: 1, balls: 0 } };
}

/** serial 以降で、seed のもとでガセの見せ方になる最初の通し番号（ガセは 10% の見せ方なので、プレビューは該当する番号を選ぶ）。 */
export function gaseSerial(serial: number, seed: number): number {
  let n = serial;
  while (planUpperRush({ serial: n, st: true, upper: false, loops: 0 }, PREVIEW_UPPER_SPEC, seed).k !== 'gase') n++;
  return n;
}
