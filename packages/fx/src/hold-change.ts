import {
  BONUS_SERIAL_BASE,
  RESERVE_SERIAL_BASE,
  RNGStream,
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
 * それ以外は当否を見て、信頼度 rel = P(当たり | 先バレ)・占有率 occ = P(先バレ | 当たり) になる確率で先バレする。
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

/**
 * カスタムの先バレの確率。当たりは occ、ハズレは p·occ·(1−rel) / (rel·(1−p))（rel=1 なら 0）。
 * こうすると P(当たり | 先バレ) = rel・P(先バレ | 当たり) = occ になる。
 */
export function sakibareProb(custom: Exclude<SakibareCustom, 'normal'>, hit: boolean, p: number): number {
  const { rel, occ } = SAKIBARE_CUSTOM_RATES[custom];
  if (hit) return occ;
  if (rel >= 1 || p <= 0) return 0;
  if (p >= 1) return 1;
  return Math.min(1, (p * occ * (1 - rel)) / (rel * (1 - p)));
}

/** 特別保留・ボーナス保留（通し番号 1e9 以上 2e9 未満）。カスタムでは先バレしない。 */
function isFreeHold(serial: number): boolean {
  return serial >= BONUS_SERIAL_BASE && serial < RESERVE_SERIAL_BASE;
}

/**
 * 先バレするか。normal は planHoldChange の sakibare のまま（色だけで決まる）。
 * カスタムは RNGStream(seed, 'holdChange', serial) の **3番目**の値で引く（1〜2番目は planHoldChange が使うので、保留の色・変化の見せ方は変わらない）。
 * カスタムの先バレは音と光だけで、点滅（変化）を強制しない（白い保留への先バレ＝ガセもある）。
 */
export function planSakibare(
  seed: number,
  serial: number,
  final: LotteryHoldColor,
  hit: boolean,
  p: number,
  custom: SakibareCustom,
): boolean {
  if (custom === 'normal') return planHoldChange(seed, serial, final).sakibare;
  if (isFreeHold(serial)) return false;
  const q = sakibareProb(custom, hit, p);
  if (q <= 0) return false;
  const rng = new RNGStream(seed, 'holdChange', serial);
  rng.nextU32();
  rng.nextU32();
  return rng.nextUnit() < q;
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
