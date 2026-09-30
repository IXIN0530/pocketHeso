// 実績の一覧（画面の名前・しきい値の出どころ, spec/24）。画面から読むので Core のパーサを通さず JSON の achievements だけを取る
// （検証は Worker 側の parseEconomy が起動時に行う）。
import type { AchievementMetric, EconomyAchievements } from '@ph/core';
import { achievements } from '../../../../resources/economy/default.json';

export const ACHIEVEMENTS: EconomyAchievements = {
  multPer: achievements.mult_per,
  list: achievements.list.map((a) => ({ id: a.id, metric: a.metric as AchievementMetric, at: a.at, name: a.name })),
};
