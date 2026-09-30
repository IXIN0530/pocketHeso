import type { AchievementDef, AchievementsView, EngineSimEvent } from '@ph/core';
import { expect, test } from 'vitest';
import { ACHIEVEMENTS } from '../engine/achievement-defs.ts';
import { achievedCount, achievedIds, achievedToast, groupAchievements, multPercent } from './achievements.ts';

const list: AchievementDef[] = [
  { id: 'firstHits_1', metric: 'firstHits', at: 1, name: '初当たり' },
  { id: 'firstHits_10', metric: 'firstHits', at: 10, name: '当たりの常連' },
  { id: 'firstHits_50', metric: 'firstHits', at: 50, name: '引きの強さ' },
  { id: 'firstHits_100', metric: 'firstHits', at: 100, name: '百回の歓喜' },
  { id: 'closes_1', metric: 'closes', at: 1, name: 'はじめての閉店' },
];

const metrics = { ballsTotal: 0, medalsEarned: 0, refPerSec: 0, yakumono: 0, awakenTotal: 0, rateStage: 0, streakDays: 0, firstHits: 4, jackpots: 0, maxChain: 0, closes: 1 };
const view = (done: AchievementsView['done'], m = metrics): AchievementsView => ({ done, mult: 1 + 0.01 * done.length, metrics: m });

test('指標ごとに達成済み・次の1つの進捗・伏せた数', () => {
  const g = groupAchievements(view([{ id: 'firstHits_1', at: 5 }, { id: 'closes_1', at: 9 }]), list);
  expect(g.map((x) => x.metric)).toEqual(['firstHits', 'closes']);
  expect(g[0]).toEqual({
    metric: 'firstHits',
    done: [{ id: 'firstHits_1', name: '初当たり', at: 5 }],
    next: { name: '当たりの常連', value: 4, at: 10, ratio: 0.4 },
    hidden: 2,
  });
  expect(g[1]).toMatchObject({ done: [{ id: 'closes_1' }], next: null, hidden: 0 });
});

test('進捗は 0〜1 に収める', () => {
  const g = groupAchievements(view([], { ...metrics, firstHits: 7 }), list);
  expect(g[0]?.next?.ratio).toBe(1);
});

test('一覧から消えた id は数えない', () => {
  expect(achievedCount(view([{ id: 'firstHits_1', at: 1 }, { id: 'gone_1', at: 2 }]), list)).toBe(1);
  expect(multPercent(1.12)).toBe(12);
});

test('同じ前進の達成は1つのトーストにまとめる', () => {
  const ev: EngineSimEvent[] = [
    { k: 'achieved', id: 'ballsTotal_1e4', at: 1 },
    { k: 'achieved', id: 'firstHits_1', at: 1 },
  ];
  expect(achievedIds(ev)).toEqual(['ballsTotal_1e4', 'firstHits_1']);
  expect(achievedToast(achievedIds(ev), ACHIEVEMENTS)).toBe('実績を 2 個達成 生産 +2%');
  expect(achievedToast(['ballsTotal_1e4'], ACHIEVEMENTS)).toBe('実績「はじめての出玉」 生産 +1%');
  expect(achievedToast([], ACHIEVEMENTS)).toBeNull();
});

test('既定の一覧は 44 個で、指標は10種', () => {
  expect(ACHIEVEMENTS.list.length).toBe(44);
  expect(groupAchievements(view([]), ACHIEVEMENTS.list).length).toBe(10);
});

test('画面の一覧は Core の parseEconomy と同じ', async () => {
  const { parseEconomy } = await import('@ph/core');
  const economy = await import('../../../../resources/economy/default.json');
  expect(ACHIEVEMENTS).toEqual(parseEconomy(economy.default).achievements);
});
