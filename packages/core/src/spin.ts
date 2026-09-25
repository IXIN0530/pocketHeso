/** 変動・大当たり・モード状態機械（spec/21 の消化〜モード、spec/22 のイベント順）。 */
import type { JackpotBranch, JackpotKind, MachineSpec, PatternTable } from './machine.ts';
import { defaultNextForKind } from './machine.ts';
import type { HoldEntry, LotteryMode } from './lottery.ts';
import { jackpotMedals, jackpotPayoutBalls } from './lottery.ts';

/** モードの残り回転数（normal は 0。jitan/st/lt は各 `spins`）。 */
function spinsForMode(spec: MachineSpec, mode: LotteryMode): number {
  if (mode === 'normal') {
    return 0;
  }
  if (mode === 'jitan') {
    if (spec.jitan === undefined) {
      throw new Error('invalid spin: jitan mode is missing');
    }
    return spec.jitan.stSpins;
  }
  if (mode === 'st') {
    return spec.st.stSpins;
  }
  if (mode === 'lt') {
    if (spec.lt === undefined) {
      throw new Error('invalid spin: lt mode is missing');
    }
    return spec.lt.stSpins;
  }
  throw new Error('invalid spin: mode must be normal, jitan, st or lt');
}

/** RUSH中か（st/lt。jitanは含まない。chainの起算・継続の判定用）。 */
function isRushMode(mode: LotteryMode): boolean {
  return mode === 'st' || mode === 'lt';
}

/** 時刻（UNIX ms 整数。2^53 未満）。 */
export type SimTime = number;

/** 変動・大当たり・モードのイベント（spec/22 の部分集合＋spec/21 上乗せ。時刻順）。 */
export type SpinEvent =
  | { k: 'spinStarted'; entry: number; at: SimTime; pattern: string; endsAt: SimTime }
  | { k: 'spinResolved'; entry: number; at: SimTime; hit: boolean }
  | { k: 'jackpotStarted'; entry: number; at: SimTime; kind: JackpotKind; rounds: number; bonusRounds?: number | undefined }
  | { k: 'uwanose'; entry: number; at: SimTime; addRounds: number; totalRounds: number }
  | { k: 'jackpotEnded'; entry: number; at: SimTime; payout: number; medals: number }
  | { k: 'modeChanged'; to: LotteryMode; at: SimTime; stRemaining: number };

/** 変動中の内容（スナップショット用）。 */
export interface ActiveSpin {
  readonly serial: number;
  readonly isHit: boolean;
  readonly branchIndex: number | null;
  readonly patternIndex: number;
  readonly startedAt: SimTime;
  readonly endsAt: SimTime;
}

/** 大当たり中の内容（スナップショット用。uwanoseAtは未放出の上乗せ通知時刻。なし・放出済みはnull）。 */
export interface ActiveJackpot {
  readonly serial: number;
  readonly branchIndex: number;
  readonly startedAt: SimTime;
  readonly endsAt: SimTime;
  readonly bonusRounds: number;
  readonly uwanoseAt: SimTime | null;
}

/** 状態の複写（`restore` で復元）。 */
export interface SpinSnapshot {
  readonly mode: LotteryMode;
  readonly stRemaining: number;
  readonly nowMs: SimTime;
  readonly active: ActiveSpin | null;
  readonly jackpot: ActiveJackpot | null;
  readonly chain: number;
  readonly chainBalls: number;
}

/** `normal_short` の保留3〜4時の短縮変動時間。 */
const SHORTENED_NORMAL_SHORT_MS = 2000;

/** 保留数のしきい値（以上で短縮）。 */
const SHORTEN_HOLD_THRESHOLD = 3;

/** 時刻の上限（2^53 未満のため）。 */
const MAX_SAFE_MS = 9007199254740991;

/** 時刻を検証する。 */
function assertTime(at: SimTime, what: string): SimTime {
  if (typeof at !== 'number' || !Number.isFinite(at) || Math.floor(at) !== at || at < 0 || at >= MAX_SAFE_MS) {
    throw new Error('invalid spin: ' + what + ' must be an int ms in range');
  }
  return at;
}

