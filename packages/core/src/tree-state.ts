/** 常連ツリーの状態の計算（spec/25「常連ランクと常連P」「購入のルール」「保存」）。IdleEconomy が使う。効果の適用は T3/T4。 */
import type { TreeEffect, TreeNodeSpec, TreeSpec } from './tree-config.ts';
import { TREE_KEEP_TARGETS, TREE_TIERS } from './tree-config.ts';

/** 購入1件（購入順に保存。cost は買った時のコスト）。 */
export interface TreeRecord {
  readonly id: string;
  readonly cost: number;
  readonly at: number;
}

/** treeBuy の拒否理由（spec/25 の5種）。 */
export type TreeBuyReason = 'unknown-node' | 'owned' | 'tier-locked' | 'locked' | 'insufficient-points';

/** ノードの状態（済／買える／P不足／前提不足か段が閉じている）。 */
export type TreeNodeState = 'owned' | 'buyable' | 'short' | 'locked';

/** 画面用のノード1件（JSON の順）。 */
export interface TreeNodeView {
  readonly id: string;
  readonly tier: number;
  readonly cost: number;
  readonly req: readonly string[];
  readonly state: TreeNodeState;
  /** 効き始め（keep・starter・open_boost だけを持つノードは開店から 'open'、他は買った次の tick から 'now', D-107）。 */
  readonly timing: TreeNodeTiming;
}

/** ノードの効き始め。 */
export type TreeNodeTiming = 'now' | 'open';

/** ノードの効き始め（効果がすべて keep・starter・open_boost なら 'open'）。 */
export function treeNodeTiming(node: TreeNodeSpec): TreeNodeTiming {
  if (node.effect.length === 0) {
    return 'now';
  }
  for (let j = 0; j < node.effect.length; j = j + 1) {
    const k = (node.effect[j] as TreeEffect).k;
    if (k !== 'keep' && k !== 'starter' && k !== 'open_boost') {
      return 'now';
    }
  }
  return 'open';
}

/** 常連ツリーの表示（Projection の tree）。 */
export interface TreeView {
  readonly rank: number;
  readonly regularRate: number;
  readonly points: number;
  readonly pointsEarned: number;
  /** treeMult（今の機種込み）。 */
  readonly mult: number;
  readonly openBoostMs: number;
  readonly bantou: { readonly owned: boolean; readonly on: boolean };
  /** 段1〜5 が開いているか。 */
  readonly tierOpen: readonly boolean[];
  readonly nodes: readonly TreeNodeView[];
  /** 所持している unlock の key（JSON の順）。 */
  readonly unlocks: readonly string[];
  /** 今閉店したら得る常連P。 */
  readonly nextClosePoints: number;
}

/** 所持ノードの効果の合計（一覧の添字順に集計。保存しない）。 */
export interface TreeTotals {
  readonly prodAdd: number;
  /** prod_add_machine（JSON の順。機種の照合は使う側）。 */
  readonly prodAddMachine: readonly { readonly machine: string; readonly add: number }[];
  readonly regularAdd: number;
  readonly achPerAdd: number;
  readonly streakMaxAdd: number;
  readonly priceSub: number;
  /** TREE_KEEP_TARGETS の添字ごとに保持するか。 */
  readonly keep: readonly boolean[];
  /** 役物8種の閉店後の Lv（各要素の最大）。 */
  readonly starter: readonly number[];
  readonly openBoostMs: number;
  /** Σ(mult − 1)。 */
  readonly openBoostMultAdd: number;
  readonly closedAdd: number;
  readonly tankAddH: number;
  readonly boostCapAddH: number;
  readonly boostMultAdd: number;
  readonly noticeIntervalSub: number;
  readonly feverMsAdd: number;
  readonly feverMultAdd: number;
  readonly rushCapAddS: number;
  readonly noticeBonusWeightAdd: number;
  /** 予告の自動受け取りの遅れ（無ければ -1）。 */
  readonly noticeAutoMs: number;
  /** 行動の特別保留の 1/value（無ければ 0）。 */
  readonly grantHold1In: number;
  /** 覚醒のメダルの基数（無ければ 0）。 */
  readonly awakenMedalBase: number;
  readonly prodMinAdd: number;
  readonly pointsAdd: number;
  readonly bantou: boolean;
  readonly unlocks: readonly string[];
}

/** 一覧の添字ごとに所持しているか（反復は配列の添字順のみ）。 */
export function treeOwnedFlags(nodes: readonly TreeNodeSpec[], records: readonly TreeRecord[]): boolean[] {
  const flags: boolean[] = [];
  for (let i = 0; i < nodes.length; i = i + 1) {
    const id = (nodes[i] as TreeNodeSpec).id;
    let owned = false;
    for (let k = 0; k < records.length; k = k + 1) {
      if ((records[k] as TreeRecord).id === id) {
        owned = true;
        break;
      }
    }
    flags.push(owned);
  }
  return flags;
}

