// 常連ツリーの画面用の定義（名前・説明は economy JSON の tree.nodes から。系統は spec/25 の表, 52 個）。
// 画面から読むので Core のパーサを通さず JSON の tree だけを取る（検証は Worker 側の parseEconomy が起動時に行う）。
import type { RestView, ShopCloseView, TreeNodeView } from '@ph/core';
import { formatNum } from '../stores/format.ts';
import { close, tree } from '../../../../resources/economy/default.json';

export interface TreeNodeText {
  readonly name: string;
  readonly desc: string;
  readonly line: string;
}

/** ノード id → 系統（JSON に系統の欄が無いため画面側で持つ。未知の id は「その他」）。 */
const LINES: Readonly<Record<string, string>> = {
  kanban: '生産',
  tank_keep: '燃料',
  auto_keep: '台',
  starter1: '開店',
  lamp_gold: '見た目',
  open_dash1: '開店',
  notice_call1: '予告',
  idle_keep: '放置',
  sashiire1: '行動',
  nail_keep: '台',
  lcd_sakura: '見た目',
  fever_long1: '予告',
  rush_cap1: '予告',
  shop_light1: '機種',
  shop_rush1: '機種',
  shop_lt1: '機種',
  tank_big1: '燃料',
  night_light1: '放置',
  awaken_disc: '台',
  awaken_keep1: '台',
  starter2: '開店',
  notice_auto: '便利',
  manin: '生産',
  kuchikomi1: '常連P',
  cab_chrome: '見た目',
  open_dash2: '開店',
  streak_up1: '行動',
  notice_call2: '予告',
  sashiire2: '行動',
  price_cut1: '生産',
  bonus_notice: '予告',
  fever_mult1: '予告',
  ach_link1: '実績',
  tank_big2: '燃料',
  grant_hold_luck: '台',
  hanjou: '生産',
  kuchikomi2: '常連P',
  bantou: '便利',
  resonance1: '台',
  night_light2: '放置',
  gold_ball: '見た目',
  shop_light2: '機種',
  shop_rush2: '機種',
  shop_lt2: '機種',
  streak_up2: '行動',
  boost_up: '燃料',
  price_cut2: '生産',
  ach_link2: '実績',
  regular_up1: '生産',
  meiten: '生産',
  resonance2: '台',
  kuchikomi3: '常連P',
  regular_up2: '生産',
  densetsu: '生産',
  dendou: '見た目・実績',
};

export const TREE_NODE_TEXT: Readonly<Record<string, TreeNodeText>> = Object.fromEntries(
  tree.nodes.map((n) => [n.id, { name: n.name, desc: n.desc, line: LINES[n.id] ?? 'その他' }]),
);

export const TREE_TIER_UNLOCK: readonly number[] = tree.tier_unlock;
export const TREE_TIER_NAMES = ['短期', '中期', '長期', '超長期', '遠い目標'] as const;
export const POINTS_PER_RANK: number = tree.points_per_rank;
export const RUN_BONUS_AT: readonly number[] = tree.run_bonus_at;

const OPEN_BOOST: Readonly<Record<string, number>> = Object.fromEntries(
  tree.nodes.map((n) => [n.id, n.effect.reduce((s, e) => s + (e.k === 'open_boost' ? ((e as { mult?: number }).mult ?? 1) - 1 : 0), 0)]),
);

/** 開店ダッシュの倍率（所持ノードの Σ(mult − 1) + 1。所持が無ければ 1）。 */
export function openBoostMult(nodes: readonly TreeNodeView[]): number {
  let add = 0;
  for (const n of nodes) {
    if (n.state === 'owned') add += OPEN_BOOST[n.id] ?? 0;
  }
  return 1 + add;
}

export interface TierGroup {
  readonly line: string;
  readonly nodes: readonly TreeNodeView[];
}

/** 段 t（1〜5）のノードを系統ごとにまとめる（系統は出てきた順、中は JSON の順）。 */
export function groupTier(nodes: readonly TreeNodeView[], t: number): TierGroup[] {
  const groups: { line: string; nodes: TreeNodeView[] }[] = [];
  for (const n of nodes) {
    if (n.tier !== t) continue;
    const line = TREE_NODE_TEXT[n.id]?.line ?? 'その他';
    let g = groups.find((x) => x.line === line);
    if (g === undefined) {
      g = { line, nodes: [] };
      groups.push(g);
    }
    g.nodes.push(n);
  }
  return groups;
}