/** レートを検証する。 */
function assertRate(rate: number): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || Math.floor(rate) !== rate || rate < 1) {
    throw new Error('invalid spin: rate must be a positive int');
  }
  return rate;
}

/** 保留数を検証する。 */
function assertHoldCount(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || Math.floor(n) !== n || n < 0 || n > 8) {
    throw new Error('invalid spin: holdCount must be an int in 0..8');
  }
  return n;
}

/** 変動時間を求める（`normal_short` は保留3〜4で 2000ms。数は開始前の待ち数）。 */
export function spinDurationMs(patterns: PatternTable, patternIndex: number, holdCount: number): number {
  if (typeof patternIndex !== 'number' || !Number.isFinite(patternIndex) || Math.floor(patternIndex) !== patternIndex) {
    throw new Error('invalid spin: patternIndex must be an int');
  }
  const row = patterns[patternIndex];
  if (row === undefined) {
    throw new Error('invalid spin: patternIndex out of range');
  }
  assertHoldCount(holdCount);
  if (row.id === 'normal_short' && holdCount >= SHORTEN_HOLD_THRESHOLD) {
    return SHORTENED_NORMAL_SHORT_MS;
  }
  return row.ms;
}

/** 大当たり時間を求める（`(rounds + bonus_rounds) × ms_per_round`。合計ラウンド分）。 */
export function jackpotDurationMs(spec: MachineSpec, branchIndex: number): number {
  if (typeof branchIndex !== 'number' || !Number.isFinite(branchIndex) || Math.floor(branchIndex) !== branchIndex) {
    throw new Error('invalid spin: branchIndex must be an int');
  }
  const b = spec.jackpotSplit[branchIndex] as JackpotBranch | undefined;
  if (b === undefined) {
    throw new Error('invalid spin: branchIndex out of range');
  }
  const bonus = b.bonusRounds === undefined ? 0 : b.bonusRounds;
  return (b.rounds + bonus) * spec.msPerRound;
}

/** 基本ラウンドの消化時間（`rounds × ms_per_round`。`uwanose` の通知時刻用）。 */
export function jackpotBaseDurationMs(spec: MachineSpec, branchIndex: number): number {
  if (typeof branchIndex !== 'number' || !Number.isFinite(branchIndex) || Math.floor(branchIndex) !== branchIndex) {
    throw new Error('invalid spin: branchIndex must be an int');
  }
  const b = spec.jackpotSplit[branchIndex] as JackpotBranch | undefined;
  if (b === undefined) {
    throw new Error('invalid spin: branchIndex out of range');
  }
  return b.rounds * spec.msPerRound;
}

/** 変動・大当たり・ST の状態機械（Engine が `advance` 内で使う）。 */
export class SpinMachine {
  private readonly spec: MachineSpec;
  private readonly patterns: PatternTable;
  private currentMode: LotteryMode;
  private stLeft: number;
  private nowMsState: SimTime;
  private activeState: ActiveSpin | null = null;
  private jackpotState: ActiveJackpot | null = null;
  private chainState = 0;
  private chainBallsState = 0;

  constructor(spec: MachineSpec, patterns: PatternTable, initial?: { mode?: LotteryMode; stRemaining?: number; nowMs?: SimTime }) {
    if (patterns.length === 0) {
      throw new Error('invalid spin: patterns must not be empty');
    }
    const mode = initial !== undefined && initial.mode !== undefined ? initial.mode : 'normal';
    if (mode !== 'normal' && mode !== 'jitan' && mode !== 'st' && mode !== 'lt') {
      throw new Error('invalid spin: mode must be normal, jitan, st or lt');
    }
    if (mode === 'jitan' && spec.jitan === undefined) {
      throw new Error('invalid spin: jitan mode is missing');
    }
    if (mode === 'lt' && spec.lt === undefined) {
      throw new Error('invalid spin: lt mode is missing');
    }
    const stRemaining = initial !== undefined && initial.stRemaining !== undefined ? initial.stRemaining : 0;
    if (typeof stRemaining !== 'number' || !Number.isFinite(stRemaining) || Math.floor(stRemaining) !== stRemaining || stRemaining < 0) {
      throw new Error('invalid spin: stRemaining must be a non-negative int');
    }
    if (mode === 'normal' && stRemaining !== 0) {
      throw new Error('invalid spin: normal mode must have stRemaining 0');
    }
    const nowMs = initial !== undefined && initial.nowMs !== undefined ? assertTime(initial.nowMs, 'nowMs') : 0;
    this.spec = spec;
    this.patterns = patterns;
    this.currentMode = mode;
    this.stLeft = stRemaining;
    this.nowMsState = nowMs;
  }

