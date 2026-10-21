import {
  BONUS_SERIAL_BASE,
  LOTTERY_HOLD_COLORS,
  RESERVE_SERIAL_BASE,
  RNGStream,
  holdColorWeights,
  modeOf,
  type LotteryHoldColor,
  type LotteryMode,
  type MachineSpec,
} from '@ph/core';

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
 * 割れる演出の時刻（自分の変動開始から, ms。変動が長い時の尺）。grow までに保留が液晶の中央へ動いて大きな玉になり、
 * crack からひびが入って広がり（点滅が速くなる）、reveal で割れて最終色の保留が出る（色が変わり hold_<色> が鳴る）。
 * reels で図柄が回り始め（変動の演出もここから）、end までに保留が当該保留の位置へ戻る。
 * 短い変動は holdBreakScale で全体を縮め、割れた後に図柄が HOLD_BREAK_MIN_REELS_MS 回るようにする。
 */
export const HOLD_BREAK_MS = { grow: 1350, crack: 1800, reveal: 4500, reels: 5000, end: 5400 } as const;

/** ひびがピキッと伸びる時刻（HOLD_BREAK_MS の尺, ms。だんだん間が詰まる）。パックの hold_crack の crack の音と同じ時刻。 */
export const HOLD_CRACK_STEPS_MS = [1950, 2600, 3150, 3550, 3850, 4100, 4280] as const;

/** 割れた後に図柄が回る最短の時間（左 → 右 → 中と止めるのに要る時間）。 */
export const HOLD_BREAK_MIN_REELS_MS = 1200;

/** 変動時間 spinMs に割れる演出を収める縮尺（1 は HOLD_BREAK_MS のまま。0.15 より縮めない）。 */
export function holdBreakScale(spinMs: number): number {
  return Math.min(1, Math.max(0.15, (spinMs - HOLD_BREAK_MIN_REELS_MS) / HOLD_BREAK_MS.reels));
}

/** 時刻 now に見せる色。spinAt は自分の変動開始の時刻（まだ・不明なら null）、scale は holdBreakScale。 */
export function holdColorAt(plan: HoldChangePlan, spinAt: number | null, now: number, scale = 1): LotteryHoldColor {
  if (!plan.change) return plan.final;
  return spinAt !== null && now >= spinAt + HOLD_BREAK_MS.reveal * scale ? plan.final : 'white';
}

/**
 * 抽選カスタム（P13-T1。リゼロ・東京喰種の先バレカスタム）。normal は色で決める従来の先バレ（D-074）。
 * それ以外は当否を見て、信頼度 rel = P(当たり | 先バレ)・占有率 occ = P(先バレ | 当たり) になる確率で先バレする（occ は上限つき, customSakibareRates）。
 */
export type SakibareCustom = 'normal' | 'sb40' | 'sb90' | 'sb100';

export const SAKIBARE_CUSTOMS: readonly SakibareCustom[] = ['normal', 'sb40', 'sb90', 'sb100'];

/** カスタムの信頼度と占有率（normal は色で決めるので無い）。 */
export const SAKIBARE_CUSTOM_RATES: Readonly<Record<Exclude<SakibareCustom, 'normal'>, { readonly rel: number; readonly occ: number }>> = {
  sb40: { rel: 0.4, occ: 0.95 },
  sb90: { rel: 0.9, occ: 0.9 },
  sb100: { rel: 1, occ: 0.6 },
};

export function isSakibareCustom(v: unknown): v is SakibareCustom {
  return typeof v === 'string' && (SAKIBARE_CUSTOMS as readonly string[]).includes(v);
}

/** 取得時のモードの当選確率（Core の閾値 / 2^32）。 */
export function holdHitProb(spec: MachineSpec, mode: LotteryMode): number {
  return modeOf(spec, mode).thresholdU32 / 4294967296;
}

/** カスタムの先バレを決める取得時のモードの材料: 当選確率 p と保留色の重み（LOTTERY_HOLD_COLORS と同順・当否別）。 */
export interface SakibareOdds {
  readonly p: number;
  readonly hitW: readonly number[];
  readonly missW: readonly number[];
}

export function sakibareOdds(spec: MachineSpec, mode: LotteryMode): SakibareOdds {
  return { p: holdHitProb(spec, mode), hitW: holdColorWeights(spec, mode, true), missW: holdColorWeights(spec, mode, false) };
}

