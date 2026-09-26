/** Engine（パチンコ部。発射600ms・Atlas参照・変動・snapshot/lookahead/project。経済は委譲）。 */
import type { JackpotKind, MachineSpec, PatternTable } from './machine.ts';
import type { HoldEntry, LotteryHoldColor, LotteryMode } from './lottery.ts';
import { drawBonusHold, drawHold } from './lottery.ts';
import { HoldQueue } from './hold-queue.ts';
import { SpinMachine, type SpinSnapshot } from './spin.ts';
import type { SimTime } from './spin.ts';
import { ATLAS_ENTRY_BYTES, ATLAS_HEADER_BYTES, ATLAS_TOTAL_BYTES, atlasKeyForBall, decodeAtlasHeader } from './atlas.ts';
import type { EconomyPort } from './economy.ts';
import type { ShopView } from './economy-state.ts';
import { StubEconomy } from './economy.ts';
import { RNGStream } from './rng.ts';

/** 予告の効果（fever=生産×7・rush=即時出玉・bonus=1/10特別変動）。 */
export type NoticeEffect = 'fever' | 'rush' | 'bonus';

/** 表示中の予告（Engine内部とスナップショット）。 */
export interface ActiveNotice {
  readonly id: number;
  readonly effect: NoticeEffect;
  readonly spawnedAt: SimTime;
  readonly expiresAt: SimTime;
}

/** 予告の表示（HallProjectionがUIに渡す）。 */
export interface NoticeView {
  readonly id: number;
  readonly effect: NoticeEffect;
  readonly expiresAt: SimTime;
}

/** 先読みで見えている最も熱い予定（保留の最大hot）。 */
export interface HotHint {
  readonly entry: number;
  readonly hot: number;
}

/** 留守中サマリー（presence false〜復帰の集計。獲得玉は生産＋払出の合計）。 */
export interface AwaySummary {
  readonly from: SimTime;
  readonly to: SimTime;
  readonly gainedBalls: number;
  readonly jackpots: number;
  readonly maxChain: number;
  readonly maxChainBalls: number;
  readonly fuelEmptyAt: SimTime | null;
  readonly hottestEntry: number | null;
  readonly maxHot: number;
}

/** 営業時間などの付与（spec/30が生成。燃料・メダル・連日を経済に渡す）。 */
export interface Grant {
  readonly claimId: string;
  readonly at: SimTime;
  readonly fuelMs: number;
  readonly medals: number;
  readonly streakDay?: string | undefined;
}

/** 入力（shoot/autoのrateは解放済みのみ・autoは解放後のみshare>0可・noticeTapは表示中のみ）。 */
export type Action =
  | { readonly t: SimTime; readonly k: 'shoot'; readonly on: boolean; readonly rate: number }
  | { readonly t: SimTime; readonly k: 'auto'; readonly share: number; readonly rate: number }
  | { readonly t: SimTime; readonly k: 'presence'; readonly fg: boolean }
  | { readonly t: SimTime; readonly k: 'buy'; readonly target: string; readonly count: number }
  | { readonly t: SimTime; readonly k: 'awaken'; readonly yakumono: string }
  | { readonly t: SimTime; readonly k: 'noticeTap'; readonly noticeId: number }
  | { readonly t: SimTime; readonly k: 'boost'; readonly on: boolean }
  | { readonly t: SimTime; readonly k: 'close' };

/** Engineが出すイベント（P3-T3で予告を追加。経済の毎秒増減はイベントにしない）。 */
export type SimEvent =
  | { readonly k: 'fired'; readonly ball: number; readonly at: SimTime; readonly rate: number }
  | { readonly k: 'sensor'; readonly ball: number; readonly at: SimTime; readonly kind: 'start1' | 'out' | 'lost' }
  | { readonly k: 'holdAdded'; readonly entry: HoldEntry; readonly at: SimTime }
  | { readonly k: 'holdOverflow'; readonly ball: number; readonly at: SimTime }
  | { readonly k: 'spinStarted'; readonly entry: number; readonly at: SimTime; readonly pattern: string; readonly endsAt: SimTime }
  | { readonly k: 'spinResolved'; readonly entry: number; readonly at: SimTime; readonly hit: boolean }
  | { readonly k: 'jackpotStarted'; readonly entry: number; readonly at: SimTime; readonly kind: JackpotKind; readonly rounds: number; readonly bonusRounds?: number | undefined }
  | { readonly k: 'uwanose'; readonly entry: number; readonly at: SimTime; readonly addRounds: number; readonly totalRounds: number }
  | { readonly k: 'jackpotEnded'; readonly entry: number; readonly at: SimTime; readonly payout: number }
  | { readonly k: 'modeChanged'; readonly to: LotteryMode; readonly at: SimTime; readonly stRemaining: number }
  | { readonly k: 'noticeSpawned'; readonly id: number; readonly at: SimTime; readonly effect: NoticeEffect }
  | { readonly k: 'noticeExpired'; readonly id: number; readonly at: SimTime; readonly effect: NoticeEffect }
  | { readonly k: 'granted'; readonly claimId: string; readonly at: SimTime; readonly fuelMs: number; readonly medals: number }
  | { readonly k: 'fuelEmpty'; readonly at: SimTime }
  | { readonly k: 'fuelRefilled'; readonly at: SimTime }
  | { readonly k: 'closed'; readonly at: SimTime; readonly regularPoints: number }
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
  /** 開始時刻（UNIX ms。未指定は0。grant/actionはこれ以降のみ）。 */
  readonly startMs?: SimTime | undefined;
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
  /** RUSH（st/lt）以外からの大当たり。 */
  readonly firstHits: number;
  /** RUSH 中の連チャンの最大（spins.chain の最大）。 */
  readonly maxChain: number;
}

/** 閉店の記録（今回の累計玉と獲得した常連P）。 */
export interface CloseRecord {
  readonly at: SimTime;
  readonly runTotal: number;
  readonly gain: number;
}

/** Engine状態の複写（restoreで復元。入力列・予告・留守集計ごと含む）。 */
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
  readonly noticeSeq: number;
  readonly noticeInFgMs: number;
  readonly activeNotice: ActiveNotice | null;
  readonly away: AwayTrackerSnapshot;
  /** 閉店の記録（古い複写には無い）。 */
  readonly closes?: readonly CloseRecord[] | undefined;
}