/** 段 t が閉じている時の「あと k 個」（段 t より下で買った数が tier_unlock[t-1] に届くまで）。開いていれば 0。 */
export function tierRemaining(nodes: readonly TreeNodeView[], t: number): number {
  let below = 0;
  for (const n of nodes) {
    if (n.tier < t && n.state === 'owned') below += 1;
  }
  return Math.max(0, (TREE_TIER_UNLOCK[t - 1] ?? 0) - below);
}

export type TreeStateMark = { mark: string; label: string };

/** 状態の表示（色だけにせず形でも区別）。 */
export function stateMark(s: TreeNodeView['state']): TreeStateMark {
  switch (s) {
    case 'owned':
      return { mark: '✓', label: '済' };
    case 'buyable':
      return { mark: '●', label: '買える' };
    case 'short':
      return { mark: '◐', label: 'P不足' };
    default:
      return { mark: '🔒', label: '前提不足' };
  }
}

/** 閉店の常連P の内訳（ランク +g・累計玉の段 +b・口コミ +c）。points は Projection の close.points。 */
export function closeBreakdown(gain: number, runTotal: number, points: number): { rank: number; bonus: number; kuchikomi: number } {
  if (gain < 1) return { rank: 0, bonus: 0, kuchikomi: 0 };
  const rank = POINTS_PER_RANK * gain;
  let bonus = 0;
  for (const at of RUN_BONUS_AT) if (runTotal >= at) bonus += 1;
  return { rank, bonus, kuchikomi: points - rank - bonus };
}

/** 閉店カードの「計算のしかた」の各行（式の定数は economy JSON から）。2つの累計玉（今回／これまで）を書き分ける。 */
export function closeExplain(c: ShopCloseView, medalsEarned: number, rank: number): string[] {
  const n = (v: number) => formatNum(v);
  const tiers = RUN_BONUS_AT.map((at) => n(at)).join('・');
  return [
    `ランクの上がり幅 ＝ min(玉由来, 行動由来) − 今のランク（今 ${rank}）`,
    `玉由来 ＝ ∛(これまでの累計玉 ÷ ${n(close.divisor)}) の切り捨て。今 これまで${n(c.totalTotal)}玉 → ${c.byBalls}。次の +1 は ${n(c.nextBallsAt)}玉（あと ${n(Math.max(0, c.nextBallsAt - c.totalTotal))}玉）`,
    `行動由来 ＝ 累計メダル ÷ ${close.medals_per_point} の切り捨て。今 ${n(medalsEarned)}枚 → ${c.byMedals}。次の +1 は ${n(c.nextMedalsAt)}枚（あと ${n(Math.max(0, c.nextMedalsAt - medalsEarned))}枚）`,
    `閉店の条件は「今回」の累計玉が ${n(c.required)}。玉由来は「これまで」の累計玉（閉店で戻りません）`,
    `常連P ＝ ランク +1 につき ${POINTS_PER_RANK} ＋ 累計玉の段（今回の累計玉が ${tiers}… を超えた数）＋ 口コミ`,
  ];
}

/** 休業の自動開店までの ms（JSON の close.rest_max_ms。P12-T3）。 */
export const REST_MAX_MS: number = (close as { rest_max_ms: number }).rest_max_ms;

/** 休業の上限の分の表記（JSON から。初期 30分）。 */
export const REST_AUTO_MINUTES: number = Math.floor(REST_MAX_MS / 60000);

/** 閉店カード・閉店シートの休業の説明（30分は JSON から）。 */
export function restCloseText(): string {
  return `閉店すると休業に入り、常連P を使ってから開店できます（${REST_AUTO_MINUTES}分で自動で開店）`;
}

/** 休業中のカウントダウン「M:SS」（残りは切り上げ。30:00 → 29:59 … 0:01 → 0:00）。 */
export function restCountdownText(rest: RestView, at: number): string {
  const s = Math.max(0, Math.ceil((rest.autoOpenAt - at) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** 休業シートの見出し「休業中 自動で開店まで M:SS」（間の空きは U+3000）。 */
export function restHeaderText(rest: RestView, at: number): string {
  return '休業中　自動で開店まで ' + restCountdownText(rest, at);
}

/** timing: 'open' の小札（休業中は「開店から」、それ以外は「次の開店から」。'now' は null）。 */
export function timingBadge(timing: TreeNodeView['timing'], resting: boolean): string | null {
  if (timing !== 'open') return null;
  return resting ? '開店から' : '次の開店から';
}
