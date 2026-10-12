/** Engine（パチンコ部。発射600ms・Atlas参照・変動・snapshot/lookahead/project。経済は委譲）。 */
import type { JackpotKind, MachineSpec, PatternTable } from './machine.ts';
import type { HoldEntry, LotteryHoldColor, LotteryMode } from './lottery.ts';
import { drawBonusHold, drawGrantHold, drawHold } from './lottery.ts';
import { HoldQueue } from './hold-queue.ts';
import { SpinMachine, type SpinSnapshot } from './spin.ts';
import type { SimTime } from './spin.ts';
import { ATLAS_ENTRY_BYTES, ATLAS_HEADER_BYTES, ATLAS_TOTAL_BYTES, atlasKeyForBall, decodeAtlasHeader } from './atlas.ts';
import type { EconomyPort } from './economy.ts';
import type { AchievementsView, EngineAchievementMetrics, ShopView } from './economy-state.ts';
import type { TreeView } from './tree-state.ts';
import { StubEconomy } from './economy.ts';
import { addAmount } from './economy-math.ts';
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

/** 留守中に変動を始めた当たりの1つ（復帰後に演出をリプレイする材料。値は Engine のイベントそのもの）。 */
export interface AwayReplay {
  readonly entry: number;
  readonly pattern: string;
  readonly color: LotteryHoldColor;
  readonly hot: number;
  readonly startedAt: SimTime;
  readonly endsAt: SimTime;
  readonly kind: JackpotKind;
  readonly rounds: number;
}

/** 変動を始めた当たり（大当たり開始でリプレイ候補に上げる）。 */
export type AwaySpinCandidate = Omit<AwayReplay, 'kind' | 'rounds'>;

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
  /** 留守中に変動を始めて大当たりになった中で最も熱いもの（hot 最大・同点は先）。無ければ null。 */
  readonly replay: AwayReplay | null;
  /** 留守中に達成した実績の数（旧版の複写には無いので 0, spec/24）。 */
  readonly achievements: number;
}