/** 留守集計の複写（awayFromがnullなら留守中でない）。 */
export interface AwayTrackerSnapshot {
  readonly awayFrom: SimTime | null;
  readonly awayBalls: number;
  readonly awayFired: number;
  /** 留守中に発射で消費した玉（Σrate）。無ければ totals.fired−awayFired（rate1前提）で読む。 */
  readonly awayConsumed?: number;
  readonly awayJackpots: number;
  readonly awayMaxChain: number;
  readonly awayMaxChainBalls: number;
  readonly awayFuelEmptyAt: SimTime | null;
  readonly awayHottestEntry: number | null;
  readonly awayMaxHot: number;
  readonly lastSummary: AwaySummary | null;
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

/** 役物表示（Lv・覚醒・次の価格・回転位相0..1・実効周期秒。位相と周期は描画用で at 基準。Lv0 は周期なし）。 */
export interface YakumonoView {
  readonly id: string;
  readonly lv: number;
  readonly awakened?: number | undefined;
  readonly nextPrice?: number | undefined;
  readonly phase?: number | undefined;
  readonly periodS?: number | undefined;
}

/** Hall投影（UIはこれだけ見る。経済項目はperSec/boost/yakumono/notice/nextHot/fever）。 */
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
  readonly notice?: NoticeView | undefined;
  readonly nextHot?: HotHint | undefined;
  readonly feverMs: number;
  readonly totals: Totals;
  /** 閉店の記録（古い順）。 */
  readonly closes: readonly CloseRecord[];
  readonly chain: number;
  readonly chainBalls: number;
  /** 前面の「打つ」（on と選択中のレート。UI のトグル表示用）。 */
  readonly shoot: { readonly on: boolean; readonly rate: number };
  /** オート打ち（生産の share を rate で打つ。share 0 は止めている）。 */
  readonly auto: { readonly share: number; readonly rate: number };
  /** 強化画面の表示（経済が IdleEconomy の時だけ）。 */
  readonly shop?: ShopView | undefined;
  /** 解放済みのレート（昇順。経済なしは [1]）。 */
  readonly rates: readonly number[];
}

/** 発射グリッドms（絶対時刻の倍数に揃える）。 */
export const FIRE_INTERVAL_MS = 600;

/** ボーナス保留の通し番号の基数（発射玉と衝突しないよう1e9からnoticeIdを足す）。 */
export const BONUS_SERIAL_BASE = 1000000000;

/** 2^32（予告の当否しきい値用。`**`禁止のため数値リテラル）。 */
const UINT32_RANGE = 4294967296;

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
  const spinSnap = snap.spin as { chain?: number; chainBalls?: number };
  let notice: NoticeView | undefined;
  if (snap.activeNotice !== null && snap.activeNotice !== undefined) {
    const n = snap.activeNotice as ActiveNotice;
    notice = { id: n.id, effect: n.effect, expiresAt: n.expiresAt };
  }
  let nextHot: HotHint | undefined;
  let bestHot = -1;
  let bestEntry = -1;
  for (let i = 0; i < snap.holds.length; i = i + 1) {
    const h = snap.holds[i] as HoldEntry | undefined;
    if (h !== undefined && h.hot > bestHot) {
      bestHot = h.hot;
      bestEntry = h.serial;
    }
  }
  if (bestEntry >= 0) {
    nextHot = { entry: bestEntry, hot: bestHot };
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
    notice,
    nextHot,
    feverMs: 0,
    totals: { ...snap.totals },
    closes: snap.closes === undefined ? [] : snap.closes.slice(),
    chain: spinSnap.chain === undefined ? 0 : spinSnap.chain,
    chainBalls: spinSnap.chainBalls === undefined ? 0 : spinSnap.chainBalls,
    shoot: { on: snap.shootOn, rate: snap.shootRate },
    auto: { share: snap.autoShare, rate: snap.autoRate },
    rates: [1],
  };
}

/** 予告nの前面間隔ms（min+floor(unit*(max-min))。unitはnoticeストリームの1手目）。 */
function noticeIntervalMs(seed: number, n: number, minFgMs: number, maxFgMs: number): number {
  const unit = new RNGStream(seed, 'notice', n).nextUnit();
  return minFgMs + Math.floor(unit * (maxFgMs - minFgMs));
}

/** 予告nの効果（noticeストリームの2手目で重み付け。1手目は間隔で消費済み）。 */
function noticeEffectFor(seed: number, n: number, weights: readonly number[]): NoticeEffect {
  const s = new RNGStream(seed, 'notice', n);
  s.nextUnit();
  const idx = s.pick(weights);
  if (idx === 0) {
    return 'fever';
  }
  if (idx === 1) {
    return 'rush';
  }
  return 'bonus';
}

