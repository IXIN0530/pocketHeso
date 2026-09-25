/** Engine（パチンコ部。発射600ms・Atlas参照・変動・snapshot/lookahead/project。経済はStub）。 */
import type { JackpotKind, MachineSpec, PatternTable } from './machine.ts';
import type { HoldEntry, LotteryHoldColor, LotteryMode } from './lottery.ts';
import { drawHold } from './lottery.ts';
import { HoldQueue } from './hold-queue.ts';
import { SpinMachine, type SpinSnapshot } from './spin.ts';
import type { SimTime } from './spin.ts';
import { ATLAS_ENTRY_BYTES, ATLAS_HEADER_BYTES, ATLAS_TOTAL_BYTES, atlasKeyForBall, decodeAtlasHeader } from './atlas.ts';
import type { EconomyPort } from './economy.ts';
import { StubEconomy } from './economy.ts';

/** 営業時間などの付与（spec/30が生成。P2-T5では燃料・メダルを加算するだけ）。 */
export interface Grant {
  readonly claimId: string;
  readonly at: SimTime;
  readonly fuelMs: number;
  readonly medals: number;
  readonly streakDay?: string | undefined;
}

/** 入力（P2-T5はshoot/auto/presenceのみ有効。他はrejectedで無視）。 */
export type Action =
  | { readonly t: SimTime; readonly k: 'shoot'; readonly on: boolean; readonly rate: number }
  | { readonly t: SimTime; readonly k: 'auto'; readonly share: number; readonly rate: number }
  | { readonly t: SimTime; readonly k: 'presence'; readonly fg: boolean }
  | { readonly t: SimTime; readonly k: 'buy'; readonly target: string; readonly count: number }
  | { readonly t: SimTime; readonly k: 'awaken'; readonly yakumono: string }
  | { readonly t: SimTime; readonly k: 'noticeTap'; readonly noticeId: number }
  | { readonly t: SimTime; readonly k: 'boost'; readonly on: boolean }
  | { readonly t: SimTime; readonly k: 'close' };

/** Engineが出すイベント（P2-T5の部分集合＋granted/rejected）。 */
export type SimEvent =
  | { readonly k: 'fired'; readonly ball: number; readonly at: SimTime; readonly rate: number }
  | { readonly k: 'sensor'; readonly ball: number; readonly at: SimTime; readonly kind: 'start1' | 'out' | 'lost' }
  | { readonly k: 'holdAdded'; readonly entry: HoldEntry; readonly at: SimTime }
  | { readonly k: 'holdOverflow'; readonly ball: number; readonly at: SimTime }
  | { readonly k: 'spinStarted'; readonly entry: number; readonly at: SimTime; readonly pattern: string; readonly endsAt: SimTime }
  | { readonly k: 'spinResolved'; readonly entry: number; readonly at: SimTime; readonly hit: boolean }
  | { readonly k: 'jackpotStarted'; readonly entry: number; readonly at: SimTime; readonly kind: JackpotKind; readonly rounds: number }
  | { readonly k: 'jackpotEnded'; readonly entry: number; readonly at: SimTime; readonly payout: number; readonly medals: number }
  | { readonly k: 'modeChanged'; readonly to: LotteryMode; readonly at: SimTime; readonly stRemaining: number }
  | { readonly k: 'granted'; readonly claimId: string; readonly at: SimTime; readonly fuelMs: number; readonly medals: number }
  | { readonly k: 'rejected'; readonly at: SimTime; readonly action: Action['k']; readonly reason: string };

/** Engineの設定（seed・機種・盤面Atlas・初期持ち玉。economyはP3差し込み口）。 */
export interface EngineConfig {
  readonly seed: number;
  readonly spec: MachineSpec;
  readonly patterns: PatternTable;
  readonly atlas: ArrayBuffer;
  readonly initialBalls?: number | undefined;
  readonly initialMedals?: number | undefined;
  readonly initialFuelMs?: number | undefined;
  readonly economy?: EconomyPort | undefined;
}

