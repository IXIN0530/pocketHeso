/** 経済定義 JSON の型と検証（spec/23。キーは snake_case・手書きバリデータ）。 */
import {
  asArray,
  asIntRange,
  asNumber,
  asNumberArray,
  asPositive,
  asRecord,
  asString,
  checkAscending,
  fail,
} from './config-check.ts';
import type { Amount } from './economy-math.ts';
import { parseTree, type TreeSpec } from './tree-config.ts';

/** 役物定義の ID（順序固定。解放鎖はこの順）。 */
export type EconomyYakumonoId =
  | 'windmill'
  | 'kaitentai'
  | 'croon'
  | 'reel'
  | 'attacker'
  | 'vzone'
  | 'denchu'
  | 'shima';

/** 既知の役物 ID（順序固定）。 */
export const ECONOMY_YAKUMONO_IDS: readonly EconomyYakumonoId[] = [
  'windmill',
  'kaitentai',
  'croon',
  'reel',
  'attacker',
  'vzone',
  'denchu',
  'shima',
];

/** 役物1件（yield は周期あたりの産出玉）。 */
export interface EconomyYakumono {
  readonly id: EconomyYakumonoId;
  readonly name: string;
  readonly periodS: number;
  readonly yield: Amount;
  readonly basePrice: Amount;
}

/** マイルストーン（thresholds＋stepFrom から step 刻み）。 */
export interface EconomyMilestones {
  readonly thresholds: readonly number[];
  readonly step: number;
  readonly stepFrom: number;
}

/** 覚醒（Lv≥minLv で実行・mult 倍。resetLv なら Lv→0。コストはメダル。resonance は覚醒1回ごとの全役物の加算倍率）。 */
export interface EconomyAwaken {
  readonly minLv: number;
  readonly mult: number;
  readonly resetLv: boolean;
  readonly resonance: number;
  readonly medalBase: number;
  readonly medalGrowth: number;
}

/** 状態係数（前面・放置基準・閉店中・ブースト倍率）。 */
export interface EconomyFactors {
  readonly fg: number;
  readonly idleBase: number;
  readonly closed: number;
  readonly boostMult: number;
}

/** 強化の数値（効果と玉/メダルコスト。P3-T4 で調整する初期値）。 */
export interface EconomyUpgrades {
  readonly idleValues: readonly number[];
  readonly idleCosts: readonly number[];
  readonly tankHours: readonly number[];
  readonly boostCapHours: number;
  readonly tankCosts: readonly number[];
  readonly nailValues: readonly number[];
  readonly nailCosts: readonly number[];
  readonly shortenFactor: number;
  readonly shortenStages: number;
  readonly shortenCosts: readonly number[];
  readonly holdPlusStages: number;
  readonly holdPlusCosts: readonly number[];
  readonly autoCost: number;
  readonly tomeuchiCost: number;
  readonly rates: readonly number[];
  readonly rateMedalCosts: readonly number[];
}