/** 予告の設定（IdleEconomy.getNoticeConfigの形。Stubなど無い場合はnull）。 */
interface NoticeConfig {
  readonly minFgMs: number;
  readonly maxFgMs: number;
  readonly displayMs: number;
  readonly feverMult: number;
  readonly feverMs: number;
  readonly feverWeight: number;
  readonly rushRate: number;
  readonly rushCapS: number;
  readonly rushWeight: number;
  readonly bonus1In: number;
  readonly bonusWeight: number;
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
  private closesState: CloseRecord[] = [];
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
  private noticeSeqState: number;
  private noticeInFgMsState: number;
  private activeNoticeState: ActiveNotice | null;
  private noticeCfgCache: NoticeConfig | null;
  private nailQCache: number | null;
  private awayFromState: SimTime | null;
  private awayBallsState: number;
  private awayFiredState: number;
  private awayConsumedState: number;
  private awayJackpotsState: number;
  private awayMaxChainState: number;
  private awayMaxChainBallsState: number;
  private awayFuelEmptyAtState: SimTime | null;
  private awayHottestEntryState: number | null;
  private awayMaxHotState: number;
  private lastSummaryState: AwaySummary | null;

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
    if (typeof initialBalls !== 'number' || !Number.isFinite(initialBalls)) {
      throw new Error('invalid engine: initialBalls must be finite');
    }
    if (Math.floor(initialMedals) !== initialMedals || initialMedals < 0) {
      throw new Error('invalid engine: initialMedals must be a non-negative int');
    }
    assertTime(initialFuelMs, 'initialFuelMs');
    const startMs = assertTime(cfg.startMs === undefined ? 0 : cfg.startMs, 'startMs');
    this.seed = cfg.seed >>> 0;
    this.spec = cfg.spec;
    this.patterns = cfg.patterns;
    this.atlasBuffer = cfg.atlas;
    this.atlasView = new DataView(cfg.atlas);
    this.economy = cfg.economy === undefined ? new StubEconomy() : cfg.economy;
    this.nowMsState = startMs;
    this.nextBallState = 0;
    this.ballsState = initialBalls;
    this.medalsState = initialMedals;
    this.fuelMsState = initialFuelMs;
    this.totalsState = { spins: 0, jackpots: 0, fired: 0, payoutBalls: 0, firstHits: 0, maxChain: 0 };
    this.shootOnState = false;
    this.shootRateState = 1;
    this.autoShareState = 0;
    this.autoRateState = 1;
    this.fgState = true;
    this.queue = new HoldQueue(cfg.spec.holdMax);
    this.spins = new SpinMachine(cfg.spec, cfg.patterns, { mode: 'normal', stRemaining: 0, nowMs: startMs });
    this.pendingState = [];
    this.grantsState = [];
    this.grantIdxState = 0;
    this.actionsState = [];
    this.actionIdxState = 0;
    this.noticeSeqState = 0;
    this.activeNoticeState = null;
    this.awayFromState = null;
    this.awayBallsState = initialBalls;
    this.awayFiredState = 0;
    this.awayConsumedState = 0;
    this.awayJackpotsState = 0;
    this.awayMaxChainState = 0;
    this.awayMaxChainBallsState = 0;
    this.awayFuelEmptyAtState = null;
    this.awayHottestEntryState = null;
    this.awayMaxHotState = -1;
    this.lastSummaryState = null;
    this.noticeCfgCache = this.readNoticeConfig();
    this.nailQCache = null;
    if (this.noticeCfgCache === null) {
      this.noticeInFgMsState = MAX_SAFE_MS;
    } else {
      this.noticeInFgMsState = noticeIntervalMs(this.seed, 0, this.noticeCfgCache.minFgMs, this.noticeCfgCache.maxFgMs);
    }
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

