/** 放置経済の状態遷移（spec/23・spec/22入力節。P3-T2）。 */
import type { AchievementDef, AchievementMetric, EconomySpec } from './economy-config.ts';
import { ACHIEVEMENT_METRICS, ECONOMY_YAKUMONO_IDS } from './economy-config.ts';
import { TREE_AWAKEN_LOW_COUNT, TREE_KEEP_TARGETS } from './tree-config.ts';
import type { EconomyPort } from './economy.ts';
import {
  addAmount,
  awakenMedalCost,
  ballPoints,
  buildGrowthTable,
  closeGain,
  effectivePeriodS,
  growthPow,
  shotUnit,
  streakMult,
  yakumonoBulkPrice,
} from './economy-math.ts';
import type { TreeBuyReason, TreeRecord, TreeTotals, TreeView } from './tree-state.ts';
import {
  treeCheckBuy,
  treeClosePoints,
  treeDropUnknown,
  treeNodeViews,
  treeOwnedFlags,
  treeSumEffects,
  treeTierOpen,
} from './tree-state.ts';

/** keep の awaken_low / awaken_all の添字（TREE_KEEP_TARGETS の順）。 */
const TREE_KEEP_AWAKEN_LOW = TREE_KEEP_TARGETS.indexOf('awaken_low');
const TREE_KEEP_AWAKEN_ALL = TREE_KEEP_TARGETS.indexOf('awaken_all');

/** 旧レート表（D-090 前。[1,4,10,40,100,400,1000]。v4 以前の rateStage 移行用）。 */
const LEGACY_RATES: readonly number[] = [1, 4, 10, 40, 100, 400, 1000];

/** 達成した実績1件（達成時刻は economyTick の時刻, spec/24）。 */
export interface AchievementRecord {
  readonly id: string;
  readonly at: number;
}

/** Engine が持つ実績の指標（Totals と閉店の記録から渡す）。 */
export interface EngineAchievementMetrics {
  readonly firstHits: number;
  readonly jackpots: number;
  readonly maxChain: number;
  readonly closes: number;
}

/** 実績の表示（Projection の achievements。done は達成順、metrics は進捗表示用の今の値）。 */
export interface AchievementsView {
  readonly done: readonly AchievementRecord[];
  readonly mult: number;
  readonly metrics: Readonly<Record<AchievementMetric, number>>;
}

/** IdleEconomy の複写（Engine の snapshot.economy に入る）。 */
export interface IdleEconomySnapshot {
  readonly v: 9;
  readonly lv: readonly number[];
  readonly awakened: readonly number[];
  readonly idleStage: number;
  readonly tankStage: number;
  readonly nailStage: number;
  readonly shortenStage: number;
  readonly holdStage: number;
  readonly rateStage: number;
  readonly autoOwned: boolean;
  readonly tomeuchiOwned: boolean;
  readonly regular: number;
  readonly runTotal: number;
  readonly totalTotal: number;
  readonly streakDays: number;
  readonly lastStreakDay: string;
  readonly boostMs: number;
  readonly boostOn: boolean;
  readonly feverMs: number;
  /** 累計獲得メダル（Grant でだけ増え、消費しても減らない。D-049）。 */
  readonly medalsEarned: number;
  /** 達成した実績（達成順。一覧から消えた id も残す, spec/24）。 */
  readonly achieved: readonly AchievementRecord[];
  /** 覚醒の累計回数（閉店で保持）。 */
  readonly awakenTotal: number;
  /** 今持っている常連P（使う通貨。regular は常連ランク, spec/25）。 */
  readonly points: number;
  /** 常連P の累計（= points + Σtree.cost）。 */
  readonly pointsEarned: number;
  /** 常連ツリーの購入（購入順）。 */
  readonly tree: readonly TreeRecord[];
  /** 開店ダッシュの残り（ms）。 */
  readonly openBoostMs: number;
  /** 番頭さん（役物の自動購入）の ON/OFF。 */
  readonly bantouOn: boolean;
  /** 休業に入った時刻（閉店の時刻。休業中でなければ null, D-107）。 */
  readonly restAt: number | null;
  /** 休業中の行動の即時の玉（開店で持ち玉に足す）。 */
  readonly restPendingBalls: number;
  /** 今の周回の役物ごとの最高 Lv（覚醒で Lv を戻しても下がらない, P13-T6）。 */
  readonly runMaxLv: readonly number[];
  /** 前の周回の役物ごとの最高 Lv（閉店で runMaxLv を写す。starter_rel が使う）。 */
  readonly prevMaxLv: readonly number[];
}

/** 休業の表示（Projection の rest, spec/25）。 */
export interface RestView {
  readonly since: number;
  readonly autoOpenAt: number;
  readonly pendingBalls: number;
}

/** 役物表示（Lv・覚醒数・次の価格。描画と購入UIが見る）。 */
export interface IdleYakumonoView {
  readonly id: string;
  readonly lv: number;
  readonly awakened: number;
  readonly nextPrice: number;
}

/** 強化画面の役物1行（毎秒は状態係数なしの素の値。prices は bulkSizes 込みの [×1, ×10, ×100]、買えない数は null）。 */
export interface ShopYakumonoView {
  readonly id: string;
  readonly lv: number;
  readonly awakened: number;
  readonly locked: boolean;
  readonly perSec: number;
  readonly prices: readonly (number | null)[];
  readonly awakenCost: number;
  readonly awakenReady: boolean;
  /** 覚醒すると基準生産が何倍になるか（覚醒後 ÷ 今。燃料・前面・ブースト等の状態係数は含まない）。覚醒できない Lv なら null。 */
  readonly awakenGain: number | null;
}

/** 強化の id（buy の target と同じ）。 */
export type ShopUpgradeId = 'idle' | 'tank' | 'nail' | 'shorten' | 'hold' | 'auto' | 'tomeuchi' | 'rate';

/** 強化画面の強化1行（value は今の効果、next は次段の効果。cost が null なら最大）。 */
export interface ShopUpgradeView {
  readonly id: ShopUpgradeId;
  readonly stage: number;
  readonly stages: number;
  readonly currency: 'balls' | 'medals';
  readonly cost: number | null;
  readonly value: number;
  readonly next: number | null;
}

/** 閉店の見込み（gain は今閉店した時の獲得。byBalls/byMedals は min を取る前の両方）。 */
export interface ShopCloseView {
  readonly runTotal: number;
  readonly required: number;
  readonly ready: boolean;
  readonly gain: number;
  readonly byBalls: number;
  readonly byMedals: number;
  /** これまでの累計玉（閉店で戻らない）。玉由来の元。 */
  readonly totalTotal: number;
  /** 玉由来が +1 になる累計玉 = (byBalls+1)³ × divisor。 */
  readonly nextBallsAt: number;
  /** 行動由来が +1 になる累計メダル = (byMedals+1) × medalsPerPoint。 */
  readonly nextMedalsAt: number;
  /** 今閉店した時に得る常連P（spec/25）。 */
  readonly points: number;
}

/** 強化画面が見る経済の状態（Projection の shop）。 */
export interface ShopView {
  readonly yakumono: readonly ShopYakumonoView[];
  readonly upgrades: readonly ShopUpgradeView[];
  readonly close: ShopCloseView;
  readonly regular: number;
  readonly streakDays: number;
  readonly medalsEarned: number;
  readonly boostOn: boolean;
  /** 共鳴（係数 = awaken.resonance + Σresonance_add、count = 今の周回の覚醒の総数、mult = 1 + 係数 × count）。 */
  readonly resonance: { readonly rate: number; readonly count: number; readonly mult: number };
  /** 今閉店したら次の周回に残る覚醒の総数（ツリーの keep。0 なら残らない）。 */
  readonly keptAwakened: number;
}

/** buy の対象（役物8種＋強化8種）。 */
export const ECONOMY_BUY_TARGETS: readonly string[] = [
  'windmill',
  'kaitentai',
  'croon',
  'reel',
  'attacker',
  'vzone',
  'denchu',
  'shima',
  'idle',
  'tank',
  'nail',
  'shorten',
  'hold',
  'auto',
  'tomeuchi',
  'rate',
];

function fail(what: string): never {
  throw new Error('invalid economy-state: ' + what);
}

function asInt(v: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.floor(v) !== v) {
    fail(what + ' must be an int');
  }
  return v;
}

function asNonNegInt(v: number, what: string): number {
  asInt(v, what);
  if (v < 0) {
    fail(what + ' must be >= 0');
  }
  return v;
}

function asFinite(v: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail(what + ' must be finite');
  }
  return v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** YYYY-MM-DD を検証して数値化する（Core は Date を使わない）。 */
function parseDay(s: string): { y: number; m: number; d: number } | null {
  if (typeof s !== 'string' || s.length !== 10) {
    return null;
  }
  const c4 = s.charAt(4);
  const c7 = s.charAt(7);
  if (c4 !== '-' || c7 !== '-') {
    return null;
  }
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (Math.floor(y) !== y || Math.floor(m) !== m || Math.floor(d) !== d) {
    return null;
  }
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
    return null;
  }
  const dim = daysInMonth(y, m);
  if (d > dim) {
    return null;
  }
  return { y, m, d };
}