/**
 * カスタムの先バレの確率（最終色ごと, LOTTERY_HOLD_COLORS と同順）と、それで出る信頼度 rel・実効の占有率 occ（P13-T8b, D-116, P13-T8c）。
 * 先バレした保留は必ず変化（灰色 → 割れて色が出る）で見せる。白以外の保留を先に使い（当たりは a、ハズレは b を色によらず一定）、
 * それで occ・rel を満たせない時（ST・LT は当たりの約40%が白）だけ、最終色が白の保留にも先バレする（割れて showHit/showMiss の色が出る）。
 * rel は必ずカスタムの値。occ はカスタムの値（ハズレの確率 ≤ 1 で満たせない時だけ下がる）。
 */
export interface CustomSakibareRates {
  readonly hit: readonly number[];
  readonly miss: readonly number[];
  readonly rel: number;
  readonly occ: number;
  /**
   * 最終色が白の先バレ保留に見せる色の重み（当否別, LOTTERY_HOLD_COLORS と同順。白は 0）。
   * 見せた色の信頼度 P(当たり | 見せた色) が保留色の表のままになるように引く（showColorWeights）。白に先バレしない時は全て 0。
   */
  readonly showHit: readonly number[];
  readonly showMiss: readonly number[];
}

const WHITE = LOTTERY_HOLD_COLORS.indexOf('white');

function sum(w: readonly number[]): number {
  let s = 0;
  for (const x of w) s += x;
  return s;
}

/**
 * 白の先バレ保留に見せる色の重み g（色ごと）。見せる色は 当たりなら hitW·g、ハズレなら missW·g の重みで引く。
 * 白の先バレ保留の当たり wh・ハズレ wm（1保留あたりの確率）が各色に足されても、色 i の信頼度は
 * k_i = 当たり_i / ハズレ_i が wh/wm と等しい色の組み合わせなら変わらない: wh/wm 以下の色の g を 1、超える色の g を t とし、
 * 足した後の比が wh/wm になる t を解く（線形）。片側しか無い時は wh/wm に一番近い色だけ（その色の信頼度だけ少し動く）。
 */
function showColorWeights(odds: SakibareOdds, wh: number, wm: number): number[] {
  const { p, hitW, missW } = odds;
  const g = hitW.map(() => 0);
  if (wh <= 0 && wm <= 0) return g;
  const sh = sum(hitW);
  const sm = sum(missW);
  const h = hitW.map((w) => (sh > 0 ? (p * w) / sh : 0));
  const m = missW.map((w) => (sm > 0 ? ((1 - p) * w) / sm : 0));
  const target = wm > 0 ? wh / wm : Infinity;
  const low: number[] = [];
  const up: number[] = [];
  for (let i = 0; i < h.length; i++) {
    if (i === WHITE || h[i]! + m[i]! <= 0) continue;
    const k = m[i]! > 0 ? h[i]! / m[i]! : Infinity;
    (k <= target ? low : up).push(i);
  }
  const ratio = (i: number): number => (m[i]! > 0 ? h[i]! / m[i]! : Infinity);
  if (up.length === 0 || low.length === 0) {
    const pool = up.length === 0 ? low : up;
    let best = pool[0];
    for (const i of pool) if (up.length === 0 ? ratio(i) > ratio(best!) : ratio(i) < ratio(best!)) best = i;
    if (best !== undefined) g[best] = 1;
    return g;
  }
  let hl = 0;
  let ml = 0;
  let hu = 0;
  let mu = 0;
  for (const i of low) {
    hl += h[i]!;
    ml += m[i]!;
  }
  for (const i of up) {
    hu += h[i]!;
    mu += m[i]!;
  }
  // (hl + t·hu) / (ml + t·mu) = target。low は h ≤ target·m、up は h > target·m なので t ≥ 0。
  const t = (hl - target * ml) / (target * mu - hu);
  for (const i of low) g[i] = 1;
  for (const i of up) g[i] = t;
  return g;
}

