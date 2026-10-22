import { RNGStream, type MachineSpec } from '@ph/core';

/**
 * 上位RUSH・上乗せの見せ方（P15-T3, D-120。rush-middle-01）。当否・上乗せの回数 K は Core が決め（HoldEntry の upper・loops）、
 * ここでは見せ方だけを決める: ガセ（白黒・フリーズしたのに割れない）・各回の当たる数字（3/2/1/0）・液晶の時刻表。
 * 乱数は RNGStream(seed, 'presentation', serial) の UPPER_RNG_SKIP 番目以降（変動の分岐 resolveCueSheet と重ならない）。
 */

/** 機種の上位の枝（無い機種は upperRushSpec が null）。 */
export interface UpperRushSpec {
  /** 上位の当たりの基本ラウンド（導入で見せる「10R」）。 */
  readonly baseRounds: number;
  /** 割れて上位に入った時に足すラウンド（枝の bonus_rounds）。 */
  readonly upperRounds: number;
  /** 上乗せ1回で足すラウンド。 */
  readonly addRounds: number;
  /** 上乗せが次へ進む確率 1/loop1In。 */
  readonly loop1In: number;
  readonly loopMax: number;
}

/** 機種の上位の枝（最初の upper 付きの枝）。無い機種（light・lt など）は null。 */
export function upperRushSpec(spec: MachineSpec): UpperRushSpec | null {
  for (const b of spec.jackpotSplit) {
    if (b.upper !== undefined) {
      return {
        baseRounds: b.rounds,
        upperRounds: b.bonusRounds ?? 0,
        addRounds: b.upper.addRounds,
        loop1In: b.upper.loop1In,
        loopMax: b.upper.loopMax,
      };
    }
  }
  return null;
}

/** 計画に要る大当たりの中身。 */
export interface UpperJackpot {
  readonly serial: number;
  /** ST 中に引いた当たり（初当たりは false）。 */
  readonly st: boolean;
  /** 上位の当たり（Core の upper）。 */
  readonly upper: boolean;
  /** 上乗せの回数 K（Core の loops。上位でなければ 0）。 */
  readonly loops: number;
}

export type UpperPlan =
  | { readonly k: 'none' }
  | { readonly k: 'gase' }
  | {
      readonly k: 'upper';
      /** 上乗せの各回で当たった数字の番目（0..3 = 3/2/1/0）。長さは K。 */
      readonly hits: readonly number[];
      /** K = loopMax（最後の当たりの後に「上乗せ MAX」。外れの回は見せない）。 */
      readonly max: boolean;
    };

/** 上位でない RUSH 中の当たりに出すガセの割合。 */
export const UPPER_GASE_RATE = 0.1;
/** 上乗せの抽選の数字の数（3/2/1/0）。 */
export const UWANOSE_DIGITS = 4;
/** 'presentation' ストリームの何番目から使うか（変動の分岐と重ならない）。 */
const UPPER_RNG_SKIP = 64;

const NONE: UpperPlan = { k: 'none' };

/** 当たる数字 i（0..3）の重み q(1−q)^i（q は4回のどこかで当たる合計が 1/loop1In になる1回あたりの確率）。 */
export function uwanoseDigitWeights(loop1In: number): number[] {
  const q = 1 - Math.pow(1 - 1 / loop1In, 1 / UWANOSE_DIGITS);
  const w: number[] = [];
  for (let i = 0; i < UWANOSE_DIGITS; i++) w.push(q * Math.pow(1 - q, i));
  return w;
}

/** 同じ seed・serial・中身なら同じ計画。上位の枝の無い機種（spec null）・初当たりでは何も出さない。 */
export function planUpperRush(jackpot: UpperJackpot, spec: UpperRushSpec | null, seed: number): UpperPlan {
  if (spec === null) return NONE;
  if (jackpot.upper) {
    const rng = new RNGStream(seed, 'presentation', jackpot.serial);
    for (let i = 0; i < UPPER_RNG_SKIP; i++) rng.nextU32();
    const w = uwanoseDigitWeights(spec.loop1In);
    const hits: number[] = [];
    for (let i = 0; i < jackpot.loops; i++) hits.push(rng.pick(w));
    return { k: 'upper', hits, max: jackpot.loops >= spec.loopMax };
  }
  if (!jackpot.st) return NONE;
  const rng = new RNGStream(seed, 'presentation', jackpot.serial);
  for (let i = 0; i < UPPER_RNG_SKIP; i++) rng.nextU32();
  return rng.nextU32() < UPPER_GASE_RATE * 4294967296 ? { k: 'gase' } : NONE;
}