/** うるう年（+ - * /・比較のみ）。 */
function isLeapYear(y: number): boolean {
  const by4 = y - Math.floor(y / 4) * 4 === 0;
  const by100 = y - Math.floor(y / 100) * 100 === 0;
  const by400 = y - Math.floor(y / 400) * 400 === 0;
  return by4 && (!by100 || by400);
}

/** 月の日数。 */
function daysInMonth(y: number, m: number): number {
  if (m === 2) {
    return isLeapYear(y) ? 29 : 28;
  }
  if (m === 4 || m === 6 || m === 9 || m === 11) {
    return 30;
  }
  return 31;
}

/** prev の翌日が curr か（両方とも有効な YYYY-MM-DD 前提）。 */
function isNextDay(prev: string, curr: string): boolean {
  const p = parseDay(prev);
  const c = parseDay(curr);
  if (p === null || c === null) {
    return false;
  }
  let ny = p.y;
  let nm = p.m;
  let nd = p.d + 1;
  const dim = daysInMonth(ny, nm);
  if (nd > dim) {
    nd = 1;
    nm = nm + 1;
    if (nm > 12) {
      nm = 1;
      ny = ny + 1;
    }
  }
  return ny === c.y && nm === c.m && nd === c.d;
}

/** 保存のツリー部分（v7）。 */
interface TreeSave {
  readonly points: number;
  readonly pointsEarned: number;
  readonly tree: TreeRecord[];
  readonly openBoostMs: number;
  readonly bantouOn: boolean;
}

/** v6 以前の移行（常連P = 累計 = points_per_rank × ランク、過去の runBonus は 0, spec/25）。 */
function migrateTreeSave(points: number): TreeSave {
  return { points, pointsEarned: points, tree: [], openBoostMs: 0, bantouOn: false };
}

/** v7 のツリー部分を読んで検証する（pointsEarned = points + Σcost。未知の id もここでは残す）。 */
/** 役物8種の Lv の配列（非負の整数）を読む。 */
function readLv8(value: unknown, what: string): number[] {
  if (!Array.isArray(value) || value.length !== 8) {
    fail(what + ' must have 8 entries');
  }
  const out: number[] = [];
  for (let i = 0; i < 8; i = i + 1) {
    out.push(asNonNegInt(value[i] as number, what + '[' + i + ']'));
  }
  return out;
}

function readTreeSave(s: Record<string, unknown>): TreeSave {
  const points = asNonNegInt(s['points'] as number, 'points');
  const pointsEarned = asNonNegInt(s['pointsEarned'] as number, 'pointsEarned');
  const raw = s['tree'];
  if (!Array.isArray(raw)) {
    fail('tree must be an array');
  }
  const tree: TreeRecord[] = [];
  let spent = 0;
  for (let i = 0; i < raw.length; i = i + 1) {
    const r = raw[i] as unknown;
    if (!isRecord(r) || typeof r['id'] !== 'string' || r['id'].length === 0) {
      fail('tree[' + i + '].id must be a non-empty string');
    }
    const id = r['id'];
    const cost = asNonNegInt(r['cost'] as number, 'tree[' + i + '].cost');
    if (cost < 1) {
      fail('tree[' + i + '].cost must be >= 1');
    }
    const at = asNonNegInt(r['at'] as number, 'tree[' + i + '].at');
    for (let k = 0; k < tree.length; k = k + 1) {
      if ((tree[k] as TreeRecord).id === id) {
        fail('tree[' + i + '].id duplicated');
      }
    }
    tree.push({ id, cost, at });
    spent = spent + cost;
  }
  if (pointsEarned !== points + spent) {
    fail('pointsEarned must equal points + spent');
  }
  const openBoostMs = asFinite(s['openBoostMs'] as number, 'openBoostMs');
  if (openBoostMs < 0) {
    fail('openBoostMs must be >= 0');
  }
  const bantouOn = s['bantouOn'];
  if (typeof bantouOn !== 'boolean') {
    fail('bantouOn must be boolean');
  }
  return { points, pointsEarned, tree, openBoostMs, bantouOn };
}

/** 放置経済の本体（Engine が委譲する。決定論・+ - * /・floor のみ）。 */
export class IdleEconomy implements EconomyPort {
  private readonly spec: EconomySpec;
  private readonly priceTable: readonly number[];
  private lvState: number[];
  private awakenedState: number[];
  private idleStageState = 0;
  private tankStageState = 0;
  private nailStageState = 0;
  private shortenStageState = 0;
  private holdStageState = 0;
  private rateStageState = 0;
  private autoOwnedState = false;
  private tomeuchiOwnedState = false;
  private regularState = 0;
  private runTotalState = 0;
  private totalTotalState = 0;
  private streakDaysState = 0;
  private lastStreakDayState = '';
  private boostMsState = 0;
  private boostOnState = true;
  private feverMsState = 0;
  private medalsEarnedState = 0;
  private awakenTotalState = 0;
  private achievedState: AchievementRecord[] = [];
  /** 一覧の添字ごとの達成済み（achievedState から作る）。 */
  private achievedFlags: boolean[];
  /** 一覧にある達成の数（achMult に使う。一覧から消えた id は数えない）。 */
  private achCountState = 0;
  /** 指標ごとの未達成の最小しきい値（ACHIEVEMENT_METRICS の添字。無ければ -1）。毎秒の判定を軽くする。 */
  private achMinAt: number[] = [];
  private pointsState = 0;
  private pointsEarnedState = 0;
  private treeState: TreeRecord[] = [];
  private openBoostMsState = 0;
  private bantouOnState = false;
  private restAtState: number | null = null;
  private restPendingBallsState = 0;
  private runMaxLvState: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  private prevMaxLvState: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  /** 今の周回の機種 id（prod_add_machine の照合用。保存しない。Engine が setMachineId で渡す）。 */
  private machineIdState = '';
  /** 一覧の添字ごとの所持（treeState から作る）。 */
  private treeOwned: boolean[] = [];
  /** 所持ノードの効果の合計（treeOwned から作る。保存しない）。 */
  private treeTotalsState: TreeTotals;
  /** basePerSec のキャッシュ（Lv・覚醒が変わる購入・覚醒・閉店・復元で捨てる。-1 は未計算）。 */
  private basePerSecCache = -1;

  /** 仕様から価格表（growth^0..10000）を作る。 */
  constructor(spec: EconomySpec) {
    this.spec = spec;
    this.priceTable = buildGrowthTable(spec.priceGrowth, 10000);
    this.lvState = [0, 0, 0, 0, 0, 0, 0, 0];
    this.awakenedState = [0, 0, 0, 0, 0, 0, 0, 0];
    this.achievedFlags = [];
    this.rebuildAchievedFlags();
    this.treeTotalsState = treeSumEffects(spec.tree.nodes, this.treeOwned);
    this.rebuildTree();
  }

  /** 状態の複写。 */
  snapshot(): IdleEconomySnapshot {
    return {
      v: 9,
      lv: [...this.lvState],
      awakened: [...this.awakenedState],
      idleStage: this.idleStageState,
      tankStage: this.tankStageState,
      nailStage: this.nailStageState,
      shortenStage: this.shortenStageState,
      holdStage: this.holdStageState,
      rateStage: this.rateStageState,
      autoOwned: this.autoOwnedState,
      tomeuchiOwned: this.tomeuchiOwnedState,
      regular: this.regularState,
      runTotal: this.runTotalState,
      totalTotal: this.totalTotalState,
      streakDays: this.streakDaysState,
      lastStreakDay: this.lastStreakDayState,
      boostMs: this.boostMsState,
      boostOn: this.boostOnState,
      feverMs: this.feverMsState,
      medalsEarned: this.medalsEarnedState,
      achieved: this.achievedState.map((r) => ({ id: r.id, at: r.at })),
      awakenTotal: this.awakenTotalState,
      points: this.pointsState,
      pointsEarned: this.pointsEarnedState,
      tree: this.treeState.map((r) => ({ id: r.id, cost: r.cost, at: r.at })),
      openBoostMs: this.openBoostMsState,
      bantouOn: this.bantouOnState,
      restAt: this.restAtState,
      restPendingBalls: this.restPendingBallsState,
      runMaxLv: [...this.runMaxLvState],
      prevMaxLv: [...this.prevMaxLvState],
    };
  }