/** 飛行中の玉（発射済み・センサー待ち）。 */
export interface PendingSensor {
  readonly ball: number;
  readonly fireAt: SimTime;
  readonly sensorAt: SimTime;
  readonly kind: 'start1' | 'out' | 'lost';
  readonly rate: number;
}

/** 累計（回転数・当たり・発射数・払出玉）。 */
export interface Totals {
  readonly spins: number;
  readonly jackpots: number;
  readonly fired: number;
  readonly payoutBalls: number;
}

/** Engine状態の複写（restoreで復元。入力列ごと含む）。 */
export interface EngineSnapshot {
  readonly nowMs: SimTime;
  readonly nextBall: number;
  readonly balls: number;
  readonly medals: number;
  readonly fuelMs: number;
  readonly totals: Totals;
  readonly shootOn: boolean;
  readonly shootRate: number;
  readonly autoShare: number;
  readonly autoRate: number;
  readonly fg: boolean;
  readonly holds: readonly HoldEntry[];
  readonly spin: SpinSnapshot;
  readonly pending: readonly PendingSensor[];
  readonly grants: readonly Grant[];
  readonly grantIdx: number;
  readonly actions: readonly Action[];
  readonly actionIdx: number;
  readonly economy: unknown;
}

/** 変動中の表示（patternはID・endsAtは終了予定）。 */
export interface SpinView {
  readonly entry: number;
  readonly pattern: string;
  readonly endsAt: SimTime;
}

/** 大当たり中の表示。 */
export interface JackpotView {
  readonly entry: number;
  readonly kind: JackpotKind;
  readonly rounds: number;
  readonly endsAt: SimTime;
}

/** 役物表示（P2-T5では空。P3以降で埋める）。 */
export interface YakumonoView {
  readonly id: string;
  readonly lv: number;
}

/** Hall投影（UIはこれだけ見る。P2-T5はパチンコ部の項目のみ実値）。 */
export interface HallProjection {
  readonly at: SimTime;
  readonly mode: LotteryMode;
  readonly stRemaining: number;
  readonly holds: readonly LotteryHoldColor[];
  readonly spin?: SpinView | undefined;
  readonly jackpot?: JackpotView | undefined;
  readonly balls: number;
  readonly medals: number;
  readonly fuelMs: number;
  readonly boostMs: number;
  readonly perSec: number;
  readonly yakumono: readonly YakumonoView[];
  readonly totals: Totals;
}

/** 発射グリッドms（絶対時刻の倍数に揃える）。 */
export const FIRE_INTERVAL_MS = 600;

/** 時刻の上限（2^53未満）。 */
const MAX_SAFE_MS = 9007199254740991;

/** 時刻を検証する。 */
function assertTime(at: number, what: string): SimTime {
  if (typeof at !== 'number' || !Number.isFinite(at) || Math.floor(at) !== at || at < 0 || at >= MAX_SAFE_MS) {
    throw new Error('invalid engine: ' + what + ' must be an int ms in range');
  }
  return at;
}

/** レートを検証する。 */
function assertRate(rate: number, what: string): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || Math.floor(rate) !== rate || rate < 1) {
    throw new Error('invalid engine: ' + what + ' must be a positive int');
  }
  return rate;
}

/** shareを検証する（0..1）。 */
function assertShare(share: number): number {
  if (typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1) {
    throw new Error('invalid engine: share must be in [0, 1]');
  }
  return share;
}

/** 次の発射グリッド（curより大きい最小の600倍数）。 */
function nextFireTick(cur: SimTime): SimTime {
  const rem = cur - Math.floor(cur / FIRE_INTERVAL_MS) * FIRE_INTERVAL_MS;
  return cur + FIRE_INTERVAL_MS - rem;
}

