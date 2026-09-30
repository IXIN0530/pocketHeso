// 実績の表示（spec/24 画面）: 記録タブの一覧・進捗、ホールのトースト文言。名前・しきい値は economy JSON から。
import type { AchievementDef, AchievementMetric, AchievementsView, EconomyAchievements, EngineSimEvent } from '@ph/core';

/** 指標の見出し。 */
export const METRIC_LABEL: Readonly<Record<AchievementMetric, string>> = {
  ballsTotal: '累計の玉',
  medalsEarned: '累計メダル',
  refPerSec: '基準生産/秒',
  yakumono: '役物の種類',
  awakenTotal: '覚醒の回数',
  rateStage: 'レート解放',
  streakDays: '連続日数',
  firstHits: '初当たり',
  jackpots: '大当たり',
  maxChain: '最大連チャン',
  closes: '閉店',
};

export interface AchievementNext {
  readonly name: string;
  readonly value: number;
  readonly at: number;
  /** 進捗（0〜1）。 */
  readonly ratio: number;
}

export interface AchievementGroup {
  readonly metric: AchievementMetric;
  readonly done: readonly { readonly id: string; readonly name: string; readonly at: number }[];
  /** 次の1つ（全部達成なら null）。 */
  readonly next: AchievementNext | null;
  /** 次の先の伏せた数。 */
  readonly hidden: number;
}

/** 一覧を指標ごとにまとめる（指標は一覧に初めて出た順、中は一覧の順）。一覧に無い id は数えない。 */
export function groupAchievements(view: AchievementsView, list: readonly AchievementDef[]): AchievementGroup[] {
  const doneAt = new Map(view.done.map((d) => [d.id, d.at]));
  const groups: { metric: AchievementMetric; done: AchievementGroup['done'][number][]; next: AchievementNext | null; hidden: number }[] = [];
  for (const a of list) {
    let g = groups.find((x) => x.metric === a.metric);
    if (!g) {
      g = { metric: a.metric, done: [], next: null, hidden: 0 };
      groups.push(g);
    }
    const at = doneAt.get(a.id);
    if (at !== undefined) {
      g.done.push({ id: a.id, name: a.name, at });
    } else if (g.next === null) {
      const value = view.metrics[a.metric];
      g.next = { name: a.name, value, at: a.at, ratio: Math.min(1, Math.max(0, value / a.at)) };
    } else {
      g.hidden += 1;
    }
  }
  return groups;
}

/** 一覧にある達成数。 */
export function achievedCount(view: AchievementsView, list: readonly AchievementDef[]): number {
  const ids = new Set(list.map((a) => a.id));
  return view.done.filter((d) => ids.has(d.id)).length;
}

/** 生産の上乗せ（%、整数に丸める）。 */
export const multPercent = (mult: number): number => Math.round((mult - 1) * 100);

/** 1回の前進で達成した実績の id（出た順）。 */
export function achievedIds(events: readonly EngineSimEvent[]): string[] {
  const ids: string[] = [];
  for (const e of events) if (e.k === 'achieved') ids.push(e.id);
  return ids;
}

/** トースト（同じ前進で複数なら1つにまとめる）。無ければ null。 */
export function achievedToast(ids: readonly string[], ach: EconomyAchievements): string | null {
  if (ids.length === 0) return null;
  const pct = Math.round(ids.length * ach.multPer * 100);
  if (ids.length === 1) {
    const name = ach.list.find((a) => a.id === ids[0])?.name ?? ids[0];
    return `実績「${name}」 生産 +${pct}%`;
  }
  return `実績を ${ids.length} 個達成 生産 +${pct}%`;
}
