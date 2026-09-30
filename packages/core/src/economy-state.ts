/** 放置経済の状態遷移（spec/23・spec/22入力節。P3-T2）。 */
import type { AchievementDef, AchievementMetric, EconomySpec } from './economy-config.ts';
import { ACHIEVEMENT_METRICS, ECONOMY_YAKUMONO_IDS } from './economy-config.ts';
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
  readonly v: 6;
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
  }

  /** 状態の複写。 */
  snapshot(): IdleEconomySnapshot {
    return {
      v: 6,
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
    };
  }

  /**
   * 複写から復元する（v1 は fever=0、v1/v2 は累計獲得メダル=0、v3 以前の jackpotFeverMult は読んで捨てる、v4 以前は旧レート段を移行 D-090、
   * v5 以前は実績なし・覚醒の累計＝今の周回の Σawakened, spec/24）。
   */
  restore(s: unknown): void {
    if (!isRecord(s)) {
      fail('snapshot must be an object');
    }
    const v = s['v'];
    if (v !== 1 && v !== 2 && v !== 3 && v !== 4 && v !== 5 && v !== 6) {
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
    if (v !== 5 && v !== 6) {
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
    if (v === 3 || v === 4 || v === 5 || v === 6) {
      medalsEarned = asNonNegInt(s['medalsEarned'] as number, 'medalsEarned');
      // v3 以前の jackpotFeverMult は読んで捨てる（D-080 で廃止）。
    }
    const achieved: AchievementRecord[] = [];
    let awakenTotal = 0;
    if (v === 6) {
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

  /** 実績の生産倍率 achMult = 1 + mult_per × 達成数（一覧にある id だけ数える, spec/24）。 */
  achMult(): number {
    return 1 + this.spec.achievements.multPer * this.achCountState;
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
    return e;
  }

  /** 燃料タンク上限ms。 */
  tankCapMs(): number {
    const h = this.spec.upgrades.tankHours[this.tankStageState];
    if (h === undefined) {
      fail('tankStage out of range');
    }
    return (h as number) * 3600000;
  }

  /** 新規開始・閉店後の持ち玉（役物0からの再出発に使う）。 */
  startBalls(): number {
    return this.spec.close.startBalls;
  }

  /** ブースト上限ms。 */
  boostCapMs(): number {
    return this.spec.upgrades.boostCapHours * 3600000;
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
    let m = 1;
    for (let i = 0; i < (n as number); i = i + 1) {
      m = m * this.spec.awaken.mult;
    }
    return m;
  }

  /** 役物ごとの毎秒生産（強化・覚醒・マイルストーン込み、状態係数なし。Lv・覚醒が変わるまでキャッシュ）。 */
  basePerSec(): number {
    if (this.basePerSecCache >= 0) {
      return this.basePerSecCache;
    }
    let sum = 0;
    for (let i = 0; i < 8; i = i + 1) {
      const def = this.spec.yakumono[i];
      if (def === undefined) {
        fail('yakumono out of range');
      }
      const lv = this.lvState[i] as number;
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
      const per = ((def as { yield: number }).yield * lv * this.yakumonoMult(i)) / period;
      sum = sum + per;
    }
    this.basePerSecCache = sum;
    return sum;
  }

  /** 現在の毎秒生産（常連・連日・実績・ブースト・予告フィーバー・状態係数込み）。 */
  getPerSec(fg: boolean, fuelMs: number): number {
    const base = this.basePerSec();
    if (base === 0) {
      return 0;
    }
    const regularF = 1 + this.spec.close.regularMult * this.regularState;
    const streakF = streakMult(
      this.streakDaysState,
      this.spec.claims.streakPerDay,
      this.spec.claims.streakMaxDays,
    );
    let stateF = this.spec.factors.closed;
    if (fuelMs > 0) {
      stateF = fg ? this.spec.factors.fg : this.idleValue();
    }
    let boostF = 1;
    if (this.boostOnState && this.boostMsState > 0 && fg) {
      boostF = this.spec.factors.boostMult;
    }
    let feverF = 1;
    if (this.feverMsState > 0) {
      feverF = this.spec.notice.feverMult;
    }
    return base * regularF * streakF * this.achMult() * boostF * feverF * stateF;
  }

  /** フィーバー残量ms（前面・背面を問わずtickで減る）。 */
  getFeverMs(): number {
    return this.feverMsState;
  }

  /** フィーバー発動（残量の延長は長い方を取る）。 */
  onNoticeFever(): void {
    const want = this.spec.notice.feverMs;
    if (want > this.feverMsState) {
      this.feverMsState = want;
    }
  }

  /** 基準生産（前面・燃料ありの値。実績は含み、ブースト・予告フィーバー・状態係数を含まず下限あり, D-080・D-095）。 */
  getRefPerSec(): number {
    const base = this.basePerSec();
    const regularF = 1 + this.spec.close.regularMult * this.regularState;
    const streakF = streakMult(
      this.streakDaysState,
      this.spec.claims.streakPerDay,
      this.spec.claims.streakMaxDays,
    );
    const ref = base * regularF * streakF * this.achMult();
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
        nextPrice: (def.basePrice as number) * growthPow(this.priceTable, lv),
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

  /** 予告の設定（Engineのスケジュール・効果判定用。参照を返さないよう複写）。 */
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
  } {
    const n = this.spec.notice;
    return {
      minFgMs: n.minFgMs,
      maxFgMs: n.maxFgMs,
      displayMs: n.displayMs,
      feverMult: n.feverMult,
      feverMs: n.feverMs,
      feverWeight: n.feverWeight,
      rushRate: n.rushRate,
      rushCapS: n.rushCapS,
      rushWeight: n.rushWeight,
      bonus1In: n.bonus1In,
      bonusWeight: n.bonusWeight,
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
        prices.push(lv + n - 1 < this.priceTable.length ? yakumonoBulkPrice(def.basePrice, lv, n, this.priceTable) : null);
      }
      const period = lv > 0 ? this.effectivePeriodSFor(def.id, lv) : 0;
      yakumono.push({
        id: def.id,
        lv,
        awakened,
        locked: i > 0 && (this.lvState[i - 1] as number) < 1,
        perSec: period > 0 ? (def.yield * lv * this.yakumonoMult(i)) / period : 0,
        prices,
        awakenCost: awakenMedalCost(this.spec.awaken.medalBase, this.spec.awaken.medalGrowth, awakened),
        awakenReady: lv >= this.spec.awaken.minLv,
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
    return {
      yakumono,
      upgrades,
      close: {
        runTotal: this.runTotalState,
        required: c.requiredRunTotal,
        ready: this.runTotalState >= c.requiredRunTotal,
        gain: closeGain(this.totalTotalState, c.divisor, this.regularState, this.medalsEarnedState, c.medalsPerPoint),
        byBalls: ballPoints(this.totalTotalState, c.divisor),
        byMedals: Math.floor(this.medalsEarnedState / c.medalsPerPoint),
      },
      regular: this.regularState,
      streakDays: this.streakDaysState,
      medalsEarned: this.medalsEarnedState,
      boostOn: this.boostOnState,
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
      const price = yakumonoBulkPrice(def.basePrice as number, lv, count, this.priceTable);
      if (curBalls < price) {
        return { ok: false, reason: 'insufficient-balls' };
      }
      this.lvState[yIdx] = lv + count;
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

  /** 覚醒（Lv≥minLvでLv→0・倍率×10、メダル消費）。 */
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
    const cost = awakenMedalCost(this.spec.awaken.medalBase, this.spec.awaken.medalGrowth, awakened);
    if (curMedals < cost) {
      return { ok: false, reason: 'insufficient-medals' };
    }
    this.lvState[idx] = 0;
    this.awakenedState[idx] = awakened + 1;
    this.awakenTotalState = this.awakenTotalState + 1;
    this.basePerSecCache = -1;
    return { ok: true, medals: curMedals - cost };
  }

  /** ブーストのON/OFF。 */
  onBoost(on: boolean): void {
    this.boostOnState = on;
  }

  /** 閉店（条件・常連P＝min(玉由来, 行動由来)−既得・リセット範囲。玉はstart_ballsに戻す）。 */
  onClose(curBalls: number): { ok: true; balls: number; gain: number } | { ok: false; reason: string } {
    asFinite(curBalls, 'curBalls');
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
    this.regularState = this.regularState + gain;
    this.lvState = [0, 0, 0, 0, 0, 0, 0, 0];
    this.awakenedState = [0, 0, 0, 0, 0, 0, 0, 0];
    this.basePerSecCache = -1;
    this.idleStageState = 0;
    this.tankStageState = 0;
    this.nailStageState = 0;
    this.shortenStageState = 0;
    this.holdStageState = 0;
    this.autoOwnedState = false;
    this.tomeuchiOwnedState = false;
    this.runTotalState = 0;
    return { ok: true, balls: this.spec.close.startBalls, gain };
  }
}