/** Atlasの1件を速読する（kindはstart1/lost/他→outに畳む。P2-T5の暫定）。 */
function readAtlasKindFlight(view: DataView, key: number): { kind: 'start1' | 'out' | 'lost'; flightMs: number } {
  const at = ATLAS_HEADER_BYTES + key * ATLAS_ENTRY_BYTES;
  const code = view.getUint8(at);
  const flightMs = view.getUint16(at + 1, true);
  if (code === 0) {
    return { kind: 'start1', flightMs };
  }
  if (code === 5) {
    return { kind: 'lost', flightMs };
  }
  return { kind: 'out', flightMs };
}

/** スナップショットから投影を作る（純関数。atはsnap.nowMs固定）。 */
export function projectSnapshot(
  snap: EngineSnapshot,
  spec: MachineSpec,
  patterns: PatternTable,
): HallProjection {
  const holds: LotteryHoldColor[] = [];
  for (let i = 0; i < snap.holds.length; i = i + 1) {
    const h = snap.holds[i] as HoldEntry | undefined;
    if (h !== undefined) {
      holds.push(h.color);
    }
  }
  let spin: SpinView | undefined;
  const active = snap.spin.active;
  if (active !== null) {
    const row = patterns[active.patternIndex];
    if (row === undefined) {
      throw new Error('invalid engine: active patternIndex out of range');
    }
    spin = { entry: active.serial, pattern: row.id, endsAt: active.endsAt };
  }
  let jackpot: JackpotView | undefined;
  const j = snap.spin.jackpot;
  if (j !== null) {
    const b = spec.jackpotSplit[j.branchIndex];
    if (b === undefined) {
      throw new Error('invalid engine: jackpot branchIndex out of range');
    }
    jackpot = { entry: j.serial, kind: b.kind, rounds: b.rounds, endsAt: j.endsAt };
  }
  return {
    at: snap.nowMs,
    mode: snap.spin.mode,
    stRemaining: snap.spin.stRemaining,
    holds,
    spin,
    jackpot,
    balls: snap.balls,
    medals: snap.medals,
    fuelMs: snap.fuelMs,
    boostMs: 0,
    perSec: 0,
    yakumono: [],
    totals: { ...snap.totals },
  };
}

/** Engine（パチンコ部。決定論・スナップショット・lookahead・project）。 */
export class Engine {
  private readonly seed: number;
  private readonly spec: MachineSpec;
  private readonly patterns: PatternTable;
  private readonly atlasBuffer: ArrayBuffer;
  private readonly atlasView: DataView;
  private economy: EconomyPort;
  private nowMsState: SimTime;
  private nextBallState: number;
  private ballsState: number;
  private medalsState: number;
  private fuelMsState: number;
  private totalsState: Totals;
  private shootOnState: boolean;
  private shootRateState: number;
  private autoShareState: number;
  private autoRateState: number;
  private fgState: boolean;
  private queue: HoldQueue;
  private spins: SpinMachine;
  private pendingState: PendingSensor[];
  private grantsState: Grant[];
  private grantIdxState: number;
  private actionsState: Action[];
  private actionIdxState: number;