  /**
   * 複写から復元する（v1 は fever=0、v1/v2 は累計獲得メダル=0、v3 以前の jackpotFeverMult は読んで捨てる、v4 以前は旧レート段を移行 D-090、
   * v5 以前は実績なし・覚醒の累計＝今の周回の Σawakened, spec/24、v6 以前は常連P = points_per_rank × ランク・ツリー空, spec/25、v7 以前は休業でない, D-107、
   * v8 以前は今の周回の最高 Lv = 今の Lv・前の周回の最高 Lv = 0, P13-T6）。
   * 一覧から消えたツリーの id は除いてその cost を常連P に返す（D-104）。
   */
  restore(s: unknown): void {
    if (!isRecord(s)) {
      fail('snapshot must be an object');
    }
    const v = s['v'];
    if (v !== 1 && v !== 2 && v !== 3 && v !== 4 && v !== 5 && v !== 6 && v !== 7 && v !== 8 && v !== 9) {
      fail('snapshot version mismatch');
    }
    const lv = s['lv'];
    const awakened = s['awakened'];
    if (!Array.isArray(lv) || lv.length !== 8 || !Array.isArray(awakened) || awakened.length !== 8) {
      fail('lv/awakened must have 8 entries');
    }
    const lvCopy: number[] = [];
    const awCopy: number[] = [];
    for (let i = 0; i < 8; i = i + 1) {
      lvCopy.push(asNonNegInt(lv[i] as number, 'lv[' + i + ']'));
      awCopy.push(asNonNegInt(awakened[i] as number, 'awakened[' + i + ']'));
    }
    const idleStage = asNonNegInt(s['idleStage'] as number, 'idleStage');
    const tankStage = asNonNegInt(s['tankStage'] as number, 'tankStage');
    const nailStage = asNonNegInt(s['nailStage'] as number, 'nailStage');
    const shortenStage = asNonNegInt(s['shortenStage'] as number, 'shortenStage');
    const holdStage = asNonNegInt(s['holdStage'] as number, 'holdStage');
    const rateStageRaw = asNonNegInt(s['rateStage'] as number, 'rateStage');
    // v4 以前は旧レート表 [1,4,10,40,100,400,1000] の段。旧の最大解放レートを新表のそれ以下の最大に丸める（400・1000→100, D-090）。
    let rateStage = rateStageRaw;
    if (v !== 5 && v !== 6 && v !== 7 && v !== 8 && v !== 9) {
      const oldRate = rateStageRaw < LEGACY_RATES.length ? (LEGACY_RATES[rateStageRaw] as number) : 1000;
      const news = this.spec.upgrades.rates;
      let mapped = 0;
      for (let i = 0; i < news.length; i = i + 1) {
        if ((news[i] as number) <= oldRate) {
          mapped = i;
        }
      }
      rateStage = mapped;
    }
    const autoOwned = s['autoOwned'];
    const tomeuchiOwned = s['tomeuchiOwned'];
    if (typeof autoOwned !== 'boolean' || typeof tomeuchiOwned !== 'boolean') {
      fail('auto/tomeuchi must be boolean');
    }
    const regular = asNonNegInt(s['regular'] as number, 'regular');
    const runTotal = asFinite(s['runTotal'] as number, 'runTotal');
    const totalTotal = asFinite(s['totalTotal'] as number, 'totalTotal');
    if (runTotal < 0 || totalTotal < 0) {
      fail('totals must be >= 0');
    }
    const streakDays = asNonNegInt(s['streakDays'] as number, 'streakDays');
    const lastStreakDay = s['lastStreakDay'];
    if (typeof lastStreakDay !== 'string') {
      fail('lastStreakDay must be a string');
    }
    if (lastStreakDay !== '' && parseDay(lastStreakDay) === null) {
      fail('lastStreakDay invalid');
    }
    const boostMs = asFinite(s['boostMs'] as number, 'boostMs');
    if (boostMs < 0) {
      fail('boostMs must be >= 0');
    }
    const boostOn = s['boostOn'];
    if (typeof boostOn !== 'boolean') {
      fail('boostOn must be boolean');
    }
    let feverMs = 0;
    if (v !== 1 && s['feverMs'] !== undefined) {
      feverMs = asFinite(s['feverMs'] as number, 'feverMs');
      if (feverMs < 0) {
        fail('feverMs must be >= 0');
      }
    }
    let medalsEarned = 0;
    if (v === 3 || v === 4 || v === 5 || v === 6 || v === 7 || v === 8 || v === 9) {
      medalsEarned = asNonNegInt(s['medalsEarned'] as number, 'medalsEarned');
      // v3 以前の jackpotFeverMult は読んで捨てる（D-080 で廃止）。
    }
    const achieved: AchievementRecord[] = [];
    let awakenTotal = 0;
    if (v === 6 || v === 7 || v === 8 || v === 9) {
      const rawAch = s['achieved'];
      if (!Array.isArray(rawAch)) {
        fail('achieved must be an array');
      }
      for (let i = 0; i < rawAch.length; i = i + 1) {
        const r = rawAch[i] as unknown;
        if (!isRecord(r) || typeof r['id'] !== 'string' || r['id'].length === 0) {
          fail('achieved[' + i + '].id must be a non-empty string');
        }
        const id = r['id'];
        const at = asNonNegInt(r['at'] as number, 'achieved[' + i + '].at');
        for (let k = 0; k < achieved.length; k = k + 1) {
          if ((achieved[k] as AchievementRecord).id === id) {
            fail('achieved[' + i + '].id duplicated');
          }
        }
        achieved.push({ id, at });
      }
      awakenTotal = asNonNegInt(s['awakenTotal'] as number, 'awakenTotal');
    } else {
      for (let i = 0; i < 8; i = i + 1) {
        awakenTotal = awakenTotal + (awCopy[i] as number);
      }
    }
    const treeSave = v === 7 || v === 8 || v === 9 ? readTreeSave(s) : migrateTreeSave(this.spec.tree.pointsPerRank * regular);
    let restAt: number | null = null;
    let restPendingBalls = 0;
    if (v === 8 || v === 9) {
      const ra = s['restAt'];
      restAt = ra === null ? null : asNonNegInt(ra as number, 'restAt');
      restPendingBalls = asFinite(s['restPendingBalls'] as number, 'restPendingBalls');
      if (restPendingBalls < 0) {
        fail('restPendingBalls must be >= 0');
      }
      if (restAt === null && restPendingBalls !== 0) {
        fail('restPendingBalls must be 0 when not resting');
      }
    }
    let runMaxLv = [...lvCopy];
    let prevMaxLv = [0, 0, 0, 0, 0, 0, 0, 0];
    if (v === 9) {
      runMaxLv = readLv8(s['runMaxLv'], 'runMaxLv');
      prevMaxLv = readLv8(s['prevMaxLv'], 'prevMaxLv');
      // 今の Lv を下回る最高 Lv は今の Lv に寄せる（最高 Lv は今の Lv 以上）
      for (let i = 0; i < 8; i = i + 1) {
        if ((runMaxLv[i] as number) < (lvCopy[i] as number)) {
          runMaxLv[i] = lvCopy[i] as number;
        }
      }
    }
    const dropped = treeDropUnknown(this.spec.tree.nodes, treeSave.tree);
    this.lvState = lvCopy;
    this.awakenedState = awCopy;
    this.basePerSecCache = -1;
    this.idleStageState = idleStage;
    this.tankStageState = tankStage;
    this.nailStageState = nailStage;
    this.shortenStageState = shortenStage;
    this.holdStageState = holdStage;
    this.rateStageState = rateStage;
    this.autoOwnedState = autoOwned;
    this.tomeuchiOwnedState = tomeuchiOwned;
    this.regularState = regular;
    this.runTotalState = runTotal;
    this.totalTotalState = totalTotal;
    this.streakDaysState = streakDays;
    this.lastStreakDayState = lastStreakDay;
    this.boostMsState = boostMs;
    this.boostOnState = boostOn;
    this.feverMsState = feverMs;
    this.medalsEarnedState = medalsEarned;
    this.achievedState = achieved;
    this.awakenTotalState = awakenTotal;
    this.rebuildAchievedFlags();
    this.pointsState = treeSave.points + dropped.refund;
    this.pointsEarnedState = treeSave.pointsEarned;
    this.treeState = dropped.kept;
    this.openBoostMsState = treeSave.openBoostMs;
    this.bantouOnState = treeSave.bantouOn;
    this.restAtState = restAt;
    this.restPendingBallsState = restPendingBalls;
    this.runMaxLvState = runMaxLv;
    this.prevMaxLvState = prevMaxLv;
    this.rebuildTree();
  }

  /** ツリーの所持と効果の合計を作り直す（購入・復元で呼ぶ）。 */
  private rebuildTree(): void {
    this.treeOwned = treeOwnedFlags(this.spec.tree.nodes, this.treeState);
    this.treeTotalsState = treeSumEffects(this.spec.tree.nodes, this.treeOwned);
    // resonance_add は basePerSec に入る
    this.basePerSecCache = -1;
  }

  /** 所持ノードの効果の合計（T3/T4 の適用が見る）。 */
  getTreeTotals(): TreeTotals {
    return this.treeTotalsState;
  }

  /** 今持っている常連P。 */
  getPoints(): number {
    return this.pointsState;
  }

  /** 今の周回の機種 id を受け取る（prod_add_machine の照合用。保存しない）。 */
  setMachineId(id: string): void {
    this.machineIdState = id;
  }

  /** ツリーの生産倍率 treeMult = 1 + Σprod_add + Σ(今の機種の prod_add_machine)（spec/25）。 */
  treeMult(): number {
    const t = this.treeTotalsState;
    let m = 1 + t.prodAdd;
    for (let i = 0; i < t.prodAddMachine.length; i = i + 1) {
      const e = t.prodAddMachine[i] as { machine: string; add: number };
      if (e.machine === this.machineIdState) {
        m = m + e.add;
      }
    }
    return m;
  }

  /** 常連係数 r = close.regular_mult + Σregular_add。 */
  regularRate(): number {
    return this.spec.close.regularMult + this.treeTotalsState.regularAdd;
  }

  /** 連続日数の倍率（上限日数に streak_max_add を足す）。 */
  private streakF(): number {
    return streakMult(
      this.streakDaysState,
      this.spec.claims.streakPerDay,
      this.spec.claims.streakMaxDays + this.treeTotalsState.streakMaxAdd,
    );
  }