// 液晶の時刻表（大当たり開始からの ms。縮める時は HUD の導入 UPPER_INTRO_MS より後を縮める）。
/** 今の導入（大当たり・10R・RUSH n連目）の長さ（jackpot-hud の HUD_START_MS と同じ）。 */
export const UPPER_INTRO_MS = 2600;
/** 液晶が白黒になってフリーズする時刻と、白黒になるまでの時間。 */
export const UPPER_FREEZE_MS = 5000;
export const UPPER_GRAY_IN_MS = 300;
/** 色が戻るまでの時間。 */
export const UPPER_GRAY_OUT_MS = 600;
/** ひびが一段ずつ広がる時刻（7回、間が詰まる。HOLD_CRACK_STEPS_MS の間隔を 6,000〜9,000 に伸ばした）。 */
export const UPPER_CRACK_STEPS_MS = [6000, 6840, 7550, 8060, 8450, 8770, 9000] as const;
/** ガセで色が戻り始める時刻。 */
export const UPPER_GASE_BACK_MS = 7000;
/** ガラスが割れて「上位RUSH突入！」を出す時刻と長さ。 */
export const UPPER_BREAK_MS = 9600;
export const UPPER_IN_SHOW_MS = 3500;
/** 最初の「上乗せスタート！」の時刻と長さ。 */
export const UWANOSE_START_MS = 13100;
export const UWANOSE_START_SHOW_MS = 1500;
/** 数字 3/2/1/0 の1つの長さ。 */
export const UWANOSE_SLOT_MS = 5000;
/** 当たりの数字から割れて「上乗せ +10R！」までと、その長さ・次の「上乗せスタート！」までの間。 */
export const UWANOSE_HIT_DELAY_MS = 2000;
export const UWANOSE_HIT_SHOW_MS = 3000;
export const UWANOSE_NEXT_GAP_MS = 1000;
/** 「上乗せ終了」と「上乗せ MAX」の長さ。 */
export const UWANOSE_END_SHOW_MS = 1500;
export const UWANOSE_MAX_SHOW_MS = 3000;
/** 縮める下限（これより縮める時は数字のカウントダウンを省く）。 */
export const UPPER_MIN_SCALE = 0.25;

export type UpperStepKind = 'freeze' | 'crack' | 'break' | 'uwanoseStart' | 'digit' | 'uwanoseHit' | 'uwanoseEnd' | 'uwanoseMax' | 'back';

export interface UpperStep {
  readonly k: UpperStepKind;
  /** 大当たり開始からの ms（縮めた後）。 */
  readonly at: number;
  /** 表示の長さ（縮めた後。freeze は白黒になるまで・back は色が戻るまで・crack は 0）。 */
  readonly ms: number;
  /** crack: 段（1..7）/ digit: 数字（3..0）/ uwanoseHit: 何回目の上乗せか（1..K）。 */
  readonly n?: number;
}

export interface UpperTimeline {
  readonly plan: UpperPlan;
  /** 時刻順。plan が none なら空。 */
  readonly steps: readonly UpperStep[];
  /** 導入より後の縮尺（1 は表のまま）。 */
  readonly scale: number;
  /** 数字のカウントダウンを省いた（縮尺が UPPER_MIN_SCALE を下回る時）。 */
  readonly compact: boolean;
  /** 色が戻りきる時刻（none は 0）。 */
  readonly end: number;
}

