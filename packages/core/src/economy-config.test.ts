import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ECONOMY_YAKUMONO_IDS, parseEconomy, parseEconomyText } from './economy-config.ts';

function defaultJson(): unknown {
  const text = readFileSync('../../resources/economy/default.json', 'utf8');
  return JSON.parse(text) as unknown;
}

function clone(v: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
}

test('既定の経済定義が spec/23 の数値（P3-T4 調整 D-048 を含む）と一致する', () => {
  const spec = parseEconomy(defaultJson());
  expect(spec.version).toBe(1);
  expect(spec.priceGrowth).toBe(1.15);
  expect(spec.bulkSizes).toEqual([10, 100]);
  expect(spec.yakumono.map((y) => y.id)).toEqual([...ECONOMY_YAKUMONO_IDS]);
  expect(spec.yakumono[0]).toMatchObject({ id: 'windmill', periodS: 2, yield: 1, basePrice: 15 });
  expect(spec.yakumono[2]).toMatchObject({ id: 'croon', periodS: 6, yield: 78, basePrice: 1100 });
  expect(spec.yakumono[7]).toMatchObject({ id: 'shima', periodS: 16, yield: 845000, basePrice: 330000000 });
  expect(spec.milestones).toEqual({ thresholds: [25, 50, 100], step: 50, stepFrom: 150 });
  expect(spec.awaken).toEqual({ minLv: 100, mult: 10, medalBase: 5, medalGrowth: 2 });
  expect(spec.factors).toEqual({ fg: 1.0, idleBase: 0.5, closed: 0.005, boostMult: 2.0 });
  expect(spec.notice.feverMult).toBe(7);
  expect(spec.notice.feverMs).toBe(77000);
  expect(spec.notice.rushRate).toBe(0.15);
  expect(spec.notice.rushCapS).toBe(900);
  expect(spec.notice.bonus1In).toBe(10);
  expect(spec.close.requiredRunTotal).toBe(10000000000);
  expect(spec.close.divisor).toBe(12000000000);
  expect(spec.close.startBalls).toBe(100);
  expect(spec.close.medalsPerPoint).toBe(7);
  expect(spec.close.regularMult).toBe(1);
  expect(spec.jackpotFever.multByRate).toEqual([4, 5, 6, 8, 11, 16, 21]);
  expect(spec.upgrades.nailValues).toEqual([0, 0.0006, 0.0012, 0.0018, 0.0024, 0.003]);
  expect(spec.claims).toEqual({ streakPerDay: 0.05, streakMaxDays: 20 });
});

test('不正な経済定義を拒否する', () => {
  expect(() => parseEconomy({})).toThrow();
  expect(() => parseEconomyText('not json')).toThrow();

  const badGrowth = clone(defaultJson());
  (badGrowth['price_growth'] as number) = 2.5;
  expect(() => parseEconomy(badGrowth)).toThrow();

  const badBulk = clone(defaultJson());
  badBulk['bulk_sizes'] = [10];
  expect(() => parseEconomy(badBulk)).toThrow();

  const badOrder = clone(defaultJson());
  const yak = badOrder['yakumono'] as unknown[];
  const first = yak[0];
  yak[0] = yak[1] as unknown;
  yak[1] = first as unknown;
  expect(() => parseEconomy(badOrder)).toThrow();

  const shortYak = clone(defaultJson());
  (shortYak['yakumono'] as unknown[]).pop();
  expect(() => parseEconomy(shortYak)).toThrow();

  const badPrice = clone(defaultJson());
  ((badPrice['yakumono'] as Array<Record<string, unknown>>)[0] as Record<string, unknown>)['base_price'] = -1;
  expect(() => parseEconomy(badPrice)).toThrow();

  const badNotice = clone(defaultJson());
  ((badNotice['notice'] as Record<string, unknown>)['min_fg_ms'] as number) = 900000;
  ((badNotice['notice'] as Record<string, unknown>)['max_fg_ms'] as number) = 300000;
  expect(() => parseEconomy(badNotice)).toThrow();

  const badClose = clone(defaultJson());
  ((badClose['close'] as Record<string, unknown>)['divisor'] as number) = 0;
  expect(() => parseEconomy(badClose)).toThrow();
  for (const v of [-1, 1.5, undefined]) {
    const badStart = clone(defaultJson());
    (badStart['close'] as Record<string, unknown>)['start_balls'] = v;
    expect(() => parseEconomy(badStart)).toThrow();
  }

  const badClaims = clone(defaultJson());
  ((badClaims['claims'] as Record<string, unknown>)['streak_per_day'] as number) = 2;
  expect(() => parseEconomy(badClaims)).toThrow();
});

test('強化配列・マイルストーン・idle_base の整合を検証する', () => {
  function up(j: Record<string, unknown>, key: string): Record<string, unknown> {
    return (j['upgrades'] as Record<string, unknown>)[key] as Record<string, unknown>;
  }
  function ms(j: Record<string, unknown>): Record<string, unknown> {
    return j['milestones'] as Record<string, unknown>;
  }
  const cases: Array<(j: Record<string, unknown>) => void> = [
    (j) => { (j['factors'] as Record<string, unknown>)['idle_base'] = 0.4; },
    (j) => { up(j, 'idle_efficiency')['values'] = [0.5, 0.6, 0.7, 0.8, 0.9, 1.1]; },
    (j) => { up(j, 'idle_efficiency')['values'] = [0.5, 0.7, 0.6, 0.8, 0.9, 1.0]; },
    (j) => { up(j, 'idle_efficiency')['costs'] = [1000, 10000, 0, 1000000, 10000000]; },
    (j) => { up(j, 'tank_hours')['costs'] = [5000, -1, 500000, 5000000]; },
    (j) => { up(j, 'tank_hours')['values'] = [12, 12, 24, 36, 48]; },
    (j) => { up(j, 'nail_q')['values'] = [0, 0.01, 0.02, 0.03, 0.04, 2]; },
    (j) => { up(j, 'shorten')['costs'] = [50000, 5000, 5000000]; },
    (j) => { up(j, 'hold_plus')['costs'] = [0, 1000000]; },
    (j) => { up(j, 'rate_unlock')['rates'] = [1, 4, 0, 40, 100, 400, 1000]; },
    (j) => { up(j, 'rate_unlock')['medal_costs'] = [2, 5, 20, 50, 200, -500]; },
    (j) => { ms(j)['thresholds'] = [25, 100, 50]; },
    (j) => { ms(j)['step_from'] = 100; },
    (j) => { (j['jackpot_fever'] as Record<string, unknown>)['mult_by_rate'] = [4, 5, 6, 8, 11, 16]; },
    (j) => { (j['jackpot_fever'] as Record<string, unknown>)['mult_by_rate'] = [4, 5, 5, 8, 11, 16, 21]; },
    (j) => { (j['close'] as Record<string, unknown>)['medals_per_point'] = 0; },
    (j) => { (j['close'] as Record<string, unknown>)['regular_mult'] = 0; },
  ];
  cases.forEach((mutate, i) => {
    const j = clone(defaultJson());
    mutate(j);
    expect(() => parseEconomy(j), 'case ' + i).toThrow();
  });
});
