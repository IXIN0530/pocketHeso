import type { LotteryHoldColor } from '@ph/core';
import { expect, test } from 'vitest';
import { HOLD_RANKED, holdChangeCue, holdColorAt, holdRank, planHoldChange, type HoldChangePlan } from './hold-change.ts';

const ORDER = ['acquire', 'shift', 'spin'];

test('白は変化しない・同じ seed と serial なら同じ見せ方', () => {
  for (let s = 0; s < 200; s++) expect(planHoldChange(7, s, 'white')).toEqual({ start: 'white', steps: [] });
  expect(planHoldChange(7, 123, 'gold')).toEqual(planHoldChange(7, 123, 'gold'));
});

test('色は上がるだけで最終色を超えず、最後は最終色・時点は取得→消化→変動開始の順', () => {
  const changed: Record<string, number> = {};
  const n = 20000;
  for (const final of HOLD_RANKED.slice(1)) {
    changed[final] = 0;
    for (let s = 0; s < n; s++) {
      const p = planHoldChange(42, s, final);
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
  // 変化で見せる割合（青20%・緑35%・赤45%・金55%）。
  expect(changed['blue']! / n).toBeCloseTo(0.2, 1);
  expect(changed['green']! / n).toBeCloseTo(0.35, 1);
  expect(changed['red']! / n).toBeCloseTo(0.45, 1);
  expect(changed['gold']! / n).toBeCloseTo(0.55, 1);
});

const TWO: HoldChangePlan = {
  start: 'white',
  steps: [
    { timing: 'acquire', color: 'blue' },
    { timing: 'spin', color: 'gold' },
  ],
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
  const p: HoldChangePlan = { start: 'blue', steps: [{ timing: 'shift', color: 'red' }] };
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