  constructor(cfg: EngineConfig, grants: readonly Grant[], actions: readonly Action[]) {
    if (typeof cfg.seed !== 'number' || !Number.isFinite(cfg.seed) || Math.floor(cfg.seed) !== cfg.seed || cfg.seed < 0) {
      throw new Error('invalid engine: seed must be a non-negative int');
    }
    decodeAtlasHeader(cfg.atlas);
    if (cfg.atlas.byteLength !== ATLAS_TOTAL_BYTES) {
      throw new Error('invalid engine: atlas byteLength mismatch');
    }
    const initialBalls = cfg.initialBalls === undefined ? 0 : cfg.initialBalls;
    const initialMedals = cfg.initialMedals === undefined ? 0 : cfg.initialMedals;
    const initialFuelMs = cfg.initialFuelMs === undefined ? 0 : cfg.initialFuelMs;
    if (Math.floor(initialBalls) !== initialBalls) {
      throw new Error('invalid engine: initialBalls must be an int');
    }
    if (Math.floor(initialMedals) !== initialMedals || initialMedals < 0) {
      throw new Error('invalid engine: initialMedals must be a non-negative int');
    }
    assertTime(initialFuelMs, 'initialFuelMs');
    this.seed = cfg.seed >>> 0;
    this.spec = cfg.spec;
    this.patterns = cfg.patterns;
    this.atlasBuffer = cfg.atlas;
    this.atlasView = new DataView(cfg.atlas);
    this.economy = cfg.economy === undefined ? new StubEconomy() : cfg.economy;
    this.nowMsState = 0;
    this.nextBallState = 0;
    this.ballsState = initialBalls;
    this.medalsState = initialMedals;
    this.fuelMsState = initialFuelMs;
    this.totalsState = { spins: 0, jackpots: 0, fired: 0, payoutBalls: 0 };
    this.shootOnState = false;
    this.shootRateState = 1;
    this.autoShareState = 0;
    this.autoRateState = 1;
    this.fgState = true;
    this.queue = new HoldQueue(cfg.spec.holdMax);
    this.spins = new SpinMachine(cfg.spec, cfg.patterns, { mode: 'normal', stRemaining: 0, nowMs: 0 });
    this.pendingState = [];
    this.grantsState = [];
    this.grantIdxState = 0;
    this.actionsState = [];
    this.actionIdxState = 0;
    for (let i = 0; i < grants.length; i = i + 1) {
      const g = grants[i] as Grant | undefined;
      if (g === undefined) {
        throw new Error('invalid engine: grant is missing');
      }
      this.appendGrant(g);
    }
    for (let i = 0; i < actions.length; i = i + 1) {
      const a = actions[i] as Action | undefined;
      if (a === undefined) {
        throw new Error('invalid engine: action is missing');
      }
      this.appendAction(a);
    }
  }

  /** 現在時刻。 */
  get nowMs(): SimTime {
    return this.nowMsState;
  }

  /** 付与を追加する（t ≥ now・時刻昇順のみ。now時刻はまだ未処理なので同刻追加も通しと一致する）。 */
  appendGrant(g: Grant): void {
    assertTime(g.at, 'grant.at');
    if (typeof g.claimId !== 'string' || g.claimId.length === 0) {
      throw new Error('invalid engine: grant.claimId must be non-empty');
    }
    assertTime(g.fuelMs, 'grant.fuelMs');
    if (Math.floor(g.medals) !== g.medals || g.medals < 0) {
      throw new Error('invalid engine: grant.medals must be a non-negative int');
    }
    if (g.at < this.nowMsState) {
      throw new Error('invalid engine: grant.at must be >= now');
    }
    const last = this.grantsState[this.grantsState.length - 1] as Grant | undefined;
    if (last !== undefined && g.at < last.at) {
      throw new Error('invalid engine: grants must be in time order');
    }
    this.grantsState.push({ claimId: g.claimId, at: g.at, fuelMs: g.fuelMs, medals: g.medals });
  }

  /** 入力を追加する（t ≥ now・時刻昇順のみ。now時刻はまだ未処理なので同刻追加も通しと一致する）。 */
  appendAction(a: Action): void {
    assertTime(a.t, 'action.t');
    if (a.t < this.nowMsState) {
      throw new Error('invalid engine: action.t must be >= now');
    }
    const last = this.actionsState[this.actionsState.length - 1] as Action | undefined;
    if (last !== undefined && a.t < last.t) {
      throw new Error('invalid engine: actions must be in time order');
    }
    if (a.k === 'shoot') {
      if (typeof a.on !== 'boolean') {
        throw new Error('invalid engine: shoot.on must be boolean');
      }
      assertRate(a.rate, 'shoot.rate');
      this.actionsState.push({ t: a.t, k: 'shoot', on: a.on, rate: a.rate });
      return;
    }
    if (a.k === 'auto') {
      assertShare(a.share);
      assertRate(a.rate, 'auto.rate');
      this.actionsState.push({ t: a.t, k: 'auto', share: a.share, rate: a.rate });
      return;
    }
    if (a.k === 'presence') {
      if (typeof a.fg !== 'boolean') {
        throw new Error('invalid engine: presence.fg must be boolean');
      }
      this.actionsState.push({ t: a.t, k: 'presence', fg: a.fg });
      return;
    }
    if (a.k === 'buy') {
      this.actionsState.push({ t: a.t, k: 'buy', target: a.target, count: a.count });
      return;
    }
    if (a.k === 'awaken') {
      this.actionsState.push({ t: a.t, k: 'awaken', yakumono: a.yakumono });
      return;
    }
    if (a.k === 'noticeTap') {
      this.actionsState.push({ t: a.t, k: 'noticeTap', noticeId: a.noticeId });
      return;
    }
    if (a.k === 'boost') {
      this.actionsState.push({ t: a.t, k: 'boost', on: a.on });
      return;
    }
    this.actionsState.push({ t: a.t, k: 'close' });
  }

