import { readFileSync } from 'node:fs';
import { LOTTERY_HOLD_COLORS, holdColorWeights, modeOf, parseMachineText, type LotteryHoldColor, type LotteryMode } from '@ph/core';
import { expect, test } from 'vitest';
import {
  HOLD_RANKED,
  SAKIBARE_DELAY_MS,
  holdChangeCue,
  holdColorAt,
  holdRank,
  planHoldChange,
  sakibareAt,
  type HoldChangePlan,
} from './hold-change.ts';

const ORDER = ['acquire', 'shift', 'spin'];

test('白は変化しない・同じ seed と serial なら同じ見せ方', () => {
  for (let s = 0; s < 200; s++) expect(planHoldChange(7, s, 'white')).toEqual({ start: 'white', steps: [], sakibare: false });
  expect(planHoldChange(7, 123, 'gold')).toEqual(planHoldChange(7, 123, 'gold'));
});

test('色は上がるだけで最終色を超えず、最後は最終色・時点は取得→消化→変動開始の順', () => {
  const changed: Record<string, number> = {};
  const plain: Record<string, number> = {};
  const n = 20000;
  for (const final of HOLD_RANKED.slice(1)) {
    changed[final] = 0;
    plain[final] = 0;
    for (let s = 0; s < n; s++) {
      const p = planHoldChange(42, s, final);
      if (p.sakibare) {
        expect(p).toEqual({ start: 'white', steps: [{ timing: 'acquire', color: final }], sakibare: true });
        continue;
      }
      plain[final]!++;
      if (p.steps.length === 0) {
        expect(p.start).toBe(final);
        continue;
      }
      changed[final]!++;
      expect(p.steps.length).toBeLessThanOrEqual(2);
      let rank = holdRank(p.start);
      let order = -1;
      for (const step of p.steps) {
        expect(holdRank(step.color)).toBeGreaterThan(rank);
        rank = holdRank(step.color);
        expect(ORDER.indexOf(step.timing)).toBeGreaterThan(order);
        order = ORDER.indexOf(step.timing);
      }
      expect(p.steps[p.steps.length - 1]!.color).toBe(final);
    }
  }
  // 先バレしなかった保留のうち変化で見せる割合（青20%・緑35%・赤45%・金55%）。
  expect(changed['blue']! / plain['blue']!).toBeCloseTo(0.2, 1);
  expect(changed['green']! / plain['green']!).toBeCloseTo(0.35, 1);
  expect(changed['red']! / plain['red']!).toBeCloseTo(0.45, 1);
  expect(changed['gold']! / plain['gold']!).toBeCloseTo(0.55, 1);
});

/** 色ごとの先バレの割合（実測。LOTTERY_HOLD_COLORS と同順）。 */
function sakibareRates(n: number): number[] {
  return LOTTERY_HOLD_COLORS.map((color) => {
    let k = 0;
    for (let s = 0; s < n; s++) if (planHoldChange(11, s, color).sakibare) k++;
    return k / n;
  });
}

/** 保留色の表と色ごとの先バレの割合から、先バレの信頼度（当たる割合）と当たりに付く割合を出す。 */
function sakibareStats(machine: string, mode: LotteryMode, f: readonly number[]): { rel: number; ofHits: number } {
  const spec = parseMachineText(readFileSync(new URL(`../../../resources/machines/${machine}.json`, import.meta.url), 'utf8'));
  const p = modeOf(spec, mode).thresholdU32 / 4294967296;
  const wHit = holdColorWeights(spec, mode, true);
  const wMiss = holdColorWeights(spec, mode, false);
  const sHit = wHit.reduce((a, b) => a + b, 0);
  const sMiss = wMiss.reduce((a, b) => a + b, 0);
  let hit = 0;
  let all = 0;
  for (let i = 0; i < f.length; i++) {
    const h = (p * wHit[i]!) / sHit;
    hit += f[i]! * h;
    all += f[i]! * (h + ((1 - p) * wMiss[i]!) / sMiss);
  }
  return { rel: hit / all, ofHits: hit / p };
}