/** 営業時間などの付与（spec/30が生成。燃料・メダル・連日を経済に渡す）。 */
export interface Grant {
  readonly claimId: string;
  readonly at: SimTime;
  readonly fuelMs: number;
  readonly medals: number;
  readonly streakDay?: string | undefined;
  /** 即時の玉 = refPerSec × prodMin × 60（spec/23, D-081。省略は0）。 */
  readonly prodMin?: number | undefined;
  /** 特別保留の数（整数。省略は0, D-081）。 */
  readonly bonusHolds?: number | undefined;
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
  | { readonly t: SimTime; readonly k: 'close' }
  /** 常連ツリーのノードを買う（rejected: unknown-node・owned・tier-locked・locked・insufficient-points, spec/25）。 */
  | { readonly t: SimTime; readonly k: 'treeBuy'; readonly node: string }
  /** 番頭さんの ON/OFF（未所持は rejected 'not-owned', spec/25）。 */
  | { readonly t: SimTime; readonly k: 'bantou'; readonly on: boolean };

/** Engineが出すイベント（P3-T3で予告を追加。経済の毎秒増減はイベントにしない）。 */
export type SimEvent =
  | { readonly k: 'fired'; readonly ball: number; readonly at: SimTime; readonly rate: number; readonly unit?: number | undefined }
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
  | { readonly k: 'granted'; readonly claimId: string; readonly at: SimTime; readonly fuelMs: number; readonly medals: number; readonly balls?: number | undefined; readonly bonusHolds?: number | undefined }
  | { readonly k: 'fuelEmpty'; readonly at: SimTime }
  | { readonly k: 'fuelRefilled'; readonly at: SimTime }
  | { readonly k: 'closed'; readonly at: SimTime; readonly regularPoints: number; readonly points?: number | undefined } // points は今回得た常連P（0 は省略, spec/25）
  | { readonly k: 'rejected'; readonly at: SimTime; readonly action: Action['k']; readonly reason: string }
  | { readonly k: 'achieved'; readonly id: string; readonly at: SimTime };

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

/** 飛行中の玉（発射済み・センサー待ち。unit は発射時の単価。旧セーブには無い, D-090）。 */
export interface PendingSensor {
  readonly ball: number;
  readonly fireAt: SimTime;
  readonly sensorAt: SimTime;
  readonly kind: 'start1' | 'out' | 'lost';
  readonly rate: number;
  readonly unit?: number | undefined;
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
  /** 次の自動保留の通し番号（古い複写には無い。無い時はRESERVE_SERIAL_BASEから）。 */
  readonly nextReserve?: number | undefined;
  /** 特別保留のストック数（古い複写には無い。無い時は0, D-081）。 */
  readonly bonusStock?: number | undefined;
  /** 特別保留の通し番号n（次に出すn。古い複写には無い。無い時は0, D-081）。 */
  readonly grantHoldSeq?: number | undefined;
  /** オート打ちの投入額の蓄積（生産×share を unit で割る余り。無い旧複写は0, D-090）。 */
  readonly autoAcc?: number | undefined;
}

/** 留守集計の複写（awayFromがnullなら留守中でない）。 */
export interface AwayTrackerSnapshot {
  readonly awayFrom: SimTime | null;
  readonly awayBalls: number;
  readonly awayFired: number;
  /** 留守中に発射と番頭さんで使った玉（Σunit。旧はΣrate）。無ければ totals.fired−awayFired（rate1前提）で読む。 */
  readonly awayConsumed?: number;
  readonly awayJackpots: number;
  readonly awayMaxChain: number;
  readonly awayMaxChainBalls: number;
  readonly awayFuelEmptyAt: SimTime | null;
  readonly awayHottestEntry: number | null;
  readonly awayMaxHot: number;
  /** 変動中の当たり（留守中に始まったもの）。旧版の複写には無い。 */
  readonly awaySpinCand?: AwaySpinCandidate | null;
  /** リプレイ候補。旧版の複写には無い。 */
  readonly awayReplay?: AwayReplay | null;
  /** 留守中に達成した実績の数。旧版の複写には無い（0）。 */
  readonly awayAchieved?: number | undefined;
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
  /** 見せてよいラウンド数（上乗せの告知前は基本ラウンドのみ、告知後は合計）。 */
  readonly rounds: number;
  /** 終了予定（未告知の上乗せを含む）。 */
  readonly endsAt: SimTime;
  /** 未告知の上乗せラウンド（告知前だけ。endsAt からの逆算用で、表示しない）。 */
  readonly hiddenRounds?: number | undefined;
  /** 当たった保留の単価 unit（出玉の数え上げ用。不明・旧は rate, D-090）。 */
  readonly unit?: number | undefined;
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
  /** 基準生産（行動の即時報酬・単価の単位。経済なしは0, D-080・D-090）。 */
  readonly refPerSec: number;
  /** 発射単価の秒数（生産何秒ぶんか。経済なしは8, D-090）。 */
  readonly shotS: number;
  /** 特別保留のストック数（EngineのbonusStock, D-081）。 */
  readonly bonusStock: number;
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
  /** 解放済みレートの1発コスト（rates と同順。発射時の ref で変わる目安, D-090）。 */
  readonly rateCosts: readonly number[];
  /** 実績（達成順・今の achMult・進捗用の指標の値。経済なしは達成なし・倍率1, spec/24）。 */
  readonly achievements: AchievementsView;
  /** 常連ツリー（経済が IdleEconomy の時だけ, spec/25）。 */
  readonly tree?: TreeView | undefined;
}

/** 発射グリッドms（絶対時刻の倍数に揃える）。 */
export const FIRE_INTERVAL_MS = 600;

/** ボーナス保留の通し番号の基数（発射玉と衝突しないよう1e9からnoticeIdを足す）。 */
export const BONUS_SERIAL_BASE = 1000000000;

/** 自動保留（電サポ）の通し番号の基数（発射玉・ボーナス保留と衝突しないよう2e9から）。 */
export const RESERVE_SERIAL_BASE = 2000000000;

/** 特別保留の通し番号の基数（1.5e9 + n。発射玉・ボーナス・自動保留と衝突しない, D-081）。 */
export const GRANT_HOLD_SERIAL_BASE = 1500000000;

/** 2^32（予告の当否しきい値用。`**`禁止のため数値リテラル）。 */
const UINT32_RANGE = 4294967296;

/** 時刻の上限（2^53未満）。 */
const MAX_SAFE_MS = 9007199254740991;

/** 時刻を検証する。 */
/** 留守中サマリーの複写（旧版の複写は replay が無いので null で埋める）。 */
function copySummary(s: AwaySummary | null): AwaySummary | null {
  if (s === null) {
    return null;
  }
  const replay = s.replay === undefined || s.replay === null ? null : { ...s.replay };
  const achievements = typeof s.achievements === 'number' ? s.achievements : 0;
  return { ...s, replay, achievements };
}

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
    // 上乗せ（LT）は告知（uwanose）まで見せない。未告知の分は hiddenRounds で渡す（spec/21）。
    const bonus = (j.bonusRounds === undefined ? 0 : j.bonusRounds);
    const hidden = j.uwanoseAt === null || j.uwanoseAt === undefined ? 0 : bonus;
    const shown = b.rounds + bonus - hidden;
    const view: JackpotView = { entry: j.serial, kind: b.kind, rounds: shown, endsAt: j.endsAt };
    jackpot = hidden > 0 ? { ...view, hiddenRounds: hidden } : view;
    const ju = (j as { unit?: number; rate?: number }).unit !== undefined
      ? (j as { unit?: number }).unit
      : (j as { rate?: number }).rate;
    if (ju !== undefined) {
      jackpot = { ...jackpot, unit: ju };
    }
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
    refPerSec: 0,
    shotS: 8,
    bonusStock: snap.bonusStock === undefined ? 0 : snap.bonusStock,
    yakumono: [],
    notice,
    nextHot,
    feverMs: 0,
    totals: {
      spins: snap.totals.spins,
      jackpots: snap.totals.jackpots,
      fired: snap.totals.fired,
      payoutBalls: snap.totals.payoutBalls,
      firstHits: (snap.totals as Partial<Totals>).firstHits === undefined ? 0 : (snap.totals as Totals).firstHits,
      maxChain: (snap.totals as Partial<Totals>).maxChain === undefined ? 0 : (snap.totals as Totals).maxChain,
    },
    closes: snap.closes === undefined ? [] : snap.closes.slice(),
    chain: spinSnap.chain === undefined ? 0 : spinSnap.chain,
    chainBalls: spinSnap.chainBalls === undefined ? 0 : spinSnap.chainBalls,
    shoot: { on: snap.shootOn, rate: snap.shootRate },
    auto: { share: snap.autoShare, rate: snap.autoRate },
    rates: [1],
    rateCosts: [1],
    achievements: {
      done: [],
      mult: 1,
      metrics: {
        ballsTotal: 0,
        medalsEarned: 0,
        refPerSec: 0,
        yakumono: 0,
        awakenTotal: 0,
        rateStage: 0,
        streakDays: 0,
        firstHits: (snap.totals as Partial<Totals>).firstHits === undefined ? 0 : (snap.totals as Totals).firstHits,
        jackpots: snap.totals.jackpots,
        maxChain: (snap.totals as Partial<Totals>).maxChain === undefined ? 0 : (snap.totals as Totals).maxChain,
        closes: snap.closes === undefined ? 0 : snap.closes.length,
      },
    },
  };
}

