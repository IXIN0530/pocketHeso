/** 取得時判定の抽選（当否・振分け・パターン・色, D-017）と賞球・レート倍率（spec/21）。 */
import type { HoldColor, HoldColorWeight, HoldTableColor, JackpotBranch, MachineMode, MachineSpec, PatternTable, SpinPattern } from './machine.ts';
import { HOLD_COLORS } from './machine.ts';
import { RNGStream } from './rng.ts';

/** 抽選時のモード（取得時のモードで当否を判定する。時短・LT拡張はspec/21 モード拡張節）。 */
export type LotteryMode = 'normal' | 'jitan' | 'st' | 'lt';

/** 既知の抽選モード（順序固定）。 */
export const LOTTERY_MODES: readonly LotteryMode[] = ['normal', 'jitan', 'st', 'lt'];

/** 保留色の抽選結果（白を含む。重みは機種 JSON の表, P7-T4）。 */
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
  /** 打ったレート（1 は省略。表示・旧セーブ用。払い出しは unit）。 */
  readonly rate?: number | undefined;
  /** 発射時の単価 unit＝floor(rate×ref×shotS)（取得時の ref で固定。旧セーブには無い, D-090）。 */
  readonly unit?: number | undefined;
  /** 上位の枝の当たり（上位の時だけ, D-120）。 */
  readonly upper?: true | undefined;
  /** 上乗せの回数 K（0〜loop_max。上位の時だけ・取得時に確定, D-120）。 */
  readonly loops?: number | undefined;
}

/** 抽選モードに対応する確率表を返す。 */
export function modeOf(spec: MachineSpec, mode: LotteryMode): MachineMode {
  if (mode === 'normal') {
    return spec.normal;
  }
  if (mode === 'jitan') {
    if (spec.jitan === undefined) {
      throw new Error('invalid lottery: jitan mode is missing');
    }
    return spec.jitan;
  }
  if (mode === 'st') {
    return spec.st;
  }
  if (mode === 'lt') {
    if (spec.lt === undefined) {
      throw new Error('invalid lottery: lt mode is missing');
    }
    return spec.lt;
  }
  throw new Error('invalid lottery: mode must be normal, jitan, st or lt');
}

/** レート（1発あたりの玉数）を検証する。 */
function assertRate(rate: number): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || Math.floor(rate) !== rate || rate < 1) {
    throw new Error('invalid lottery: rate must be a positive int');
  }
  return rate;
}

/** 単価 unit（1発のコスト・賞球と出玉の掛け率）を検証する。 */
function assertUnit(unit: number): number {
  if (typeof unit !== 'number' || !Number.isFinite(unit) || Math.floor(unit) !== unit || unit < 1) {
    throw new Error('invalid lottery: unit must be a positive int');
  }
  return unit;
}

/** 通し番号（RNG の entrySerial）を検証する。 */
function assertSerial(serial: number): number {
  if (typeof serial !== 'number' || !Number.isFinite(serial) || Math.floor(serial) !== serial || serial < 0) {
    throw new Error('invalid lottery: serial must be a non-negative int');
  }
  return serial;
}

/** 取得時のモードで使う保留色の表（通常・時短は `hold_colors`、ST・LT は `hold_colors_st`, P7-T4）。 */
export function holdColorTable(spec: MachineSpec, mode: LotteryMode): readonly HoldColorWeight[] {
  if (mode === 'normal' || mode === 'jitan') {
    return spec.holdColors;
  }
  if (mode === 'st' || mode === 'lt') {
    return spec.holdColorsSt;
  }
  throw new Error('invalid lottery: mode must be normal, jitan, st or lt');
}

/** 表の行を色で探す（JSON の順序に依存しない）。 */
function holdRow(table: readonly HoldColorWeight[], color: HoldTableColor): HoldColorWeight {
  for (let i = 0; i < table.length; i = i + 1) {
    const row = table[i];
    if (row !== undefined && row.color === color) {
      return row;
    }
  }
  throw new Error('invalid lottery: hold_colors lacks ' + color);
}