  /** 次に処理する時刻（curより大きい入力・発射・センサー・変動終了・大当たり終了の最小値。なければto）。 */
  private nextEventTime(cur: SimTime, to: SimTime): SimTime {
    let nxt = to;
    const g = this.grantsState[this.grantIdxState] as Grant | undefined;
    if (g !== undefined && g.at > cur && g.at < nxt) {
      nxt = g.at;
    }
    const a = this.actionsState[this.actionIdxState] as Action | undefined;
    if (a !== undefined && a.t > cur && a.t < nxt) {
      nxt = a.t;
    }
    const nf = nextFireTick(cur);
    if (nf < nxt) {
      nxt = nf;
    }
    for (let i = 0; i < this.pendingState.length; i = i + 1) {
      const p = this.pendingState[i] as PendingSensor;
      if (p.sensorAt > cur && p.sensorAt < nxt) {
        nxt = p.sensorAt;
      }
    }
    if (this.spins.isSpinning) {
      const endsAt = this.spins.activeEndsAt as SimTime | null;
      if (endsAt !== null && endsAt > cur && endsAt < nxt) {
        nxt = endsAt;
      }
    }
    if (this.spins.isInJackpot) {
      const endsAt = this.spins.jackpotEndsAt as SimTime | null;
      if (endsAt !== null && endsAt > cur && endsAt < nxt) {
        nxt = endsAt;
      }
    }
    return nxt;
  }

  /** 指定時刻まで進める（半開区間[now, to)を処理。to時刻の事象は次のadvanceで処理。新規イベントのみ返す）。 */
  advance(to: SimTime): SimEvent[] {
    assertTime(to, 'to');
    if (to < this.nowMsState) {
      throw new Error('invalid engine: to must be >= now');
    }
    const out: SimEvent[] = [];
    let cur = this.nowMsState;
    while (cur < to) {
      this.applyInputsAt(cur, out);
      this.applyFiringAt(cur, out);
      this.applySensorsAt(cur, out);
      this.applySpinAt(cur, out);
      cur = this.nextEventTime(cur, to);
    }
    this.nowMsState = to;
    return out;
  }

  /** 同時刻のgrant/actionを適用する。 */
  private applyInputsAt(at: SimTime, out: SimEvent[]): void {
    while (true) {
      const g = this.grantsState[this.grantIdxState] as Grant | undefined;
      if (g === undefined || g.at !== at) {
        break;
      }
      this.grantIdxState = this.grantIdxState + 1;
      this.fuelMsState = this.fuelMsState + g.fuelMs;
      this.medalsState = this.medalsState + g.medals;
      out.push({ k: 'granted', claimId: g.claimId, at, fuelMs: g.fuelMs, medals: g.medals });
    }
    while (true) {
      const a = this.actionsState[this.actionIdxState] as Action | undefined;
      if (a === undefined || a.t !== at) {
        break;
      }
      this.actionIdxState = this.actionIdxState + 1;
      if (a.k === 'shoot') {
        this.shootOnState = a.on;
        this.shootRateState = a.rate;
      } else if (a.k === 'auto') {
        this.autoShareState = a.share;
        this.autoRateState = a.rate;
      } else if (a.k === 'presence') {
        this.fgState = a.fg;
      } else {
        out.push({ k: 'rejected', at, action: a.k, reason: 'not-implemented' });
      }
    }
  }