/** 予告nの前面間隔ms（floor((min+floor(unit*(max-min))) × intervalMult)。unitはnoticeストリームの1手目, spec/25）。 */
function noticeIntervalMs(seed: number, n: number, cfg: NoticeConfig): number {
  const unit = new RNGStream(seed, 'notice', n).nextUnit();
  const base = cfg.minFgMs + Math.floor(unit * (cfg.maxFgMs - cfg.minFgMs));
  const mult = cfg.intervalMult === undefined ? 1 : cfg.intervalMult;
  return Math.floor(base * mult);
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
  /** 間隔の係数（1 − Σnotice_interval_sub。無ければ 1）。 */
  readonly intervalMult?: number;
  /** 前面で出た予告を出現 + autoMs に自動で受け取る（notice_auto。負・無しは自動なし）。 */
  readonly autoMs?: number;
  /** 行動の特別保留の当たり 1/n（grant_hold_1_in。無ければ bonus1In）。 */
  readonly grantBonus1In?: number;
}

/** 番頭さんの判定の間隔ms（economyTick の時刻がこの倍数の時, spec/25）。 */
const BANTOU_INTERVAL_MS = 60000;

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
  private nextReserveState: number;
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
  private awaySpinCandState: AwaySpinCandidate | null;
  private awayReplayState: AwayReplay | null;
  private awayAchievedState: number;
  private lastSummaryState: AwaySummary | null;
  private autoAccState: number;
  private bonusStockState: number;
  private grantHoldSeqState: number;

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
    this.syncMachineId();
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
    this.nextReserveState = RESERVE_SERIAL_BASE;
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
    this.awaySpinCandState = null;
    this.awayReplayState = null;
    this.awayAchievedState = 0;
    this.lastSummaryState = null;
    this.autoAccState = 0;
    this.bonusStockState = 0;
    this.grantHoldSeqState = 0;
    this.noticeCfgCache = this.readNoticeConfig();
    this.nailQCache = null;
    if (this.noticeCfgCache === null) {
      this.noticeInFgMsState = MAX_SAFE_MS;
    } else {
      this.noticeInFgMsState = noticeIntervalMs(this.seed, 0, this.noticeCfgCache);
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
    const prodMin = g.prodMin === undefined ? 0 : g.prodMin;
    if (typeof prodMin !== 'number' || !Number.isFinite(prodMin) || prodMin < 0) {
      throw new Error('invalid engine: grant.prodMin must be finite >= 0');
    }
    const bonusHolds = g.bonusHolds === undefined ? 0 : g.bonusHolds;
    if (Math.floor(bonusHolds) !== bonusHolds || bonusHolds < 0) {
      throw new Error('invalid engine: grant.bonusHolds must be a non-negative int');
    }
    if (g.at < this.nowMsState) {
      throw new Error('invalid engine: grant.at must be >= now');
    }
    const last = this.grantsState[this.grantsState.length - 1] as Grant | undefined;
    if (last !== undefined && g.at < last.at) {
      throw new Error('invalid engine: grants must be in time order');
    }
    const base: Grant = { claimId: g.claimId, at: g.at, fuelMs: g.fuelMs, medals: g.medals };
    const withProd: Grant = prodMin > 0 ? { ...base, prodMin } : base;
    const withBonus: Grant = bonusHolds > 0 ? { ...withProd, bonusHolds } : withProd;
    if (g.streakDay === undefined) {
      this.grantsState.push(withBonus);
    } else {
      this.grantsState.push({ ...withBonus, streakDay: g.streakDay });
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
    if (a.k === 'treeBuy') {
      if (typeof a.node !== 'string' || a.node.length === 0) {
        throw new Error('invalid engine: treeBuy.node must be non-empty');
      }
      this.actionsState.push({ t: a.t, k: 'treeBuy', node: a.node });
      return;
    }
    if (a.k === 'bantou') {
      if (typeof a.on !== 'boolean') {
        throw new Error('invalid engine: bantou.on must be boolean');
      }
      this.actionsState.push({ t: a.t, k: 'bantou', on: a.on });
      return;
    }
    this.actionsState.push({ t: a.t, k: 'close' });
  }

  /** 今の機種 id を経済に渡す（prod_add_machine の照合。保存されないので構築・復元のたびに, spec/25）。 */
  private syncMachineId(): void {
    const hook = this.econHook('setMachineId') as ((id: string) => void) | undefined;
    if (hook !== undefined && typeof hook === 'function') {
      (hook.bind(this.economy))(this.spec.id);
    }
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

  /** 解放済みでないレートを、解放済みのうちそれ以下の最大に丸める（旧セーブの400・1000など。表が無ければそのまま, D-092）。 */
  private clampUnlockedRate(rate: number): number {
    if (this.isRateAllowed(rate)) {
      return rate;
    }
    const hook = this.econHook('getUnlockedRates') as (() => readonly number[]) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return rate;
    }
    const rates = (hook.bind(this.economy))();
    if (rates.length === 0) {
      return rate;
    }
    let best = rates[0] as number;
    for (let i = 1; i < rates.length; i = i + 1) {
      const r = rates[i] as number;
      if (r <= rate && r > best) {
        best = r;
      }
    }
    return best;
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
    const autoAt = this.noticeAutoAt();
    if (autoAt !== null && autoAt > cur && autoAt < nxt) {
      nxt = autoAt;
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
      const prodMin = g.prodMin === undefined ? 0 : g.prodMin;
      const bonusHolds = g.bonusHolds === undefined ? 0 : g.bonusHolds;
      const balls = prodMin > 0 ? this.readRefPerSec() * prodMin * this.readProdMinMult() * 60 : 0;
      if (balls > 0) {
        this.ballsState = addAmount(this.ballsState, balls);
        this.noteEconomyGain(balls);
      }
      if (bonusHolds > 0) {
        this.bonusStockState = this.bonusStockState + bonusHolds;
      }
      const grantedBase = { k: 'granted', claimId: g.claimId, at, fuelMs: g.fuelMs, medals: g.medals } as const;
      const withBalls = prodMin > 0 ? { ...grantedBase, balls } : grantedBase;
      const granted = bonusHolds > 0 ? { ...withBalls, bonusHolds } : withBalls;
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
        out.push(granted);
        if (r.fuelRefilled) {
          out.push({ k: 'fuelRefilled', at });
        }
      } else {
        this.fuelMsState = this.fuelMsState + g.fuelMs;
        this.medalsState = this.medalsState + g.medals;
        out.push(granted);
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
            const points = (r as { points?: number }).points;
            if (points !== undefined && points > 0) {
              out.push({ k: 'closed', at, regularPoints: r.gain, points });
            } else {
              out.push({ k: 'closed', at, regularPoints: r.gain });
            }
            this.syncHoldMax();
            this.clearNailQCache();
            this.autoAccState = 0;
          } else {
            out.push({ k: 'rejected', at, action: a.k, reason: r.reason });
          }
        }
      } else if (a.k === 'treeBuy') {
        const hook = this.econHook('buyTreeNode') as
          | ((id: string, at: number) => { ok: true } | { ok: false; reason: string })
          | undefined;
        if (hook === undefined || typeof hook !== 'function') {
          out.push({ k: 'rejected', at, action: a.k, reason: 'not-implemented' });
        } else {
          const r = (hook.bind(this.economy))(a.node, at);
          if (r.ok) {
            // 予告の設定はツリー込みなので読み直す（今決まっている間隔はそのまま。次に決める間隔から, spec/25）。
            this.noticeCfgCache = this.readNoticeConfig();
          } else {
            out.push({ k: 'rejected', at, action: a.k, reason: r.reason });
          }
        }
      } else if (a.k === 'bantou') {
        const hook = this.econHook('onBantou') as
          | ((on: boolean) => { ok: true } | { ok: false; reason: string })
          | undefined;
        if (hook === undefined || typeof hook !== 'function') {
          out.push({ k: 'rejected', at, action: a.k, reason: 'not-implemented' });
        } else {
          const r = (hook.bind(this.economy))(a.on);
          if (!r.ok) {
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
    this.awaySpinCandState = null;
    this.awayReplayState = null;
    this.awayAchievedState = 0;
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
      replay: this.awayReplayState,
      achievements: this.awayAchievedState,
    };
    this.awayFromState = null;
    this.awaySpinCandState = null;
    this.awayReplayState = null;
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

  /** 留守中に当たりの変動が始まったら候補として覚える（外れは覚えない）。 */
  private noteAwaySpin(entry: HoldEntry, at: SimTime, pattern: string, endsAt: SimTime): void {
    if (this.awayFromState === null) {
      return;
    }
    this.awaySpinCandState = entry.isHit
      ? { entry: entry.serial, pattern, color: entry.color, hot: entry.hot, startedAt: at, endsAt }
      : null;
  }

  /** 留守中の大当たり開始で、候補が今までより熱ければリプレイに上げる。 */
  private noteAwayReplay(entry: number, kind: JackpotKind, rounds: number): void {
    const cand = this.awaySpinCandState;
    if (this.awayFromState === null || cand === null || cand.entry !== entry) {
      return;
    }
    const best = this.awayReplayState;
    if (best === null || cand.hot > best.hot) {
      this.awayReplayState = { ...cand, kind, rounds };
    }
    this.awaySpinCandState = null;
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
          this.ballsState = addAmount(this.ballsState, gain);
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
            this.readFreeUnit(),
          );
          this.ballsState = addAmount(this.ballsState, entry.hesoPayoutBalls);
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
    this.noticeInFgMsState = noticeIntervalMs(this.seed, this.noticeSeqState, cfg);
  }

  /** 表示中の予告を自動で受け取る時刻（notice_auto を持つ時だけ。出現 + autoMs。無ければ null, spec/25）。 */
  private noticeAutoAt(): SimTime | null {
    const cfg = this.noticeCfgCache;
    const active = this.activeNoticeState;
    if (cfg === null || active === null || cfg.autoMs === undefined || cfg.autoMs < 0) {
      return null;
    }
    return active.spawnedAt + cfg.autoMs;
  }

  /** 予告の自動受け取り・出現・期限切れ（自動は前面・期限内で手のタップと同じ経路。前面加算が尽きたら出現、期限が来たら失効）。 */
  private applyNoticeAt(at: SimTime, out: SimEvent[]): void {
    const cfg = this.noticeCfgCache;
    if (cfg === null) {
      return;
    }
    if (this.tryAutoNoticeAt(at, out)) {
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
    // 遅れ 0 は出現と同じ時刻に受け取る（次の処理時刻まで待つと advance の区切りで結果が変わるため）。
    this.tryAutoNoticeAt(at, out);
  }

  /** 自動受け取りの時刻を過ぎていて前面・期限内なら、手のタップと同じ経路で受け取る（受け取ったら true）。 */
  private tryAutoNoticeAt(at: SimTime, out: SimEvent[]): boolean {
    const autoAt = this.noticeAutoAt();
    const active = this.activeNoticeState;
    if (autoAt === null || active === null || !this.fgState || at < autoAt || at > active.expiresAt) {
      return false;
    }
    this.applyNoticeTapAt(at, active.id, out);
    return true;
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
      this.ballsState = addAmount(this.ballsState, r.ballGain);
    }
    this.fuelMsState = r.fuelMs;
    if (r.fuelBecameEmpty) {
      out.push({ k: 'fuelEmpty', at: cur });
      this.noteAwayFuelEmpty(cur);
    }
    this.applyBantouAt(cur);
    this.applyAchievementsAt(cur, out);
  }

  /** 番頭さん（60,000ms の倍数の economyTick の後。イベントは出さず役物 Lv に出る, spec/25）。 */
  private applyBantouAt(cur: SimTime): void {
    if (cur - Math.floor(cur / BANTOU_INTERVAL_MS) * BANTOU_INTERVAL_MS !== 0) {
      return;
    }
    const hook = this.econHook('onBantouTick') as ((balls: number) => { balls: number; spent: number }) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return;
    }
    const r = (hook.bind(this.economy))(this.ballsState);
    if (r.spent > 0) {
      this.ballsState = r.balls;
      // 留守中サマリーの獲得玉は「増えた分」なので、番頭さんの支払いは発射と同じく足し戻す。
      if (this.awayFromState !== null) {
        this.awayConsumedState = this.awayConsumedState + r.spent;
      }
    }
  }

  /** Engine が持つ実績の指標（Totals と閉店の記録の数）。 */
  private engineAchievementMetrics(): EngineAchievementMetrics {
    return {
      firstHits: this.totalsState.firstHits,
      jackpots: this.totalsState.jackpots,
      maxChain: this.totalsState.maxChain,
      closes: this.closesState.length,
    };
  }

  /** economyTick の直後の実績判定（達成を一覧の順に achieved で出す, spec/24）。 */
  private applyAchievementsAt(cur: SimTime, out: SimEvent[]): void {
    const hook = this.econHook('onAchievementTick') as
      | ((at: number, eng: EngineAchievementMetrics) => string[])
      | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return;
    }
    const ids = (hook.bind(this.economy))(cur, this.engineAchievementMetrics());
    for (let i = 0; i < ids.length; i = i + 1) {
      out.push({ k: 'achieved', id: ids[i] as string, at: cur });
    }
    if (this.awayFromState !== null) {
      this.awayAchievedState = this.awayAchievedState + ids.length;
    }
  }

  /** 経済tickを持つか（Stubは燃料を消費しないためオートの燃料判定をしない）。 */
  private hasEconomyTick(): boolean {
    const hook = this.econHook('onTick');
    return hook !== undefined && typeof hook === 'function';
  }

  /** 発射単価フックを持つか（IdleEconomy のみ。Stub は旧 share 間引き, D-090）。 */
  private hasShotUnit(): boolean {
    const hook = this.econHook('getShotUnit');
    return hook !== undefined && typeof hook === 'function';
  }

  /** 1発の単価 unit を読む（経済なしは rate, D-090）。 */
  private readShotUnit(rate: number): number {
    const hook = this.econHook('getShotUnit') as ((r: number) => number) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      if (Math.floor(rate) !== rate || rate < 1) {
        throw new Error('invalid engine: bad rate');
      }
      return rate;
    }
    const v = (hook.bind(this.economy))(rate) as number;
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.floor(v) !== v || v < 1) {
      throw new Error('invalid engine: bad shot unit');
    }
    return v;
  }

  /** 発射単価の秒数 shotS を読む（経済なしは8, D-090）。 */
  private readShotS(): number {
    const hook = this.econHook('getShotS') as (() => number) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return 8;
    }
    const v = (hook.bind(this.economy))() as number;
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.floor(v) !== v || v < 1) {
      throw new Error('invalid engine: bad shotS');
    }
    return v;
  }

  /** 無料保留の1パチ単価を読む（経済なしは1, D-090）。 */
  private readFreeUnit(): number {
    return this.readShotUnit(1);
  }

  /** 基準生産を読む（経済なしは0, D-080）。 */
  /** 行動の即時の玉の倍率（prod_min_add。フック無しは 1, spec/25）。 */
  private readProdMinMult(): number {
    const hook = this.econHook('getProdMinMult') as (() => number) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return 1;
    }
    const v = (hook.bind(this.economy))() as number;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) {
      throw new Error('invalid engine: bad prodMinMult');
    }
    return v;
  }

  private readRefPerSec(): number {
    const hook = this.econHook('getRefPerSec') as (() => number) | undefined;
    if (hook === undefined || typeof hook !== 'function') {
      return 0;
    }
    const v = (hook.bind(this.economy))() as number;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error('invalid engine: bad refPerSec');
    }
    return v;
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

  /** 1発を打つ（コスト unit を持ち玉から引き、飛行中に積む。unit==rate は省略, D-090）。 */
  private fireOneBall(at: SimTime, out: SimEvent[], rate: number, unit: number): void {
    const ball = this.nextBallState;
    this.nextBallState = ball + 1;
    this.ballsState = this.ballsState - unit;
    if (this.awayFromState !== null) {
      this.awayConsumedState = this.awayConsumedState + unit;
    }
    this.totalsState = {
      ...this.totalsState,
      spins: this.totalsState.spins,
      jackpots: this.totalsState.jackpots,
      fired: this.totalsState.fired + 1,
      payoutBalls: this.totalsState.payoutBalls,
    };
    if (unit === rate) {
      out.push({ k: 'fired', ball, at, rate });
    } else {
      out.push({ k: 'fired', ball, at, rate, unit });
    }
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
    if (unit === rate) {
      this.pendingState.push({ ball, fireAt: at, sensorAt: at + found.flightMs, kind, rate });
    } else {
      this.pendingState.push({ ball, fireAt: at, sensorAt: at + found.flightMs, kind, rate, unit });
    }
  }

  /** 同時刻の発射（600ms倍数のみ。前面shootは即時・autoは生産×shareをunitで割る蓄積・燃料0/止め打ち満タン/持ち玉<unitで停止・釘でout→start1, D-090）。 */
  private applyFiringAt(at: SimTime, out: SimEvent[]): void {
    const rem = at - Math.floor(at / FIRE_INTERVAL_MS) * FIRE_INTERVAL_MS;
    if (rem !== 0) {
      return;
    }
    if (this.fgState && this.shootOnState) {
      const rate = this.shootRateState;
      const unit = this.readShotUnit(rate);
      if (this.ballsState < unit) {
        return;
      }
      this.fireOneBall(at, out, rate, unit);
      return;
    }
    if (this.autoShareState > 0 && this.isAutoUnlocked()) {
      if (this.isTomeuchiEnabled() && this.queue.isFull()) {
        return;
      }
      if (this.fuelMsState <= 0 && this.hasEconomyTick()) {
        return;
      }
      if (!this.hasShotUnit()) {
        // 経済なし（Stub）は旧 share 間引き。
        const n = Math.floor(at / FIRE_INTERVAL_MS);
        if (Math.floor(n * this.autoShareState) !== Math.floor((n - 1) * this.autoShareState)) {
          const rate = this.autoRateState;
          if (this.ballsState < rate) {
            return;
          }
          this.fireOneBall(at, out, rate, rate);
        }
        return;
      }
      const rate = this.autoRateState;
      const unit = this.readShotUnit(rate);
      // 持ち玉が1発に足りない間は積まない。蓄積は1発分で頭打ち（戻った時の連射を防ぐ, D-092）。
      if (this.ballsState < unit) {
        return;
      }
      const ref = this.readRefPerSec();
      const invested = (ref * this.autoShareState * FIRE_INTERVAL_MS) / 1000;
      const acc = this.autoAccState + invested;
      if (acc < unit) {
        this.autoAccState = acc;
        return;
      }
      const left = acc - unit;
      this.autoAccState = left > unit ? unit : left;
      this.fireOneBall(at, out, rate, unit);
    }
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
      const unit = h.unit === undefined ? h.rate : h.unit;
      const entry = drawHold(this.spec, this.patterns, this.seed, mode, h.ball, h.rate, unit);
      this.ballsState = addAmount(this.ballsState, entry.hesoPayoutBalls);
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

  /** 電サポ中か（jitan/st/lt。normalは対象外）。 */
  private isSupportMode(): boolean {
    const m = this.spins.mode;
    return m === 'jitan' || m === 'st' || m === 'lt';
  }

  /** 電サポ中の自動保留（玉を打たずに保留を上限まで足す。賞球なし・無料は1パチ単価, D-090）。 */
  private fillReserveHolds(at: SimTime, out: SimEvent[]): void {
    if (!this.isSupportMode()) {
      return;
    }
    this.syncHoldMax();
    while (!this.queue.isFull()) {
      const serial = this.nextReserveState;
      if (serial >= MAX_SAFE_MS) {
        throw new Error('invalid engine: reserve serial out of range');
      }
      this.nextReserveState = serial + 1;
      const mode = this.spins.mode;
      const freeUnit = this.readFreeUnit();
      const drawn = drawHold(this.spec, this.patterns, this.seed, mode, serial, 1, freeUnit);
      const entry: HoldEntry = { ...drawn, hesoPayoutBalls: 0 };
      this.noteAwayHot(entry.serial, entry.hot);
      if (this.queue.tryAdd(entry)) {
        out.push({ k: 'holdAdded', entry, at });
      } else {
        break;
      }
    }
  }

  /** 特別保留の投入（ストックから保留の空きへ。自動補充より先。満タン・大当たり中も失われない, D-081）。 */
  private fillGrantHolds(at: SimTime, out: SimEvent[]): void {
    if (this.bonusStockState <= 0) {
      return;
    }
    this.syncHoldMax();
    while (this.bonusStockState > 0 && !this.queue.isFull()) {
      const n = this.grantHoldSeqState;
      const serial = GRANT_HOLD_SERIAL_BASE + n;
      if (serial >= MAX_SAFE_MS) {
        throw new Error('invalid engine: grant hold serial out of range');
      }
      this.grantHoldSeqState = n + 1;
      this.bonusStockState = this.bonusStockState - 1;
      const mode = this.spins.mode;
      const cfg = this.noticeCfgCache;
      const bonus1In = cfg === null ? 10 : (cfg.grantBonus1In === undefined ? cfg.bonus1In : cfg.grantBonus1In);
      const entry = drawGrantHold(this.spec, this.patterns, this.seed, mode, n, serial, bonus1In, this.readFreeUnit());
      this.noteAwayHot(entry.serial, entry.hot);
      if (this.queue.tryAdd(entry)) {
        out.push({ k: 'holdAdded', entry, at });
      } else {
        break;
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
              this.noteAwayReplay(e.entry, e.kind, e.rounds);
              out.push(e);
            } else {
              out.push(e);
            }
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
        const unitBefore = this.spins.jackpotUnit as number;
        const evs = this.spins.finishJackpot(at, unitBefore);
        for (let i = 0; i < evs.length; i = i + 1) {
          const e = evs[i] as (typeof evs)[number] | undefined;
          if (e === undefined) {
            continue;
          }
          if (e.k === 'modeChanged') {
            deferredMode = { k: 'modeChanged', to: e.to, at: e.at, stRemaining: e.stRemaining };
          } else {
            if (e.k === 'jackpotEnded') {
              this.ballsState = addAmount(this.ballsState, e.payout);
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
              out.push(e);
            } else {
              out.push(e);
            }
          }
        }
      }
    }
    this.fillGrantHolds(at, out);
    this.fillReserveHolds(at, out);
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
          if (e.k === 'spinStarted') {
            this.noteAwaySpin(entry, at, e.pattern, e.endsAt);
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
    this.fillGrantHolds(at, out);
    this.fillReserveHolds(at, out);
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
    const lastCopy = copySummary(this.lastSummaryState);
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
      nextReserve: this.nextReserveState,
      bonusStock: this.bonusStockState,
      grantHoldSeq: this.grantHoldSeqState,
      autoAcc: this.autoAccState,
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
        awaySpinCand: this.awaySpinCandState === null ? null : { ...this.awaySpinCandState },
        awayReplay: this.awayReplayState === null ? null : { ...this.awayReplayState },
        awayAchieved: this.awayAchievedState,
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
    const oldTotals = snap.totals as Partial<Totals> & { bonusBalls?: number };
    eng.closesState = snap.closes === undefined ? [] : snap.closes.slice();
    // 旧 bonusBalls・jackpotBonus は読み捨て（D-090）。
    const { bonusBalls: _dropBonus, ...restTotals } = snap.totals as Totals & { bonusBalls?: number };
    void _dropBonus;
    eng.totalsState = {
      ...restTotals,
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
    eng.syncMachineId();
    // 旧セーブの 400・1000 は経済側で解放段が丸められるので、打つレートも合わせる（D-092）。
    eng.shootRateState = eng.clampUnlockedRate(eng.shootRateState);
    eng.autoRateState = eng.clampUnlockedRate(eng.autoRateState);
    eng.noticeCfgCache = eng.readNoticeConfig();
    eng.nailQCache = null;
    eng.noticeSeqState = snap.noticeSeq;
    eng.noticeInFgMsState = snap.noticeInFgMs;
    eng.activeNoticeState = snap.activeNotice === null ? null : { ...snap.activeNotice };
    // 旧 jackpotBonus は読み捨て（D-090）。
    if (snap.nextReserve === undefined) {
      eng.nextReserveState = RESERVE_SERIAL_BASE;
    } else {
      if (Math.floor(snap.nextReserve) !== snap.nextReserve || snap.nextReserve < 0 || snap.nextReserve >= MAX_SAFE_MS) {
        throw new Error('invalid engine: snap.nextReserve must be a non-negative int in range');
      }
      eng.nextReserveState = snap.nextReserve;
    }
    if (snap.bonusStock === undefined) {
      eng.bonusStockState = 0;
    } else {
      if (Math.floor(snap.bonusStock) !== snap.bonusStock || snap.bonusStock < 0) {
        throw new Error('invalid engine: snap.bonusStock must be a non-negative int');
      }
      eng.bonusStockState = snap.bonusStock;
    }
    if (snap.grantHoldSeq === undefined) {
      eng.grantHoldSeqState = 0;
    } else {
      if (Math.floor(snap.grantHoldSeq) !== snap.grantHoldSeq || snap.grantHoldSeq < 0 || snap.grantHoldSeq >= MAX_SAFE_MS) {
        throw new Error('invalid engine: snap.grantHoldSeq must be a non-negative int in range');
      }
      eng.grantHoldSeqState = snap.grantHoldSeq;
    }
    if (snap.autoAcc === undefined) {
      eng.autoAccState = 0;
    } else {
      if (typeof snap.autoAcc !== 'number' || !Number.isFinite(snap.autoAcc) || snap.autoAcc < 0) {
        throw new Error('invalid engine: snap.autoAcc must be finite >= 0');
      }
      eng.autoAccState = snap.autoAcc;
    }
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
    eng.awaySpinCandState = away.awaySpinCand === undefined || away.awaySpinCand === null ? null : { ...away.awaySpinCand };
    eng.awayReplayState = away.awayReplay === undefined || away.awayReplay === null ? null : { ...away.awayReplay };
    if (away.awayAchieved === undefined) {
      eng.awayAchievedState = 0;
    } else {
      if (Math.floor(away.awayAchieved) !== away.awayAchieved || away.awayAchieved < 0) {
        throw new Error('invalid engine: snap.away.awayAchieved must be a non-negative int');
      }
      eng.awayAchievedState = away.awayAchieved;
    }
    eng.lastSummaryState = copySummary(away.lastSummary);
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
    const rates = ratesHook !== undefined && typeof ratesHook === 'function'
      ? (ratesHook.bind(this.economy))()
      : [1];
    const rateCosts: number[] = [];
    for (let i = 0; i < rates.length; i = i + 1) {
      rateCosts.push(this.readShotUnit(rates[i] as number));
    }
    const achHook = this.econHook('getAchievementsView') as
      | ((eng: EngineAchievementMetrics) => AchievementsView)
      | undefined;
    const achievements = achHook !== undefined && typeof achHook === 'function'
      ? (achHook.bind(this.economy))(this.engineAchievementMetrics())
      : snapBase.achievements;
    const base = { ...snapBase, rates, rateCosts, achievements };
    const refPerSec = this.readRefPerSec();
    const shotS = this.readShotS();
    const baseWithRef = { ...base, refPerSec, shotS };
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
    const treeHook = this.econHook('getTreeView') as (() => TreeView) | undefined;
    const tree = treeHook !== undefined && typeof treeHook === 'function' ? (treeHook.bind(this.economy))() : undefined;
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
      return { ...baseWithRef, feverMs, shop, tree };
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
    return { ...baseWithRef, perSec, boostMs, yakumono, feverMs, shop, tree };
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