  /** 役物の価格の係数（1 − Σprice_sub）。 */
  priceMult(): number {
    return 1 - this.treeTotalsState.priceSub;
  }

  /** 覚醒のメダルの基数（awaken_medal_base を持てばその値）。 */
  private awakenBase(): number {
    const v = this.treeTotalsState.awakenMedalBase;
    return v > 0 ? v : this.spec.awaken.medalBase;
  }

  /** 行動の即時の玉の倍率（1 + Σprod_min_add）。Engine が refPerSec × prodMin × 60 に掛ける。 */
  getProdMinMult(): number {
    return 1 + this.treeTotalsState.prodMinAdd;
  }

  /** 開店ダッシュの残り ms。 */
  getOpenBoostMs(): number {
    return this.openBoostMsState;
  }

  /** 今閉店したら得る常連P（gain 0 なら 0）。 */
  private nextClosePoints(): number {
    const c = this.spec.close;
    const gain = closeGain(this.totalTotalState, c.divisor, this.regularState, this.medalsEarnedState, c.medalsPerPoint);
    return treeClosePoints(gain, this.runTotalState, this.spec.tree, this.treeTotalsState.pointsAdd);
  }

  /** 常連ツリーのノードを買う（常連P・段・前提・二重購入を検査。いつでも買える, spec/25）。 */
  buyTreeNode(id: string, at: number): { ok: true } | { ok: false; reason: TreeBuyReason } {
    asNonNegInt(at, 'at');
    const r = treeCheckBuy(this.spec.tree, id, this.treeOwned, this.pointsState);
    if (!r.ok) {
      return r;
    }
    const cost = (this.spec.tree.nodes[r.idx] as { cost: number }).cost;
    this.pointsState = this.pointsState - cost;
    this.treeState.push({ id, cost, at });
    this.rebuildTree();
    return { ok: true };
  }

  /** 常連ツリーの表示（Projection の tree）。 */
  getTreeView(): TreeView {
    return {
      rank: this.regularState,
      regularRate: this.regularRate(),
      points: this.pointsState,
      pointsEarned: this.pointsEarnedState,
      mult: this.treeMult(),
      openBoostMs: this.openBoostMsState,
      bantou: { owned: this.treeTotalsState.bantou, on: this.bantouOnState },
      tierOpen: treeTierOpen(this.spec.tree, this.treeOwned),
      nodes: treeNodeViews(this.spec.tree, this.treeOwned, this.pointsState),
      unlocks: [...this.treeTotalsState.unlocks],
      nextClosePoints: this.nextClosePoints(),
    };
  }

  /** 一覧の添字ごとの達成済みと、一覧にある達成の数を作り直す（反復は配列の添字順のみ）。 */
  private rebuildAchievedFlags(): void {
    const list = this.spec.achievements.list;
    const flags: boolean[] = [];
    let count = 0;
    for (let i = 0; i < list.length; i = i + 1) {
      const id = (list[i] as AchievementDef).id;
      let done = false;
      for (let k = 0; k < this.achievedState.length; k = k + 1) {
        if ((this.achievedState[k] as AchievementRecord).id === id) {
          done = true;
          break;
        }
      }
      flags.push(done);
      if (done) {
        count = count + 1;
      }
    }
    this.achievedFlags = flags;
    this.achCountState = count;
    this.rebuildAchMinAt();
  }

  /** 指標ごとの未達成の最小しきい値を作り直す。 */
  private rebuildAchMinAt(): void {
    const list = this.spec.achievements.list;
    const mins: number[] = [];
    for (let m = 0; m < ACHIEVEMENT_METRICS.length; m = m + 1) {
      mins.push(-1);
    }
    for (let i = 0; i < list.length; i = i + 1) {
      if (this.achievedFlags[i] === true) {
        continue;
      }
      const def = list[i] as AchievementDef;
      for (let m = 0; m < ACHIEVEMENT_METRICS.length; m = m + 1) {
        if (ACHIEVEMENT_METRICS[m] === def.metric) {
          const cur = mins[m] as number;
          if (cur < 0 || def.at < cur) {
            mins[m] = def.at;
          }
          break;
        }
      }
    }
    this.achMinAt = mins;
  }

  /** 実績の生産倍率 achMult = 1 + (mult_per + Σach_per_add) × 達成数（一覧にある id だけ数える, spec/24・spec/25）。 */
  achMult(): number {
    return 1 + (this.spec.achievements.multPer + this.treeTotalsState.achPerAdd) * this.achCountState;
  }

  /** 覚醒の累計回数。 */
  getAwakenTotal(): number {
    return this.awakenTotalState;
  }

  /** 実績の指標1つの今の値（Engine 側の値は引数で受け取る）。 */
  private metricValue(metric: AchievementMetric, eng: EngineAchievementMetrics): number {
    switch (metric) {
      case 'ballsTotal':
        return this.totalTotalState;
      case 'medalsEarned':
        return this.medalsEarnedState;
      case 'refPerSec':
        return this.getRefPerSec();
      case 'yakumono': {
        let n = 0;
        for (let i = 0; i < 8; i = i + 1) {
          if ((this.lvState[i] as number) >= 1) {
            n = n + 1;
          }
        }
        return n;
      }
      case 'awakenTotal':
        return this.awakenTotalState;
      case 'rateStage':
        return this.rateStageState;
      case 'streakDays':
        return this.streakDaysState;
      case 'firstHits':
        return eng.firstHits;
      case 'jackpots':
        return eng.jackpots;
      case 'maxChain':
        return eng.maxChain;
      case 'closes':
        return eng.closes;
    }
  }

  /** 実績の指標の今の値（進捗表示用。Engine 側の値は引数で受け取る）。 */
  achievementMetrics(eng: EngineAchievementMetrics): Record<AchievementMetric, number> {
    return {
      ballsTotal: this.metricValue('ballsTotal', eng),
      medalsEarned: this.metricValue('medalsEarned', eng),
      refPerSec: this.metricValue('refPerSec', eng),
      yakumono: this.metricValue('yakumono', eng),
      awakenTotal: this.metricValue('awakenTotal', eng),
      rateStage: this.metricValue('rateStage', eng),
      streakDays: this.metricValue('streakDays', eng),
      firstHits: this.metricValue('firstHits', eng),
      jackpots: this.metricValue('jackpots', eng),
      maxChain: this.metricValue('maxChain', eng),
      closes: this.metricValue('closes', eng),
    };
  }

  /**
   * economyTick の最後の実績判定（一覧を添字順に見て、未達成で 値 ≥ at のものを達成にする。
   * achMult は次の tick から効く。達成した id を一覧の順で返す, spec/24）。
   */
  onAchievementTick(at: number, eng: EngineAchievementMetrics): string[] {
    const list = this.spec.achievements.list;
    if (this.achCountState >= list.length) {
      return [];
    }
    // 毎秒呼ばれるので、まず指標ごとの未達成の最小しきい値に届いたものがあるかだけ見る（添字は ACHIEVEMENT_METRICS の順）。
    const mins = this.achMinAt;
    const reached = (i: number, value: number): boolean => {
      const minAt = mins[i] as number;
      return minAt > 0 && value >= minAt;
    };
    const any =
      reached(0, this.totalTotalState) ||
      reached(1, this.medalsEarnedState) ||
      reached(4, this.awakenTotalState) ||
      reached(5, this.rateStageState) ||
      reached(6, this.streakDaysState) ||
      reached(7, eng.firstHits) ||
      reached(8, eng.jackpots) ||
      reached(9, eng.maxChain) ||
      reached(10, eng.closes) ||
      ((mins[3] as number) > 0 && this.metricValue('yakumono', eng) >= (mins[3] as number)) ||
      ((mins[2] as number) > 0 && this.getRefPerSec() >= (mins[2] as number));
    if (!any) {
      return [];
    }
    let ref = -1;
    const out: string[] = [];
    for (let i = 0; i < list.length; i = i + 1) {
      if (this.achievedFlags[i] === true) {
        continue;
      }
      const def = list[i] as AchievementDef;
      let value: number;
      if (def.metric === 'refPerSec') {
        if (ref < 0) {
          ref = this.getRefPerSec();
        }
        value = ref;
      } else {
        value = this.metricValue(def.metric, eng);
      }
      if (value >= def.at) {
        this.achievedFlags[i] = true;
        this.achievedState.push({ id: def.id, at });
        out.push(def.id);
      }
    }
    this.achCountState = this.achCountState + out.length;
    this.rebuildAchMinAt();
    return out;
  }

  /** 実績の表示（達成順・今の achMult・指標の今の値）。 */
  getAchievementsView(eng: EngineAchievementMetrics): AchievementsView {
    return {
      done: this.achievedState.map((r) => ({ id: r.id, at: r.at })),
      mult: this.achMult(),
      metrics: this.achievementMetrics(eng),
    };
  }

  /** 独立した複製。 */
  fork(): IdleEconomy {
    const e = new IdleEconomy(this.spec);
    e.restore(this.snapshot());
    e.setMachineId(this.machineIdState);
    return e;
  }

  /** 燃料タンク上限ms。 */
  tankCapMs(): number {
    const h = this.spec.upgrades.tankHours[this.tankStageState];
    if (h === undefined) {
      fail('tankStage out of range');
    }
    return ((h as number) + this.treeTotalsState.tankAddH) * 3600000;
  }

