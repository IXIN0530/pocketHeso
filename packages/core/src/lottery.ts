/** 取得時判定の抽選（当否・振分け・パターン・色, D-017）と賞球・レート倍率（spec/21）。 */
import type { HoldColor, JackpotBranch, MachineMode, MachineSpec, PatternTable, SpinPattern } from './machine.ts';
import { HOLD_COLORS } from './machine.ts';
import { RNGStream } from './rng.ts';

/** 抽選時のモード（取得時のモードで当否を判定する）。 */
export type LotteryMode = 'normal' | 'st';

/** 既知の抽選モード（順序固定）。 */
export const LOTTERY_MODES: readonly LotteryMode[] = ['normal', 'st'];

/** 保留色の抽選結果（`white` は重み残余として暗黙に存在）。 */
export type LotteryHoldColor = HoldColor | 'white';

/** 保留色の抽選候補（順序固定。`HOLD_COLORS` の順＋`white`）。 */
export const LOTTERY_HOLD_COLORS: readonly LotteryHoldColor[] = [
  HOLD_COLORS[0] as HoldColor,
  HOLD_COLORS[1] as HoldColor,
  HOLD_COLORS[2] as HoldColor,
  HOLD_COLORS[3] as HoldColor,
  'white',
];

/** 保留1件分の取得時確定データ（先読み・予約通知の根拠）。 */
export interface HoldEntry {
  readonly serial: number;
  readonly modeAtDraw: LotteryMode;
  readonly isHit: boolean;
  readonly branchIndex: number | null;
  readonly patternIndex: number;
  readonly color: LotteryHoldColor;
  readonly hot: number;
  readonly hesoPayoutBalls: number;
}

/** 抽選モードに対応する確率表を返す。 */
export function modeOf(spec: MachineSpec, mode: LotteryMode): MachineMode {
  if (mode !== 'normal' && mode !== 'st') {
    throw new Error('invalid lottery: mode must be normal or st');
  }
  return mode === 'normal' ? spec.normal : spec.st;
}

/** レート（1発あたりの玉数）を検証する。 */
function assertRate(rate: number): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || Math.floor(rate) !== rate || rate < 1) {
    throw new Error('invalid lottery: rate must be a positive int');
  }
  return rate;
}

/** 通し番号（RNG の entrySerial）を検証する。 */
function assertSerial(serial: number): number {
  if (typeof serial !== 'number' || !Number.isFinite(serial) || Math.floor(serial) !== serial || serial < 0) {
    throw new Error('invalid lottery: serial must be a non-negative int');
  }
  return serial;
}

/** 合計を覆う最小の10のべき乗（white 残余の分母。D-032）。 */
function pow10Cover(total: number): number {
  let d = 1;
  while (d < total) {
    d = d * 10;
  }
  return d;
}

/** 機種の保留色行を `HOLD_COLORS` 順に探す（JSON の順序に依存しない）。 */
function holdRow(spec: MachineSpec, color: HoldColor): { wHit: number; wMiss: number } {
  for (let i = 0; i < spec.holdColors.length; i = i + 1) {
    const row = spec.holdColors[i];
    if (row !== undefined && row.color === color) {
      return row;
    }
  }
  throw new Error('invalid lottery: hold_colors lacks ' + color);
}

/** 保留色の重み列（`LOTTERY_HOLD_COLORS` と同順。当否別。`white` は残余, D-032）。 */
export function holdColorWeights(spec: MachineSpec, isHit: boolean): readonly number[] {
  const w: number[] = [];
  let sum = 0;
  for (let c = 0; c < HOLD_COLORS.length; c = c + 1) {
    const color = HOLD_COLORS[c] as HoldColor;
    const row = holdRow(spec, color);
    const v = isHit ? row.wHit : row.wMiss;
    w.push(v);
    sum = sum + v;
  }
  w.push(pow10Cover(sum) - sum);
  return w;
}

