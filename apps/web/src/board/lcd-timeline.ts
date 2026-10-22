// 液晶の保留・変動・大当たりの再生（spec/40 ホール, spec/21 流れ）。Three に依存しない（テスト用）。
// Engine のイベント（保留の取得 → 変動開始 → 停止 → 大当たり）を時刻付きでため、盤面の玉と同じ表示時刻で1つずつ反映する。
// 前進ごとに「全部反映した結果」を Projection と照らし、合わなければ（背面の間・Debug の倍速で取りこぼした時）Projection に揃える。
import { GRANT_HOLD_SERIAL_BASE, RESERVE_SERIAL_BASE, type EngineSimEvent, type HallProjection, type JackpotKind, type LotteryHoldColor, type LotteryMode } from '@ph/core';
import {
  SAKIBARE_DELAY_MS,
  holdBreakScale,
  holdColorAt,
  planHoldChange,
  planHoldChangeCustom,
  type HoldChangePlan,
  type SakibareCustom,
  type SakibareOdds,
} from '@ph/fx';

export interface LcdHold {
  /** 保留の通し番号（Projection から作った時は分からないので -1）。 */
  readonly entry: number;
  /** 最終色（Core が取得時に確定）。見せる色は shownLcdState（保留変化, P7-T4）。 */
  readonly color: LotteryHoldColor;
  /** 当否（取得時に確定済み, spec/21）。Projection から作った時は null。 */
  readonly hit: boolean | null;
  /** 取得の時刻（Projection から作った時は null）。 */
  readonly addedAt: number | null;
  /** 灰色で点滅している（変化する保留, D-075）。shownLcdState だけが付ける。 */
  readonly blink?: boolean;
  /** 玉のレート（旧セーブ用。不明・1 は省略）。 */
  readonly rate?: number;
  /** 玉の単価 unit（出玉の数え上げ用。不明は rate, D-090）。 */
  readonly unit?: number;
  /** 取得時のモード（先バレの確率 p に使う。Projection から作った時は省略）。 */
  readonly mode?: LotteryMode;
  /** 取得時の抽選カスタム（設定を後から変えても、取った保留はこのまま。省略は normal）。 */
  readonly custom?: SakibareCustom;
}

export interface LcdSpin {
  readonly entry: number;
  readonly pattern: string;
  /** 開始時刻（Projection から作った時は分からないので null）。 */
  readonly startAt: number | null;
  readonly endsAt: number;
  /** 当該保留の最終色（Projection から作った時は分からないので null）。 */
  readonly color: LotteryHoldColor | null;
  readonly hit: boolean | null;
  /** 保留だった時の取得の時刻（先バレ用。不明なら null）。 */
  readonly addedAt: number | null;
  /** 変動開始で保留が割れる（D-075）。shownLcdState が付ける（演出プレビューは指定できる）。 */
  readonly breaks?: boolean;
  readonly rate?: number;
  readonly unit?: number;
  /** 保留だった時の取得時のモードと抽選カスタム（先バレ用）。 */
  readonly mode?: LotteryMode;
  readonly custom?: SakibareCustom;
}

export interface LcdJackpot {
  readonly entry: number;
  readonly kind: JackpotKind;
  /** ラウンド数（上乗せ後は合計）。 */
  readonly rounds: number;
  /** 開始の時刻（Projection から作った時は null）。 */
  readonly startAt?: number | null;
  /** 終了予定（Projection から作った時だけ分かる。未告知の上乗せを含む）。 */
  readonly endsAt?: number | null;
  /** 未告知の上乗せラウンド（Projection から作った上乗せ前だけ。開始の逆算用で、表示しない）。 */
  readonly hiddenRounds?: number;
  /** 当たった保留のレート（旧セーブ用。不明は 1）。 */
  readonly rate?: number;
  /** 当たった保留の単価 unit（出玉の数え上げ用。不明は rate, D-090）。 */
  readonly unit?: number;
  /** 上乗せ（LT）の時刻と足したラウンド数。 */
  readonly bonus?: { readonly at: number; readonly add: number } | null;
  /** 上位の当たり（rounds は上乗せ込みの合計。見せる全ラウンドは jackpotHud が時刻表で決める, D-120）。loops は Core の上乗せ回数 K。 */
  readonly upper?: { readonly loops: number };
}

/** RUSH の連チャン（chain は RUSH に入った当たりを1と数えた当たりの数、balls はその出玉の合計）。 */
export interface LcdRush {
  readonly mode: LotteryMode;
  readonly chain: number;
  readonly balls: number;
}