  /** 新規開始・閉店後の持ち玉（役物0からの再出発に使う）。 */
  startBalls(): number {
    return this.spec.close.startBalls;
  }

  /** ブースト上限ms。 */
  boostCapMs(): number {
    return (this.spec.upgrades.boostCapHours + this.treeTotalsState.boostCapAddH) * 3600000;
  }

  /** 放置効率（現在の値）。 */
  idleValue(): number {
    const v = this.spec.upgrades.idleValues[this.idleStageState];
    if (v === undefined) {
      fail('idleStage out of range');
    }
    return v as number;
  }

  /** 覚醒倍率（10^awakenedを乗算で）。 */
  yakumonoMult(idx: number): number {
    const n = this.awakenedState[idx];
    if (n === undefined) {
      fail('yakumono index out of range');
    }
    return this.awakenMultOf(n as number);
  }

  /** 覚醒 n 回の倍率（mult^n を乗算で）。 */
  private awakenMultOf(n: number): number {
    let m = 1;
    for (let i = 0; i < n; i = i + 1) {
      m = m * this.spec.awaken.mult;
    }
    return m;
  }

  /** 共鳴の係数（awaken.resonance + Σresonance_add）。 */
  private resonanceRate(): number {
    return this.spec.awaken.resonance + this.treeTotalsState.resonanceAdd;
  }

  /** 共鳴の倍率 1 + 係数 × 覚醒の総数（今の周回の Σawakened。保持した覚醒も数える）。 */
  private resonanceOf(aws: readonly number[]): number {
    const rate = this.resonanceRate();
    if (rate === 0) {
      return 1;
    }
    let n = 0;
    for (let i = 0; i < 8; i = i + 1) {
      n = n + (aws[i] as number);
    }
    return 1 + rate * n;
  }

  /** 役物ごとの毎秒生産（強化・覚醒・マイルストーン込み、状態係数なし。Lv・覚醒が変わるまでキャッシュ）。 */
  basePerSec(): number {
    if (this.basePerSecCache >= 0) {
      return this.basePerSecCache;
    }
    const sum = this.basePerSecOf(this.lvState, this.awakenedState);
    this.basePerSecCache = sum;
    return sum;
  }

  /** 役物の Lv と覚醒数から毎秒生産の和を出す（共鳴込み）。 */
  private basePerSecOf(lvs: readonly number[], aws: readonly number[]): number {
    let sum = 0;
    for (let i = 0; i < 8; i = i + 1) {
      const def = this.spec.yakumono[i];
      if (def === undefined) {
        fail('yakumono out of range');
      }
      const lv = lvs[i] as number;
      if (lv === 0) {
        continue;
      }
      const period = effectivePeriodS(
        (def as { periodS: number }).periodS,
        lv,
        this.spec.milestones.thresholds,
        this.spec.milestones.step,
        this.spec.milestones.stepFrom,
      );
      const per = ((def as { yield: number }).yield * lv * this.awakenMultOf(aws[i] as number)) / period;
      sum = sum + per;
    }
    if (sum === 0) {
      return 0;
    }
    return sum * this.resonanceOf(aws);
  }

  /** 今のツリーで開店した時の役物 Lv（starter の絶対 Lv と、前の周回の最高 Lv × starter_rel の切り捨ての大きい方。前の役物が 0 なら 0）。 */
  private openLvs(): number[] {
    const t = this.treeTotalsState;
    const out: number[] = [];
    for (let i = 0; i < 8; i = i + 1) {
      let lv = t.starter[i] as number;
      if (t.starterRel > 0) {
        const rel = Math.floor((this.prevMaxLvState[i] as number) * t.starterRel);
        if (rel > lv) {
          lv = rel;
        }
      }
      if (i > 0 && (out[i - 1] as number) === 0) {
        lv = 0;
      }
      out.push(lv);
    }
    return out;
  }

  /** 今のツリーで開店した時の覚醒数（keep awaken_all は全役物、awaken_low は風車〜クルーンを残す。他は 0）。 */
  private openAwakened(): number[] {
    const keep = this.treeTotalsState.keep;
    const all = keep[TREE_KEEP_AWAKEN_ALL] === true;
    const low = keep[TREE_KEEP_AWAKEN_LOW] === true;
    const out: number[] = [];
    for (let i = 0; i < 8; i = i + 1) {
      out.push(all || (low && i < TREE_AWAKEN_LOW_COUNT) ? (this.awakenedState[i] as number) : 0);
    }
    return out;
  }

  /** 覚醒すると基準生産が何倍になるか（Lv が足りなければ null。今の生産が 0 なら null）。 */
  private awakenGainOf(idx: number): number | null {
    const lv = this.lvState[idx] as number;
    if (lv < this.spec.awaken.minLv) {
      return null;
    }
    const now = this.basePerSec();
    if (!(now > 0)) {
      return null;
    }
    const lvs = [...this.lvState];
    const aws = [...this.awakenedState];
    if (this.spec.awaken.resetLv) {
      lvs[idx] = 0;
    }
    aws[idx] = (aws[idx] as number) + 1;
    return this.basePerSecOf(lvs, aws) / now;
  }

  /** 今の周回の最高 Lv を今の Lv で更新する（Lv が増えた時に呼ぶ）。 */
  private noteRunMax(idx: number): void {
    const lv = this.lvState[idx] as number;
    if (lv > (this.runMaxLvState[idx] as number)) {
      this.runMaxLvState[idx] = lv;
    }
  }

  /** 現在の毎秒生産（常連・連日・実績・ツリー・ブースト・予告フィーバー・開店ダッシュ・状態係数込み, spec/25）。 */
  getPerSec(fg: boolean, fuelMs: number): number {
    if (this.restAtState !== null) {
      return 0;
    }
    const base = this.basePerSec();
    if (base === 0) {
      return 0;
    }
    const t = this.treeTotalsState;
    const regularF = 1 + this.regularRate() * this.regularState;
    let stateF = this.spec.factors.closed + t.closedAdd;
    if (fuelMs > 0) {
      stateF = fg ? this.spec.factors.fg : this.idleValue();
    }
    let boostF = 1;
    if (this.boostOnState && this.boostMsState > 0 && fg) {
      boostF = this.spec.factors.boostMult + t.boostMultAdd;
    }
    let feverF = 1;
    if (this.feverMsState > 0) {
      feverF = this.spec.notice.feverMult + t.feverMultAdd;
    }
    let openF = 1;
    if (this.openBoostMsState > 0) {
      openF = 1 + t.openBoostMultAdd;
    }
    return base * regularF * this.streakF() * this.achMult() * this.treeMult() * boostF * feverF * openF * stateF;
  }

  /** フィーバー残量ms（前面・背面を問わずtickで減る）。 */
  getFeverMs(): number {
    return this.feverMsState;
  }

  /** フィーバー発動（残量の延長は長い方を取る）。 */
  onNoticeFever(): void {
    const want = this.spec.notice.feverMs + this.treeTotalsState.feverMsAdd;
    if (want > this.feverMsState) {
      this.feverMsState = want;
    }
  }

  /** 基準生産（前面・燃料ありの値。実績・ツリーは含み、ブースト・予告フィーバー・開店ダッシュ・状態係数を含まず下限あり, D-080・D-095・spec/25）。 */
  getRefPerSec(): number {
    const base = this.basePerSec();
    const regularF = 1 + this.regularRate() * this.regularState;
    const ref = base * regularF * this.streakF() * this.achMult() * this.treeMult();
    const min = this.spec.prodRef.minPerSec;
    return ref > min ? ref : min;
  }

  /** 今のツリーで開店した直後の基準生産（役物 Lv・覚醒は開店時の形。休業中の行動の即時の玉に使う, D-108）。 */
  private openRefPerSec(): number {
    const base = this.basePerSecOf(this.openLvs(), this.openAwakened());
    const regularF = 1 + this.regularRate() * this.regularState;
    const ref = base * regularF * this.streakF() * this.achMult() * this.treeMult();
    const min = this.spec.prodRef.minPerSec;
    return ref > min ? ref : min;
  }

  /** 発射単価の秒数（生産何秒ぶんか, D-090）。 */
  getShotS(): number {
    return this.spec.pachinko.shotS;
  }

  /** 1発の単価 unit＝floor(rate×refPerSec×shotS)、最低 rate（発射時点の ref。無料は rate1, D-090。解放チェックはしない）。 */
  getShotUnit(rate: number): number {
    if (Math.floor(rate) !== rate || rate < 1) {
      fail('shot rate must be a positive int');
    }
    return shotUnit(rate, this.getRefPerSec(), this.spec.pachinko.shotS);
  }

  /** 解放チェックなしの単価（表示・測試用。rate の解放は問わない）。 */
  shotUnitUnchecked(rate: number): number {
    if (Math.floor(rate) !== rate || rate < 1) {
      fail('shot rate must be a positive int');
    }
    return shotUnit(rate, this.getRefPerSec(), this.spec.pachinko.shotS);
  }

  /** 累計獲得メダル。 */
  getMedalsEarned(): number {
    return this.medalsEarnedState;
  }

  /** ブースト残量ms。 */
  getBoostMs(): number {
    return this.boostMsState;
  }

  /** 常連P。 */
  getRegular(): number {
    return this.regularState;
  }