  /** 現在のモード。 */
  get mode(): LotteryMode {
    return this.currentMode;
  }

  /** モード残り回転数（normal 時は 0。jitan/st/lt の残り）。 */
  get stRemaining(): number {
    return this.stLeft;
  }

  /** RUSH入りからの連チャン数（st/ltに入ると0から数え、normalに戻るとリセット）。 */
  get chain(): number {
    return this.chainState;
  }

  /** RUSH入りからの累計出玉（chainと同じ区切り）。 */
  get chainBalls(): number {
    return this.chainBallsState;
  }

  /** 現在時刻（最後に処理したイベント時刻）。 */
  get nowMs(): SimTime {
    return this.nowMsState;
  }

  /** 変動中か。 */
  get isSpinning(): boolean {
    return this.activeState !== null;
  }

  /** 大当たり中か。 */
  get isInJackpot(): boolean {
    return this.jackpotState !== null;
  }

  /** 変動終了予定時刻（変動中でなければ `null`）。 */
  get activeEndsAt(): SimTime | null {
    return this.activeState === null ? null : this.activeState.endsAt;
  }

  /** 大当たり終了予定時刻（大当たり中でなければ `null`）。 */
  get jackpotEndsAt(): SimTime | null {
    return this.jackpotState === null ? null : this.jackpotState.endsAt;
  }

  /** 上乗せ通知予定時刻（未放出の `uwanose` があればその時刻。なければ `null`）。 */
  get uwanoseAt(): SimTime | null {
    if (this.jackpotState === null) {
      return null;
    }
    return this.jackpotState.uwanoseAt;
  }

  /** 変動を開始する（待機中でなければ投げる。durationScale は変動短縮の倍率で1が等倍）。 */
  startSpin(entry: HoldEntry, at: SimTime, holdCount: number, durationScale = 1): SpinEvent[] {
    assertTime(at, 'at');
    assertHoldCount(holdCount);
    if (!(durationScale > 0) || durationScale > 1) {
      throw new Error('invalid spin: durationScale must be in (0, 1]');
    }
    if (at < this.nowMsState) {
      throw new Error('invalid spin: at must be >= nowMs');
    }
    if (this.activeState !== null) {
      throw new Error('invalid spin: already spinning');
    }
    if (this.jackpotState !== null) {
      throw new Error('invalid spin: in jackpot');
    }
    if (typeof entry.serial !== 'number' || !Number.isFinite(entry.serial) || Math.floor(entry.serial) !== entry.serial || entry.serial < 0) {
      throw new Error('invalid spin: entry.serial must be a non-negative int');
    }
    const row = this.patterns[entry.patternIndex];
    if (row === undefined) {
      throw new Error('invalid spin: entry.patternIndex out of range');
    }
    if (entry.isHit && entry.branchIndex === null) {
      throw new Error('invalid spin: hit entry needs branchIndex');
    }
    if (!entry.isHit && entry.branchIndex !== null) {
      throw new Error('invalid spin: miss entry must have null branchIndex');
    }
    const baseMs = spinDurationMs(this.patterns, entry.patternIndex, holdCount);
    const durationMs = durationScale === 1 ? baseMs : Math.floor(baseMs * durationScale);
    if (durationMs < 1) {
      throw new Error('invalid spin: durationMs out of range');
    }
    const endsAt = at + durationMs;
    if (endsAt >= MAX_SAFE_MS) {
      throw new Error('invalid spin: endsAt out of range');
    }
    this.activeState = {
      serial: entry.serial,
      isHit: entry.isHit,
      branchIndex: entry.branchIndex,
      patternIndex: entry.patternIndex,
      startedAt: at,
      endsAt,
    };
    this.nowMsState = at;
    return [{ k: 'spinStarted', entry: entry.serial, at, pattern: row.id, endsAt }];
  }