  /** 同時刻の発射（600ms倍数の時のみ。前面shoot優先・背面はautoのみ）。 */
  private applyFiringAt(at: SimTime, out: SimEvent[]): void {
    const rem = at - Math.floor(at / FIRE_INTERVAL_MS) * FIRE_INTERVAL_MS;
    if (rem !== 0) {
      return;
    }
    let rate = -1;
    if (this.fgState && this.shootOnState) {
      rate = this.shootRateState;
    } else if (this.autoShareState > 0) {
      const n = Math.floor(at / FIRE_INTERVAL_MS);
      if (Math.floor(n * this.autoShareState) !== Math.floor((n - 1) * this.autoShareState)) {
        rate = this.autoRateState;
      }
    }
    if (rate < 1) {
      return;
    }
    const ball = this.nextBallState;
    this.nextBallState = ball + 1;
    this.ballsState = this.ballsState - 1;
    this.totalsState = {
      spins: this.totalsState.spins,
      jackpots: this.totalsState.jackpots,
      fired: this.totalsState.fired + 1,
      payoutBalls: this.totalsState.payoutBalls,
    };
    out.push({ k: 'fired', ball, at, rate });
    const key = atlasKeyForBall(this.seed, ball);
    if (key < 0 || key >= 65536) {
      throw new Error('invalid engine: atlas key out of range');
    }
    const found = readAtlasKindFlight(this.atlasView, key);
    this.pendingState.push({ ball, fireAt: at, sensorAt: at + found.flightMs, kind: found.kind, rate });
  }

  /** 同時刻のセンサーと保留取得（sensor→holdの順）。 */
  private applySensorsAt(at: SimTime, out: SimEvent[]): void {
    const hits: PendingSensor[] = [];
    const rest: PendingSensor[] = [];
    for (let i = 0; i < this.pendingState.length; i = i + 1) {
      const p = this.pendingState[i] as PendingSensor;
      if (p.sensorAt === at) {
        out.push({ k: 'sensor', ball: p.ball, at, kind: p.kind });
        if (p.kind === 'start1') {
          hits.push(p);
        }
      } else {
        rest.push(p);
      }
    }
    this.pendingState = rest;
    for (let i = 0; i < hits.length; i = i + 1) {
      const h = hits[i] as PendingSensor;
      const mode = this.spins.mode;
      const entry = drawHold(this.spec, this.patterns, this.seed, mode, h.ball, h.rate);
      this.ballsState = this.ballsState + entry.hesoPayoutBalls;
      this.totalsState = {
        spins: this.totalsState.spins,
        jackpots: this.totalsState.jackpots,
        fired: this.totalsState.fired,
        payoutBalls: this.totalsState.payoutBalls + entry.hesoPayoutBalls,
      };
      if (this.queue.tryAdd(entry)) {
        out.push({ k: 'holdAdded', entry, at });
      } else {
        out.push({ k: 'holdOverflow', ball: h.ball, at });
      }
    }
  }