/** 保留色の重み列（`LOTTERY_HOLD_COLORS` と同順。取得時のモードの表・当否別, P7-T4）。 */
export function holdColorWeights(spec: MachineSpec, mode: LotteryMode, isHit: boolean): readonly number[] {
  const table = holdColorTable(spec, mode);
  const w: number[] = [];
  for (let c = 0; c < LOTTERY_HOLD_COLORS.length; c = c + 1) {
    const row = holdRow(table, LOTTERY_HOLD_COLORS[c] as LotteryHoldColor);
    w.push(isHit ? row.wHit : row.wMiss);
  }
  return w;
}

/** 熱さ = パターンの hot に保留色のボーナス（赤+1・金+2、上限5, P7-T4）。 */
export function holdHot(patternHot: number, color: LotteryHoldColor): number {
  if (color === 'red') {
    return Math.min(5, patternHot + 1);
  }
  if (color === 'gold') {
    return Math.min(5, patternHot + 2);
  }
  return patternHot;
}

/** 振分けの重み列（`jackpotSplit` と同順。取得時のモードで重みを選ぶ。省略時の既定は weight_jitan=weight・weight_lt=weight_st）。 */
export function splitWeights(spec: MachineSpec, mode: LotteryMode): number[] {
  const w: number[] = [];
  for (let i = 0; i < spec.jackpotSplit.length; i = i + 1) {
    const b = spec.jackpotSplit[i] as JackpotBranch;
    if (mode === 'normal') {
      w.push(b.weight);
    } else if (mode === 'jitan') {
      w.push(b.weightJitan === undefined ? b.weight : b.weightJitan);
    } else if (mode === 'st') {
      w.push(b.weightSt);
    } else if (mode === 'lt') {
      w.push(b.weightLt === undefined ? b.weightSt : b.weightLt);
    } else {
      throw new Error('invalid lottery: mode must be normal, jitan, st or lt');
    }
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

/** 上乗せの回数 K（`uwanose` ストリームから最大 loop_max 回、閾値未満なら次へ。upper でない枝・外れは null, D-120）。 */
export function drawUpperLoops(spec: MachineSpec, seed: number, serial: number, branchIndex: number | null): number | null {
  if (branchIndex === null) {
    return null;
  }
  const b = spec.jackpotSplit[branchIndex];
  if (b === undefined || b.upper === undefined) {
    return null;
  }
  const rng = new RNGStream(seed, 'uwanose', serial);
  let k = 0;
  while (k < b.upper.loopMax) {
    if (rng.nextU32() >= b.upper.loopThresholdU32) {
      break;
    }
    k = k + 1;
  }
  return k;
}

/** 上位の当たりなら `upper`・`loops` を足す（それ以外はそのまま返す）。 */
function withUpper<T extends HoldEntry>(entry: T, loops: number | null): T {
  if (loops === null) {
    return entry;
  }
  return { ...entry, upper: true, loops };
}

/** 予告ボーナス抽選の当否しきい値（`floor(2^32 / bonus1In)`）。 */
function bonusThresholdU32(bonus1In: number): number {
  if (typeof bonus1In !== 'number' || !Number.isFinite(bonus1In) || Math.floor(bonus1In) !== bonus1In) {
    throw new Error('invalid lottery: bonus1In must be an int');
  }
  if (bonus1In < 2 || bonus1In > 100) {
    throw new Error('invalid lottery: bonus1In out of range');
  }
  return Math.floor(4294967296 / bonus1In);
}

/** 予告の特別変動1回（当否1/10は `notice` ストリームの3手目、枝・パターン・色は bonusSerial の各ストリーム。無料は1パチ単価, D-090）。 */
export function drawBonusHold(
  spec: MachineSpec,
  patterns: PatternTable,
  seed: number,
  mode: LotteryMode,
  noticeId: number,
  bonusSerial: number,
  bonus1In: number,
  effectWeights: readonly number[],
  unit?: number,
): HoldEntry {
  modeOf(spec, mode);
  assertSerial(noticeId);
  assertSerial(bonusSerial);
  if (patterns.length === 0) {
    throw new Error('invalid lottery: patterns must not be empty');
  }
  if (effectWeights.length === 0) {
    throw new Error('invalid lottery: effectWeights must not be empty');
  }
  const notice = new RNGStream(seed, 'notice', noticeId);
  notice.nextUnit();
  notice.pick(effectWeights);
  const hitU32 = notice.nextU32();
  const isHit = hitU32 < bonusThresholdU32(bonus1In);
  let branchIndex: number | null = null;
  if (isHit) {
    branchIndex = new RNGStream(seed, 'split', bonusSerial).pick(splitWeights(spec, mode));
  }
  const patternIndex = new RNGStream(seed, 'pattern', bonusSerial).pick(patternWeights(patterns, isHit));
  const patternRow = patterns[patternIndex];
  if (patternRow === undefined) {
    throw new Error('invalid lottery: pattern index out of range');
  }
  const colorIndex = new RNGStream(seed, 'holdColor', bonusSerial).pick(holdColorWeights(spec, mode, isHit));
  const color = LOTTERY_HOLD_COLORS[colorIndex];
  if (color === undefined) {
    throw new Error('invalid lottery: color index out of range');
  }
  const hot = holdHot(patternRow.hot, color);
  const loops = drawUpperLoops(spec, seed, bonusSerial, branchIndex);
  if (unit !== undefined) {
    assertUnit(unit);
    return withUpper({ serial: bonusSerial, modeAtDraw: mode, isHit, branchIndex, patternIndex, color, hot, hesoPayoutBalls: 0, unit }, loops);
  }
  return withUpper({ serial: bonusSerial, modeAtDraw: mode, isHit, branchIndex, patternIndex, color, hot, hesoPayoutBalls: 0 }, loops);
}

/** 行動の特別保留1件（当たり1/10は `grantHold` ストリーム、枝・パターン・色は serial の各ストリーム。賞球なし・無料は1パチ単価, D-081・D-090）。 */
export function drawGrantHold(
  spec: MachineSpec,
  patterns: PatternTable,
  seed: number,
  mode: LotteryMode,
  grantIndex: number,
  serial: number,
  bonus1In: number,
  unit?: number,
): HoldEntry {
  modeOf(spec, mode);
  assertSerial(grantIndex);
  assertSerial(serial);
  if (patterns.length === 0) {
    throw new Error('invalid lottery: patterns must not be empty');
  }
  const hitU32 = new RNGStream(seed, 'grantHold', grantIndex).nextU32();
  const isHit = hitU32 < bonusThresholdU32(bonus1In);
  let branchIndex: number | null = null;
  if (isHit) {
    branchIndex = new RNGStream(seed, 'split', serial).pick(splitWeights(spec, mode));
  }
  const patternIndex = new RNGStream(seed, 'pattern', serial).pick(patternWeights(patterns, isHit));
  const patternRow = patterns[patternIndex];
  if (patternRow === undefined) {
    throw new Error('invalid lottery: pattern index out of range');
  }
  const colorIndex = new RNGStream(seed, 'holdColor', serial).pick(holdColorWeights(spec, mode, isHit));
  const color = LOTTERY_HOLD_COLORS[colorIndex];
  if (color === undefined) {
    throw new Error('invalid lottery: color index out of range');
  }
  const hot = holdHot(patternRow.hot, color);
  const loops = drawUpperLoops(spec, seed, serial, branchIndex);
  if (unit !== undefined) {
    assertUnit(unit);
    return withUpper({ serial, modeAtDraw: mode, isHit, branchIndex, patternIndex, color, hot, hesoPayoutBalls: 0, unit }, loops);
  }
  return withUpper({ serial, modeAtDraw: mode, isHit, branchIndex, patternIndex, color, hot, hesoPayoutBalls: 0 }, loops);
}

/** ヘソ入賞時の取得時判定（当否・振分け・パターン・色を全部確定。賞球と出玉は取得時の unit, D-090）。 */
export function drawHold(
  spec: MachineSpec,
  patterns: PatternTable,
  seed: number,
  mode: LotteryMode,
  serial: number,
  rate: number,
  unit?: number,
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
    branchIndex = new RNGStream(seed, 'split', serial).pick(splitWeights(spec, mode));
  }
  const patternIndex = new RNGStream(seed, 'pattern', serial).pick(patternWeights(patterns, isHit));
  const patternRow = patterns[patternIndex];
  if (patternRow === undefined) {
    throw new Error('invalid lottery: pattern index out of range');
  }
  const colorIndex = new RNGStream(seed, 'holdColor', serial).pick(holdColorWeights(spec, mode, isHit));
  const color = LOTTERY_HOLD_COLORS[colorIndex];
  if (color === undefined) {
    throw new Error('invalid lottery: color index out of range');
  }
  const hot = holdHot(patternRow.hot, color);
  const loops = drawUpperLoops(spec, seed, serial, branchIndex);
  const useUnit = unit === undefined ? rate : assertUnit(unit);
  const entry: HoldEntry = { serial, modeAtDraw: mode, isHit, branchIndex, patternIndex, color, hot, hesoPayoutBalls: spec.hesoPayout * useUnit, unit: useUnit };
  // rate1 は省略（旧 toEqual 互換）。unit は常に持つ（旧セーブには無い）。
  const withRate = withUpper(rate === 1 ? entry : { ...entry, rate }, loops);
  // unit が rate と同じ（Stub・旧挙動）の時は省略して旧形に寄せる。
  if (useUnit === rate) {
    const { unit: _drop, ...rest } = withRate;
    void _drop;
    return rest;
  }
  return withRate;
}

/** ヘソ賞球（`heso_payout × unit`。満タン時も支払う。旧 rate と同じ検証, D-090）。 */
export function hesoPayoutBalls(spec: MachineSpec, unit: number): number {
  assertUnit(unit);
  return spec.hesoPayout * unit;
}

/** 保留の単価を読む（無い旧セーブは rate・無ければ 1, D-090）。 */
export function holdUnit(entry: HoldEntry): number {
  if (entry.unit !== undefined) {
    return entry.unit;
  }
  if (entry.rate !== undefined) {
    return entry.rate;
  }
  return 1;
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

/** 上位の上乗せ回数を検証する（upper でない枝は 0 だけ, D-120）。 */
function assertLoops(b: JackpotBranch, loops: number): number {
  if (typeof loops !== 'number' || !Number.isFinite(loops) || Math.floor(loops) !== loops || loops < 0) {
    throw new Error('invalid lottery: loops must be a non-negative int');
  }
  const max = b.upper === undefined ? 0 : b.upper.loopMax;
  if (loops > max) {
    throw new Error('invalid lottery: loops out of range');
  }
  return loops;
}

/** 上乗せラウンド数（`bonus_rounds + add_rounds × loops`。`bonus_rounds` 省略時は 0、loops は上位の K で省略時 0）。 */
export function jackpotBonusRounds(spec: MachineSpec, branchIndex: number, loops = 0): number {
  const b = branchAt(spec, branchIndex);
  const bonus = b.bonusRounds === undefined ? 0 : b.bonusRounds;
  const k = assertLoops(b, loops);
  return b.upper === undefined ? bonus : bonus + b.upper.addRounds * k;
}

/** 合計ラウンド数（`rounds + bonus_rounds (+ add_rounds × loops)`）。 */
export function jackpotTotalRounds(spec: MachineSpec, branchIndex: number, loops = 0): number {
  const b = branchAt(spec, branchIndex);
  return b.rounds + jackpotBonusRounds(spec, branchIndex, loops);
}

/** 大当たり出玉（合計ラウンド × count × payout_per_ball × unit。取得時の unit, D-090・D-120）。 */
export function jackpotPayoutBalls(spec: MachineSpec, branchIndex: number, unit: number, loops = 0): number {
  assertUnit(unit);
  return jackpotTotalRounds(spec, branchIndex, loops) * spec.roundCount * spec.payoutPerBall * unit;
}