  /** 今回累計玉。 */
  getRunTotal(): number {
    return this.runTotalState;
  }

  /** 全期間累計玉。 */
  getTotalTotal(): number {
    return this.totalTotalState;
  }

  /** 連続日数。 */
  getStreakDays(): number {
    return this.streakDaysState;
  }

  /** 役物表示（Lv・覚醒・次の単価）。 */
  getYakumonoViews(): IdleYakumonoView[] {
    const out: IdleYakumonoView[] = [];
    for (let i = 0; i < 8; i = i + 1) {
      const def = this.spec.yakumono[i] as { id: string; basePrice: number };
      const lv = this.lvState[i] as number;
      const awakened = this.awakenedState[i] as number;
      out.push({
        id: def.id,
        lv,
        awakened,
        nextPrice: (def.basePrice as number) * growthPow(this.priceTable, lv) * this.priceMult(),
      });
    }
    return out;
  }

  /** 釘q（現在の値。T3のパチンコ接続用）。 */
  nailQ(): number {
    const v = this.spec.upgrades.nailValues[this.nailStageState];
    if (v === undefined) {
      fail('nailStage out of range');
    }
    return v as number;
  }

  /**
   * 予告の設定（Engineのスケジュール・効果判定用。ツリー込み, spec/25。参照を返さないよう複写）。
   * autoMs は notice_auto の遅れ（無ければ -1）、grantBonus1In は行動の特別保留の当たり 1/n（grant_hold_1_in が無ければ bonus1In）。
   */
  getNoticeConfig(): {
    minFgMs: number;
    maxFgMs: number;
    displayMs: number;
    feverMult: number;
    feverMs: number;
    feverWeight: number;
    rushRate: number;
    rushCapS: number;
    rushWeight: number;
    bonus1In: number;
    bonusWeight: number;
    intervalMult: number;
    autoMs: number;
    grantBonus1In: number;
  } {
    const n = this.spec.notice;
    const t = this.treeTotalsState;
    return {
      autoMs: t.noticeAutoMs,
      grantBonus1In: t.grantHold1In > 0 ? t.grantHold1In : n.bonus1In,
      minFgMs: n.minFgMs,
      maxFgMs: n.maxFgMs,
      displayMs: n.displayMs,
      feverMult: n.feverMult + t.feverMultAdd,
      feverMs: n.feverMs + t.feverMsAdd,
      feverWeight: n.feverWeight,
      rushRate: n.rushRate,
      rushCapS: n.rushCapS + t.rushCapAddS,
      rushWeight: n.rushWeight,
      bonus1In: n.bonus1In,
      bonusWeight: n.bonusWeight + t.noticeBonusWeightAdd,
      intervalMult: 1 - t.noticeIntervalSub,
    };
  }

  /** 変動短縮の適用回数（T3用）。 */
  shortenCount(): number {
    return this.shortenStageState;
  }

  /** 変動短縮の倍率（factor^stagesを乗算で）。 */
  shortenMult(): number {
    let m = 1;
    for (let i = 0; i < this.shortenStageState; i = i + 1) {
      m = m * this.spec.upgrades.shortenFactor;
    }
    return m;
  }

  /** 保留プラスの適用回数（T3用）。 */
  holdPlusCount(): number {
    return this.holdStageState;
  }

  /** 実効hold_max（base+holdPlus、上限6）。 */
  effectiveHoldMax(baseHoldMax: number): number {
    if (Math.floor(baseHoldMax) !== baseHoldMax || baseHoldMax < 1 || baseHoldMax > 8) {
      fail('baseHoldMax out of range');
    }
    const v = baseHoldMax + this.holdStageState;
    return v > 6 ? 6 : v;
  }

  /** 役物の実効周期s（マイルストーン込み。描画位相用）。 */
  effectivePeriodSFor(id: string, lv: number): number {
    const idx = this.yakumonoIndex(id);
    if (idx < 0) {
      fail('unknown yakumono');
    }
    const def = this.spec.yakumono[idx] as { periodS: number };
    if (Math.floor(lv) !== lv || lv < 0) {
      fail('lv out of range');
    }
    return effectivePeriodS(
      (def as { periodS: number }).periodS,
      lv,
      this.spec.milestones.thresholds,
      this.spec.milestones.step,
      this.spec.milestones.stepFrom,
    );
  }

  /** オート打ちの解放済みか。 */
  isAutoUnlocked(): boolean {
    return this.autoOwnedState;
  }

  /** 止め打ちの所持か。 */
  isTomeuchiEnabled(): boolean {
    return this.tomeuchiOwnedState;
  }

  /** 解放済みのレート（rates[0..rateStage]。昇順）。 */
  getUnlockedRates(): number[] {
    const rates = this.spec.upgrades.rates;
    if (this.rateStageState >= rates.length) {
      fail('rateStage out of range');
    }
    const out: number[] = [];
    for (let i = 0; i <= this.rateStageState; i = i + 1) {
      out.push(rates[i] as number);
    }
    return out;
  }

  /** レートが解放済みか（rates[0..rateStage]のいずれかと一致）。 */
  isRateAllowed(rate: number): boolean {
    if (Math.floor(rate) !== rate || rate < 1) {
      return false;
    }
    const rates = this.spec.upgrades.rates;
    const maxIdx = this.rateStageState;
    if (maxIdx >= rates.length) {
      fail('rateStage out of range');
    }
    for (let i = 0; i <= maxIdx; i = i + 1) {
      if ((rates[i] as number) === rate) {
        return true;
      }
    }
    return false;
  }

  /** Grant適用（燃料は上限・溢れ→ブースト、メダル加算（累計獲得も）、連日更新）。 */
  onGrant(
    fuelMs: number,
    medals: number,
    streakDay: string | undefined,
    curFuelMs: number,
    curMedals: number,
  ): { fuelMs: number; medals: number; fuelRefilled: boolean } {
    asNonNegInt(fuelMs, 'grant.fuelMs');
    asNonNegInt(medals, 'grant.medals');
    asFinite(curFuelMs, 'curFuelMs');
    asFinite(curMedals, 'curMedals');
    if (curFuelMs < 0 || curMedals < 0) {
      fail('current balances must be >= 0');
    }
    if (streakDay !== undefined) {
      this.applyStreakDay(streakDay);
    }
    this.medalsEarnedState = this.medalsEarnedState + medals;
    const cap = this.tankCapMs();
    const boostCap = this.boostCapMs();
    let fuel = curFuelMs;
    if (fuelMs > 0) {
      const space = cap - fuel;
      if (space >= fuelMs) {
        fuel = fuel + fuelMs;
      } else if (space > 0) {
        fuel = cap;
        const overflow = fuelMs - space;
        const boostSpace = boostCap - this.boostMsState;
        const add = overflow < boostSpace ? overflow : boostSpace;
        if (add > 0) {
          this.boostMsState = this.boostMsState + add;
        }
      } else {
        const boostSpace = boostCap - this.boostMsState;
        const add = fuelMs < boostSpace ? fuelMs : boostSpace;
        if (add > 0) {
          this.boostMsState = this.boostMsState + add;
        }
      }
    }
    const fuelRefilled = curFuelMs === 0 && fuel > 0;
    return { fuelMs: fuel, medals: curMedals + medals, fuelRefilled };
  }

  /** 連日を更新する（不正な日付は無視）。 */
  private applyStreakDay(day: string): void {
    if (parseDay(day) === null) {
      return;
    }
    if (this.lastStreakDayState === '') {
      this.streakDaysState = 1;
      this.lastStreakDayState = day;
      return;
    }
    if (day === this.lastStreakDayState) {
      return;
    }
    if (isNextDay(this.lastStreakDayState, day)) {
      this.streakDaysState = this.streakDaysState + 1;
      this.lastStreakDayState = day;
      return;
    }
    if (day > this.lastStreakDayState) {
      this.streakDaysState = 1;
      this.lastStreakDayState = day;
    }
  }

  /** 1000ms分の生産と消費（開始時状態で1秒分。燃料・ブースト・フィーバーを消費し玉を産む）。 */
  onTick(fg: boolean, curFuelMs: number): { ballGain: number; fuelMs: number; fuelBecameEmpty: boolean } {
    asFinite(curFuelMs, 'curFuelMs');
    if (curFuelMs < 0) {
      fail('fuelMs must be >= 0');
    }
    // 休業中は生産も消費もしない（燃料・ブースト・フィーバー・開店ダッシュを減らさない, D-107）。
    if (this.restAtState !== null) {
      return { ballGain: 0, fuelMs: curFuelMs, fuelBecameEmpty: false };
    }
    const perSec = this.getPerSec(fg, curFuelMs);
    const gain = perSec;
    if (gain > 0) {
      this.runTotalState = addAmount(this.runTotalState, gain);
      this.totalTotalState = addAmount(this.totalTotalState, gain);
    }
    let fuel = curFuelMs;
    let becameEmpty = false;
    if (fuel > 0) {
      if (fuel <= 1000) {
        fuel = 0;
        becameEmpty = true;
      } else {
        fuel = fuel - 1000;
      }
    }
    if (this.boostOnState && this.boostMsState > 0 && fg) {
      if (this.boostMsState <= 1000) {
        this.boostMsState = 0;
      } else {
        this.boostMsState = this.boostMsState - 1000;
      }
    }
    if (this.feverMsState > 0) {
      if (this.feverMsState <= 1000) {
        this.feverMsState = 0;
      } else {
        this.feverMsState = this.feverMsState - 1000;
      }
    }
    if (this.openBoostMsState > 0) {
      this.openBoostMsState = this.openBoostMsState <= 1000 ? 0 : this.openBoostMsState - 1000;
    }
    return { ballGain: gain, fuelMs: fuel, fuelBecameEmpty: becameEmpty };
  }