/** 縮める前の時刻表（compact はカウントダウンなし）。 */
function rawSteps(plan: UpperPlan, compact: boolean): UpperStep[] {
  if (plan.k === 'none') return [];
  const out: UpperStep[] = [{ k: 'freeze', at: UPPER_FREEZE_MS, ms: UPPER_GRAY_IN_MS }];
  if (plan.k === 'gase') {
    out.push({ k: 'back', at: UPPER_GASE_BACK_MS, ms: UPPER_GRAY_OUT_MS });
    return out;
  }
  UPPER_CRACK_STEPS_MS.forEach((at, i) => out.push({ k: 'crack', at, ms: 0, n: i + 1 }));
  out.push({ k: 'break', at: UPPER_BREAK_MS, ms: UPPER_IN_SHOW_MS });
  let t = UWANOSE_START_MS;
  let lastHitEnd = UPPER_BREAK_MS + UPPER_IN_SHOW_MS;
  const rounds = plan.max ? plan.hits.length : plan.hits.length + 1;
  for (let r = 0; r < rounds; r++) {
    const hit = plan.hits[r];
    if (compact) {
      if (hit === undefined) break;
      out.push({ k: 'uwanoseHit', at: t, ms: UWANOSE_HIT_SHOW_MS, n: r + 1 });
      lastHitEnd = t + UWANOSE_HIT_SHOW_MS;
      t = lastHitEnd + UWANOSE_NEXT_GAP_MS;
      continue;
    }
    out.push({ k: 'uwanoseStart', at: t, ms: UWANOSE_START_SHOW_MS });
    const first = t + UWANOSE_START_SHOW_MS;
    const shown = hit === undefined ? UWANOSE_DIGITS : hit + 1;
    for (let i = 0; i < shown; i++) {
      out.push({ k: 'digit', at: first + i * UWANOSE_SLOT_MS, ms: UWANOSE_SLOT_MS, n: UWANOSE_DIGITS - 1 - i });
    }
    if (hit === undefined) {
      t = first + UWANOSE_DIGITS * UWANOSE_SLOT_MS;
      break;
    }
    const at = first + hit * UWANOSE_SLOT_MS + UWANOSE_HIT_DELAY_MS;
    out.push({ k: 'uwanoseHit', at, ms: UWANOSE_HIT_SHOW_MS, n: r + 1 });
    lastHitEnd = at + UWANOSE_HIT_SHOW_MS;
    t = lastHitEnd + UWANOSE_NEXT_GAP_MS;
  }
  if (plan.max) {
    // 最後の当たりの後（K = 0 で max になる機種は無いが、その時は割れた告知の後）。
    const at = lastHitEnd + UWANOSE_NEXT_GAP_MS;
    out.push({ k: 'uwanoseMax', at, ms: UWANOSE_MAX_SHOW_MS });
    out.push({ k: 'back', at: at + UWANOSE_MAX_SHOW_MS, ms: UPPER_GRAY_OUT_MS });
  } else {
    if (compact) t = Math.max(t - UWANOSE_NEXT_GAP_MS, lastHitEnd);
    out.push({ k: 'uwanoseEnd', at: t, ms: UWANOSE_END_SHOW_MS });
    out.push({ k: 'back', at: t + UWANOSE_END_SHOW_MS, ms: UPPER_GRAY_OUT_MS });
  }
  return out;
}

const endOf = (steps: readonly UpperStep[]): number => {
  const last = steps[steps.length - 1];
  return last === undefined ? 0 : last.at + last.ms;
};

/** 導入より後を縮める（s = 1 はそのまま）。 */
function scaled(steps: readonly UpperStep[], s: number): UpperStep[] {
  if (s === 1) return [...steps];
  return steps.map((x) => ({ ...x, at: UPPER_INTRO_MS + (x.at - UPPER_INTRO_MS) * s, ms: x.ms * s }));
}

/** 収める縮尺（1 以下・0 以上）。 */
function fit(end: number, budgetMs: number): number {
  if (end <= budgetMs) return 1;
  return Math.max(0, (budgetMs - UPPER_INTRO_MS) / (end - UPPER_INTRO_MS));
}

/**
 * 計画の時刻表。budgetMs は色が戻りきるまでに使える時間（大当たりの長さ − 結果の告知 4,500ms）。
 * 収まらない時は導入より後を縮め（下限 UPPER_MIN_SCALE）、それでも足りなければ数字のカウントダウンを省いて当たりだけ順に見せる。
 */
export function upperTimeline(plan: UpperPlan, budgetMs: number): UpperTimeline {
  const full = rawSteps(plan, false);
  if (full.length === 0) return { plan, steps: [], scale: 1, compact: false, end: 0 };
  let s = fit(endOf(full), budgetMs);
  if (s >= UPPER_MIN_SCALE || plan.k !== 'upper') {
    const steps = scaled(full, s);
    return { plan, steps, scale: s, compact: false, end: endOf(steps) };
  }
  const short = rawSteps(plan, true);
  s = fit(endOf(short), budgetMs);
  const steps = scaled(short, s);
  return { plan, steps, scale: s, compact: true, end: endOf(steps) };
}

/** 液晶いっぱいに出す文字（虹の時は rainbow）。 */
export type UpperBannerKind = 'upperIn' | 'uwanoseStart' | 'digit' | 'uwanoseHit' | 'uwanoseEnd' | 'uwanoseMax';

