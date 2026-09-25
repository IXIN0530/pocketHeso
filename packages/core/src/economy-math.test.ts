import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  awakenMedalCost,
  buildGrowthTable,
  buildPow115Table,
  cbrt40,
  closeGain,
  effectivePeriodS,
  growthPow,
  milestoneCount,
  pow115,
  streakMult,
  yakumonoBulkPrice,
  yakumonoPrice,
} from './economy-math.ts';

function relErr(got: number, want: number): number {
  if (want === 0) {
    return got === 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  const d = got - want;
  return (d < 0 ? -d : d) / (want < 0 ? -want : want);
}

test('1.15^n 表は乗算で作り単調に増える', () => {
  const t = buildPow115Table(300);
  expect(t.length).toBe(301);
  expect(t[0]).toBe(1);
  expect(t[1]).toBe(1.15);
  expect(relErr(t[2] as number, 1.3225)).toBeLessThan(1e-15);
  expect(relErr(t[10] as number, 4.0455577357079076)).toBeLessThan(1e-12);
  expect(relErr(t[25] as number, 32.918952619789614)).toBeLessThan(1e-12);
  expect(relErr(t[50] as number, 1083.6574415839539)).toBeLessThan(1e-12);
  for (let i = 1; i < t.length; i = i + 1) {
    expect((t[i] as number) > (t[i - 1] as number)).toBe(true);
  }
  expect(pow115(t, 3)).toBe(t[3]);
  expect(growthPow(buildGrowthTable(2, 10), 10)).toBe(1024);
  expect(() => buildGrowthTable(0, 10)).toThrow();
  expect(() => buildGrowthTable(1.15, -1)).toThrow();
  expect(() => growthPow(t, 301)).toThrow();
});

test('役物価格10件が手計算と一致する', () => {
  const t = buildPow115Table(200);
  const cases: Array<[number, number, number]> = [
    [15, 0, 15.0],
    [15, 1, 17.25],
    [15, 10, 60.68336603561861],
    [100, 5, 201.13571874999994],
    [1100, 7, 2926.0218685156237],
    [12000, 25, 395027.4314374754],
    [130000, 50, 140875467.405914],
    [1400000, 100, 1644038830980.3916],
    [20000000, 3, 30417499.99999999],
    [330000000, 10, 1335034052.7836094],
  ];
  for (let i = 0; i < cases.length; i = i + 1) {
    const c = cases[i] as [number, number, number];
    expect(relErr(yakumonoPrice(c[0], c[1], t), c[2])).toBeLessThan(1e-12);
  }
});

test('まとめ買い価格は単価の合計と一致する', () => {
  const t = buildPow115Table(200);
  expect(relErr(yakumonoBulkPrice(15, 0, 10, t), 304.5557735707909)).toBeLessThan(1e-12);
  expect(relErr(yakumonoBulkPrice(100, 5, 10, t), 4083.8029611082175)).toBeLessThan(1e-12);
  let sum = 0;
  for (let i = 0; i < 10; i = i + 1) {
    sum = sum + yakumonoPrice(15, i, t);
  }
  expect(yakumonoBulkPrice(15, 0, 10, t)).toBe(sum);
  let sum100 = 0;
  for (let i = 0; i < 100; i = i + 1) {
    sum100 = sum100 + yakumonoPrice(15, i, t);
  }
  expect(yakumonoBulkPrice(15, 0, 100, t)).toBe(sum100);
  expect(() => yakumonoBulkPrice(15, 0, 0, t)).toThrow();
  expect(() => yakumonoBulkPrice(15, 0, 101, t)).toThrow();
});

test('マイルストーン到達数と実効周期', () => {
  const th = [25, 50, 100];
  expect(milestoneCount(0, th, 50, 150)).toBe(0);
  expect(milestoneCount(24, th, 50, 150)).toBe(0);
  expect(milestoneCount(25, th, 50, 150)).toBe(1);
  expect(milestoneCount(49, th, 50, 150)).toBe(1);
  expect(milestoneCount(50, th, 50, 150)).toBe(2);
  expect(milestoneCount(99, th, 50, 150)).toBe(2);
  expect(milestoneCount(100, th, 50, 150)).toBe(3);
  expect(milestoneCount(149, th, 50, 150)).toBe(3);
  expect(milestoneCount(150, th, 50, 150)).toBe(4);
  expect(milestoneCount(199, th, 50, 150)).toBe(4);
  expect(milestoneCount(200, th, 50, 150)).toBe(5);
  expect(milestoneCount(250, th, 50, 150)).toBe(6);
  expect(effectivePeriodS(16, 0, th, 50, 150)).toBe(16);
  expect(effectivePeriodS(16, 25, th, 50, 150)).toBe(8);
  expect(effectivePeriodS(16, 50, th, 50, 150)).toBe(4);
  expect(effectivePeriodS(16, 100, th, 50, 150)).toBe(2);
  expect(effectivePeriodS(16, 150, th, 50, 150)).toBe(1);
  expect(effectivePeriodS(2, 25, th, 50, 150)).toBe(1);
});

test('cbrt が 1e0〜1e300 で相対誤差 1e-12 以内', () => {
  const cases: Array<[number, number]> = [
    [0, 0],
    [1, 1],
    [8, 2],
    [27, 3],
    [1000, 10],
    [1000000000, 1000],
    [8000000000, 2000],
    [1e12, 10000],
    [1e30, 10000000000],
    [1e100, 2.154434690031884e33],
    [1e200, 4.641588833612779e66],
    [1e300, 1e100],
  ];
  for (let i = 0; i < cases.length; i = i + 1) {
    const c = cases[i] as [number, number];
    expect(relErr(cbrt40(c[0]), c[1])).toBeLessThan(1e-12);
  }
  expect(relErr(cbrt40(2), 1.2599210498948732)).toBeLessThan(1e-12);
  expect(relErr(cbrt40(7), 1.912931182772389)).toBeLessThan(1e-12);
  expect(relErr(cbrt40(9), 2.080083823051904)).toBeLessThan(1e-12);
  expect(() => cbrt40(-1)).toThrow();
  expect(() => cbrt40(Number.NaN)).toThrow();
});

test('覚醒・閉店・連日の純粋計算', () => {
  expect(awakenMedalCost(5, 2, 0)).toBe(5);
  expect(awakenMedalCost(5, 2, 1)).toBe(10);
  expect(awakenMedalCost(5, 2, 2)).toBe(20);
  expect(awakenMedalCost(5, 2, 3)).toBe(40);
  expect(closeGain(1000000000, 1000000000, 0)).toBe(1);
  expect(closeGain(8000000000, 1000000000, 0)).toBe(2);
  expect(closeGain(7900000000, 1000000000, 0)).toBe(1);
  expect(closeGain(8000000000, 1000000000, 2)).toBe(0);
  expect(closeGain(0, 1000000000, 0)).toBe(0);
  expect(streakMult(0, 0.05, 20)).toBe(1);
  expect(streakMult(10, 0.05, 20)).toBe(1.5);
  expect(streakMult(20, 0.05, 20)).toBe(2);
  expect(streakMult(30, 0.05, 20)).toBe(2);
});

test('ECONOMY リソースの既定値で価格が再現できる', () => {
  const text = readFileSync('../../resources/economy/default.json', 'utf8');
  const json = JSON.parse(text) as { yakumono: Array<{ base_price: number }> };
  const t = buildPow115Table(100);
  const windmill = json.yakumono[0] as { base_price: number };
  expect(relErr(yakumonoPrice(windmill.base_price, 10, t), 60.68336603561861)).toBeLessThan(1e-12);
});