  /** 同時刻の変動・大当たり・開始（resolve→jackpot→spinStarted→modeの順）。 */
  private applySpinAt(at: SimTime, out: SimEvent[]): void {
    let deferredMode: SimEvent | null = null;
    if (this.spins.isSpinning) {
      const endsAt = this.spins.activeEndsAt as SimTime | null;
      if (endsAt !== null && endsAt === at) {
        const evs = this.spins.resolveSpin(at);
        for (let i = 0; i < evs.length; i = i + 1) {
          const e = evs[i] as (typeof evs)[number] | undefined;
          if (e === undefined) {
            continue;
          }
          if (e.k === 'modeChanged') {
            deferredMode = { k: 'modeChanged', to: e.to, at: e.at, stRemaining: e.stRemaining };
          } else {
            if (e.k === 'jackpotStarted') {
              this.totalsState = {
                spins: this.totalsState.spins,
                jackpots: this.totalsState.jackpots + 1,
                fired: this.totalsState.fired,
                payoutBalls: this.totalsState.payoutBalls,
              };
            }
            out.push(e);
          }
        }
      }
    }
    if (this.spins.isInJackpot) {
      const endsAt = this.spins.jackpotEndsAt as SimTime | null;
      if (endsAt !== null && endsAt === at) {
        const evs = this.spins.finishJackpot(at, 1);
        for (let i = 0; i < evs.length; i = i + 1) {
          const e = evs[i] as (typeof evs)[number] | undefined;
          if (e === undefined) {
            continue;
          }
          if (e.k === 'modeChanged') {
            deferredMode = { k: 'modeChanged', to: e.to, at: e.at, stRemaining: e.stRemaining };
          } else {
            if (e.k === 'jackpotEnded') {
              this.ballsState = this.ballsState + e.payout;
              this.medalsState = this.medalsState + e.medals;
              this.totalsState = {
                spins: this.totalsState.spins,
                jackpots: this.totalsState.jackpots,
                fired: this.totalsState.fired,
                payoutBalls: this.totalsState.payoutBalls + e.payout,
              };
            }
            out.push(e);
          }
        }
      }
    }
    if (!this.spins.isSpinning && !this.spins.isInJackpot && this.queue.size > 0) {
      const holdCount = this.queue.size;
      const entry = this.queue.takeFirst();
      if (entry !== null) {
        const evs = this.spins.startSpin(entry, at, holdCount);
        for (let i = 0; i < evs.length; i = i + 1) {
          const e = evs[i] as (typeof evs)[number] | undefined;
          if (e === undefined) {
            continue;
          }
          out.push(e);
        }
        this.totalsState = {
          spins: this.totalsState.spins + 1,
          jackpots: this.totalsState.jackpots,
          fired: this.totalsState.fired,
          payoutBalls: this.totalsState.payoutBalls,
        };
      }
    }
    if (deferredMode !== null) {
      out.push(deferredMode);
    }
  }

  /** 状態の複写。 */
  snapshot(): EngineSnapshot {
    const holds = this.queue.peekAll();
    const holdsCopy: HoldEntry[] = [];
    for (let i = 0; i < holds.length; i = i + 1) {
      const h = holds[i] as HoldEntry | undefined;
      if (h !== undefined) {
        holdsCopy.push({ ...h });
      }
    }
    const pendingCopy: PendingSensor[] = [];
    for (let i = 0; i < this.pendingState.length; i = i + 1) {
      const p = this.pendingState[i] as PendingSensor;
      pendingCopy.push({ ...p });
    }
    const grantsCopy: Grant[] = [];
    for (let i = 0; i < this.grantsState.length; i = i + 1) {
      const g = this.grantsState[i] as Grant;
      grantsCopy.push({ ...g });
    }
    const actionsCopy: Action[] = [];
    for (let i = 0; i < this.actionsState.length; i = i + 1) {
      const a = this.actionsState[i] as Action;
      actionsCopy.push({ ...a });
    }
    return {
      nowMs: this.nowMsState,
      nextBall: this.nextBallState,
      balls: this.ballsState,
      medals: this.medalsState,
      fuelMs: this.fuelMsState,
      totals: { ...this.totalsState },
      shootOn: this.shootOnState,
      shootRate: this.shootRateState,
      autoShare: this.autoShareState,
      autoRate: this.autoRateState,
      fg: this.fgState,
      holds: holdsCopy,
      spin: this.spins.snapshot(),
      pending: pendingCopy,
      grants: grantsCopy,
      grantIdx: this.grantIdxState,
      actions: actionsCopy,
      actionIdx: this.actionIdxState,
      economy: this.economy.snapshot(),
    };
  }