  /** 変動を停止する（`at` は終了予定時刻と一致させる）。 */
  resolveSpin(at: SimTime): SpinEvent[] {
    assertTime(at, 'at');
    const active = this.activeState;
    if (active === null) {
      throw new Error('invalid spin: not spinning');
    }
    if (at !== active.endsAt) {
      throw new Error('invalid spin: at must equal spin endsAt');
    }
    if (this.currentMode !== 'normal') {
      if (this.stLeft <= 0) {
        throw new Error('invalid spin: ' + this.currentMode + ' has no spins left');
      }
      this.stLeft = this.stLeft - 1;
    }
    const resolved: SpinEvent = { k: 'spinResolved', entry: active.serial, at, hit: active.isHit };
    if (active.isHit) {
      if (active.branchIndex === null) {
        throw new Error('invalid spin: hit entry needs branchIndex');
      }
      const b = this.spec.jackpotSplit[active.branchIndex] as JackpotBranch | undefined;
      if (b === undefined) {
        throw new Error('invalid spin: branchIndex out of range');
      }
      const bonus = b.bonusRounds === undefined ? 0 : b.bonusRounds;
      const baseMs = b.rounds * this.spec.msPerRound;
      const totalMs = (b.rounds + bonus) * this.spec.msPerRound;
      const jackpotEndsAt = at + totalMs;
      if (jackpotEndsAt >= MAX_SAFE_MS) {
        throw new Error('invalid spin: jackpot endsAt out of range');
      }
      let pendingUwanose: SimTime | null = null;
      if (bonus > 0) {
        pendingUwanose = at + baseMs;
        if (pendingUwanose >= MAX_SAFE_MS) {
          throw new Error('invalid spin: uwanose at out of range');
        }
      }
      this.jackpotState = {
        serial: active.serial,
        branchIndex: active.branchIndex,
        startedAt: at,
        endsAt: jackpotEndsAt,
        bonusRounds: bonus,
        uwanoseAt: pendingUwanose,
      };
      this.activeState = null;
      this.nowMsState = at;
      if (bonus > 0) {
        return [resolved, { k: 'jackpotStarted', entry: active.serial, at, kind: b.kind, rounds: b.rounds, bonusRounds: bonus }];
      }
      return [resolved, { k: 'jackpotStarted', entry: active.serial, at, kind: b.kind, rounds: b.rounds }];
    }
    this.activeState = null;
    this.nowMsState = at;
    if (this.currentMode !== 'normal' && this.stLeft === 0) {
      this.currentMode = 'normal';
      this.chainState = 0;
      this.chainBallsState = 0;
      return [resolved, { k: 'modeChanged', to: 'normal', at, stRemaining: 0 }];
    }
    return [resolved];
  }

  /** 上乗せを通知する（`at` は基本ラウンド消化時刻と一致させる。bonus>0の時のみ）。 */
  emitUwanose(at: SimTime): SpinEvent[] {
    assertTime(at, 'at');
    const jackpot = this.jackpotState;
    if (jackpot === null) {
      throw new Error('invalid spin: not in jackpot');
    }
    if (jackpot.uwanoseAt === null) {
      throw new Error('invalid spin: no pending uwanose');
    }
    if (at !== jackpot.uwanoseAt) {
      throw new Error('invalid spin: at must equal uwanose at');
    }
    const b = this.spec.jackpotSplit[jackpot.branchIndex] as JackpotBranch | undefined;
    if (b === undefined) {
      throw new Error('invalid spin: branchIndex out of range');
    }
    const bonus = jackpot.bonusRounds;
    const totalRounds = b.rounds + bonus;
    this.jackpotState = { ...jackpot, uwanoseAt: null };
    this.nowMsState = at;
    return [{ k: 'uwanose', entry: jackpot.serial, at, addRounds: bonus, totalRounds }];
  }