  /** 飛行中の玉（発射済み・センサー待ち）の写し。描画が軌跡と入賞先を知るため。 */
  inFlight(): PendingSensor[] {
    const out: PendingSensor[] = [];
    for (let i = 0; i < this.pendingState.length; i = i + 1) {
      out.push({ ...(this.pendingState[i] as PendingSensor) });
    }
    return out;
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
    if (g.streakDay !== undefined && typeof g.streakDay !== 'string') {
      throw new Error('invalid engine: grant.streakDay must be a string');
    }
    if (g.at < this.nowMsState) {
      throw new Error('invalid engine: grant.at must be >= now');
    }
    const last = this.grantsState[this.grantsState.length - 1] as Grant | undefined;
    if (last !== undefined && g.at < last.at) {
      throw new Error('invalid engine: grants must be in time order');
    }
    if (g.streakDay === undefined) {
      this.grantsState.push({ claimId: g.claimId, at: g.at, fuelMs: g.fuelMs, medals: g.medals });
    } else {
      this.grantsState.push({
        claimId: g.claimId,
        at: g.at,
        fuelMs: g.fuelMs,
        medals: g.medals,
        streakDay: g.streakDay,
      });
    }
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
      if (typeof a.target !== 'string' || a.target.length === 0) {
        throw new Error('invalid engine: buy.target must be non-empty');
      }
      if (Math.floor(a.count) !== a.count || a.count < 1) {
        throw new Error('invalid engine: buy.count must be a positive int');
      }
      this.actionsState.push({ t: a.t, k: 'buy', target: a.target, count: a.count });
      return;
    }
    if (a.k === 'awaken') {
      if (typeof a.yakumono !== 'string' || a.yakumono.length === 0) {
        throw new Error('invalid engine: awaken.yakumono must be non-empty');
      }
      this.actionsState.push({ t: a.t, k: 'awaken', yakumono: a.yakumono });
      return;
    }
    if (a.k === 'noticeTap') {
      if (Math.floor(a.noticeId) !== a.noticeId || a.noticeId < 0) {
        throw new Error('invalid engine: noticeTap.noticeId must be a non-negative int');
      }
      this.actionsState.push({ t: a.t, k: 'noticeTap', noticeId: a.noticeId });
      return;
    }
    if (a.k === 'boost') {
      if (typeof a.on !== 'boolean') {
        throw new Error('invalid engine: boost.on must be boolean');
      }
      this.actionsState.push({ t: a.t, k: 'boost', on: a.on });
      return;
    }
    this.actionsState.push({ t: a.t, k: 'close' });
  }

  /** 経済フックを持つか（StubでもIdleEconomyでもなくテスト用でも動くようダックタイピング）。 */
  private econHook<K extends string>(name: K): unknown {
    const e = this.economy as unknown as Record<string, unknown>;
    return e[name];
  }

  /** 予告設定を読む（無い場合はnullで予告なし）。 */
  private readNoticeConfig(): NoticeConfig | null {
    const hook = this.econHook('getNoticeConfig') as (() => NoticeConfig) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return null;
    }
    const c = (hook.bind(this.economy))() as NoticeConfig;
    if (
      typeof c.minFgMs !== 'number' ||
      typeof c.maxFgMs !== 'number' ||
      typeof c.displayMs !== 'number' ||
      c.minFgMs < 0 ||
      c.maxFgMs <= c.minFgMs ||
      c.displayMs <= 0
    ) {
      throw new Error('invalid engine: bad notice config');
    }
    return c;
  }

  /** レートが解放済みか（フック無しは全許可）。 */
  private isRateAllowed(rate: number): boolean {
    const hook = this.econHook('isRateAllowed') as ((rate: number) => boolean) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return true;
    }
    return (hook.bind(this.economy))(rate);
  }

  /** オート打ちが解放済みか（フック無しは許可）。 */
  private isAutoUnlocked(): boolean {
    const hook = this.econHook('isAutoUnlocked') as (() => boolean) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return true;
    }
    return (hook.bind(this.economy))();
  }

  /** 止め打ちの所持か（フック無しはなし）。 */
  private isTomeuchiEnabled(): boolean {
    const hook = this.econHook('isTomeuchiEnabled') as (() => boolean) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return false;
    }
    return (hook.bind(this.economy))();
  }

  /** 釘q（フック無しは0。buy/closeまでキャッシュ）。 */
  private readNailQ(): number {
    if (this.nailQCache !== null) {
      return this.nailQCache;
    }
    const hook = this.econHook('nailQ') as (() => number) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      this.nailQCache = 0;
      return 0;
    }
    const q = (hook.bind(this.economy))() as number;
    if (!(q >= 0 && q <= 1)) {
      throw new Error('invalid engine: bad nail q');
    }
    this.nailQCache = q;
    return q;
  }

  /** 釘qキャッシュを捨てる（購入・閉店・復元時）。 */
  private clearNailQCache(): void {
    this.nailQCache = null;
  }

  /** 変動短縮の倍率（フック無しは1）。 */
  private readShortenMult(): number {
    const hook = this.econHook('shortenMult') as (() => number) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return 1;
    }
    const m = (hook.bind(this.economy))() as number;
    if (!(m > 0 && m <= 1)) {
      throw new Error('invalid engine: bad shorten mult');
    }
    return m;
  }

  /** 実効hold_maxをキューに反映する（フック無しはbase）。 */
  private syncHoldMax(): void {
    const hook = this.econHook('effectiveHoldMax') as ((base: number) => number) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      if (this.queue.max !== this.spec.holdMax) {
        this.queue.setMax(this.spec.holdMax);
      }
      return;
    }
    const want = (hook.bind(this.economy))(this.spec.holdMax) as number;
    if (want !== this.queue.max) {
      this.queue.setMax(want);
    }
  }

  /** 次の1000msグリッド（curより大きい最小の1000倍数）。 */
  private static nextEconomyTick(cur: SimTime): SimTime {
    const rem = cur - Math.floor(cur / 1000) * 1000;
    return cur + 1000 - rem;
  }

  /** 次に処理する時刻（入力・発射・センサー・変動・上乗せ・大当たり・予告出現/期限・経済1000msの最小値。なければto）。 */
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
    const nt = Engine.nextEconomyTick(cur);
    if (nt < nxt) {
      nxt = nt;
    }
    if (this.activeNoticeState !== null && this.activeNoticeState.expiresAt > cur && this.activeNoticeState.expiresAt < nxt) {
      nxt = this.activeNoticeState.expiresAt;
    }
    if (this.activeNoticeState === null && this.fgState && this.noticeInFgMsState < MAX_SAFE_MS) {
      const spawnAt = cur + this.noticeInFgMsState;
      if (spawnAt > cur && spawnAt < nxt) {
        nxt = spawnAt;
      }
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
      const uwAt = this.spins.uwanoseAt;
      if (uwAt !== null && uwAt > cur && uwAt < nxt) {
        nxt = uwAt;
      }
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
    let prev = cur;
    let prevFg = this.fgState;
    while (cur < to) {
      this.accountFgTime(prev, cur, prevFg);
      this.applyInputsAt(cur, out);
      this.applyFiringAt(cur, out);
      this.applySensorsAt(cur, out);
      this.applySpinAt(cur, out);
      this.applyNoticeAt(cur, out);
      this.applyEconomyTickAt(cur, out);
      prev = cur;
      prevFg = this.fgState;
      cur = this.nextEventTime(cur, to);
    }
    this.accountFgTime(prev, to, prevFg);
    this.nowMsState = to;
    return out;
  }

  /** 前面時間を予告タイマーに加算する（区間[prev, cur)のfgで減算。発動はapplyNoticeAt）。 */
  private accountFgTime(prev: SimTime, cur: SimTime, fg: boolean): void {
    if (cur <= prev || !fg || this.activeNoticeState !== null) {
      return;
    }
    if (this.noticeInFgMsState >= MAX_SAFE_MS) {
      return;
    }
    const elapsed = cur - prev;
    if (elapsed >= this.noticeInFgMsState) {
      this.noticeInFgMsState = 0;
    } else {
      this.noticeInFgMsState = this.noticeInFgMsState - elapsed;
    }
  }

  /** 同時刻のgrant/actionを適用する（経済付きは上限・検証を委譲）。 */
  private applyInputsAt(at: SimTime, out: SimEvent[]): void {
    while (true) {
      const g = this.grantsState[this.grantIdxState] as Grant | undefined;
      if (g === undefined || g.at !== at) {
        break;
      }
      this.grantIdxState = this.grantIdxState + 1;
      const hook = this.econHook('onGrant') as
        | ((
        fuelMs: number,
        medals: number,
        streakDay: string | undefined,
        curFuelMs: number,
        curMedals: number,
      ) => { fuelMs: number; medals: number; fuelRefilled: boolean })
        | undefined;
      if (hook !== undefined && typeof hook === 'function') {
        const bound = hook.bind(this.economy);
        const r = bound(g.fuelMs, g.medals, g.streakDay, this.fuelMsState, this.medalsState);
        this.fuelMsState = r.fuelMs;
        this.medalsState = r.medals;
        out.push({ k: 'granted', claimId: g.claimId, at, fuelMs: g.fuelMs, medals: g.medals });
        if (r.fuelRefilled) {
          out.push({ k: 'fuelRefilled', at });
        }
      } else {
        this.fuelMsState = this.fuelMsState + g.fuelMs;
        this.medalsState = this.medalsState + g.medals;
        out.push({ k: 'granted', claimId: g.claimId, at, fuelMs: g.fuelMs, medals: g.medals });
      }
    }
    while (true) {
      const a = this.actionsState[this.actionIdxState] as Action | undefined;
      if (a === undefined || a.t !== at) {
        break;
      }
      this.actionIdxState = this.actionIdxState + 1;
      if (a.k === 'shoot') {
        if (!this.isRateAllowed(a.rate)) {
          out.push({ k: 'rejected', at, action: a.k, reason: 'locked-rate' });
        } else {
          this.shootOnState = a.on;
          this.shootRateState = a.rate;
        }
      } else if (a.k === 'auto') {
        if (!this.isRateAllowed(a.rate)) {
          out.push({ k: 'rejected', at, action: a.k, reason: 'locked-rate' });
        } else if (a.share > 0 && !this.isAutoUnlocked()) {
          out.push({ k: 'rejected', at, action: a.k, reason: 'locked' });
        } else {
          this.autoShareState = a.share;
          this.autoRateState = a.rate;
        }
      } else if (a.k === 'presence') {
        if (a.fg === this.fgState) {
          continue;
        }
        this.fgState = a.fg;
        if (!a.fg) {
          this.startAway(at);
        } else {
          this.finishAway(at);
        }
      } else if (a.k === 'buy') {
        const hook = this.econHook('onBuy') as
          | ((target: string, count: number, balls: number, medals: number) =>
          | { ok: true; balls: number; medals: number }
          | { ok: false; reason: string })
          | undefined;
        if (hook === undefined || typeof hook !== 'function') {
          out.push({ k: 'rejected', at, action: a.k, reason: 'not-implemented' });
        } else {
          const r = (hook.bind(this.economy))(a.target, a.count, this.ballsState, this.medalsState);
          if (r.ok) {
            this.ballsState = r.balls;
            this.medalsState = r.medals;
            this.syncHoldMax();
            this.clearNailQCache();
          } else {
            out.push({ k: 'rejected', at, action: a.k, reason: r.reason });
          }
        }
      } else if (a.k === 'awaken') {
        const hook = this.econHook('onAwaken') as
          | ((id: string, medals: number) => { ok: true; medals: number } | { ok: false; reason: string })
          | undefined;
        if (hook === undefined || typeof hook !== 'function') {
          out.push({ k: 'rejected', at, action: a.k, reason: 'not-implemented' });
        } else {
          const r = (hook.bind(this.economy))(a.yakumono, this.medalsState);
          if (r.ok) {
            this.medalsState = r.medals;
          } else {
            out.push({ k: 'rejected', at, action: a.k, reason: r.reason });
          }
        }
      } else if (a.k === 'noticeTap') {
        this.applyNoticeTapAt(at, a.noticeId, out);
      } else if (a.k === 'boost') {
        const hook = this.econHook('onBoost') as ((on: boolean) => void) | undefined;
        if (hook === undefined || typeof hook !== 'function') {
          out.push({ k: 'rejected', at, action: a.k, reason: 'not-implemented' });
        } else {
          (hook.bind(this.economy))(a.on);
        }
      } else if (a.k === 'close') {
        const hook = this.econHook('onClose') as
          | ((balls: number) => { ok: true; balls: number; gain: number } | { ok: false; reason: string })
          | undefined;
        if (hook === undefined || typeof hook !== 'function') {
          out.push({ k: 'rejected', at, action: a.k, reason: 'not-implemented' });
        } else {
          const runHook = this.econHook('getRunTotal') as (() => number) | undefined;
          const runTotal = runHook !== undefined && typeof runHook === 'function' ? (runHook.bind(this.economy))() : 0;
          const r = (hook.bind(this.economy))(this.ballsState);
          if (r.ok) {
            this.ballsState = r.balls;
            this.closesState.push({ at, runTotal, gain: r.gain });
            out.push({ k: 'closed', at, regularPoints: r.gain });
            this.syncHoldMax();
            this.clearNailQCache();
          } else {
            out.push({ k: 'rejected', at, action: a.k, reason: r.reason });
          }
        }
      } else {
        const unknownKind = (a as Action).k;
        out.push({ k: 'rejected', at, action: unknownKind, reason: 'not-implemented' });
      }
    }
  }

  /** 留守を開始する（presence false時。集計の起点を記録）。 */
  private startAway(at: SimTime): void {
    this.awayFromState = at;
    this.awayBallsState = this.ballsState;
    this.awayFiredState = this.totalsState.fired;
    this.awayConsumedState = 0;
    this.awayJackpotsState = this.totalsState.jackpots;
    this.awayMaxChainState = 0;
    this.awayMaxChainBallsState = 0;
    this.awayFuelEmptyAtState = null;
    this.awayHottestEntryState = null;
    this.awayMaxHotState = -1;
  }

  /** 留守を終える（presence true時。集計をlastSummaryに保存）。 */
  private finishAway(at: SimTime): void {
    if (this.awayFromState === null) {
      return;
    }
    const from = this.awayFromState;
    const gained = this.ballsState - this.awayBallsState + this.awayConsumedState;
    this.lastSummaryState = {
      from,
      to: at,
      gainedBalls: gained,
      jackpots: this.totalsState.jackpots - this.awayJackpotsState,
      maxChain: this.awayMaxChainState,
      maxChainBalls: this.awayMaxChainBallsState,
      fuelEmptyAt: this.awayFuelEmptyAtState,
      hottestEntry: this.awayHottestEntryState,
      maxHot: this.awayMaxHotState < 0 ? 0 : this.awayMaxHotState,
    };
    this.awayFromState = null;
  }

  /** 留守中の当たり・熱さ・燃料切れを更新する。 */
  private noteAwayJackpot(): void {
    if (this.awayFromState === null) {
      return;
    }
    if (this.spins.chain > this.awayMaxChainState) {
      this.awayMaxChainState = this.spins.chain;
    }
    if (this.spins.chainBalls > this.awayMaxChainBallsState) {
      this.awayMaxChainBallsState = this.spins.chainBalls;
    }
  }

  /** 留守中の保留の熱さを更新する。 */
  private noteAwayHot(entrySerial: number, hot: number): void {
    if (this.awayFromState === null) {
      return;
    }
    if (hot > this.awayMaxHotState) {
      this.awayMaxHotState = hot;
      this.awayHottestEntryState = entrySerial;
    }
  }

  /** 留守中の燃料切れを更新する（最初の1回のみ）。 */
  private noteAwayFuelEmpty(at: SimTime): void {
    if (this.awayFromState === null) {
      return;
    }
    if (this.awayFuelEmptyAtState === null) {
      this.awayFuelEmptyAtState = at;
    }
  }

  /** 直近の留守中サマリー（presence復帰後にUIが読む。無ければnull）。 */
  awaySummary(): AwaySummary | null {
    return this.lastSummaryState;
  }

  /** 予告タップを検証・適用する（成功は無音、失敗はrejected）。 */
  private applyNoticeTapAt(at: SimTime, noticeId: number, out: SimEvent[]): void {
    const active = this.activeNoticeState;
    if (active === null || active.id !== noticeId) {
      out.push({ k: 'rejected', at, action: 'noticeTap', reason: 'not-found' });
      return;
    }
    if (!this.fgState) {
      out.push({ k: 'rejected', at, action: 'noticeTap', reason: 'not-foreground' });
      return;
    }
    if (at > active.expiresAt) {
      out.push({ k: 'rejected', at, action: 'noticeTap', reason: 'expired' });
      return;
    }
    const effect = active.effect;
    this.activeNoticeState = null;
    this.scheduleNextNotice();
    if (effect === 'fever') {
      const hook = this.econHook('onNoticeFever') as (() => void) | undefined;
      if (hook !== undefined && typeof hook === 'function') {
        (hook.bind(this.economy))();
      }
    } else if (effect === 'rush') {
      const cfg = this.noticeCfgCache;
      if (cfg !== null) {
        const perSecHook = this.econHook('getPerSec') as
          | ((fg: boolean, fuelMs: number) => number)
          | undefined;
        let perSec = 0;
        if (perSecHook !== undefined && typeof perSecHook === 'function') {
          perSec = (perSecHook.bind(this.economy))(this.fgState, this.fuelMsState);
        }
        const byBalls = this.ballsState * cfg.rushRate;
        const cap = perSec * cfg.rushCapS;
        const gain = byBalls < cap ? byBalls : cap;
        if (gain > 0) {
          this.ballsState = this.ballsState + gain;
          this.noteEconomyGain(gain);
        }
      }
    } else {
      const cfg = this.noticeCfgCache;
      if (cfg !== null) {
        const weights = [cfg.feverWeight, cfg.rushWeight, cfg.bonusWeight];
        const serial = BONUS_SERIAL_BASE + active.id;
        if (serial < MAX_SAFE_MS) {
          const entry = drawBonusHold(
            this.spec,
            this.patterns,
            this.seed,
            this.spins.mode,
            active.id,
            serial,
            cfg.bonus1In,
            weights,
          );
          this.ballsState = this.ballsState + entry.hesoPayoutBalls;
          this.totalsState = {
            ...this.totalsState,
            spins: this.totalsState.spins,
            jackpots: this.totalsState.jackpots,
            fired: this.totalsState.fired,
            payoutBalls: this.totalsState.payoutBalls + entry.hesoPayoutBalls,
          };
          this.noteEconomyGain(entry.hesoPayoutBalls);
          this.noteAwayHot(entry.serial, entry.hot);
          if (this.queue.tryAdd(entry)) {
            out.push({ k: 'holdAdded', entry, at });
          } else {
            out.push({ k: 'holdOverflow', ball: entry.serial, at });
          }
        }
      }
    }
  }

  /** 次の予告までの前面msを決める（noticeSeqを進める）。 */
  private scheduleNextNotice(): void {
    const cfg = this.noticeCfgCache;
    if (cfg === null) {
      this.noticeSeqState = this.noticeSeqState + 1;
      this.noticeInFgMsState = MAX_SAFE_MS;
      return;
    }
    this.noticeSeqState = this.noticeSeqState + 1;
    this.noticeInFgMsState = noticeIntervalMs(this.seed, this.noticeSeqState, cfg.minFgMs, cfg.maxFgMs);
  }

  /** 予告の出現・期限切れ（前面加算が尽きたら出現、期限が来たら失効）。 */
  private applyNoticeAt(at: SimTime, out: SimEvent[]): void {
    const cfg = this.noticeCfgCache;
    if (cfg === null) {
      return;
    }
    if (this.activeNoticeState !== null) {
      if (at >= this.activeNoticeState.expiresAt) {
        const expired = this.activeNoticeState;
        this.activeNoticeState = null;
        this.scheduleNextNotice();
        out.push({ k: 'noticeExpired', id: expired.id, at: expired.expiresAt, effect: expired.effect });
      }
      return;
    }
    if (!this.fgState || this.noticeInFgMsState > 0) {
      return;
    }
    const id = this.noticeSeqState;
    const weights = [cfg.feverWeight, cfg.rushWeight, cfg.bonusWeight];
    const effect = noticeEffectFor(this.seed, id, weights);
    const expiresAt = at + cfg.displayMs;
    if (expiresAt >= MAX_SAFE_MS) {
      this.scheduleNextNotice();
      return;
    }
    this.activeNoticeState = { id, effect, spawnedAt: at, expiresAt };
    out.push({ k: 'noticeSpawned', id, at, effect });
  }

  /** 1000msグリッドの経済生産（グリッド時刻の状態で続く1秒分を先払い。advanceの区切りに依らない）。 */
  private applyEconomyTickAt(cur: SimTime, out: SimEvent[]): void {
    const rem = cur - Math.floor(cur / 1000) * 1000;
    if (rem !== 0) {
      return;
    }
    const hook = this.econHook('onTick') as
      | ((fg: boolean, fuelMs: number) => { ballGain: number; fuelMs: number; fuelBecameEmpty: boolean })
      | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return;
    }
    const r = (hook.bind(this.economy))(this.fgState, this.fuelMsState);
    if (r.ballGain !== 0) {
      this.ballsState = this.ballsState + r.ballGain;
    }
    this.fuelMsState = r.fuelMs;
    if (r.fuelBecameEmpty) {
      out.push({ k: 'fuelEmpty', at: cur });
      this.noteAwayFuelEmpty(cur);
    }
  }

  /** 経済tickを持つか（Stubは燃料を消費しないためオートの燃料判定をしない）。 */
  private hasEconomyTick(): boolean {
    const hook = this.econHook('onTick');
    return hook !== undefined && typeof hook === 'function';
  }

  /** 大当たりフィーバーの開始（打ったレート）・終了（null）を経済に伝える。 */
  private setJackpotFever(rate: number | null): void {
    const hook = this.econHook('onJackpotFever') as ((rate: number | null) => void) | undefined;
    if (hook !== undefined && typeof hook === 'function') {
      (hook.bind(this.economy))(rate);
    }
  }

  /** 外部獲得（ヘソ・大当たり）を経済の累計に足す。 */
  private noteEconomyGain(amount: number): void {
    if (!(amount > 0)) {
      return;
    }
    const hook = this.econHook('noteGain') as ((amount: number) => void) | undefined;
    if (hook !== undefined && typeof hook === 'function') {
      (hook.bind(this.economy))(amount);
    }
  }

  /** 同時刻の発射（600ms倍数のみ。前面shoot優先・autoはshare間引き・燃料0/止め打ち満タン/持ち玉<rateで停止・釘でout→start1・1発rate玉）。 */
  private applyFiringAt(at: SimTime, out: SimEvent[]): void {
    const rem = at - Math.floor(at / FIRE_INTERVAL_MS) * FIRE_INTERVAL_MS;
    if (rem !== 0) {
      return;
    }
    let rate = -1;
    if (this.fgState && this.shootOnState) {
      rate = this.shootRateState;
    } else if (this.autoShareState > 0 && this.isAutoUnlocked()) {
      if (this.isTomeuchiEnabled() && this.queue.isFull()) {
        return;
      }
      if (this.fuelMsState <= 0 && this.hasEconomyTick()) {
        return;
      }
      const n = Math.floor(at / FIRE_INTERVAL_MS);
      if (Math.floor(n * this.autoShareState) !== Math.floor((n - 1) * this.autoShareState)) {
        rate = this.autoRateState;
      }
    }
    if (rate < 1 || this.ballsState < rate) {
      return;
    }
    const ball = this.nextBallState;
    this.nextBallState = ball + 1;
    this.ballsState = this.ballsState - rate;
    if (this.awayFromState !== null) {
      this.awayConsumedState = this.awayConsumedState + rate;
    }
    this.totalsState = {
      ...this.totalsState,
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
    let kind = found.kind;
    if (kind === 'out') {
      const q = this.readNailQ();
      if (q > 0) {
        const rng = new RNGStream(this.seed, 'launch', ball);
        rng.nextU32();
        const second = rng.nextU32() / UINT32_RANGE;
        if (second < q) {
          kind = 'start1';
        }
      }
    }
    this.pendingState.push({ ball, fireAt: at, sensorAt: at + found.flightMs, kind, rate });
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
        ...this.totalsState,
        spins: this.totalsState.spins,
        jackpots: this.totalsState.jackpots,
        fired: this.totalsState.fired,
        payoutBalls: this.totalsState.payoutBalls + entry.hesoPayoutBalls,
      };
      this.noteEconomyGain(entry.hesoPayoutBalls);
      this.noteAwayHot(entry.serial, entry.hot);
      if (this.queue.tryAdd(entry)) {
        out.push({ k: 'holdAdded', entry, at });
      } else {
        out.push({ k: 'holdOverflow', ball: h.ball, at });
      }
    }
  }

  /** 同時刻の変動・大当たり・開始（resolve→jackpot*（uwanose含む）→spinStarted→modeの順）。 */
  private applySpinAt(at: SimTime, out: SimEvent[]): void {
    let deferredMode: SimEvent | null = null;
    if (this.spins.isSpinning) {
      const endsAt = this.spins.activeEndsAt as SimTime | null;
      if (endsAt !== null && endsAt === at) {
        const fromRush = this.spins.mode === 'st' || this.spins.mode === 'lt';
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
                ...this.totalsState,
                spins: this.totalsState.spins,
                jackpots: this.totalsState.jackpots + 1,
                fired: this.totalsState.fired,
                payoutBalls: this.totalsState.payoutBalls,
                firstHits: this.totalsState.firstHits + (fromRush ? 0 : 1),
              };
              this.setJackpotFever(this.spins.jackpotRate);
            }
            out.push(e);
          }
        }
      }
    }
    if (this.spins.isInJackpot) {
      const uwAt = this.spins.uwanoseAt;
      if (uwAt !== null && uwAt === at) {
        const uw = this.spins.emitUwanose(at);
        for (let i = 0; i < uw.length; i = i + 1) {
          const e = uw[i] as (typeof uw)[number] | undefined;
          if (e !== undefined) {
            out.push(e);
          }
        }
      }
      const endsAt = this.spins.jackpotEndsAt as SimTime | null;
      if (endsAt !== null && endsAt === at) {
        const evs = this.spins.finishJackpot(at, this.spins.jackpotRate as number);
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
              this.setJackpotFever(null);
              this.totalsState = {
                ...this.totalsState,
                spins: this.totalsState.spins,
                jackpots: this.totalsState.jackpots,
                fired: this.totalsState.fired,
                payoutBalls: this.totalsState.payoutBalls + e.payout,
                maxChain: this.spins.chain > this.totalsState.maxChain ? this.spins.chain : this.totalsState.maxChain,
              };
              this.noteEconomyGain(e.payout);
              this.noteAwayJackpot();
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
        const evs = this.spins.startSpin(entry, at, holdCount, this.readShortenMult());
        for (let i = 0; i < evs.length; i = i + 1) {
          const e = evs[i] as (typeof evs)[number] | undefined;
          if (e === undefined) {
            continue;
          }
          out.push(e);
        }
        this.totalsState = {
          ...this.totalsState,
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
    const activeCopy = this.activeNoticeState === null ? null : { ...this.activeNoticeState };
    const lastCopy = this.lastSummaryState === null ? null : { ...this.lastSummaryState };
    return {
      nowMs: this.nowMsState,
      nextBall: this.nextBallState,
      balls: this.ballsState,
      medals: this.medalsState,
      fuelMs: this.fuelMsState,
      totals: { ...this.totalsState },
      closes: this.closesState.slice(),
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
      noticeSeq: this.noticeSeqState,
      noticeInFgMs: this.noticeInFgMsState,
      activeNotice: activeCopy,
      away: {
        awayFrom: this.awayFromState,
        awayBalls: this.awayBallsState,
        awayFired: this.awayFiredState,
        awayConsumed: this.awayConsumedState,
        awayJackpots: this.awayJackpotsState,
        awayMaxChain: this.awayMaxChainState,
        awayMaxChainBalls: this.awayMaxChainBallsState,
        awayFuelEmptyAt: this.awayFuelEmptyAtState,
        awayHottestEntry: this.awayHottestEntryState,
        awayMaxHot: this.awayMaxHotState,
        lastSummary: lastCopy,
      },
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
    if (typeof snap.balls !== 'number' || !Number.isFinite(snap.balls)) {
      throw new Error('invalid engine: snap.balls must be finite');
    }
    if (Math.floor(snap.medals) !== snap.medals || snap.medals < 0) {
      throw new Error('invalid engine: snap.medals must be a non-negative int');
    }
    assertTime(snap.fuelMs, 'snap.fuelMs');
    if (Math.floor(snap.noticeSeq) !== snap.noticeSeq || snap.noticeSeq < 0) {
      throw new Error('invalid engine: snap.noticeSeq must be a non-negative int');
    }
    if (typeof snap.noticeInFgMs !== 'number' || !Number.isFinite(snap.noticeInFgMs) || snap.noticeInFgMs < 0) {
      throw new Error('invalid engine: snap.noticeInFgMs must be finite >= 0');
    }
    if (snap.activeNotice !== null) {
      const n = snap.activeNotice;
      assertTime(n.spawnedAt, 'snap.activeNotice.spawnedAt');
      assertTime(n.expiresAt, 'snap.activeNotice.expiresAt');
      if (Math.floor(n.id) !== n.id || n.id < 0) {
        throw new Error('invalid engine: snap.activeNotice.id must be a non-negative int');
      }
      if (n.effect !== 'fever' && n.effect !== 'rush' && n.effect !== 'bonus') {
        throw new Error('invalid engine: snap.activeNotice.effect unknown');
      }
      if (n.expiresAt <= n.spawnedAt) {
        throw new Error('invalid engine: snap.activeNotice expiresAt must be > spawnedAt');
      }
    }
    const away = snap.away;
    if (away === undefined || away === null || typeof away !== 'object') {
      throw new Error('invalid engine: snap.away is missing');
    }
    if (away.awayFrom !== null) {
      assertTime(away.awayFrom, 'snap.away.awayFrom');
    }
    if (away.awayConsumed !== undefined && (typeof away.awayConsumed !== 'number' || !Number.isFinite(away.awayConsumed) || away.awayConsumed < 0)) {
      throw new Error('invalid engine: snap.away.awayConsumed must be finite >= 0');
    }
    if (away.awayFuelEmptyAt !== null) {
      assertTime(away.awayFuelEmptyAt, 'snap.away.awayFuelEmptyAt');
    }
    if (away.lastSummary !== null) {
      assertTime(away.lastSummary.from, 'snap.away.lastSummary.from');
      assertTime(away.lastSummary.to, 'snap.away.lastSummary.to');
    }
    eng.nowMsState = snap.nowMs;
    eng.nextBallState = snap.nextBall;
    eng.ballsState = snap.balls;
    eng.medalsState = snap.medals;
    eng.fuelMsState = snap.fuelMs;
    const oldTotals = snap.totals as Partial<Totals>;
    eng.closesState = snap.closes === undefined ? [] : snap.closes.slice();
    eng.totalsState = {
      ...snap.totals,
      firstHits: oldTotals.firstHits === undefined ? 0 : oldTotals.firstHits,
      maxChain: oldTotals.maxChain === undefined ? 0 : oldTotals.maxChain,
    };
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
    eng.noticeCfgCache = eng.readNoticeConfig();
    eng.nailQCache = null;
    eng.noticeSeqState = snap.noticeSeq;
    eng.noticeInFgMsState = snap.noticeInFgMs;
    eng.activeNoticeState = snap.activeNotice === null ? null : { ...snap.activeNotice };
    eng.awayFromState = away.awayFrom;
    eng.awayBallsState = away.awayBalls;
    eng.awayFiredState = away.awayFired;
    eng.awayConsumedState = away.awayConsumed === undefined
      ? (away.awayFrom === null ? 0 : snap.totals.fired - away.awayFired)
      : away.awayConsumed;
    eng.awayJackpotsState = away.awayJackpots;
    eng.awayMaxChainState = away.awayMaxChain;
    eng.awayMaxChainBallsState = away.awayMaxChainBalls;
    eng.awayFuelEmptyAtState = away.awayFuelEmptyAt;
    eng.awayHottestEntryState = away.awayHottestEntry;
    eng.awayMaxHotState = away.awayMaxHot;
    eng.lastSummaryState = away.lastSummary === null ? null : { ...away.lastSummary };
    eng.syncHoldMax();
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

  /** 現在の投影（UIはこれだけを見る。経済付きはperSec・boost・役物・フィーバーを上乗せ）。 */
  project(): HallProjection {
    const snapBase = projectSnapshot(this.snapshot(), this.spec, this.patterns);
    const ratesHook = this.econHook('getUnlockedRates') as (() => number[]) | undefined;
    const base = ratesHook !== undefined && typeof ratesHook === 'function'
      ? { ...snapBase, rates: (ratesHook.bind(this.economy))() }
      : snapBase;
    const perSecHook = this.econHook('getPerSec') as
      | ((fg: boolean, fuelMs: number) => number)
      | undefined;
    const boostHook = this.econHook('getBoostMs') as (() => number) | undefined;
    const yakuHook = this.econHook('getYakumonoViews') as
      | (() => Array<{ id: string; lv: number; awakened: number; nextPrice: number }>)
      | undefined;
    const feverHook = this.econHook('getFeverMs') as (() => number) | undefined;
    const shopHook = this.econHook('getShopView') as (() => ShopView) | undefined;
    const shop = shopHook !== undefined && typeof shopHook === 'function' ? (shopHook.bind(this.economy))() : undefined;
    if (
      perSecHook === undefined ||
      boostHook === undefined ||
      yakuHook === undefined ||
      typeof perSecHook !== 'function' ||
      typeof boostHook !== 'function' ||
      typeof yakuHook !== 'function'
    ) {
      const feverMs = feverHook !== undefined && typeof feverHook === 'function'
        ? (feverHook.bind(this.economy))() as number
        : 0;
      return { ...base, feverMs, shop };
    }
    const perSec = (perSecHook.bind(this.economy))(this.fgState, this.fuelMsState);
    const boostMs = (boostHook.bind(this.economy))();
    const feverMs = feverHook !== undefined && typeof feverHook === 'function'
      ? (feverHook.bind(this.economy))() as number
      : 0;
    const views = (yakuHook.bind(this.economy))();
    const yakumono: YakumonoView[] = [];
    for (let i = 0; i < views.length; i = i + 1) {
      const v = views[i] as { id: string; lv: number; awakened: number; nextPrice: number };
      const periodS = this.yakumonoPeriodS(v.id, v.lv);
      const x = periodS > 0 ? this.nowMsState / 1000 / periodS : 0;
      yakumono.push({ id: v.id, lv: v.lv, awakened: v.awakened, nextPrice: v.nextPrice, phase: x - Math.floor(x), periodS: periodS > 0 ? periodS : undefined });
    }
    return { ...base, perSec, boostMs, yakumono, feverMs, shop };
  }

  /** 役物の実効周期秒（Lv0・経済なしは0）。 */
  private yakumonoPeriodS(id: string, lv: number): number {
    if (lv <= 0) {
      return 0;
    }
    const yakHook = this.econHook('effectivePeriodSFor') as
      | ((yakumonoId: string, yakumonoLv: number) => number)
      | undefined;
    if (yakHook === undefined || typeof yakHook !== 'function') {
      return 0;
    }
    const period = (yakHook.bind(this.economy))(id, lv) as number;
    return period > 0 ? period : 0;
  }
}
