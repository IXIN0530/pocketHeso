/** 経済定義 JSON の型と検証（spec/23。キーは snake_case・手書きバリデータ）。 */
import type { Amount } from './economy-math.ts';

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

/** 覚醒（Lv≥minLv で Lv→0・mult 倍。コストはメダル）。 */
export interface EconomyAwaken {
  readonly minLv: number;
  readonly mult: number;
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

/** 閉店の数値（条件・常連 P の除数・新規開始/閉店後の持ち玉）。 */
export interface EconomyClose {
  readonly requiredRunTotal: Amount;
  readonly divisor: Amount;
  readonly startBalls: Amount;
}

/** claims 節の数値（連日倍率。燃料換算は claims 側）。 */
export interface EconomyClaims {
  readonly streakPerDay: number;
  readonly streakMaxDays: number;
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
  readonly claims: EconomyClaims;
}

function fail(message: string): never {
  throw new Error('invalid economy: ' + message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(what + ' must be an object');
  }
  return value;
}

function asArray(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(what + ' must be an array');
  }
  return value;
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(what + ' must be a finite number');
  }
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(what + ' must be a non-empty string');
  }
  return value;
}

function asInt(value: unknown, what: string): number {
  const n = asNumber(value, what);
  if (Math.floor(n) !== n) {
    fail(what + ' must be an int');
  }
  return n;
}

function asPositive(value: unknown, what: string): number {
  const n = asNumber(value, what);
  if (n <= 0) {
    fail(what + ' must be > 0');
  }
  return n;
}

function asIntRange(value: unknown, what: string, lo: number, hi: number): number {
  const n = asInt(value, what);
  if (n < lo || n > hi) {
    fail(what + ' out of range');
  }
  return n;
}

/** 全要素が [lo, hi] に入り、狭義単調増加であることを検証する。 */
function checkAscending(values: readonly number[], what: string, lo: number, hi: number): void {
  let prev = 0;
  for (let i = 0; i < values.length; i = i + 1) {
    const v = values[i] ?? Number.NaN;
    if (!(v >= lo && v <= hi)) {
      fail(what + '[' + i + '] out of range');
    }
    if (i > 0 && v <= prev) {
      fail(what + ' must be strictly ascending');
    }
    prev = v;
  }
}

function isYakumonoId(value: string): value is EconomyYakumonoId {
  for (let i = 0; i < ECONOMY_YAKUMONO_IDS.length; i = i + 1) {
    if (ECONOMY_YAKUMONO_IDS[i] === value) {
      return true;
    }
  }
  return false;
}

function asNumberArray(value: unknown, what: string): readonly number[] {
  const raw = asArray(value, what);
  const out: number[] = [];
  for (let i = 0; i < raw.length; i = i + 1) {
    out.push(asNumber(raw[i], what + '[' + i + ']'));
  }
  return out;
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
  const startBalls = asIntRange(cl['start_balls'], 'close.start_balls', 0, 1000000);
  const claims = asRecord(o['claims'], 'claims');
  const streakPerDay = asNumber(claims['streak_per_day'], 'claims.streak_per_day');
  if (streakPerDay < 0 || streakPerDay > 1) {
    fail('claims.streak_per_day out of range');
  }
  const streakMaxDays = asIntRange(claims['streak_max_days'], 'claims.streak_max_days', 1, 365);
  return {
    version,
    priceGrowth,
    bulkSizes,
    yakumono,
    milestones: { thresholds, step, stepFrom },
    awaken: { minLv, mult, medalBase, medalGrowth },
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
    close: { requiredRunTotal, divisor, startBalls },
    claims: { streakPerDay, streakMaxDays },
  };
}

/** JSON テキストを検証して `EconomySpec` にする。 */
export function parseEconomyText(text: string): EconomySpec {
  return parseEconomy(JSON.parse(text) as unknown);
}
