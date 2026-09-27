import { RNGStream, type LotteryHoldColor } from '@ph/core';

/**
 * 保留変化（P7-T4）。最終色は Core が取得時に決め、ここでは見せ方だけを決める:
 * 表示を始める色・途中の段階・変わる時点。乱数は RNGStream(seed, 'holdChange', serial) のみ（Core の抽選結果には触れない）。
 * 最終色より格上の色は途中で見せない（色は上がるだけ）。当否は受け取らない（先バレも変化も色だけで決まり、色の信頼度を変えない）。
 */

/** 変わる時点: 取得時 / 前の保留が消化された時 / 自分の変動開始時。 */
export type HoldChangeTiming = 'acquire' | 'shift' | 'spin';

export interface HoldChangeStep {
  readonly timing: HoldChangeTiming;
  readonly color: LotteryHoldColor;
}

export interface HoldChangePlan {
  /** 表示を始める色。 */
  readonly start: LotteryHoldColor;
  /** 変化の段階（時点の早い順。最後の色が最終色）。 */
  readonly steps: readonly HoldChangeStep[];
  /** 先バレ（取得の直後に専用の音・光。白で出て、取得時の変化で最終色へ上がる）。 */
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
/** 始まりの色の重み（白・青・緑・赤。最終色より下だけ使う）。白から始まることが多い。 */
const START_W = [4, 2, 1, 1];
/** 2段階で変わる割合（/100。始まりと最終色の間に色がある時だけ）。 */
const TWO_STEP_PCT = 40;
/** 1段階の時点の重み（取得時・消化時・変動開始時）。 */
const ONE_TIMING_W = [3, 3, 4];
/** 2段階の時点の組と重み。 */
const TWO_TIMINGS: readonly (readonly [HoldChangeTiming, HoldChangeTiming])[] = [
  ['acquire', 'shift'],
  ['acquire', 'spin'],
  ['shift', 'spin'],
];
const TWO_TIMING_W = [3, 4, 3];
const ONE_TIMINGS: readonly HoldChangeTiming[] = ['acquire', 'shift', 'spin'];

/** 同じ seed・serial・最終色なら同じ見せ方。 */
export function planHoldChange(seed: number, serial: number, final: LotteryHoldColor): HoldChangePlan {
  const r = holdRank(final);
  if (r <= 0) return { start: final, steps: [], sakibare: false };
  const rng = new RNGStream(seed, 'holdChange', serial);
  const sb = SAKIBARE_PCT[r]!;
  if (rng.pick([100 - sb, sb]) === 1) return { start: 'white', steps: [{ timing: 'acquire', color: final }], sakibare: true };
  const pct = CHANGE_PCT[r]!;
  if (rng.pick([100 - pct, pct]) === 0) return { start: final, steps: [], sakibare: false };
  const s = rng.pick(START_W.slice(0, r));
  const two = r - s >= 2 && rng.pick([100 - TWO_STEP_PCT, TWO_STEP_PCT]) === 1;
  if (!two) {
    return { start: HOLD_RANKED[s]!, steps: [{ timing: ONE_TIMINGS[rng.pick(ONE_TIMING_W)]!, color: final }], sakibare: false };
  }
  // 途中の色は始まりと最終色の間から等しく選ぶ。
  const mids: number[] = [];
  for (let k = s + 1; k < r; k++) mids.push(1);
  const mid = s + 1 + rng.pick(mids);
  const [t1, t2] = TWO_TIMINGS[rng.pick(TWO_TIMING_W)]!;
  return {
    start: HOLD_RANKED[s]!,
    steps: [
      { timing: t1, color: HOLD_RANKED[mid]! },
      { timing: t2, color: final },
    ],
    sakibare: false,
  };
}

/** 保留の表示時刻（液晶の再生時刻）。 */
export interface HoldChangeClock {
  /** 取得の時刻。null は不明（リプレイ・プレビュー）: 取得時・消化時の変化は済んだものとする。 */
  readonly addedAt: number | null;
  /** 前の保留が初めて消化された時刻（まだなら null）。 */
  readonly shiftAt: number | null;
  /** 自分の変動開始の時刻（まだなら null）。 */
  readonly spinAt: number | null;
}

/** 各時点から実際に色が変わるまでの間（取得・移動・変動開始を見せてから変える）。 */
export const HOLD_CHANGE_DELAY_MS: Readonly<Record<HoldChangeTiming, number>> = { acquire: 700, shift: 350, spin: 500 };

function triggerAt(timing: HoldChangeTiming, c: HoldChangeClock): number {
  const spin = c.spinAt === null ? Infinity : c.spinAt + HOLD_CHANGE_DELAY_MS.spin;
  if (timing === 'spin') return spin;
  if (c.addedAt === null) return -Infinity;
  if (timing === 'acquire') return c.addedAt + HOLD_CHANGE_DELAY_MS.acquire;
  // 前の保留が消化されないまま自分の番が来たら、変動開始時に変える。
  return c.shiftAt === null ? spin : c.shiftAt + HOLD_CHANGE_DELAY_MS.shift;
}

/** 各段階が実際に効く時刻（前の段階より前にはならない）。 */
export function holdChangeTimes(plan: HoldChangePlan, c: HoldChangeClock): number[] {
  const out: number[] = [];
  let prev = -Infinity;
  for (const step of plan.steps) {
    prev = Math.max(prev, triggerAt(step.timing, c));
    out.push(prev);
  }
  return out;
}

/** 時刻 now に見せる色。 */
export function holdColorAt(plan: HoldChangePlan, c: HoldChangeClock, now: number): LotteryHoldColor {
  const times = holdChangeTimes(plan, c);
  let color = plan.start;
  for (let i = 0; i < plan.steps.length; i++) {
    if (times[i]! <= now) color = plan.steps[i]!.color;
  }
  return color;
}

/** 取得から先バレまでの間（玉が入ってすぐ鳴らす。色が上がるのは取得時の変化 +700ms）。 */
export const SAKIBARE_DELAY_MS = 150;

/** 先バレの時刻（先バレしない・取得時刻が分からない時は null）。 */
export function sakibareAt(plan: HoldChangePlan, c: HoldChangeClock): number | null {
  return plan.sakibare && c.addedAt !== null ? c.addedAt + SAKIBARE_DELAY_MS : null;
}

/** 先バレの演出（パックのシート名）。 */
export const SAKIBARE_CUE = 'sakibare';

/** 変化の時に鳴らす演出（パックのシート名）。 */
export function holdChangeCue(color: LotteryHoldColor): string {
  return 'hold_' + color;
}