/** 段1〜5 が開いているか（段 n は「段 n より下で買った数 ≥ tier_unlock[n]」）。 */
export function treeTierOpen(tree: TreeSpec, owned: readonly boolean[]): boolean[] {
  const countByTier: number[] = [];
  for (let t = 0; t < TREE_TIERS; t = t + 1) {
    countByTier.push(0);
  }
  for (let i = 0; i < tree.nodes.length; i = i + 1) {
    if (owned[i] === true) {
      const t = (tree.nodes[i] as TreeNodeSpec).tier - 1;
      countByTier[t] = (countByTier[t] as number) + 1;
    }
  }
  const open: boolean[] = [];
  let below = 0;
  for (let t = 0; t < TREE_TIERS; t = t + 1) {
    open.push(below >= (tree.tierUnlock[t] as number));
    below = below + (countByTier[t] as number);
  }
  return open;
}

/** runBonus = 今回の累計玉が run_bonus_at の何個以上か。 */
export function treeRunBonus(runTotal: number, runBonusAt: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < runBonusAt.length; i = i + 1) {
    if (runTotal >= (runBonusAt[i] as number)) {
      n = n + 1;
    }
  }
  return n;
}

/** 閉店で得る常連P（gain ≥ 1 なら points_per_rank × gain + runBonus + Σ口コミ、それ以外 0）。 */
export function treeClosePoints(gain: number, runTotal: number, tree: TreeSpec, pointsAdd: number): number {
  if (gain < 1) {
    return 0;
  }
  return tree.pointsPerRank * gain + treeRunBonus(runTotal, tree.runBonusAt) + pointsAdd;
}

/** 添字 idx のノードを今買えるか（拒否理由の順: owned → tier-locked → locked → insufficient-points）。 */
function nodeBlock(
  tree: TreeSpec,
  idx: number,
  owned: readonly boolean[],
  tierOpen: readonly boolean[],
  points: number,
): TreeBuyReason | null {
  const node = tree.nodes[idx] as TreeNodeSpec;
  if (owned[idx] === true) {
    return 'owned';
  }
  if (tierOpen[node.tier - 1] !== true) {
    return 'tier-locked';
  }
  for (let r = 0; r < node.req.length; r = r + 1) {
    const reqId = node.req[r] as string;
    let ok = false;
    for (let i = 0; i < idx; i = i + 1) {
      if ((tree.nodes[i] as TreeNodeSpec).id === reqId) {
        ok = owned[i] === true;
        break;
      }
    }
    if (!ok) {
      return 'locked';
    }
  }
  if (points < node.cost) {
    return 'insufficient-points';
  }
  return null;
}

/** id のノードを今買えるか。買えるなら添字、買えないなら理由。 */
export function treeCheckBuy(
  tree: TreeSpec,
  id: string,
  owned: readonly boolean[],
  points: number,
): { ok: true; idx: number } | { ok: false; reason: TreeBuyReason } {
  let idx = -1;
  for (let i = 0; i < tree.nodes.length; i = i + 1) {
    if ((tree.nodes[i] as TreeNodeSpec).id === id) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    return { ok: false, reason: 'unknown-node' };
  }
  const reason = nodeBlock(tree, idx, owned, treeTierOpen(tree, owned), points);
  if (reason !== null) {
    return { ok: false, reason };
  }
  return { ok: true, idx };
}

/** 画面用のノード一覧（JSON の順）。 */
export function treeNodeViews(tree: TreeSpec, owned: readonly boolean[], points: number): TreeNodeView[] {
  const tierOpen = treeTierOpen(tree, owned);
  const out: TreeNodeView[] = [];
  for (let i = 0; i < tree.nodes.length; i = i + 1) {
    const node = tree.nodes[i] as TreeNodeSpec;
    const reason = nodeBlock(tree, i, owned, tierOpen, points);
    let state: TreeNodeState = 'buyable';
    if (reason === 'owned') {
      state = 'owned';
    } else if (reason === 'tier-locked' || reason === 'locked') {
      state = 'locked';
    } else if (reason === 'insufficient-points') {
      state = 'short';
    }
    out.push({ id: node.id, tier: node.tier, cost: node.cost, req: [...node.req], state, timing: treeNodeTiming(node) });
  }
  return out;
}