export interface UpperView {
  /** 液晶の白黒の度合い（0 色のまま .. 1 白黒）。 */
  readonly gray: number;
  /** HUD の数字が止まっている（freeze から色が戻り始めるまで）。 */
  readonly frozen: boolean;
  /** 止めた時刻（大当たり開始からの ms）。HUD はこの時刻の値を見せる。 */
  readonly frozenAt: number;
  /** ひびの段数（0..7。割れた後は 0）。 */
  readonly crack: number;
  /** 最後に割れてから（break・uwanoseHit）の ms。割れていなければ null。 */
  readonly shatter: number | null;
  readonly banner: {
    readonly k: UpperBannerKind;
    /** 出てからの ms と長さ。 */
    readonly t: number;
    readonly ms: number;
    /** digit の数字（3..0）。 */
    readonly digit?: number;
    /** upperIn・uwanoseHit で足したラウンド。 */
    readonly add?: number;
    readonly rainbow: boolean;
  } | null;
  /** ここまでに見せた足したラウンド（割れて upperRounds、上乗せごとに addRounds）。 */
  readonly addedRounds: number;
}

const BANNER: Partial<Record<UpperStepKind, UpperBannerKind>> = {
  break: 'upperIn',
  uwanoseStart: 'uwanoseStart',
  digit: 'digit',
  uwanoseHit: 'uwanoseHit',
  uwanoseEnd: 'uwanoseEnd',
  uwanoseMax: 'uwanoseMax',
};

/** 時刻 t（大当たり開始からの ms）の見せ方。plan が none なら null。 */
export function upperViewAt(tl: UpperTimeline, spec: UpperRushSpec, t: number): UpperView | null {
  if (tl.plan.k === 'none') return null;
  let freeze: UpperStep | null = null;
  let back: UpperStep | null = null;
  let crack = 0;
  let shatterAt: number | null = null;
  let added = 0;
  let banner: UpperStep | null = null;
  for (const x of tl.steps) {
    if (x.k === 'freeze') freeze = x;
    if (x.k === 'back') back = x;
    if (x.at > t) continue;
    switch (x.k) {
      case 'crack':
        crack = x.n ?? 0;
        break;
      case 'break':
        crack = 0;
        shatterAt = x.at;
        added += spec.upperRounds;
        break;
      case 'uwanoseHit':
        shatterAt = x.at;
        added += spec.addRounds;
        break;
    }
    if (BANNER[x.k] !== undefined && t < x.at + x.ms) banner = x;
  }
  let gray = 0;
  if (freeze && t >= freeze.at) {
    gray = freeze.ms > 0 ? Math.min(1, (t - freeze.at) / freeze.ms) : 1;
    if (back && t >= back.at) gray = back.ms > 0 ? Math.max(0, 1 - (t - back.at) / back.ms) : 0;
  }
  const frozenAt = freeze?.at ?? 0;
  const bk = banner ? BANNER[banner.k]! : null;
  return {
    gray,
    frozen: freeze !== null && t >= freeze.at && (back === null || t < back.at),
    frozenAt,
    crack,
    shatter: shatterAt === null ? null : t - shatterAt,
    banner:
      banner && bk
        ? {
            k: bk,
            t: t - banner.at,
            ms: banner.ms,
            ...(bk === 'digit' ? { digit: banner.n ?? 0 } : {}),
            ...(bk === 'upperIn' ? { add: spec.upperRounds } : bk === 'uwanoseHit' ? { add: spec.addRounds } : {}),
            rainbow: bk === 'upperIn' || bk === 'uwanoseHit' || bk === 'uwanoseMax',
          }
        : null,
    addedRounds: added,
  };
}

/** 時刻表の各段で鳴らすパックの演出（シート名, 中身は T4）。色が戻る段は鳴らさない。 */
export const UPPER_CUES: Readonly<Record<Exclude<UpperStepKind, 'back'>, string>> = {
  freeze: 'upper_freeze',
  crack: 'upper_crack',
  break: 'upper_in',
  uwanoseStart: 'uwanose_start',
  digit: 'uwanose_tick',
  uwanoseHit: 'uwanose_hit',
  uwanoseEnd: 'uwanose_end',
  uwanoseMax: 'uwanose_end',
};

/** 時刻表の音の時刻とシート名（時刻順）。ガセは upper_freeze だけ。 */
export function upperCues(tl: UpperTimeline): { readonly at: number; readonly cue: string }[] {
  const out: { at: number; cue: string }[] = [];
  for (const x of tl.steps) {
    if (x.k !== 'back') out.push({ at: x.at, cue: UPPER_CUES[x.k] });
  }
  return out;
}