  /** パチンコ払い出しなどの外部獲得を累計に足す（残高はEngineが足す）。 */
  noteGain(amount: number): void {
    asFinite(amount, 'amount');
    if (amount <= 0) {
      return;
    }
    this.runTotalState = addAmount(this.runTotalState, amount);
    this.totalTotalState = addAmount(this.totalTotalState, amount);
  }

  /** 強化画面の表示（役物の毎秒・まとめ買い価格・覚醒、強化の段と次の価格、閉店の見込み）。 */
  getShopView(): ShopView {
    const sizes = [1];
    for (let i = 0; i < this.spec.bulkSizes.length; i = i + 1) {
      sizes.push(this.spec.bulkSizes[i] as number);
    }
    const yakumono: ShopYakumonoView[] = [];
    for (let i = 0; i < 8; i = i + 1) {
      const def = this.spec.yakumono[i] as { id: string; periodS: number; yield: number; basePrice: number };
      const lv = this.lvState[i] as number;
      const awakened = this.awakenedState[i] as number;
      const prices: (number | null)[] = [];
      for (let k = 0; k < sizes.length; k = k + 1) {
        const n = sizes[k] as number;
        prices.push(
          lv + n - 1 < this.priceTable.length
            ? yakumonoBulkPrice(def.basePrice, lv, n, this.priceTable) * this.priceMult()
            : null,
        );
      }
      const period = lv > 0 ? this.effectivePeriodSFor(def.id, lv) : 0;
      const resonanceF = this.resonanceOf(this.awakenedState);
      yakumono.push({
        id: def.id,
        lv,
        awakened,
        locked: i > 0 && (this.lvState[i - 1] as number) < 1,
        perSec: period > 0 ? ((def.yield * lv * this.yakumonoMult(i)) / period) * resonanceF : 0,
        prices,
        awakenCost: awakenMedalCost(this.awakenBase(), this.spec.awaken.medalGrowth, awakened),
        awakenReady: lv >= this.spec.awaken.minLv,
        awakenGain: this.awakenGainOf(i),
      });
    }
    const u = this.spec.upgrades;
    const staged = (
      id: ShopUpgradeId,
      stage: number,
      costs: readonly number[],
      values: readonly number[],
      currency: 'balls' | 'medals',
    ): ShopUpgradeView => ({
      id,
      stage,
      stages: costs.length,
      currency,
      cost: stage < costs.length ? (costs[stage] as number) : null,
      value: values[stage] as number,
      next: stage < costs.length ? (values[stage + 1] as number) : null,
    });
    const shortenValues: number[] = [1];
    for (let i = 0; i < u.shortenCosts.length; i = i + 1) {
      shortenValues.push((shortenValues[i] as number) * u.shortenFactor);
    }
    const holdValues: number[] = [];
    for (let i = 0; i <= u.holdPlusCosts.length; i = i + 1) {
      holdValues.push(i);
    }
    const upgrades: ShopUpgradeView[] = [
      staged('idle', this.idleStageState, u.idleCosts, u.idleValues, 'balls'),
      staged('tank', this.tankStageState, u.tankCosts, u.tankHours, 'balls'),
      staged('nail', this.nailStageState, u.nailCosts, u.nailValues, 'balls'),
      staged('shorten', this.shortenStageState, u.shortenCosts, shortenValues, 'balls'),
      staged('hold', this.holdStageState, u.holdPlusCosts, holdValues, 'balls'),
      staged('auto', this.autoOwnedState ? 1 : 0, [u.autoCost], [0, 1], 'balls'),
      staged('tomeuchi', this.tomeuchiOwnedState ? 1 : 0, [u.tomeuchiCost], [0, 1], 'balls'),
      staged('rate', this.rateStageState, u.rateMedalCosts, u.rates, 'medals'),
    ];
    const c = this.spec.close;
    const byBalls = ballPoints(this.totalTotalState, c.divisor);
    const byMedals = Math.floor(this.medalsEarnedState / c.medalsPerPoint);
    return {
      yakumono,
      upgrades,
      close: {
        runTotal: this.runTotalState,
        required: c.requiredRunTotal,
        ready: this.runTotalState >= c.requiredRunTotal,
        gain: closeGain(this.totalTotalState, c.divisor, this.regularState, this.medalsEarnedState, c.medalsPerPoint),
        byBalls,
        byMedals,
        totalTotal: this.totalTotalState,
        nextBallsAt: (byBalls + 1) * (byBalls + 1) * (byBalls + 1) * c.divisor,
        nextMedalsAt: (byMedals + 1) * c.medalsPerPoint,
        points: this.nextClosePoints(),
      },
      regular: this.regularState,
      streakDays: this.streakDaysState,
      medalsEarned: this.medalsEarnedState,
      boostOn: this.boostOnState,
      resonance: {
        rate: this.resonanceRate(),
        count: this.awakenedState.reduce((a, b) => a + b, 0),
        mult: this.resonanceOf(this.awakenedState),
      },
      keptAwakened: this.openAwakened().reduce((a, b) => a + b, 0),
    };
  }

  /** 役物index（-1は該当なし）。 */
  private yakumonoIndex(id: string): number {
    for (let i = 0; i < ECONOMY_YAKUMONO_IDS.length; i = i + 1) {
      if (ECONOMY_YAKUMONO_IDS[i] === id) {
        return i;
      }
    }
    return -1;
  }

  /** 購入（成功時は残高を返し、失敗時は reason を返す）。 */
  onBuy(
    target: string,
    count: number,
    curBalls: number,
    curMedals: number,
  ): { ok: true; balls: number; medals: number } | { ok: false; reason: string } {
    asFinite(curBalls, 'curBalls');
    asFinite(curMedals, 'curMedals');
    if (curBalls < 0 || curMedals < 0) {
      return { ok: false, reason: 'insufficient' };
    }
    if (typeof target !== 'string' || target.length === 0) {
      return { ok: false, reason: 'unknown-target' };
    }
    if (Math.floor(count) !== count || count < 1) {
      return { ok: false, reason: 'invalid-count' };
    }
    const yIdx = this.yakumonoIndex(target);
    if (yIdx >= 0) {
      if (count !== 1 && count !== 10 && count !== 100) {
        return { ok: false, reason: 'invalid-count' };
      }
      if (yIdx > 0 && (this.lvState[yIdx - 1] as number) < 1) {
        return { ok: false, reason: 'locked' };
      }
      const def = this.spec.yakumono[yIdx] as { basePrice: number };
      const lv = this.lvState[yIdx] as number;
      const price = yakumonoBulkPrice(def.basePrice as number, lv, count, this.priceTable) * this.priceMult();
      if (curBalls < price) {
        return { ok: false, reason: 'insufficient-balls' };
      }
      this.lvState[yIdx] = lv + count;
      this.noteRunMax(yIdx);
      this.basePerSecCache = -1;
      return { ok: true, balls: curBalls - price, medals: curMedals };
    }
    if (count !== 1) {
      return { ok: false, reason: 'invalid-count' };
    }
    if (target === 'idle') {
      const costs = this.spec.upgrades.idleCosts;
      if (this.idleStageState >= costs.length) {
        return { ok: false, reason: 'maxed' };
      }
      const cost = costs[this.idleStageState] as number;
      if (curBalls < cost) {
        return { ok: false, reason: 'insufficient-balls' };
      }
      this.idleStageState = this.idleStageState + 1;
      return { ok: true, balls: curBalls - cost, medals: curMedals };
    }
    if (target === 'tank') {
      const costs = this.spec.upgrades.tankCosts;
      if (this.tankStageState >= costs.length) {
        return { ok: false, reason: 'maxed' };
      }
      const cost = costs[this.tankStageState] as number;
      if (curBalls < cost) {
        return { ok: false, reason: 'insufficient-balls' };
      }
      this.tankStageState = this.tankStageState + 1;
      return { ok: true, balls: curBalls - cost, medals: curMedals };
    }
    if (target === 'nail') {
      const costs = this.spec.upgrades.nailCosts;
      if (this.nailStageState >= costs.length) {
        return { ok: false, reason: 'maxed' };
      }
      const cost = costs[this.nailStageState] as number;
      if (curBalls < cost) {
        return { ok: false, reason: 'insufficient-balls' };
      }
      this.nailStageState = this.nailStageState + 1;
      return { ok: true, balls: curBalls - cost, medals: curMedals };
    }
    if (target === 'shorten') {
      const costs = this.spec.upgrades.shortenCosts;
      if (this.shortenStageState >= costs.length) {
        return { ok: false, reason: 'maxed' };
      }
      const cost = costs[this.shortenStageState] as number;
      if (curBalls < cost) {
        return { ok: false, reason: 'insufficient-balls' };
      }
      this.shortenStageState = this.shortenStageState + 1;
      return { ok: true, balls: curBalls - cost, medals: curMedals };
    }
    if (target === 'hold') {
      const costs = this.spec.upgrades.holdPlusCosts;
      if (this.holdStageState >= costs.length) {
        return { ok: false, reason: 'maxed' };
      }
      const cost = costs[this.holdStageState] as number;
      if (curBalls < cost) {
        return { ok: false, reason: 'insufficient-balls' };
      }
      this.holdStageState = this.holdStageState + 1;
      return { ok: true, balls: curBalls - cost, medals: curMedals };
    }
    if (target === 'auto') {
      if (this.autoOwnedState) {
        return { ok: false, reason: 'maxed' };
      }
      const cost = this.spec.upgrades.autoCost;
      if (curBalls < cost) {
        return { ok: false, reason: 'insufficient-balls' };
      }
      this.autoOwnedState = true;
      return { ok: true, balls: curBalls - cost, medals: curMedals };
    }
    if (target === 'tomeuchi') {
      if (this.tomeuchiOwnedState) {
        return { ok: false, reason: 'maxed' };
      }
      const cost = this.spec.upgrades.tomeuchiCost;
      if (curBalls < cost) {
        return { ok: false, reason: 'insufficient-balls' };
      }
      this.tomeuchiOwnedState = true;
      return { ok: true, balls: curBalls - cost, medals: curMedals };
    }
    if (target === 'rate') {
      const costs = this.spec.upgrades.rateMedalCosts;
      if (this.rateStageState >= costs.length) {
        return { ok: false, reason: 'maxed' };
      }
      const cost = costs[this.rateStageState] as number;
      if (curMedals < cost) {
        return { ok: false, reason: 'insufficient-medals' };
      }
      this.rateStageState = this.rateStageState + 1;
      return { ok: true, balls: curBalls, medals: curMedals - cost };
    }
    return { ok: false, reason: 'unknown-target' };
  }