/**
 * 大当たりの後（または RUSH の回数切れ）の結果の告知（D-077）。
 * rushIn/ltIn: RUSH・LT 突入 / rushOn: 継続 / rushEnd: 終了 / jitanIn: 時短 / end: 通常へ。
 */
export type LcdResultKind = 'rushIn' | 'ltIn' | 'rushOn' | 'rushEnd' | 'jitanIn' | 'end';

export interface LcdResult {
  readonly at: number;
  readonly kind: LcdResultKind;
  /** この大当たりの出玉（回数切れは 0）。 */
  readonly payout: number;
  /** RUSH の連チャン数と出玉の合計（RUSH に関わらない時は 0）。 */
  readonly chain: number;
  readonly balls: number;
  /** 次のモードの回転数（分からない・通常は 0）。 */
  readonly spins: number;
  /** 大当たりの終わりで決めた結果（同じ時刻のモード変更で決め直す）。 */
  readonly from: LcdRush | null;
  /** 上位の当たりの終わり（「上位RUSH継続」, D-120）。 */
  readonly upper?: true;
}

export interface LcdState {
  readonly holds: readonly LcdHold[];
  readonly spin: LcdSpin | null;
  /** 直前に止まった変動（図柄の停止に使う）。 */
  readonly resolved: { readonly entry: number; readonly hit: boolean; readonly rate?: number; readonly unit?: number } | null;
  readonly jackpot: LcdJackpot | null;
  /** 今のモードと連チャン（省略は通常）。 */
  readonly rush?: LcdRush;
  /** 直近の結果の告知（省略・null は無し）。 */
  readonly result?: LcdResult | null;
}

type LcdEvent = Extract<
  EngineSimEvent,
  { k: 'holdAdded' | 'spinStarted' | 'spinResolved' | 'jackpotStarted' | 'uwanose' | 'jackpotEnded' | 'modeChanged' }
>;

const isLcdEvent = (e: EngineSimEvent): e is LcdEvent =>
  e.k === 'holdAdded' ||
  e.k === 'spinStarted' ||
  e.k === 'spinResolved' ||
  e.k === 'jackpotStarted' ||
  e.k === 'uwanose' ||
  e.k === 'jackpotEnded' ||
  e.k === 'modeChanged';

const NORMAL: LcdRush = { mode: 'normal', chain: 0, balls: 0 };

/** RUSH 中か（st/lt。時短は含まない。Core の chain と同じ区切り）。 */
/** 行動の特別保留（通し番号が 1.5e9 台, D-081）。液晶の保留に「特」の札を付ける。Projection から作った保留（-1）は分からない。 */
export function isGrantHold(entry: number): boolean {
  return entry >= GRANT_HOLD_SERIAL_BASE && entry < RESERVE_SERIAL_BASE;
}

export function isRush(mode: LotteryMode): boolean {
  return mode === 'st' || mode === 'lt';
}

/** 大当たりの終わり（payout）または RUSH の回数切れ（payout null）で、次のモード to の結果と連チャンを決める。 */
function settle(from: LcdRush, to: LotteryMode, payout: number | null, at: number, spins: number): { rush: LcdRush; result: LcdResult } {
  const was = isRush(from.mode);
  const will = isRush(to);
  const got = payout ?? 0;
  const base = { at, payout: got, spins, from: payout === null ? null : from };
  if (will && was && payout !== null) {
    const rush = { mode: to, chain: from.chain + 1, balls: from.balls + got };
    const kind = to === 'lt' && from.mode !== 'lt' ? 'ltIn' : 'rushOn';
    return { rush, result: { ...base, kind, chain: rush.chain, balls: rush.balls } };
  }
  if (will && !was) {
    const rush = { mode: to, chain: 1, balls: got };
    return { rush, result: { ...base, kind: to === 'lt' ? 'ltIn' : 'rushIn', chain: 1, balls: got } };
  }
  if (!will && was) {
    const chain = payout === null ? from.chain : from.chain + 1;
    return { rush: { mode: to, chain: 0, balls: 0 }, result: { ...base, kind: 'rushEnd', chain, balls: from.balls + got } };
  }
  return { rush: { mode: to, chain: 0, balls: 0 }, result: { ...base, kind: to === 'jitan' ? 'jitanIn' : 'end', chain: 0, balls: 0 } };
}

const EMPTY: LcdState = { holds: [], spin: null, resolved: null, jackpot: null };

