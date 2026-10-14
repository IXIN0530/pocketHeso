import type { TreeNodeView } from '@ph/core';
import { expect, test } from 'vitest';
import { formatClock } from '../stores/format.ts';
import { closeBreakdown, closeExplain, groupTier, openBoostMult, stateMark, TREE_NODE_TEXT, tierRemaining } from './tree-defs.ts';

const node = (id: string, tier: number, state: TreeNodeView['state'], cost = 3): TreeNodeView => ({ id, tier, cost, req: [], state, timing: 'now' });

test('名前と系統は JSON から引き当てる（52個すべて系統あり）', () => {
  expect(Object.keys(TREE_NODE_TEXT).length).toBe(52);
  expect(TREE_NODE_TEXT['kanban']).toMatchObject({ name: '常連の看板', line: '生産' });
  expect(Object.values(TREE_NODE_TEXT).every((t) => t.line !== 'その他')).toBe(true);
});

test('状態の印は形も変える（済／買える／P不足／前提不足）', () => {
  const marks = (['owned', 'buyable', 'short', 'locked'] as const).map((s) => stateMark(s).mark);
  expect(new Set(marks).size).toBe(4);
});

test('段の中は系統ごとにまとめ、閉じた段は「あと k 個」', () => {
  const nodes = [node('kanban', 1, 'owned'), node('tank_keep', 1, 'buyable'), node('auto_keep', 1, 'short'), node('starter1', 2, 'locked')];
  expect(groupTier(nodes, 1).map((g) => [g.line, g.nodes.length])).toEqual([
    ['生産', 1],
    ['燃料', 1],
    ['台', 1],
  ]);
  // 段2 は 段1 を 4 個買うと開く（JSON の tier_unlock[1]）。1 個持ちなら あと 3
  expect(tierRemaining(nodes, 2)).toBe(3);
  expect(tierRemaining(nodes, 1)).toBe(0);
});

test('開店ダッシュの倍率は所持ノードから（×2 → 長で ×2.5、無ければ ×1）', () => {
  expect(openBoostMult([node('open_dash1', 1, 'buyable')])).toBe(1);
  expect(openBoostMult([node('open_dash1', 1, 'owned')])).toBe(2);
  expect(openBoostMult([node('open_dash1', 1, 'owned'), node('open_dash2', 3, 'owned')])).toBe(2.5);
});

test('閉店の常連P の内訳（ランク・累計玉の段・口コミ）', () => {
  expect(closeBreakdown(0, 1e12, 0)).toEqual({ rank: 0, bonus: 0, kuchikomi: 0 });
  // gain 3 → 30P、1e11 以上で bonus 1、1e12 未満。合計 34 なら口コミ 3
  expect(closeBreakdown(3, 5e11, 34)).toEqual({ rank: 30, bonus: 1, kuchikomi: 3 });
});

test('残り時間は 時:分:秒', () => {
  expect(formatClock(4325000)).toBe('1:12:05');
  expect(formatClock(0)).toBe('0:00:00');
});

test('閉店の説明: 玉由来・行動由来の次の +1 と、2つの累計玉の書き分け（P11-T2）', () => {
  const c = {
    runTotal: 3e9,
    required: 1e10,
    ready: false,
    gain: 0,
    byBalls: 2,
    byMedals: 5,
    totalTotal: 1.5e11,
    nextBallsAt: 27 * 12e9,
    nextMedalsAt: 6 * 28,
    points: 0,
  };
  const text = closeExplain(c, 150, 1).join('\n');
  expect(text).toContain('∛(これまでの累計玉 ÷ 120億)');
  expect(text).toContain('次の +1 は 3240億玉（あと 1740億玉）');
  expect(text).toContain('累計メダル ÷ 28');
  expect(text).toContain('次の +1 は 168枚（あと 18枚）');
  expect(text).toContain('「今回」の累計玉が 100億');
  expect(text).toContain('「これまで」の累計玉');
});