/** 所持ノードの効果を添字順に集計する（加算型は和、「1個まで」は値、starter は要素ごとの最大）。 */
export function treeSumEffects(nodes: readonly TreeNodeSpec[], owned: readonly boolean[]): TreeTotals {
  let prodAdd = 0;
  const prodAddMachine: { machine: string; add: number }[] = [];
  let regularAdd = 0;
  let achPerAdd = 0;
  let streakMaxAdd = 0;
  let priceSub = 0;
  const keep: boolean[] = [];
  for (let i = 0; i < TREE_KEEP_TARGETS.length; i = i + 1) {
    keep.push(false);
  }
  const starter = [0, 0, 0, 0, 0, 0, 0, 0];
  let openBoostMs = 0;
  let openBoostMultAdd = 0;
  let closedAdd = 0;
  let tankAddH = 0;
  let boostCapAddH = 0;
  let boostMultAdd = 0;
  let noticeIntervalSub = 0;
  let feverMsAdd = 0;
  let feverMultAdd = 0;
  let rushCapAddS = 0;
  let noticeBonusWeightAdd = 0;
  let noticeAutoMs = -1;
  let grantHold1In = 0;
  let awakenMedalBase = 0;
  let prodMinAdd = 0;
  let pointsAdd = 0;
  let bantou = false;
  const unlocks: string[] = [];
  for (let i = 0; i < nodes.length; i = i + 1) {
    if (owned[i] !== true) {
      continue;
    }
    const effects = (nodes[i] as TreeNodeSpec).effect;
    for (let j = 0; j < effects.length; j = j + 1) {
      const e = effects[j] as TreeEffect;
      switch (e.k) {
        case 'prod_add':
          prodAdd = prodAdd + e.add;
          break;
        case 'prod_add_machine':
          prodAddMachine.push({ machine: e.machine, add: e.add });
          break;
        case 'regular_add':
          regularAdd = regularAdd + e.add;
          break;
        case 'ach_per_add':
          achPerAdd = achPerAdd + e.add;
          break;
        case 'streak_max_add':
          streakMaxAdd = streakMaxAdd + e.add;
          break;
        case 'price_sub':
          priceSub = priceSub + e.sub;
          break;
        case 'keep':
          for (let t = 0; t < e.targets.length; t = t + 1) {
            for (let q = 0; q < TREE_KEEP_TARGETS.length; q = q + 1) {
              if (TREE_KEEP_TARGETS[q] === e.targets[t]) {
                keep[q] = true;
              }
            }
          }
          break;
        case 'starter':
          for (let q = 0; q < 8; q = q + 1) {
            const v = e.lv[q] as number;
            if (v > (starter[q] as number)) {
              starter[q] = v;
            }
          }
          break;
        case 'open_boost':
          openBoostMs = openBoostMs + e.ms;
          openBoostMultAdd = openBoostMultAdd + (e.mult - 1);
          break;
        case 'closed_add':
          closedAdd = closedAdd + e.add;
          break;
        case 'tank_add_h':
          tankAddH = tankAddH + e.add;
          break;
        case 'boost_cap_add_h':
          boostCapAddH = boostCapAddH + e.add;
          break;
        case 'boost_mult_add':
          boostMultAdd = boostMultAdd + e.add;
          break;
        case 'notice_interval_sub':
          noticeIntervalSub = noticeIntervalSub + e.sub;
          break;
        case 'fever_ms_add':
          feverMsAdd = feverMsAdd + e.add;
          break;
        case 'fever_mult_add':
          feverMultAdd = feverMultAdd + e.add;
          break;
        case 'rush_cap_add_s':
          rushCapAddS = rushCapAddS + e.add;
          break;
        case 'notice_bonus_weight_add':
          noticeBonusWeightAdd = noticeBonusWeightAdd + e.add;
          break;
        case 'notice_auto':
          noticeAutoMs = e.ms;
          break;
        case 'grant_hold_1_in':
          grantHold1In = e.value;
          break;
        case 'awaken_medal_base':
          awakenMedalBase = e.value;
          break;
        case 'prod_min_add':
          prodMinAdd = prodMinAdd + e.add;
          break;
        case 'points_add':
          pointsAdd = pointsAdd + e.add;
          break;
        case 'bantou':
          bantou = true;
          break;
        case 'unlock':
          unlocks.push(e.key);
          break;
      }
    }
  }
  return {
    prodAdd,
    prodAddMachine,
    regularAdd,
    achPerAdd,
    streakMaxAdd,
    priceSub,
    keep,
    starter,
    openBoostMs,
    openBoostMultAdd,
    closedAdd,
    tankAddH,
    boostCapAddH,
    boostMultAdd,
    noticeIntervalSub,
    feverMsAdd,
    feverMultAdd,
    rushCapAddS,
    noticeBonusWeightAdd,
    noticeAutoMs,
    grantHold1In,
    awakenMedalBase,
    prodMinAdd,
    pointsAdd,
    bantou,
    unlocks,
  };
}

/** 復元した購入から一覧に無い id を除き、その cost の合計を返す（返金額。D-104）。 */
export function treeDropUnknown(
  nodes: readonly TreeNodeSpec[],
  records: readonly TreeRecord[],
): { kept: TreeRecord[]; refund: number } {
  const kept: TreeRecord[] = [];
  let refund = 0;
  for (let k = 0; k < records.length; k = k + 1) {
    const r = records[k] as TreeRecord;
    let known = false;
    for (let i = 0; i < nodes.length; i = i + 1) {
      if ((nodes[i] as TreeNodeSpec).id === r.id) {
        known = true;
        break;
      }
    }
    if (known) {
      kept.push(r);
    } else {
      refund = refund + r.cost;
    }
  }
  return { kept, refund };
}