/** Projection の時点の状態（通し番号・当否・開始時刻は分からない）。 */
export function stateFromProjection(p: HallProjection): LcdState {
  return {
    holds: p.holds.map((color) => ({ entry: -1, color, hit: null, addedAt: null })),
    spin: p.spin
      ? { entry: p.spin.entry, pattern: p.spin.pattern, startAt: null, endsAt: p.spin.endsAt, color: null, hit: null, addedAt: null }
      : null,
    resolved: null,
    jackpot: p.jackpot
      ? {
          entry: p.jackpot.entry,
          kind: p.jackpot.kind,
          rounds: p.jackpot.rounds,
          startAt: null,
          endsAt: p.jackpot.endsAt,
          ...(p.jackpot.hiddenRounds !== undefined ? { hiddenRounds: p.jackpot.hiddenRounds } : {}),
          ...(p.jackpot.unit !== undefined ? { unit: p.jackpot.unit } : {}),
          ...(p.jackpot.upper === true ? { upper: { loops: p.jackpot.loops ?? 0 } } : {}),
        }
      : null,
    // Core の chain は RUSH に入った当たりを 0 と数える。chainBalls は RUSH に入った当たりの出玉を含まない（目安）。
    rush: { mode: p.mode, chain: isRush(p.mode) ? p.chain + 1 : 0, balls: isRush(p.mode) ? p.chainBalls : 0 },
    result: null,
  };
}

/** イベント1つを反映する（spec/21 流れ: 取得で末尾に積み、変動開始で先頭を取り出す）。抽選カスタムは normal（reduce にそのまま渡せる 2 引数）。 */
export function applyLcdEvent(s: LcdState, e: LcdEvent): LcdState {
  return applyLcdEventWith(s, e, 'normal');
}

/** applyLcdEvent に、取得した保留へ記録する抽選カスタム（その時点の設定）を渡す版。 */
export function applyLcdEventWith(s: LcdState, e: LcdEvent, custom: SakibareCustom): LcdState {
  switch (e.k) {
    case 'holdAdded':
      return {
        ...s,
        holds: [
          ...s.holds,
          {
            entry: e.entry.serial,
            color: e.entry.color,
            hit: e.entry.isHit,
            addedAt: e.at,
            mode: e.entry.modeAtDraw,
            custom,
            ...(e.entry.rate !== undefined && e.entry.rate !== 1 ? { rate: e.entry.rate } : {}),
            ...(e.entry.unit !== undefined ? { unit: e.entry.unit } : {}),
          },
        ],
      };
    case 'spinStarted': {
      const i = Math.max(0, s.holds.findIndex((h) => h.entry === e.entry));
      const h = s.holds[i];
      return {
        ...s,
        holds: s.holds.filter((_, k) => k !== i),
        spin: {
          entry: e.entry,
          pattern: e.pattern,
          startAt: e.at,
          endsAt: e.endsAt,
          color: h?.color ?? null,
          hit: h?.hit ?? null,
          addedAt: h?.addedAt ?? null,
          ...(h?.mode !== undefined ? { mode: h.mode } : {}),
          ...(h?.custom !== undefined ? { custom: h.custom } : {}),
          ...(h?.rate !== undefined ? { rate: h.rate } : {}),
          ...(h?.unit !== undefined ? { unit: h.unit } : {}),
        },
      };
    }
    case 'spinResolved': {
      const rate = s.spin?.entry === e.entry ? s.spin.rate : undefined;
      const unit = s.spin?.entry === e.entry ? s.spin.unit : undefined;
      return {
        ...s,
        spin: null,
        resolved: { entry: e.entry, hit: e.hit, ...(rate !== undefined ? { rate } : {}), ...(unit !== undefined ? { unit } : {}) },
      };
    }
    case 'jackpotStarted': {
      const r = s.resolved?.entry === e.entry ? s.resolved : undefined;
      const rate = r?.rate ?? 1;
      const unit = r?.unit ?? rate;
      return {
        ...s,
        jackpot: {
          entry: e.entry,
          kind: e.kind,
          // 上位は上乗せを告知しない（uwanose が来ない）ので合計で持つ。LT の上乗せは告知まで基本ラウンド。
          rounds: e.upper === true ? e.rounds + (e.bonusRounds ?? 0) : e.rounds,
          startAt: e.at,
          endsAt: null,
          rate,
          unit,
          bonus: null,
          ...(e.upper === true ? { upper: { loops: e.loops ?? 0 } } : {}),
        },
        result: null,
      };
    }
    case 'uwanose':
      if (!s.jackpot) {
        return s;
      }
      // 告知したので上乗せはもう隠れていない（合計ラウンドへ）。
      return { ...s, jackpot: { ...s.jackpot, rounds: e.totalRounds, hiddenRounds: 0, bonus: { at: e.at, add: e.addRounds } } };
    case 'jackpotEnded': {
      // モードが変わらない時（通常 → 通常）はモード変更が来ないので、ここで今のモードのまま決めておく。
      // payout は取得時の unit 込み（D-090）。
      const got = e.payout;
      const from = s.rush ?? NORMAL;
      const { rush, result } = settle(from, from.mode, got, e.at, 0);
      return { ...s, jackpot: null, rush, result: s.jackpot?.upper ? { ...result, upper: true } : result };
    }
    case 'modeChanged': {
      const r = s.result;
      // 大当たりの終わりと同じ時刻: 次のモードで結果を決め直す。
      if (r && r.at === e.at && r.from) {
        const { rush, result } = settle(r.from, e.to, r.payout, e.at, e.stRemaining);
        return { ...s, rush, result: r.upper ? { ...result, upper: true } : result };
      }
      const from = s.rush ?? NORMAL;
      if (isRush(from.mode) && !isRush(e.to)) {
        // RUSH の回数切れ。
        const { rush, result } = settle(from, e.to, null, e.at, e.stRemaining);
        return { ...s, rush, result };
      }
      return { ...s, rush: { ...from, mode: e.to } };
    }
  }
}

