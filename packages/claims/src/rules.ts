// 換算・上限・連続日数の規則（economy json の claims 節, spec/30）。

/** 入力元（pass は休養日パスの記録）。 */
export type Source = 'health' | 'checkin' | 'checkin-own' | 'self' | 'pass';

/** 逓減の段（前段の to 〜 この段の to を mult 倍。最後の段より先は 0）。 */
export interface Tier {
  readonly to: number;
  readonly mult: number;
}

/** 換算規則（検証済み）。 */
export interface ClaimRules {
  /** 受け取れる日数（今日を含む。3 = 今日と過去2日）。 */
  readonly claimDays: number;
  readonly steps: {
    readonly fuelMinPer1000: number;
    readonly tiers: readonly Tier[];
    readonly medalAt: number;
  };
  readonly checkin: {
    readonly fuelMinPerMin: number;
    readonly tiers: readonly Tier[];
    readonly medalMinMinutes: number;
    readonly medalMaxPerDay: number;
  };
  readonly self: {
    readonly fuelMinPerItem: number;
    readonly maxPerDay: number;
  };
  readonly trust: Readonly<Record<Exclude<Source, 'pass'>, number>>;
  readonly streak: {
    readonly minSteps: number;
    readonly minMinutes: number;
  };
}

function fail(message: string): never {
  throw new Error('invalid claims: ' + message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rec(v: unknown, what: string): Record<string, unknown> {
  if (!isRecord(v)) {
    fail(what + ' must be an object');
  }
  return v;
}

function num(v: unknown, what: string, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
    fail(what + ' out of range');
  }
  return v;
}

function int(v: unknown, what: string, lo: number, hi: number): number {
  const n = num(v, what, lo, hi);
  if (Math.floor(n) !== n) {
    fail(what + ' must be an integer');
  }
  return n;
}

function tiers(v: unknown, what: string): Tier[] {
  if (!Array.isArray(v) || v.length === 0) {
    fail(what + ' must be a non-empty array');
  }
  const out: Tier[] = [];
  let prev = 0;
  for (let i = 0; i < v.length; i++) {
    const t = rec(v[i], what + '[' + i + ']');
    const to = int(t['to'], what + '[' + i + '].to', 1, 1e9);
    const mult = num(t['mult'], what + '[' + i + '].mult', 0, 1);
    if (to <= prev) {
      fail(what + ' must be ascending');
    }
    prev = to;
    out.push({ to, mult });
  }
  return out;
}

/** economy json 全体（parse 済みオブジェクト）から claims 節を読む。 */
export function parseClaimRules(economy: unknown): ClaimRules {
  const c = rec(rec(economy, 'economy')['claims'], 'claims');
  const st = rec(c['steps'], 'steps');
  const ck = rec(c['checkin'], 'checkin');
  const sf = rec(c['self'], 'self');
  const tr = rec(c['trust'], 'trust');
  const sk = rec(c['streak'], 'streak');
  return {
    claimDays: int(c['claim_days'], 'claim_days', 1, 31),
    steps: {
      fuelMinPer1000: num(st['fuel_min_per_1000'], 'steps.fuel_min_per_1000', 0, 1000),
      tiers: tiers(st['tiers'], 'steps.tiers'),
      medalAt: int(st['medal_at'], 'steps.medal_at', 1, 1e9),
    },
    checkin: {
      fuelMinPerMin: num(ck['fuel_min_per_min'], 'checkin.fuel_min_per_min', 0, 100),
      tiers: tiers(ck['tiers'], 'checkin.tiers'),
      medalMinMinutes: int(ck['medal_min_minutes'], 'checkin.medal_min_minutes', 1, 1440),
      medalMaxPerDay: int(ck['medal_max_per_day'], 'checkin.medal_max_per_day', 0, 100),
    },
    self: {
      fuelMinPerItem: num(sf['fuel_min_per_item'], 'self.fuel_min_per_item', 0, 1440),
      maxPerDay: int(sf['max_per_day'], 'self.max_per_day', 0, 100),
    },
    trust: {
      health: num(tr['health'], 'trust.health', 0, 1),
      checkin: num(tr['checkin'], 'trust.checkin', 0, 1),
      'checkin-own': num(tr['checkin-own'], 'trust.checkin-own', 0, 1),
      self: num(tr['self'], 'trust.self', 0, 1),
    },
    streak: {
      minSteps: int(sk['min_steps'], 'streak.min_steps', 1, 1e9),
      minMinutes: int(sk['min_minutes'], 'streak.min_minutes', 1, 1440),
    },
  };
}

/** 逓減込みの累計換算量（x まで積み上げた「等倍換算の量」）。 */
export function tiered(x: number, ts: readonly Tier[]): number {
  let sum = 0;
  let lo = 0;
  for (const t of ts) {
    if (x <= lo) {
      break;
    }
    const hi = x < t.to ? x : t.to;
    sum = sum + (hi - lo) * t.mult;
    lo = t.to;
  }
  return sum;
}