  /** 複写から復元する（経済はcfg.economy、未指定ならStub。状態はsnap.economyから入れる）。 */
  static restore(snap: EngineSnapshot, cfg: EngineConfig): Engine {
    const eng = new Engine(
      {
        seed: cfg.seed,
        spec: cfg.spec,
        patterns: cfg.patterns,
        atlas: cfg.atlas,
        initialBalls: 0,
        economy: cfg.economy,
      },
      [],
      [],
    );
    assertTime(snap.nowMs, 'snap.nowMs');
    if (Math.floor(snap.nextBall) !== snap.nextBall || snap.nextBall < 0) {
      throw new Error('invalid engine: snap.nextBall must be a non-negative int');
    }
    if (Math.floor(snap.balls) !== snap.balls) {
      throw new Error('invalid engine: snap.balls must be an int');
    }
    if (Math.floor(snap.medals) !== snap.medals || snap.medals < 0) {
      throw new Error('invalid engine: snap.medals must be a non-negative int');
    }
    assertTime(snap.fuelMs, 'snap.fuelMs');
    eng.nowMsState = snap.nowMs;
    eng.nextBallState = snap.nextBall;
    eng.ballsState = snap.balls;
    eng.medalsState = snap.medals;
    eng.fuelMsState = snap.fuelMs;
    eng.totalsState = { ...snap.totals };
    eng.shootOnState = snap.shootOn;
    eng.shootRateState = snap.shootRate;
    eng.autoShareState = snap.autoShare;
    eng.autoRateState = snap.autoRate;
    eng.fgState = snap.fg;
    eng.queue = new HoldQueue(eng.spec.holdMax);
    for (let i = 0; i < snap.holds.length; i = i + 1) {
      const h = snap.holds[i] as HoldEntry | undefined;
      if (h === undefined) {
        throw new Error('invalid engine: snap.holds is missing an entry');
      }
      if (!eng.queue.tryAdd({ ...h })) {
        throw new Error('invalid engine: snap.holds overflows');
      }
    }
    eng.spins = SpinMachine.restore(eng.spec, eng.patterns, snap.spin);
    eng.pendingState = [];
    for (let i = 0; i < snap.pending.length; i = i + 1) {
      const p = snap.pending[i] as PendingSensor | undefined;
      if (p === undefined) {
        throw new Error('invalid engine: snap.pending is missing an entry');
      }
      eng.pendingState.push({ ...p });
    }
    eng.grantsState = [];
    for (let i = 0; i < snap.grants.length; i = i + 1) {
      const g = snap.grants[i] as Grant | undefined;
      if (g === undefined) {
        throw new Error('invalid engine: snap.grants is missing an entry');
      }
      eng.grantsState.push({ ...g });
    }
    eng.grantIdxState = snap.grantIdx;
    eng.actionsState = [];
    for (let i = 0; i < snap.actions.length; i = i + 1) {
      const a = snap.actions[i] as Action | undefined;
      if (a === undefined) {
        throw new Error('invalid engine: snap.actions is missing an entry');
      }
      eng.actionsState.push({ ...a });
    }
    eng.actionIdxState = snap.actionIdx;
    eng.economy.restore(snap.economy);
    return eng;
  }

  /** 未来を計算する（状態を変えない。入力追加なし・背面を仮定）。 */
  lookahead(until: SimTime): SimEvent[] {
    assertTime(until, 'until');
    if (until < this.nowMsState) {
      throw new Error('invalid engine: until must be >= now');
    }
    const clone = Engine.restore(this.snapshot(), {
      seed: this.seed,
      spec: this.spec,
      patterns: this.patterns,
      atlas: this.atlasBuffer,
      economy: this.economy.fork(),
    });
    clone.fgState = false;
    clone.grantIdxState = clone.grantsState.length;
    clone.actionIdxState = clone.actionsState.length;
    return clone.advance(until);
  }

  /** 現在の投影（UIはこれだけを見る）。 */
  project(): HallProjection {
    return projectSnapshot(this.snapshot(), this.spec, this.patterns);
  }
}