/** 全部反映した結果が Projection と合うか（保留の色の並び・変動中と大当たり中の番号）。 */
export function matchesProjection(s: LcdState, p: HallProjection): boolean {
  return (
    s.holds.length === p.holds.length &&
    s.holds.every((h, i) => h.color === p.holds[i]) &&
    (s.spin?.entry ?? -1) === (p.spin?.entry ?? -1) &&
    (s.jackpot?.entry ?? -1) === (p.jackpot?.entry ?? -1)
  );
}

/** 取得時のモード → 先バレの材料（今の機種の spec から。知らない機種は p = 0 で先バレしない）。 */
export type OddsOf = (mode: LotteryMode) => SakibareOdds;

const NO_ODDS: SakibareOdds = { p: 0, hitW: [], missW: [] };
const noOdds: OddsOf = () => NO_ODDS;

/**
 * 見せ方。当否が分かる保留・変動は取得時のカスタム・モードで planHoldChangeCustom（先バレなら必ず変化, P13-T8b）、
 * 分からないもの（Projection から作った・リプレイ）は planHoldChange（先バレしない）。
 */
function planOf(
  seed: number,
  entry: number,
  final: LotteryHoldColor,
  hit: boolean | null,
  mode: LotteryMode | undefined,
  custom: SakibareCustom | undefined,
  oddsOf: OddsOf,
): HoldChangePlan {
  const c = custom ?? 'normal';
  if (c === 'normal' || hit === null) return planHoldChange(seed, entry, final);
  return planHoldChangeCustom(seed, entry, final, hit, oddsOf(mode ?? 'normal'), c);
}

/**
 * 見せる色に置き換えた状態（保留変化, D-075）。見せ方は RNGStream(seed, 'holdChange', entry) で決まる。
 * 変化する保留は灰色（白）で点滅（blink）し、変動が始まると割れて（breaks）HOLD_BREAK_MS.reveal（短い変動は縮めた時刻）に最終色（plan.final）になる。
 * Projection から作った保留・変動（番号・開始時刻が不明）は最終色のまま見せる。
 */
export function shownLcdState(s: LcdState, seed: number, now: number, oddsOf: OddsOf = noOdds): LcdState {
  const holds = s.holds.map((h) => {
    if (h.entry < 0) return h;
    const plan = planOf(seed, h.entry, h.color, h.hit, h.mode, h.custom, oddsOf);
    if (!plan.change) return h;
    return { ...h, color: holdColorAt(plan, null, now), blink: true };
  });
  let spin = s.spin;
  if (spin && spin.color !== null && spin.startAt !== null) {
    // プレビューは breaks を指定して割れる演出を見せられる。
    const plan: HoldChangePlan =
      spin.entry >= 0
        ? planOf(seed, spin.entry, spin.color, spin.hit, spin.mode, spin.custom, oddsOf)
        : { final: spin.color, change: false, sakibare: false };
    const change = spin.breaks === true || plan.change;
    if (change) {
      const scale = holdBreakScale(spin.endsAt - spin.startAt);
      spin = { ...spin, color: holdColorAt({ ...plan, change }, spin.startAt, now, scale), breaks: true };
    }
  }
  return holds.every((h, i) => h === s.holds[i]) && spin === s.spin ? s : { ...s, holds, spin };
}

