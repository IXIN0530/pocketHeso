/** 経済の純粋計算部品（Amount・成長表・cbrt・価格・マイルストーン。spec/23）。 */

/** 玉・メダル等の数量（double。1e308超の後期に仮数＋指数型へ差し替え可能にする別名）。 */
export type Amount = number;

/** cbrt のニュートン反復回数（固定）。 */
export const CBRT_ITERATIONS = 40;

/** 1e6（cbrt のスケーリング係数。(1e2)^3）。 */
const CBRT_SCALE = 1000000;

/** cbrt スケール戻しの係数（100 = cbrt(1e6)）。 */
const CBRT_UNSCALE = 100;

function fail(what: string): never {
  throw new Error('invalid economy-math: ' + what);
}

function asNonNegativeFinite(v: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    fail(what + ' must be a finite number >= 0');
  }
  return v;
}

function asPositiveFinite(v: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    fail(what + ' must be a finite number > 0');
  }
  return v;
}

function asNonNegativeInt(v: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.floor(v) !== v || v < 0) {
    fail(what + ' must be a non-negative int');
  }
  return v;
}

/** 成長率の累乗表を作る（乗算のみ。table[n] = growth^n）。 */
export function buildGrowthTable(growth: number, maxN: number): readonly number[] {
  asPositiveFinite(growth, 'growth');
  asNonNegativeInt(maxN, 'maxN');
  if (maxN > 10000) {
    fail('maxN out of range');
  }
  const table: number[] = [1];
  for (let i = 1; i <= maxN; i = i + 1) {
    table.push(table[i - 1] as number * growth);
  }
  return table;
}

/** 表から growth^n を読む。 */
export function growthPow(table: readonly number[], n: number): number {
  asNonNegativeInt(n, 'n');
  const v = table[n];
  if (v === undefined) {
    fail('n out of table range');
  }
  return v;
}

/** 1.15^n の表を作る（乗算のみ）。 */
export function buildPow115Table(maxN: number): readonly number[] {
  return buildGrowthTable(1.15, maxN);
}

/** 表から 1.15^n を読む。 */
export function pow115(table: readonly number[], n: number): number {
  return growthPow(table, n);
}

/** 非負数の立方根（ニュートン法40回固定。+ - * / のみ）。 */
export function cbrt40(x: number): number {
  asNonNegativeFinite(x, 'x');
  if (x === 0) {
    return 0;
  }
  let b = x;
  let k = 0;
  while (b >= CBRT_SCALE) {
    b = b / CBRT_SCALE;
    k = k + 1;
  }
  while (b < 1) {
    b = b * CBRT_SCALE;
    k = k - 1;
  }
  let t = b < 1000 ? 10 : 100;
  for (let i = 0; i < CBRT_ITERATIONS; i = i + 1) {
    t = (2 * t + b / (t * t)) / 3;
  }
  let s = t;
  if (k >= 0) {
    for (let i = 0; i < k; i = i + 1) {
      s = s * CBRT_UNSCALE;
    }
  } else {
    for (let i = 0; i > k; i = i - 1) {
      s = s / CBRT_UNSCALE;
    }
  }
  return s;
}

/** 役物1Lvの価格 = basePrice × growth^lv。 */
export function yakumonoPrice(basePrice: number, lv: number, table: readonly number[]): Amount {
  asPositiveFinite(basePrice, 'basePrice');
  return basePrice * growthPow(table, asNonNegativeInt(lv, 'lv'));
}

/** まとめ買い価格 = Σ basePrice×growth^(lv+i)（ループ加算）。 */
export function yakumonoBulkPrice(
  basePrice: number,
  lv: number,
  count: number,
  table: readonly number[],
): Amount {
  asPositiveFinite(basePrice, 'basePrice');
  asNonNegativeInt(lv, 'lv');
  asNonNegativeInt(count, 'count');
  if (count < 1 || count > 100) {
    fail('count out of range (1..100)');
  }
  let sum = 0;
  for (let i = 0; i < count; i = i + 1) {
    sum = sum + basePrice * growthPow(table, lv + i);
  }
  return sum;
}

/** マイルストーン到達数（thresholds以下＋stepFromからstep刻み）。 */
export function milestoneCount(
  lv: number,
  thresholds: readonly number[],
  step: number,
  stepFrom: number,
): number {
  asNonNegativeInt(lv, 'lv');
  asNonNegativeInt(step, 'step');
  asNonNegativeInt(stepFrom, 'stepFrom');
  if (step < 1 || stepFrom < 1) {
    fail('step/stepFrom must be >= 1');
  }
  let n = 0;
  for (let i = 0; i < thresholds.length; i = i + 1) {
    const t = thresholds[i] as number;
    asNonNegativeInt(t, 'thresholds[' + i + ']');
    if (t <= lv) {
      n = n + 1;
    }
  }
  for (let t = stepFrom; t <= lv; t = t + step) {
    let dup = false;
    for (let i = 0; i < thresholds.length; i = i + 1) {
      if ((thresholds[i] as number) === t) {
        dup = true;
      }
    }
    if (!dup) {
      n = n + 1;
    }
  }
  return n;
}

/** 実効周期 = periodS / 2^count（2で繰り返し割る。正確）。 */
export function effectivePeriodS(
  periodS: number,
  lv: number,
  thresholds: readonly number[],
  step: number,
  stepFrom: number,
): number {
  asPositiveFinite(periodS, 'periodS');
  const n = milestoneCount(lv, thresholds, step, stepFrom);
  let p = periodS;
  for (let i = 0; i < n; i = i + 1) {
    p = p / 2;
  }
  return p;
}

/** 覚醒コスト = medalBase × medalGrowth^awakened（乗算ループ）。 */
export function awakenMedalCost(medalBase: number, medalGrowth: number, awakened: number): number {
  asPositiveFinite(medalBase, 'medalBase');
  asPositiveFinite(medalGrowth, 'medalGrowth');
  asNonNegativeInt(awakened, 'awakened');
  let c = medalBase;
  for (let i = 0; i < awakened; i = i + 1) {
    c = c * medalGrowth;
  }
  return c;
}

/** 閉店の獲得常連P = floor(cbrt(total/divisor)) − owned（負なら0）。 */
export function closeGain(total: Amount, divisor: number, owned: number): number {
  asNonNegativeFinite(total, 'total');
  asPositiveFinite(divisor, 'divisor');
  asNonNegativeInt(owned, 'owned');
  const x = total / divisor;
  // cbrt40 は立方数で 1ulp 小さく返ることがあるため、整数の3乗で floor を補正する
  let f = Math.floor(cbrt40(x));
  if ((f + 1) * (f + 1) * (f + 1) <= x) {
    f = f + 1;
  } else if (f * f * f > x) {
    f = f - 1;
  }
  const gain = f - owned;
  return gain < 0 ? 0 : gain;
}

/** 連日倍率 = 1 + perDay × min(days, maxDays)。 */
export function streakMult(days: number, perDay: number, maxDays: number): number {
  asNonNegativeInt(days, 'days');
  asNonNegativeFinite(perDay, 'perDay');
  asNonNegativeInt(maxDays, 'maxDays');
  const m = days < maxDays ? days : maxDays;
  return 1 + perDay * m;
}
