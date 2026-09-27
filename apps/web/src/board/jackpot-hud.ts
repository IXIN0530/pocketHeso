// 大当たり中の液晶の表示（D-077）: ラウンド・アタッカーに入った玉・獲得出玉・連チャンと、終わった後の結果の告知。
// LcdState と表示時刻から決める（Three・DOM に依存しない）。描くのは hud-canvas.ts。
import { isRush, type LcdResultKind, type LcdState } from './lcd-timeline.ts';

/** 機種のラウンドの中身（spec/21 round）。 */
export interface JackpotRound {
  /** 1ラウンドでアタッカーに入る玉の数。 */
  readonly count: number;
  readonly payoutPerBall: number;
  readonly msPerRound: number;
}

/** 機種の既定（3機種とも同じ。機種が分かる前に使う）。 */
export const DEFAULT_ROUND: JackpotRound = { count: 10, payoutPerBall: 15, msPerRound: 25000 };

/** 大当たりの始めに「大当たり nR」を大きく出す時間。 */
export const HUD_START_MS = 2600;
/** 上乗せ（LT）の告知の時間。 */
export const HUD_BONUS_MS = 3000;
/** 結果の告知の時間（次の変動が始まっても重ねて出す）。 */
export const HUD_RESULT_MS = 4500;
/** 1ラウンドのうちアタッカーが開いて玉が入っていく割合（残りはラウンド間のインターバル）。 */
const OPEN_SHARE = 0.8;

export type HudView =
  | {
      readonly k: 'round';
      /** 大当たりの始まりからの ms（「大当たり」の告知の進み）。 */
      readonly t: number;
      readonly round: number;
      readonly rounds: number;
      /** このラウンドでアタッカーに入った玉（0..count）。 */
      readonly inRound: number;
      readonly count: number;
      /** この大当たりの獲得出玉（ここまで）。 */
      readonly balls: number;
      /** RUSH 中の当たりなら何連目か（RUSH 外は 0）。 */
      readonly chain: number;
      /** 上乗せの告知（足したラウンドと告知からの ms）。 */
      readonly bonus: { readonly add: number; readonly t: number } | null;
    }
  | {
      readonly k: 'result';
      readonly t: number;
      readonly kind: LcdResultKind;
      readonly payout: number;
      readonly chain: number;
      readonly balls: number;
      readonly spins: number;
    };

/** 時刻 now に液晶へ重ねる表示（無ければ null）。 */
export function jackpotHud(st: LcdState, now: number, r: JackpotRound): HudView | null {
  const j = st.jackpot;
  if (j) {
    // Projection から作った大当たりは開始が分からないので終了予定から逆算する（上乗せ前は目安）。
    const start = j.startAt ?? (j.endsAt != null ? j.endsAt - j.rounds * r.msPerRound : now);
    const t = Math.max(0, now - start);
    const round = Math.min(j.rounds, Math.floor(t / r.msPerRound) + 1);
    const within = round === j.rounds ? Math.min(t - (round - 1) * r.msPerRound, r.msPerRound) : t - (round - 1) * r.msPerRound;
    const inRound = Math.min(r.count, Math.floor((within / (r.msPerRound * OPEN_SHARE)) * r.count));
    const balls = ((round - 1) * r.count + inRound) * r.payoutPerBall * (j.rate ?? 1);
    const rush = st.rush;
    const bonusT = j.bonus ? now - j.bonus.at : -1;
    return {
      k: 'round',
      t,
      round,
      rounds: j.rounds,
      inRound,
      count: r.count,
      balls,
      chain: rush && isRush(rush.mode) ? rush.chain + 1 : 0,
      bonus: j.bonus && bonusT >= 0 && bonusT < HUD_BONUS_MS ? { add: j.bonus.add, t: bonusT } : null,
    };
  }
  const res = st.result;
  if (res && now >= res.at && now - res.at < HUD_RESULT_MS) {
    return { k: 'result', t: now - res.at, kind: res.kind, payout: res.payout, chain: res.chain, balls: res.balls, spins: res.spins };
  }
  return null;
}

/** 結果の告知に合わせて鳴らすパックの演出（シート名）。 */
export function resultCue(kind: LcdResultKind): string {
  switch (kind) {
    case 'rushIn':
    case 'ltIn':
      return 'rush_in';
    case 'rushOn':
      return 'rush_on';
    case 'rushEnd':
      return 'rush_end';
    case 'jitanIn':
    case 'end':
      return 'bonus_end';
  }
}