/** 予告の数値（前面滞在での出現間隔と効果・重み）。 */
export interface EconomyNotice {
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

/** 閉店の数値（条件・常連 P の除数・行動由来の上限・常連倍率・新規開始/閉店後の持ち玉）。 */
export interface EconomyClose {
  readonly requiredRunTotal: Amount;
  readonly divisor: Amount;
  readonly medalsPerPoint: number;
  readonly regularMult: number;
  readonly startBalls: Amount;
  /** 休業の上限ms（閉店からこの時間で自動で開店, D-107）。 */
  readonly restMaxMs: number;
}

/** 基準生産の下限（役物なしでも報酬を0にしない, D-080）。 */
export interface EconomyProdRef {
  readonly minPerSec: number;
}

/** パチンコの発射単価（1発＝生産 shotS 秒ぶん × レート, D-090）。 */
export interface EconomyPachinko {
  readonly shotS: number;
}

/** claims 節の数値（連日倍率。燃料換算は claims 側）。 */
export interface EconomyClaims {
  readonly streakPerDay: number;
  readonly streakMaxDays: number;
}

/** 実績の指標（spec/24。Engine 側の firstHits・jackpots・maxChain・closes を含む）。 */
export type AchievementMetric =
  | 'ballsTotal'
  | 'medalsEarned'
  | 'refPerSec'
  | 'yakumono'
  | 'awakenTotal'
  | 'rateStage'
  | 'streakDays'
  | 'firstHits'
  | 'jackpots'
  | 'maxChain'
  | 'closes';

/** 既知の実績の指標（順序固定）。 */
export const ACHIEVEMENT_METRICS: readonly AchievementMetric[] = [
  'ballsTotal',
  'medalsEarned',
  'refPerSec',
  'yakumono',
  'awakenTotal',
  'rateStage',
  'streakDays',
  'firstHits',
  'jackpots',
  'maxChain',
  'closes',
];

/** 実績1件（at 以上で達成。name は表示名で Core は計算に使わない）。 */
export interface AchievementDef {
  readonly id: string;
  readonly metric: AchievementMetric;
  readonly at: number;
  readonly name: string;
}

/** 実績（1個あたりの生産倍率の加算と一覧。一覧の順が判定順, spec/24）。 */
export interface EconomyAchievements {
  readonly multPer: number;
  readonly list: readonly AchievementDef[];
}

/** 経済定義（検証済み）。 */
export interface EconomySpec {
  readonly version: number;
  readonly priceGrowth: number;
  readonly bulkSizes: readonly number[];
  readonly yakumono: readonly EconomyYakumono[];
  readonly milestones: EconomyMilestones;
  readonly awaken: EconomyAwaken;
  readonly factors: EconomyFactors;
  readonly upgrades: EconomyUpgrades;
  readonly notice: EconomyNotice;
  readonly close: EconomyClose;
  readonly prodRef: EconomyProdRef;
  readonly pachinko: EconomyPachinko;
  readonly claims: EconomyClaims;
  readonly achievements: EconomyAchievements;
  /** 常連ツリー（spec/25。`tree` が無い JSON は空のツリー）。 */
  readonly tree: TreeSpec;
}

function isYakumonoId(value: string): value is EconomyYakumonoId {
  for (let i = 0; i < ECONOMY_YAKUMONO_IDS.length; i = i + 1) {
    if (ECONOMY_YAKUMONO_IDS[i] === value) {
      return true;
    }
  }
  return false;
}

function isAchievementMetric(value: string): value is AchievementMetric {
  for (let i = 0; i < ACHIEVEMENT_METRICS.length; i = i + 1) {
    if (ACHIEVEMENT_METRICS[i] === value) {
      return true;
    }
  }
  return false;
}

/** 実績節を検証する（id 重複・未知の metric・at ≤ 0・mult_per が 0〜0.1 の外はエラー, spec/24）。 */
function parseAchievements(value: unknown): EconomyAchievements {
  const ao = asRecord(value, 'achievements');
  const multPer = asNumber(ao['mult_per'], 'achievements.mult_per');
  if (multPer < 0 || multPer > 0.1) {
    fail('achievements.mult_per out of range');
  }
  const raw = asArray(ao['list'], 'achievements.list');
  const list: AchievementDef[] = [];
  for (let i = 0; i < raw.length; i = i + 1) {
    const what = 'achievements.list[' + i + ']';
    const r = asRecord(raw[i], what);
    const id = asString(r['id'], what + '.id');
    for (let k = 0; k < list.length; k = k + 1) {
      if ((list[k] as AchievementDef).id === id) {
        fail(what + '.id duplicated');
      }
    }
    const metric = asString(r['metric'], what + '.metric');
    if (!isAchievementMetric(metric)) {
      fail(what + '.metric unknown');
    }
    const at = asPositive(r['at'], what + '.at');
    const name = asString(r['name'], what + '.name');
    if (name.length > 32) {
      fail(what + '.name too long');
    }
    list.push({ id, metric, at, name });
  }
  return { multPer, list };
}

/** 経済定義 JSON を検証して `EconomySpec` にする。入力のキー順には依存しない。 */
export function parseEconomy(json: unknown): EconomySpec {
  const o = asRecord(json, 'economy');
  const version = asIntRange(o['version'], 'version', 1, 99);
  const priceGrowth = asNumber(o['price_growth'], 'price_growth');
  if (priceGrowth <= 1 || priceGrowth > 2) {
    fail('price_growth out of range');
  }
  const bulkSizes = asNumberArray(o['bulk_sizes'], 'bulk_sizes');
  if (bulkSizes.length !== 2 || bulkSizes[0] !== 10 || bulkSizes[1] !== 100) {
    fail('bulk_sizes must be [10, 100]');
  }
  const yakRaw = asArray(o['yakumono'], 'yakumono');
  if (yakRaw.length !== ECONOMY_YAKUMONO_IDS.length) {
    fail('yakumono must have 8 entries');
  }
  const yakumono: EconomyYakumono[] = [];
  for (let i = 0; i < yakRaw.length; i = i + 1) {
    const what = 'yakumono[' + i + ']';
    const yo = asRecord(yakRaw[i], what);
    const idRaw = asString(yo['id'], what + '.id');
    if (!isYakumonoId(idRaw)) {
      fail(what + '.id unknown');
    }
    if (idRaw !== ECONOMY_YAKUMONO_IDS[i]) {
      fail(what + '.id out of order');
    }
    const name = asString(yo['name'], what + '.name');
    if (name.length > 32) {
      fail(what + '.name too long');
    }
    const periodS = asIntRange(yo['period_s'], what + '.period_s', 1, 3600);
    const yieldV = asIntRange(yo['yield'], what + '.yield', 1, 1000000000);
    const basePrice = asIntRange(yo['base_price'], what + '.base_price', 1, 1000000000000);
    yakumono.push({ id: idRaw, name, periodS, yield: yieldV, basePrice });
  }
  const ms = asRecord(o['milestones'], 'milestones');
  const thresholds = asNumberArray(ms['thresholds'], 'milestones.thresholds');
  for (let i = 0; i < thresholds.length; i = i + 1) {
    asIntRange(thresholds[i], 'milestones.thresholds[' + i + ']', 1, 10000);
  }
  const step = asIntRange(ms['step'], 'milestones.step', 1, 1000);
  const stepFrom = asIntRange(ms['step_from'], 'milestones.step_from', 1, 10000);
  checkAscending(thresholds, 'milestones.thresholds', 1, 10000);
  const lastThreshold = thresholds[thresholds.length - 1];
  if (lastThreshold !== undefined && stepFrom <= lastThreshold) {
    fail('milestones.step_from must be > last threshold');
  }
  const aw = asRecord(o['awaken'], 'awaken');
  const minLv = asIntRange(aw['min_lv'], 'awaken.min_lv', 1, 1000);
  const mult = asIntRange(aw['mult'], 'awaken.mult', 2, 1000);
  const medalBase = asPositive(aw['medal_base'], 'awaken.medal_base');
  const medalGrowth = asNumber(aw['medal_growth'], 'awaken.medal_growth');
  if (medalGrowth <= 1 || medalGrowth > 10) {
    fail('awaken.medal_growth out of range');
  }
  const resetLvRaw = aw['reset_lv'];
  if (resetLvRaw !== undefined && typeof resetLvRaw !== 'boolean') {
    fail('awaken.reset_lv must be boolean');
  }
  const resetLv = resetLvRaw === undefined ? true : resetLvRaw;
  const resonance = aw['resonance'] === undefined ? 0 : asNumber(aw['resonance'], 'awaken.resonance');
  if (resonance < 0 || resonance > 1) {
    fail('awaken.resonance out of range');
  }
  const fa = asRecord(o['factors'], 'factors');
  const fg = asNumber(fa['fg'], 'factors.fg');
  if (fg <= 0 || fg > 10) {
    fail('factors.fg out of range');
  }
  const idleBase = asNumber(fa['idle_base'], 'factors.idle_base');
  if (idleBase < 0 || idleBase > 1) {
    fail('factors.idle_base out of range');
  }
  const closed = asNumber(fa['closed'], 'factors.closed');
  if (closed < 0 || closed > 1) {
    fail('factors.closed out of range');
  }
  const boostMult = asNumber(fa['boost_mult'], 'factors.boost_mult');
  if (boostMult < 1 || boostMult > 10) {
    fail('factors.boost_mult out of range');
  }
  const up = asRecord(o['upgrades'], 'upgrades');
  const idle = asRecord(up['idle_efficiency'], 'upgrades.idle_efficiency');
  const idleValues = asNumberArray(idle['values'], 'upgrades.idle_efficiency.values');
  const idleCosts = asNumberArray(idle['costs'], 'upgrades.idle_efficiency.costs');
  if (idleValues.length !== idleCosts.length + 1) {
    fail('upgrades.idle_efficiency values/costs mismatch');
  }
  checkAscending(idleValues, 'upgrades.idle_efficiency.values', 0, 1);
  checkAscending(idleCosts, 'upgrades.idle_efficiency.costs', 1, Number.MAX_VALUE);
  if (idleValues[0] !== idleBase) {
    fail('upgrades.idle_efficiency.values[0] must equal factors.idle_base');
  }
  const tank = asRecord(up['tank_hours'], 'upgrades.tank_hours');
  const tankHours = asNumberArray(tank['values'], 'upgrades.tank_hours.values');
  const tankCosts = asNumberArray(tank['costs'], 'upgrades.tank_hours.costs');
  if (tankHours.length !== tankCosts.length + 1) {
    fail('upgrades.tank_hours values/costs mismatch');
  }
  checkAscending(tankHours, 'upgrades.tank_hours.values', 1, 1000);
  checkAscending(tankCosts, 'upgrades.tank_hours.costs', 1, Number.MAX_VALUE);
  const boostCapHours = asPositive(tank['boost_cap_hours'], 'upgrades.tank_hours.boost_cap_hours');
  const nail = asRecord(up['nail_q'], 'upgrades.nail_q');
  const nailValues = asNumberArray(nail['values'], 'upgrades.nail_q.values');
  const nailCosts = asNumberArray(nail['costs'], 'upgrades.nail_q.costs');
  if (nailValues.length !== nailCosts.length + 1) {
    fail('upgrades.nail_q values/costs mismatch');
  }
  checkAscending(nailValues, 'upgrades.nail_q.values', 0, 1);
  checkAscending(nailCosts, 'upgrades.nail_q.costs', 1, Number.MAX_VALUE);
  const shorten = asRecord(up['shorten'], 'upgrades.shorten');
  const shortenFactor = asNumber(shorten['factor'], 'upgrades.shorten.factor');
  if (shortenFactor <= 0 || shortenFactor >= 1) {
    fail('upgrades.shorten.factor out of range');
  }
  const shortenStages = asIntRange(shorten['stages'], 'upgrades.shorten.stages', 1, 10);
  const shortenCosts = asNumberArray(shorten['costs'], 'upgrades.shorten.costs');
  if (shortenCosts.length !== shortenStages) {
    fail('upgrades.shorten costs mismatch');
  }
  checkAscending(shortenCosts, 'upgrades.shorten.costs', 1, Number.MAX_VALUE);
  const holdPlus = asRecord(up['hold_plus'], 'upgrades.hold_plus');
  const holdPlusStages = asIntRange(holdPlus['stages'], 'upgrades.hold_plus.stages', 1, 4);
  const holdPlusCosts = asNumberArray(holdPlus['costs'], 'upgrades.hold_plus.costs');
  if (holdPlusCosts.length !== holdPlusStages) {
    fail('upgrades.hold_plus costs mismatch');
  }
  checkAscending(holdPlusCosts, 'upgrades.hold_plus.costs', 1, Number.MAX_VALUE);
  const autoCost = asPositive(asRecord(up['auto'], 'upgrades.auto')['cost'], 'upgrades.auto.cost');
  const tomeuchiCost = asPositive(asRecord(up['tomeuchi'], 'upgrades.tomeuchi')['cost'], 'upgrades.tomeuchi.cost');
  const rate = asRecord(up['rate_unlock'], 'upgrades.rate_unlock');
  const rates = asNumberArray(rate['rates'], 'upgrades.rate_unlock.rates');
  const rateMedalCosts = asNumberArray(rate['medal_costs'], 'upgrades.rate_unlock.medal_costs');
  if (rates.length < 2 || rateMedalCosts.length !== rates.length - 1) {
    fail('upgrades.rate_unlock rates/costs mismatch');
  }
  checkAscending(rates, 'upgrades.rate_unlock.rates', 1, 1000000);
  checkAscending(rateMedalCosts, 'upgrades.rate_unlock.medal_costs', 1, Number.MAX_VALUE);
  const no = asRecord(o['notice'], 'notice');
  const minFgMs = asIntRange(no['min_fg_ms'], 'notice.min_fg_ms', 60000, 3600000);
  const maxFgMs = asIntRange(no['max_fg_ms'], 'notice.max_fg_ms', 60000, 3600000);
  if (minFgMs >= maxFgMs) {
    fail('notice.min_fg_ms must be < max_fg_ms');
  }
  const displayMs = asIntRange(no['display_ms'], 'notice.display_ms', 1000, 60000);
  const feverMult = asIntRange(no['fever_mult'], 'notice.fever_mult', 2, 100);
  const feverMs = asIntRange(no['fever_ms'], 'notice.fever_ms', 1000, 600000);
  const feverWeight = asIntRange(no['fever_weight'], 'notice.fever_weight', 1, 1000);
  const rushRate = asNumber(no['rush_rate'], 'notice.rush_rate');
  if (rushRate <= 0 || rushRate >= 1) {
    fail('notice.rush_rate out of range');
  }
  const rushCapS = asIntRange(no['rush_cap_s'], 'notice.rush_cap_s', 1, 3600);
  const rushWeight = asIntRange(no['rush_weight'], 'notice.rush_weight', 1, 1000);
  const bonus1In = asIntRange(no['bonus_1_in'], 'notice.bonus_1_in', 2, 100);
  const bonusWeight = asIntRange(no['bonus_weight'], 'notice.bonus_weight', 1, 1000);
  const cl = asRecord(o['close'], 'close');
  const requiredRunTotal = asPositive(cl['required_run_total'], 'close.required_run_total');
  const divisor = asPositive(cl['divisor'], 'close.divisor');
  const medalsPerPoint = asIntRange(cl['medals_per_point'], 'close.medals_per_point', 1, 1000);
  const regularMult = asPositive(cl['regular_mult'], 'close.regular_mult');
  if (regularMult > 100) {
    fail('close.regular_mult out of range');
  }
  const startBalls = asIntRange(cl['start_balls'], 'close.start_balls', 0, 1000000);
  const restMaxMs = asIntRange(cl['rest_max_ms'], 'close.rest_max_ms', 60000, 31536000000);
  const pr = asRecord(o['prod_ref'], 'prod_ref');
  const minPerSec = asNumber(pr['min_per_sec'], 'prod_ref.min_per_sec');
  if (!(minPerSec > 0 && minPerSec <= 1000)) {
    fail('prod_ref.min_per_sec out of range');
  }
  const pk = asRecord(o['pachinko'], 'pachinko');
  const shotS = asIntRange(pk['shot_s'], 'pachinko.shot_s', 1, 3600);
  const claims = asRecord(o['claims'], 'claims');
  const streakPerDay = asNumber(claims['streak_per_day'], 'claims.streak_per_day');
  if (streakPerDay < 0 || streakPerDay > 1) {
    fail('claims.streak_per_day out of range');
  }
  const streakMaxDays = asIntRange(claims['streak_max_days'], 'claims.streak_max_days', 1, 365);
  const achievements = parseAchievements(o['achievements']);
  const tree = parseTree(o['tree'], { awakenMedalBase: medalBase, factorsClosed: closed });
  return {
    version,
    priceGrowth,
    bulkSizes,
    yakumono,
    milestones: { thresholds, step, stepFrom },
    awaken: { minLv, mult, resetLv, resonance, medalBase, medalGrowth },
    factors: { fg, idleBase, closed, boostMult },
    upgrades: {
      idleValues,
      idleCosts,
      tankHours,
      boostCapHours,
      tankCosts,
      nailValues,
      nailCosts,
      shortenFactor,
      shortenStages,
      shortenCosts,
      holdPlusStages,
      holdPlusCosts,
      autoCost,
      tomeuchiCost,
      rates,
      rateMedalCosts,
    },
    notice: {
      minFgMs,
      maxFgMs,
      displayMs,
      feverMult,
      feverMs,
      feverWeight,
      rushRate,
      rushCapS,
      rushWeight,
      bonus1In,
      bonusWeight,
    },
    close: { requiredRunTotal, divisor, medalsPerPoint, regularMult, startBalls, restMaxMs },
    prodRef: { minPerSec },
    pachinko: { shotS },
    claims: { streakPerDay, streakMaxDays },
    achievements,
    tree,
  };
}

/** JSON テキストを検証して `EconomySpec` にする。 */
export function parseEconomyText(text: string): EconomySpec {
  return parseEconomy(JSON.parse(text) as unknown);
}