/** 振分けの重み列（`jackpotSplit` と同順）。 */
function splitWeights(spec: MachineSpec): number[] {
  const w: number[] = [];
  for (let i = 0; i < spec.jackpotSplit.length; i = i + 1) {
    const b = spec.jackpotSplit[i] as JackpotBranch;
    w.push(b.weight);
  }
  return w;
}

/** 変動パターンの重み列（`patterns` と同順。当否別）。 */
function patternWeights(patterns: PatternTable, isHit: boolean): number[] {
  const w: number[] = [];
  for (let i = 0; i < patterns.length; i = i + 1) {
    const p = patterns[i] as SpinPattern;
    w.push(isHit ? p.hitW : p.missW);
  }
  return w;
}

/** ヘソ入賞時の取得時判定（当否・振分け・パターン・色を全部確定）。 */
export function drawHold(
  spec: MachineSpec,
  patterns: PatternTable,
  seed: number,
  mode: LotteryMode,
  serial: number,
  rate: number,
): HoldEntry {
  const modeObj = modeOf(spec, mode);
  assertSerial(serial);
  assertRate(rate);
  if (patterns.length === 0) {
    throw new Error('invalid lottery: patterns must not be empty');
  }
  const jackpot = new RNGStream(seed, 'jackpot', serial);
  const isHit = jackpot.nextU32() < modeObj.thresholdU32;
  let branchIndex: number | null = null;
  if (isHit) {
    branchIndex = new RNGStream(seed, 'split', serial).pick(splitWeights(spec));
  }
  const patternIndex = new RNGStream(seed, 'pattern', serial).pick(patternWeights(patterns, isHit));
  const patternRow = patterns[patternIndex];
  if (patternRow === undefined) {
    throw new Error('invalid lottery: pattern index out of range');
  }
  const colorIndex = new RNGStream(seed, 'holdColor', serial).pick(holdColorWeights(spec, isHit));
  const color = LOTTERY_HOLD_COLORS[colorIndex];
  if (color === undefined) {
    throw new Error('invalid lottery: color index out of range');
  }
  let hot = patternRow.hot;
  if (color === 'red') {
    hot = Math.min(5, hot + 1);
  } else if (color === 'gold') {
    hot = 5;
  }
  return { serial, modeAtDraw: mode, isHit, branchIndex, patternIndex, color, hot, hesoPayoutBalls: spec.hesoPayout * rate };
}

/** ヘソ賞球（`heso_payout × rate`。満タン時も支払う）。 */
export function hesoPayoutBalls(spec: MachineSpec, rate: number): number {
  assertRate(rate);
  return spec.hesoPayout * rate;
}

/** 振分け枝を取り出す（範囲外は投げる）。 */
function branchAt(spec: MachineSpec, branchIndex: number): JackpotBranch {
  if (typeof branchIndex !== 'number' || !Number.isFinite(branchIndex) || Math.floor(branchIndex) !== branchIndex) {
    throw new Error('invalid lottery: branchIndex must be an int');
  }
  const b = spec.jackpotSplit[branchIndex];
  if (b === undefined) {
    throw new Error('invalid lottery: branchIndex out of range');
  }
  return b;
}

/** 大当たり出玉（`rounds × count × payout_per_ball × rate`）。 */
export function jackpotPayoutBalls(spec: MachineSpec, branchIndex: number, rate: number): number {
  assertRate(rate);
  const b = branchAt(spec, branchIndex);
  return b.rounds * spec.roundCount * spec.payoutPerBall * rate;
}

/** 大当たりメダル（確変なら `per_kakuhen`、通常なら `per_jackpot`）。 */
export function jackpotMedals(spec: MachineSpec, branchIndex: number): number {
  const b = branchAt(spec, branchIndex);
  return b.kind === 'kakuhen' ? spec.medalPerKakuhen : spec.medalPerJackpot;
}