/**
 * 先バレ（D-074）する保留・変動の番号と時刻。normal は色で、カスタムは当否と取得時のモードの材料 odds で決まる（planHoldChangeCustom, P13-T8b）。
 * 取得時刻・当否・色が分からない保留（Projection から作った・リプレイ・プレビュー）は出さない。
 */
export function sakibareTimes(s: LcdState, seed: number, oddsOf: OddsOf = noOdds): { entry: number; at: number }[] {
  const out: { entry: number; at: number }[] = [];
  const see = (
    entry: number,
    color: LotteryHoldColor | null,
    addedAt: number | null,
    hit: boolean | null,
    mode: LotteryMode | undefined,
    custom: SakibareCustom | undefined,
  ) => {
    if (entry < 0 || color === null || addedAt === null || hit === null) return;
    if (planOf(seed, entry, color, hit, mode, custom, oddsOf).sakibare) out.push({ entry, at: addedAt + SAKIBARE_DELAY_MS });
  };
  for (const h of s.holds) see(h.entry, h.color, h.addedAt, h.hit, h.mode, h.custom);
  if (s.spin) see(s.spin.entry, s.spin.color, s.spin.addedAt, s.spin.hit, s.spin.mode, s.spin.custom);
  return out;
}

/**
 * 今のフレームで鳴らす先バレ。fire は時刻に達して初めて気付いた保留（遅れすぎは除く）、next は次のフレームへ渡す済みの番号。
 * 音は同じ時刻の先バレ（大当たり後の RUSH で自動保留がまとめて足される時など）で1回だけ（sound）、光は保留ごと（fire）。
 */
export function fireSakibares(
  times: readonly { entry: number; at: number }[],
  done: ReadonlySet<number>,
  now: number,
  lateMs: number,
): { fire: { entry: number; at: number; sound: boolean }[]; next: Set<number> } {
  const next = new Set<number>();
  const fire: { entry: number; at: number; sound: boolean }[] = [];
  const sounded = new Set<number>();
  for (const { entry, at } of times) {
    if (at > now) continue;
    next.add(entry);
    if (done.has(entry) || now - at > lateMs) continue;
    fire.push({ entry, at, sound: !sounded.has(at) });
    sounded.add(at);
  }
  return { fire, next };
}

export class LcdTimeline {
  private shown: LcdState = EMPTY;
  /** まだ表示時刻に達していないイベント（時刻順）。 */
  private queue: LcdEvent[] = [];
  private ready = false;
  /** Projection に揃えた回数（テスト・Debug 用）。 */
  resyncs = 0;
  /** 次に取得する保留に記録する抽選カスタム（設定の今の値。board-scene が渡す）。 */
  custom: SakibareCustom = 'normal';

  get state(): LcdState {
    return this.shown;
  }

  /** Engine の前進結果（イベントと、その時点の Projection）を受け取る。 */
  push(projection: HallProjection, events: readonly EngineSimEvent[]): void {
    for (const e of events) {
      if (isLcdEvent(e)) this.queue.push(e);
    }
    let end = this.shown;
    for (const e of this.queue) end = applyLcdEventWith(end, e, this.custom);
    if (this.ready && matchesProjection(end, projection)) return;
    // 初回・取りこぼし: Projection の時点に飛ぶ（表示は少し先へ進む）。
    if (this.ready) this.resyncs++;
    this.ready = true;
    this.shown = stateFromProjection(projection);
    this.queue = [];
  }

  /** 表示時刻 now までのイベントを反映する（同じ時刻のイベントは Engine の順）。 */
  advance(now: number): LcdState {
    let n = 0;
    while (n < this.queue.length && this.queue[n]!.at <= now) {
      this.shown = applyLcdEventWith(this.shown, this.queue[n]!, this.custom);
      n++;
    }
    if (n > 0) this.queue.splice(0, n);
    return this.shown;
  }

  /** まだ表示していない大当たりの開始の数と、終了の出玉の合計（ホールの状態行・持ち玉を液晶に揃える, P13-T4）。 */
  pending(): { readonly jackpots: number; readonly payout: number } {
    let jackpots = 0;
    let payout = 0;
    for (const e of this.queue) {
      if (e.k === 'jackpotStarted') jackpots++;
      else if (e.k === 'jackpotEnded') payout += e.payout;
    }
    return { jackpots, payout };
  }

  /** まだ表示していない停止結果（当否が不明な変動の図柄を決める時に先を覗く）。 */
  peekResult(entry: number): boolean | null {
    for (const e of this.queue) {
      if (e.k === 'spinResolved' && e.entry === entry) return e.hit;
    }
    return null;
  }
}
