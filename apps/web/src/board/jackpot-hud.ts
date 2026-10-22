// 大当たり中の液晶の表示（D-077）: ラウンド・アタッカーに入った玉・獲得出玉・連チャンと、終わった後の結果の告知。
// LcdState と表示時刻から決める（Three・DOM に依存しない）。描くのは hud-canvas.ts。
import { planUpperRush, upperTimeline, upperViewAt, type UpperRushSpec, type UpperView } from '@ph/fx';
import { isRush, type LcdResultKind, type LcdState } from './lcd-timeline.ts';

/** 機種のラウンドの中身（spec/21 round）。 */
export interface JackpotRound {
  /** 1ラウンドでアタッカーに入る玉の数。 */
  readonly count: number;
  readonly payoutPerBall: number;
  readonly msPerRound: number;
  /** 機種の上位の枝（rush-middle-01。無い機種は省略・null, D-120）。 */
  readonly upper?: UpperRushSpec | null;
}

/** 機種の既定（3機種とも同じ。機種が分かる前に使う）。 */
export const DEFAULT_ROUND: JackpotRound = { count: 10, payoutPerBall: 15, msPerRound: 5000 };

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
      /** 上位RUSH・上乗せ・ガセの見せ方（P15-T3。無い時は null）。addBalls は今の告知で足した出玉（「+1,500」。無ければ 0）。 */
      readonly upper: (UpperView & { readonly addBalls: number }) | null;
    }
  | {
      readonly k: 'result';
      readonly t: number;
      readonly kind: LcdResultKind;
      readonly payout: number;
      readonly chain: number;
      readonly balls: number;
      readonly spins: number;
      /** 上位の当たりの終わり（「上位RUSH継続」）。 */
      readonly upper: boolean;
    };

/** 開始から t ms のラウンドとアタッカーに入った玉。 */
function roundAt(t: number, rounds: number, r: JackpotRound): { round: number; inRound: number } {
  const round = Math.min(rounds, Math.floor(t / r.msPerRound) + 1);
  const within = round === rounds ? Math.min(t - (round - 1) * r.msPerRound, r.msPerRound) : t - (round - 1) * r.msPerRound;
  return { round, inRound: Math.min(r.count, Math.floor((within / (r.msPerRound * OPEN_SHARE)) * r.count)) };
}

/**
 * 時刻 now に液晶へ重ねる表示（無ければ null）。seed は上位RUSH・ガセの見せ方（planUpperRush）に使う。
 * 上位・ガセの白黒の間は HUD の数字を止め（ラウンドは裏で進む）、色が戻ると追いつく。上位の全ラウンドは時刻表で 10R → 20R → +10R と見せる。
 */
export function jackpotHud(st: LcdState, now: number, r: JackpotRound, seed = 0): HudView | null {
  const j = st.jackpot;
  if (j) {
    // Projection から作った大当たりは開始が分からないので終了予定から逆算する（終了予定は未告知の上乗せを含む）。
    const start = j.startAt ?? (j.endsAt != null ? j.endsAt - (j.rounds + (j.hiddenRounds ?? 0)) * r.msPerRound : now);
    const t = Math.max(0, now - start);
    const rush = st.rush;
    const spec = r.upper ?? null;
    const loops = j.upper?.loops ?? 0;
    const plan = planUpperRush({ serial: j.entry, st: rush?.mode === 'st', upper: j.upper !== undefined, loops }, spec, seed);
    const view = spec && plan.k !== 'none' ? upperViewAt(upperTimeline(plan, j.rounds * r.msPerRound - HUD_RESULT_MS), spec, t) : null;
    const live = roundAt(t, j.rounds, r);
    const { round, inRound } = view?.frozen ? roundAt(Math.min(t, view.frozenAt), j.rounds, r) : live;
    const unit = j.unit ?? j.rate ?? 1;
    const balls = ((round - 1) * r.count + inRound) * r.payoutPerBall * unit;
    let rounds = j.rounds;
    if (spec && view && j.upper) {
      // 見せる全ラウンドは、いつも今のラウンド＋1 以上（縮めた時も）。
      const base = j.rounds - spec.upperRounds - spec.addRounds * loops;
      rounds = Math.min(j.rounds, Math.max(base + view.addedRounds, live.round + 1));
    }
    const bonusT = j.bonus ? now - j.bonus.at : -1;
    const add = view?.banner?.add ?? 0;
    return {
      k: 'round',
      t,
      round,
      rounds,
      inRound,
      count: r.count,
      balls,
      chain: rush && isRush(rush.mode) ? rush.chain + 1 : 0,
      bonus: j.bonus && bonusT >= 0 && bonusT < HUD_BONUS_MS ? { add: j.bonus.add, t: bonusT } : null,
      upper: view ? { ...view, addBalls: add * r.count * r.payoutPerBall * unit } : null,
    };
  }
  const res = st.result;
  if (res && now >= res.at && now - res.at < HUD_RESULT_MS) {
    return {
      k: 'result',
      t: now - res.at,
      kind: res.kind,
      payout: res.payout,
      chain: res.chain,
      balls: res.balls,
      spins: res.spins,
      upper: res.upper === true,
    };
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