test('先バレ: 色だけで決まり（白はなし）、通常時の表では信頼度が約40%（3機種）', () => {
  const f = sakibareRates(40000);
  const rate = (c: LotteryHoldColor) => f[LOTTERY_HOLD_COLORS.indexOf(c)]!;
  expect(rate('white')).toBe(0);
  // 青10%・緑18%・赤24%・金35%（熱い色ほど先バレしやすい）。
  const want: [LotteryHoldColor, number][] = [['blue', 0.1], ['green', 0.18], ['red', 0.24], ['gold', 0.35]];
  for (const [c, x] of want) expect(Math.abs(rate(c) - x)).toBeLessThan(0.01);
  for (const machine of ['light-middle-01', 'rush-middle-01', 'lt-middle-01']) {
    const normal = sakibareStats(machine, 'normal', f);
    expect(Math.abs(normal.rel - 0.4)).toBeLessThan(0.02);
    expect(normal.ofHits).toBeGreaterThan(0.2);
    // ST・LT の表（出たら熱い）では先バレもやや熱い。
    expect(sakibareStats(machine, 'st', f).rel).toBeGreaterThan(normal.rel);
  }
});

test('先バレの時刻: 取得の少し後（取得時刻が分からない・先バレしない時は null）、色は取得時の変化で上がる', () => {
  const p: HoldChangePlan = { start: 'white', steps: [{ timing: 'acquire', color: 'red' }], sakibare: true };
  const c = { addedAt: 1000, shiftAt: null, spinAt: null };
  expect(sakibareAt(p, c)).toBe(1000 + SAKIBARE_DELAY_MS);
  expect(holdColorAt(p, c, 1000 + SAKIBARE_DELAY_MS)).toBe('white');
  expect(holdColorAt(p, c, 1700)).toBe('red');
  expect(sakibareAt(p, { ...c, addedAt: null })).toBeNull();
  expect(sakibareAt({ ...p, sakibare: false }, c)).toBeNull();
});

const TWO: HoldChangePlan = {
  start: 'white',
  steps: [
    { timing: 'acquire', color: 'blue' },
    { timing: 'spin', color: 'gold' },
  ],
  sakibare: false,
};

test('時点ごとの色: 取得の少し後・変動開始の少し後に変わる', () => {
  const c = { addedAt: 1000, shiftAt: null, spinAt: null };
  expect(holdColorAt(TWO, c, 1000)).toBe('white');
  expect(holdColorAt(TWO, c, 1700)).toBe('blue');
  expect(holdColorAt(TWO, c, 1e12)).toBe('blue');
  expect(holdColorAt(TWO, { ...c, spinAt: 5000 }, 5499)).toBe('blue');
  expect(holdColorAt(TWO, { ...c, spinAt: 5000 }, 5500)).toBe('gold');
});

test('消化で変わる予定のまま自分の番が来たら変動開始で変わる・取得がすぐ変動なら順番を守る', () => {
  const p: HoldChangePlan = { start: 'blue', steps: [{ timing: 'shift', color: 'red' }], sakibare: false };
  expect(holdColorAt(p, { addedAt: 0, shiftAt: 3000, spinAt: null }, 3350)).toBe('red');
  expect(holdColorAt(p, { addedAt: 0, shiftAt: null, spinAt: 3000 }, 3499)).toBe('blue');
  expect(holdColorAt(p, { addedAt: 0, shiftAt: null, spinAt: 3000 }, 3500)).toBe('red');
  // 取得と同時に変動開始（保留なし）: 取得時の変化（+700）の後に変動開始の変化が来る。
  const c = { addedAt: 0, shiftAt: null, spinAt: 0 };
  expect(holdColorAt(TWO, c, 600)).toBe('white');
  expect(holdColorAt(TWO, c, 700)).toBe('gold');
});

test('取得時刻が分からない（リプレイ・プレビュー）時は取得時・消化時の変化は済んでいる', () => {
  const c = { addedAt: null, shiftAt: null, spinAt: 2000 };
  expect(holdColorAt(TWO, c, 0)).toBe('blue');
  expect(holdColorAt(TWO, c, 2500)).toBe('gold');
  const colors: LotteryHoldColor[] = ['blue', 'green', 'red', 'gold'];
  expect(colors.map(holdChangeCue)).toEqual(['hold_blue', 'hold_green', 'hold_red', 'hold_gold']);
});