export function customSakibareRates(odds: SakibareOdds, custom: Exclude<SakibareCustom, 'normal'>): CustomSakibareRates {
  const { rel, occ: want } = SAKIBARE_CUSTOM_RATES[custom];
  const { p } = odds;
  const zero = odds.hitW.map(() => 0);
  if (p <= 0 || sum(odds.hitW) <= 0) return { hit: zero, miss: zero, rel, occ: 0, showHit: zero, showMiss: zero };
  const sh = sum(odds.hitW);
  const sm = sum(odds.missW);
  const fh = (sh - (odds.hitW[WHITE] ?? 0)) / sh;
  const fm = sm > 0 ? (sm - (odds.missW[WHITE] ?? 0)) / sm : 0;
  // 先バレ = 当たり p·occ・ハズレ (1−p)·q。rel = p·occ / (p·occ + (1−p)·q) より q = p·occ·(1−rel) / (rel·(1−p)) ≤ 1。
  let occ = Math.min(want, 1);
  if (rel < 1 && p < 1) occ = Math.min(occ, (rel * (1 - p)) / (p * (1 - rel)));
  const q = rel >= 1 || p >= 1 || sm <= 0 ? 0 : (p * occ * (1 - rel)) / (rel * (1 - p));
  // 白以外を先に使い、足りない分を白で。
  const a = fh > 0 ? Math.min(1, occ / fh) : 0;
  const aw = occ > fh && fh < 1 ? (occ - fh) / (1 - fh) : 0;
  const b = fm > 0 ? Math.min(1, q / fm) : 0;
  const bw = q > fm && fm < 1 ? Math.min(1, (q - fm) / (1 - fm)) : 0;
  const g = showColorWeights(odds, p * aw * (1 - fh), (1 - p) * bw * (1 - fm));
  return {
    hit: odds.hitW.map((_, i) => (i === WHITE ? aw : a)),
    miss: odds.missW.map((_, i) => (i === WHITE ? bw : b)),
    rel,
    occ,
    showHit: odds.hitW.map((w, i) => w * g[i]!),
    showMiss: odds.missW.map((w, i) => w * g[i]!),
  };
}

/** 特別保留・ボーナス保留（通し番号 1e9 以上 2e9 未満）。カスタムでは先バレしない。 */
function isFreeHold(serial: number): boolean {
  return serial >= BONUS_SERIAL_BASE && serial < RESERVE_SERIAL_BASE;
}

/**
 * 抽選カスタムの見せ方（P13-T8b）。normal は planHoldChange のまま。
 * カスタムは planHoldChange の変化はそのままに、先バレだけを当否と取得時のモードで引き直す:
 * RNGStream(seed, 'holdChange', serial) の **3番目**の値 < 最終色の確率（customSakibareRates）なら先バレで、必ず変化で見せる。
 * 先バレしない保留の final・change は planHoldChange と同じ（乱数の1〜2番目を使うのは planHoldChange だけ）。
 * 見せる最終色は plan.final: 白以外は Core の最終色のまま、白の先バレ（ST・LT, P13-T8c）は4番目の値で引いた色（Core の色・熱さは白のまま）。
 */
export function planHoldChangeCustom(
  seed: number,
  serial: number,
  final: LotteryHoldColor,
  hit: boolean,
  odds: SakibareOdds,
  custom: SakibareCustom,
): HoldChangePlan {
  const base = planHoldChange(seed, serial, final);
  if (custom === 'normal') return base;
  const plain = { final, change: base.change, sakibare: false };
  if (isFreeHold(serial)) return plain;
  const rates = customSakibareRates(odds, custom);
  const q = (hit ? rates.hit : rates.miss)[LOTTERY_HOLD_COLORS.indexOf(final)] ?? 0;
  if (q <= 0) return plain;
  const rng = new RNGStream(seed, 'holdChange', serial);
  rng.nextU32();
  rng.nextU32();
  if (rng.nextUnit() >= q) return plain;
  if (final !== 'white') return { final, change: true, sakibare: true };
  // 白の先バレ（ST・LT）: 4番目の値で見せる色を引く（色の信頼度を変えない重み）。
  const show = hit ? rates.showHit : rates.showMiss;
  return sum(show) > 0 ? { final: LOTTERY_HOLD_COLORS[rng.pick(show)]!, change: true, sakibare: true } : plain;
}

/** 先バレするか（planHoldChangeCustom の sakibare）。 */
export function planSakibare(
  seed: number,
  serial: number,
  final: LotteryHoldColor,
  hit: boolean,
  odds: SakibareOdds,
  custom: SakibareCustom,
): boolean {
  return planHoldChangeCustom(seed, serial, final, hit, odds, custom).sakibare;
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
