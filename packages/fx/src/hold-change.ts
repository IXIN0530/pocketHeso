import { RNGStream, type LotteryHoldColor } from '@ph/core';

/**
 * 保留変化（P7-T4, D-075）。最終色は Core が取得時に決め、ここでは見せ方だけを決める: 変化するか・先バレか。
 * 乱数は RNGStream(seed, 'holdChange', serial) のみ（Core の抽選結果には触れない）。当否は受け取らない
 * （先バレも変化も色だけで決まり、色の信頼度を変えない）。
 * 変化する保留は灰色（白）で点滅して出て、自分の変動開始で大きな玉になり、ひびが入って割れて最終色が出る（HOLD_BREAK_MS）。
 */

export interface HoldChangePlan {
  readonly final: LotteryHoldColor;
  /** 変化する（灰色で点滅して出て、変動開始で割れて最終色になる）。 */
  readonly change: boolean;
  /** 先バレ（取得の直後に専用の音・光。見せ方は変化と同じ）。先バレなら change も true。 */
  readonly sakibare: boolean;
}

/** 熱さ順（白 < 青 < 緑 < 赤 < 金）。 */
export const HOLD_RANKED: readonly LotteryHoldColor[] = ['white', 'blue', 'green', 'red', 'gold'];

export function holdRank(color: LotteryHoldColor): number {
  return HOLD_RANKED.indexOf(color);
}

/**
 * 最終色ごとの先バレの割合（/100。白・青・緑・赤・金, D-074）。当否を見ずに最終色だけで決めるので、
 * 先バレした保留の各色の信頼度は保留色の表のまま。通常時の表（3機種）で先バレの信頼度は約40%・当たりの約24%に付く。
 */
const SAKIBARE_PCT = [0, 10, 18, 24, 35];
/** 最終色ごとの「変化で見せる」割合（/100。白・青・緑・赤・金。先バレしなかった保留のうち）。 */
const CHANGE_PCT = [0, 20, 35, 45, 55];

/** 同じ seed・serial・最終色なら同じ見せ方。 */
export function planHoldChange(seed: number, serial: number, final: LotteryHoldColor): HoldChangePlan {
  const r = holdRank(final);
  if (r <= 0) return { final, change: false, sakibare: false };
  const rng = new RNGStream(seed, 'holdChange', serial);
  const sb = SAKIBARE_PCT[r]!;
  if (rng.pick([100 - sb, sb]) === 1) return { final, change: true, sakibare: true };
  const pct = CHANGE_PCT[r]!;
  return { final, change: rng.pick([100 - pct, pct]) === 1, sakibare: false };
}

/**
 * 割れる演出の時刻（自分の変動開始から, ms）。grow までに保留が液晶の中央へ動いて大きな玉になり、
 * crack からひびが入って広がり（点滅が速くなる）、reveal で割れて最終色の保留が出る（色が変わり hold_<色> が鳴る）。
 * reels で図柄が回り始め（変動の演出もここから）、end までに保留が当該保留の位置へ戻る。
 */
export const HOLD_BREAK_MS = { grow: 450, crack: 600, reveal: 1500, reels: 2000, end: 2400 } as const;

/** 時刻 now に見せる色。spinAt は自分の変動開始の時刻（まだ・不明なら null）。 */
export function holdColorAt(plan: HoldChangePlan, spinAt: number | null, now: number): LotteryHoldColor {
  if (!plan.change) return plan.final;
  return spinAt !== null && now >= spinAt + HOLD_BREAK_MS.reveal ? plan.final : 'white';
}

/** 取得から先バレまでの間（玉が入ってすぐ鳴らす）。 */
export const SAKIBARE_DELAY_MS = 150;

/** 先バレの時刻（先バレしない・取得時刻が分からない時は null）。 */
export function sakibareAt(plan: HoldChangePlan, addedAt: number | null): number | null {
  return plan.sakibare && addedAt !== null ? addedAt + SAKIBARE_DELAY_MS : null;
}

/** 割れる演出の前半（玉になる・ひび, パックのシート名）。割れた時は holdChangeCue の色のシートが鳴る。 */
export const HOLD_CRACK_CUE = 'hold_crack';

/** 先バレの演出（パックのシート名）。 */
export const SAKIBARE_CUE = 'sakibare';

/** 変化の時に鳴らす演出（パックのシート名）。 */
export function holdChangeCue(color: LotteryHoldColor): string {
  return 'hold_' + color;
}
