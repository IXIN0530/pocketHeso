// 盤面が実際に映している液晶の状態をホールの状態行へ渡す（P13-T4）。
// Engine の Projection は盤面（表示の遅れ DISPLAY_LAG_MS）より先に進むので、そのまま出すと図柄が揃う前に「大当たり中」が出てしまう。
import type { HallProjection, LotteryMode } from '@ph/core';
import { create } from 'zustand';

export interface LcdView {
  /** 液晶が今映している大当たり（無ければ null）。 */
  readonly jackpot: { readonly rounds: number } | null;
  /** 液晶が映しているモードと連チャン（RUSH に入った当たりを 1 と数える。通常は 0）。 */
  readonly mode: LotteryMode;
  readonly chain: number;
  /** まだ液晶に出ていない大当たりの開始の数・終了の出玉（Projection から引いて見せる）。 */
  readonly pendingJackpots: number;
  readonly pendingPayout: number;
}

/** null = 盤面が無い・背面・プレビュー・Debug の倍速（Projection をそのまま使う）。 */
export const useLcdView = create<{ readonly view: LcdView | null }>(() => ({ view: null }));

export function setLcdView(v: LcdView | null): void {
  const cur = useLcdView.getState().view;
  if (cur === v) return;
  if (
    cur !== null &&
    v !== null &&
    cur.jackpot?.rounds === v.jackpot?.rounds &&
    (cur.jackpot === null) === (v.jackpot === null) &&
    cur.mode === v.mode &&
    cur.chain === v.chain &&
    cur.pendingJackpots === v.pendingJackpots &&
    cur.pendingPayout === v.pendingPayout
  )
    return;
  useLcdView.setState({ view: v });
}

/** 状態行・持ち玉に出す値（view が null なら Projection のまま）。 */
export function shownHall(
  p: HallProjection,
  view: LcdView | null,
): { jackpot: { rounds: number } | null; chain: number; jackpots: number; balls: number; mode: LotteryMode; stRemaining: number | null } {
  if (view === null) {
    return { jackpot: p.jackpot ? { rounds: p.jackpot.rounds } : null, chain: p.chain, jackpots: p.totals.jackpots, balls: p.balls, mode: p.mode, stRemaining: p.stRemaining };
  }
  return {
    jackpot: view.jackpot,
    // Core の chain は RUSH に入った当たりを 0 と数える。LcdView の chain は 1 と数える。
    chain: view.chain > 0 ? view.chain - 1 : 0,
    jackpots: Math.max(0, p.totals.jackpots - view.pendingJackpots),
    balls: p.balls - view.pendingPayout,
    mode: view.mode,
    stRemaining: view.mode === p.mode ? p.stRemaining : null,
  };
}