  /** 大当たりを消化する（`at` は終了予定時刻と一致させる）。 */
  finishJackpot(at: SimTime, rate: number): SpinEvent[] {
    assertTime(at, 'at');
    assertRate(rate);
    const jackpot = this.jackpotState;
    if (jackpot === null) {
      throw new Error('invalid spin: not in jackpot');
    }
    if (this.activeState !== null) {
      throw new Error('invalid spin: cannot finish jackpot while spinning');
    }
    if (jackpot.uwanoseAt !== null) {
      throw new Error('invalid spin: uwanose is pending');
    }
    if (at !== jackpot.endsAt) {
      throw new Error('invalid spin: at must equal jackpot endsAt');
    }
    const b = this.spec.jackpotSplit[jackpot.branchIndex] as JackpotBranch | undefined;
    if (b === undefined) {
      throw new Error('invalid spin: branchIndex out of range');
    }
    const payout = jackpotPayoutBalls(this.spec, jackpot.branchIndex, rate);
    const medals = jackpotMedals(this.spec, jackpot.branchIndex);
    const ended: SpinEvent = { k: 'jackpotEnded', entry: jackpot.serial, at, payout, medals };
    const nextMode: LotteryMode = b.next === undefined ? defaultNextForKind(b.kind) : b.next;
    const nextSt = spinsForMode(this.spec, nextMode);
    const wasRush = isRushMode(this.currentMode);
    const willRush = isRushMode(nextMode);
    this.jackpotState = null;
    this.nowMsState = at;
    if (willRush && wasRush) {
      this.chainState = this.chainState + 1;
      this.chainBallsState = this.chainBallsState + payout;
    } else if (willRush && !wasRush) {
      this.chainState = 0;
      this.chainBallsState = 0;
    } else {
      this.chainState = 0;
      this.chainBallsState = 0;
    }
    if (nextMode !== this.currentMode || nextSt !== this.stLeft) {
      this.currentMode = nextMode;
      this.stLeft = nextSt;
      return [ended, { k: 'modeChanged', to: nextMode, at, stRemaining: nextSt }];
    }
    return [ended];
  }

  /** 状態の複写。 */
  snapshot(): SpinSnapshot {
    return {
      mode: this.currentMode,
      stRemaining: this.stLeft,
      nowMs: this.nowMsState,
      active: this.activeState === null ? null : { ...this.activeState },
      jackpot: this.jackpotState === null ? null : { ...this.jackpotState },
      chain: this.chainState,
      chainBalls: this.chainBallsState,
    };
  }

  /** 複写から復元する。 */
  static restore(spec: MachineSpec, patterns: PatternTable, snap: SpinSnapshot): SpinMachine {
    const m = new SpinMachine(spec, patterns, { mode: snap.mode, stRemaining: snap.stRemaining, nowMs: snap.nowMs });
    m.activeState = snap.active === null ? null : { ...snap.active };
    if (snap.jackpot === null) {
      m.jackpotState = null;
    } else {
      const j = snap.jackpot as ActiveJackpot & { bonusRounds?: number; uwanoseAt?: SimTime | null };
      const bonus = j.bonusRounds === undefined ? 0 : j.bonusRounds;
      const pending = j.uwanoseAt === undefined ? null : j.uwanoseAt;
      m.jackpotState = {
        serial: j.serial,
        branchIndex: j.branchIndex,
        startedAt: j.startedAt,
        endsAt: j.endsAt,
        bonusRounds: bonus,
        uwanoseAt: pending,
      };
    }
    const s = snap as SpinSnapshot & { chain?: number; chainBalls?: number };
    m.chainState = s.chain === undefined ? 0 : s.chain;
    m.chainBallsState = s.chainBalls === undefined ? 0 : s.chainBalls;
    return m;
  }
}