  /** 覚醒（Lv≥minLv で倍率 ×mult・reset_lv なら Lv→0、メダル消費。覚醒数は共鳴にも効く）。 */
  onAwaken(id: string, curMedals: number): { ok: true; medals: number } | { ok: false; reason: string } {
    asFinite(curMedals, 'curMedals');
    const idx = this.yakumonoIndex(id);
    if (idx < 0) {
      return { ok: false, reason: 'unknown-target' };
    }
    const lv = this.lvState[idx] as number;
    if (lv < this.spec.awaken.minLv) {
      return { ok: false, reason: 'not-ready' };
    }
    const awakened = this.awakenedState[idx] as number;
    const cost = awakenMedalCost(this.awakenBase(), this.spec.awaken.medalGrowth, awakened);
    if (curMedals < cost) {
      return { ok: false, reason: 'insufficient-medals' };
    }
    if (this.spec.awaken.resetLv) {
      this.lvState[idx] = 0;
    }
    this.awakenedState[idx] = awakened + 1;
    this.awakenTotalState = this.awakenTotalState + 1;
    this.basePerSecCache = -1;
    return { ok: true, medals: curMedals - cost };
  }

  /** ブーストのON/OFF。 */
  onBoost(on: boolean): void {
    this.boostOnState = on;
  }

  /** 番頭さんの ON/OFF（未所持は not-owned, spec/25）。 */
  onBantou(on: boolean): { ok: true } | { ok: false; reason: string } {
    if (!this.treeTotalsState.bantou) {
      return { ok: false, reason: 'not-owned' };
    }
    this.bantouOnState = on;
    return { ok: true };
  }

  /**
   * 番頭さんの自動購入（Engine が 60,000ms の倍数の economyTick で呼ぶ, spec/25）。所持かつ ON の時だけ、
   * 持ち玉 × share を上限に「次の Lv が最も安い役物」を1 Lv ずつ買う（同額は添字の小さい方・解放は前の役物 Lv1・1回 max_per_run まで）。
   */
  onBantouTick(curBalls: number): { balls: number; spent: number } {
    asFinite(curBalls, 'curBalls');
    if (!this.bantouOnState || !this.treeTotalsState.bantou || !(curBalls > 0) || this.restAtState !== null) {
      return { balls: curBalls, spent: 0 };
    }
    const b = this.spec.tree.bantou;
    let budget = curBalls * b.share;
    let spent = 0;
    const pm = this.priceMult();
    for (let n = 0; n < b.maxPerRun; n = n + 1) {
      let best = -1;
      let bestPrice = 0;
      for (let i = 0; i < 8; i = i + 1) {
        const lv = this.lvState[i] as number;
        if ((i > 0 && (this.lvState[i - 1] as number) < 1) || lv + 1 > this.priceTable.length) {
          continue;
        }
        const price = (this.spec.yakumono[i] as { basePrice: number }).basePrice * growthPow(this.priceTable, lv) * pm;
        if (best < 0 || price < bestPrice) {
          best = i;
          bestPrice = price;
        }
      }
      if (best < 0 || bestPrice > budget) {
        break;
      }
      this.lvState[best] = (this.lvState[best] as number) + 1;
      this.noteRunMax(best);
      budget = budget - bestPrice;
      spent = spent + bestPrice;
    }
    if (spent > 0) {
      this.basePerSecCache = -1;
    }
    return { balls: curBalls - spent, spent };
  }

  /** 休業中か（閉店から開店まで, D-107）。 */
  isResting(): boolean {
    return this.restAtState !== null;
  }

  /** 自動で開店する時刻（restAt + rest_max_ms。休業中でなければ null）。 */
  getAutoOpenAt(): number | null {
    return this.restAtState === null ? null : this.restAtState + this.spec.close.restMaxMs;
  }

  /** 休業の表示（休業中でなければ null）。 */
  getRestView(): RestView | null {
    if (this.restAtState === null) {
      return null;
    }
    return {
      since: this.restAtState,
      autoOpenAt: this.restAtState + this.spec.close.restMaxMs,
      pendingBalls: this.restPendingBallsState,
    };
  }

  /**
   * 休業中の行動の即時の玉（refPerSec × prodMin × (1 + Σprod_min_add) × 60 の refPerSec を「今のツリーで開店した直後」の値にして、
   * restPendingBalls に貯める。開店で持ち玉に足す。D-108）。足した玉を返す。
   */
  onRestGrant(prodMin: number): number {
    asFinite(prodMin, 'prodMin');
    if (this.restAtState === null) {
      fail('not resting');
    }
    if (!(prodMin > 0)) {
      return 0;
    }
    const balls = this.openRefPerSec() * prodMin * this.getProdMinMult() * 60;
    this.restPendingBallsState = addAmount(this.restPendingBallsState, balls);
    return balls;
  }

  /** 閉店（条件・常連ランク＋min(玉由来, 行動由来)−既得・常連P。休業に入るだけでリセットは開店で, D-107）。 */
  onClose(at: number): { ok: true; gain: number; points: number } | { ok: false; reason: string } {
    asNonNegInt(at, 'at');
    if (this.restAtState !== null) {
      return { ok: false, reason: 'resting' };
    }
    if (this.runTotalState < this.spec.close.requiredRunTotal) {
      return { ok: false, reason: 'not-ready' };
    }
    const gain = closeGain(
      this.totalTotalState,
      this.spec.close.divisor,
      this.regularState,
      this.medalsEarnedState,
      this.spec.close.medalsPerPoint,
    );
    const points = treeClosePoints(gain, this.runTotalState, this.spec.tree, this.treeTotalsState.pointsAdd);
    this.regularState = this.regularState + gain;
    this.pointsState = this.pointsState + points;
    this.pointsEarnedState = this.pointsEarnedState + points;
    this.restAtState = at;
    this.restPendingBallsState = 0;
    this.prevMaxLvState = [...this.runMaxLvState];
    return { ok: true, gain, points };
  }

  /** 開店（リセット範囲。玉は start_balls ＋休業中の行動の玉。休業中でなければ not-resting, D-107）。 */
  onOpen(): { ok: true; balls: number } | { ok: false; reason: string } {
    if (this.restAtState === null) {
      return { ok: false, reason: 'not-resting' };
    }
    // ツリー: starter・starter_rel の Lv から再出発・keep の強化と覚醒は残す・開店ダッシュを入れる（その時点のツリーで, spec/25。順は TREE_KEEP_TARGETS）。
    const t = this.treeTotalsState;
    this.lvState = this.openLvs();
    this.awakenedState = this.openAwakened();
    this.runMaxLvState = [...this.lvState];
    this.basePerSecCache = -1;
    const keep = t.keep;
    if (keep[0] !== true) {
      this.idleStageState = 0;
    }
    if (keep[1] !== true) {
      this.tankStageState = 0;
    }
    if (keep[2] !== true) {
      this.nailStageState = 0;
    }
    if (keep[3] !== true) {
      this.shortenStageState = 0;
    }
    if (keep[4] !== true) {
      this.holdStageState = 0;
    }
    if (keep[5] !== true) {
      this.autoOwnedState = false;
    }
    if (keep[6] !== true) {
      this.tomeuchiOwnedState = false;
    }
    this.openBoostMsState = t.openBoostMs;
    this.runTotalState = 0;
    const pending = this.restPendingBallsState;
    this.restAtState = null;
    this.restPendingBallsState = 0;
    this.noteGain(pending);
    return { ok: true, balls: addAmount(this.spec.close.startBalls, pending) };
  }
}
