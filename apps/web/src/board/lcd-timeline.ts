// 液晶の保留・変動・大当たりの再生（spec/40 ホール, spec/21 流れ）。Three に依存しない（テスト用）。
// Engine のイベント（保留の取得 → 変動開始 → 停止 → 大当たり）を時刻付きでため、盤面の玉と同じ表示時刻で1つずつ反映する。
// 前進ごとに「全部反映した結果」を Projection と照らし、合わなければ（背面の間・Debug の倍速で取りこぼした時）Projection に揃える。
import type { EngineSimEvent, HallProjection, JackpotKind, LotteryHoldColor } from '@ph/core';
import { holdColorAt, planHoldChange, sakibareAt } from '@ph/fx';

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
}

export interface LcdJackpot {
  readonly entry: number;
  readonly kind: JackpotKind;
  readonly rounds: number;
}

export interface LcdState {
  readonly holds: readonly LcdHold[];
  readonly spin: LcdSpin | null;
  /** 直前に止まった変動（図柄の停止に使う）。 */
  readonly resolved: { readonly entry: number; readonly hit: boolean } | null;
  readonly jackpot: LcdJackpot | null;
}

type LcdEvent = Extract<
  EngineSimEvent,
  { k: 'holdAdded' | 'spinStarted' | 'spinResolved' | 'jackpotStarted' | 'uwanose' | 'jackpotEnded' }
>;

const isLcdEvent = (e: EngineSimEvent): e is LcdEvent =>
  e.k === 'holdAdded' ||
  e.k === 'spinStarted' ||
  e.k === 'spinResolved' ||
  e.k === 'jackpotStarted' ||
  e.k === 'uwanose' ||
  e.k === 'jackpotEnded';

const EMPTY: LcdState = { holds: [], spin: null, resolved: null, jackpot: null };

/** Projection の時点の状態（通し番号・当否・開始時刻は分からない）。 */
export function stateFromProjection(p: HallProjection): LcdState {
  return {
    holds: p.holds.map((color) => ({ entry: -1, color, hit: null, addedAt: null })),
    spin: p.spin
      ? { entry: p.spin.entry, pattern: p.spin.pattern, startAt: null, endsAt: p.spin.endsAt, color: null, hit: null, addedAt: null }
      : null,
    resolved: null,
    jackpot: p.jackpot ? { entry: p.jackpot.entry, kind: p.jackpot.kind, rounds: p.jackpot.rounds } : null,
  };
}

/** イベント1つを反映する（spec/21 流れ: 取得で末尾に積み、変動開始で先頭を取り出す）。 */
export function applyLcdEvent(s: LcdState, e: LcdEvent): LcdState {
  switch (e.k) {
    case 'holdAdded':
      return {
        ...s,
        holds: [...s.holds, { entry: e.entry.serial, color: e.entry.color, hit: e.entry.isHit, addedAt: e.at }],
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
        },
      };
    }
    case 'spinResolved':
      return { ...s, spin: null, resolved: { entry: e.entry, hit: e.hit } };
    case 'jackpotStarted':
      return { ...s, jackpot: { entry: e.entry, kind: e.kind, rounds: e.rounds } };
    case 'uwanose':
      return s.jackpot ? { ...s, jackpot: { ...s.jackpot, rounds: e.totalRounds } } : s;
    case 'jackpotEnded':
      return { ...s, jackpot: null };
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

/**
 * 見せる色に置き換えた状態（保留変化, D-075）。見せ方は RNGStream(seed, 'holdChange', entry) で決まり、最終色は Core のまま。
 * 変化する保留は灰色（白）で点滅（blink）し、変動が始まると割れて（breaks）HOLD_BREAK_MS.reveal に最終色になる。
 * Projection から作った保留・変動（番号・開始時刻が不明）は最終色のまま見せる。
 */
export function shownLcdState(s: LcdState, seed: number, now: number): LcdState {
  const holds = s.holds.map((h) => {
    if (h.entry < 0 || !planHoldChange(seed, h.entry, h.color).change) return h;
    return { ...h, color: 'white' as const, blink: true };
  });
  let spin = s.spin;
  if (spin && spin.color !== null && spin.startAt !== null) {
    // プレビューは breaks を指定して割れる演出を見せられる。
    const change = spin.breaks === true || (spin.entry >= 0 && planHoldChange(seed, spin.entry, spin.color).change);
    if (change) spin = { ...spin, color: holdColorAt({ final: spin.color, change, sakibare: false }, spin.startAt, now), breaks: true };
  }
  return holds.every((h, i) => h === s.holds[i]) && spin === s.spin ? s : { ...s, holds, spin };
}

/**
 * 先バレ（D-074）する保留・変動の番号と時刻（見せ方と同じ RNGStream(seed, 'holdChange', entry) で決まる）。
 * 取得時刻が分からない保留（Projection から作った・リプレイ・プレビュー）は出さない。
 */
export function sakibareTimes(s: LcdState, seed: number): { entry: number; at: number }[] {
  const out: { entry: number; at: number }[] = [];
  const see = (entry: number, color: LotteryHoldColor | null, addedAt: number | null) => {
    if (entry < 0 || color === null || addedAt === null) return;
    const at = sakibareAt(planHoldChange(seed, entry, color), addedAt);
    if (at !== null) out.push({ entry, at });
  };
  for (const h of s.holds) see(h.entry, h.color, h.addedAt);
  if (s.spin) see(s.spin.entry, s.spin.color, s.spin.addedAt);
  return out;
}

export class LcdTimeline {
  private shown: LcdState = EMPTY;
  /** まだ表示時刻に達していないイベント（時刻順）。 */
  private queue: LcdEvent[] = [];
  private ready = false;
  /** Projection に揃えた回数（テスト・Debug 用）。 */
  resyncs = 0;

  get state(): LcdState {
    return this.shown;
  }

  /** Engine の前進結果（イベントと、その時点の Projection）を受け取る。 */
  push(projection: HallProjection, events: readonly EngineSimEvent[]): void {
    for (const e of events) {
      if (isLcdEvent(e)) this.queue.push(e);
    }
    let end = this.shown;
    for (const e of this.queue) end = applyLcdEvent(end, e);
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
      this.shown = applyLcdEvent(this.shown, this.queue[n]!);
      n++;
    }
    if (n > 0) this.queue.splice(0, n);
    return this.shown;
  }

  /** まだ表示していない停止結果（当否が不明な変動の図柄を決める時に先を覗く）。 */
  peekResult(entry: number): boolean | null {
    for (const e of this.queue) {
      if (e.k === 'spinResolved' && e.entry === entry) return e.hit;
    }
    return null;
  }
}
