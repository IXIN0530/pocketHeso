/** 常連ツリーの設定（`default.json` の `tree`）の型と検証（spec/25「設定 JSON」）。効果の計算はここに置かない。 */
import {
  asArray,
  asInt,
  asIntRange,
  asNumber,
  asPositive,
  asRecord,
  asString,
  checkAscending,
  fail,
} from './config-check.ts';

/** 閉店のリセットで段を保持できる強化（`keep` の targets。awaken_low は風車〜クルーン・awaken_all は全役物の覚醒）。 */
export type TreeKeepTarget =
  | 'idle'
  | 'tank'
  | 'nail'
  | 'shorten'
  | 'hold'
  | 'auto'
  | 'tomeuchi'
  | 'awaken_low'
  | 'awaken_all';

/** 既知の keep 対象（順序固定）。 */
export const TREE_KEEP_TARGETS: readonly TreeKeepTarget[] = [
  'idle',
  'tank',
  'nail',
  'shorten',
  'hold',
  'auto',
  'tomeuchi',
  'awaken_low',
  'awaken_all',
];

/** awaken_low が保持する役物の数（風車・回転体・クルーン）。 */
export const TREE_AWAKEN_LOW_COUNT = 3;

/** ノードの効果（k ごとの判別共用体, spec/25「効果の種類」）。 */
export type TreeEffect =
  | { readonly k: 'prod_add'; readonly add: number }
  | { readonly k: 'prod_add_machine'; readonly machine: string; readonly add: number }
  | { readonly k: 'regular_add'; readonly add: number }
  | { readonly k: 'ach_per_add'; readonly add: number }
  | { readonly k: 'streak_max_add'; readonly add: number }
  | { readonly k: 'price_sub'; readonly sub: number }
  | { readonly k: 'keep'; readonly targets: readonly TreeKeepTarget[] }
  | { readonly k: 'starter'; readonly lv: readonly number[] }
  | { readonly k: 'starter_rel'; readonly ratio: number }
  | { readonly k: 'resonance_add'; readonly add: number }
  | { readonly k: 'open_boost'; readonly ms: number; readonly mult: number }
  | { readonly k: 'closed_add'; readonly add: number }
  | { readonly k: 'tank_add_h'; readonly add: number }
  | { readonly k: 'boost_cap_add_h'; readonly add: number }
  | { readonly k: 'boost_mult_add'; readonly add: number }
  | { readonly k: 'notice_interval_sub'; readonly sub: number }
  | { readonly k: 'fever_ms_add'; readonly add: number }
  | { readonly k: 'fever_mult_add'; readonly add: number }
  | { readonly k: 'rush_cap_add_s'; readonly add: number }
  | { readonly k: 'notice_bonus_weight_add'; readonly add: number }
  | { readonly k: 'notice_auto'; readonly ms: number }
  | { readonly k: 'grant_hold_1_in'; readonly value: number }
  | { readonly k: 'awaken_medal_base'; readonly value: number }
  | { readonly k: 'prod_min_add'; readonly add: number }
  | { readonly k: 'points_add'; readonly add: number }
  | { readonly k: 'bantou' }
  | { readonly k: 'unlock'; readonly key: string }
  /** 休業中に選べる台を増やす（spec/25・spec/22 の pickMachine）。生産・閉店・EV には触れない。 */
  | { readonly k: 'unlock_machine'; readonly machine: string };

/** ノード1件（name・desc は画面用で Core は計算に使わない）。 */
export interface TreeNodeSpec {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly tier: number;
  readonly cost: number;
  readonly req: readonly string[];
  readonly effect: readonly TreeEffect[];
}

/** 常連ツリー（検証済み）。nodes の順が集計順・req の参照順。 */
export interface TreeSpec {
  readonly pointsPerRank: number;
  readonly runBonusAt: readonly number[];
  /** 段1〜5 を開くのに要る「下の段で買った数」（長さ5・非減少）。 */
  readonly tierUnlock: readonly number[];
  readonly bantou: { readonly share: number; readonly maxPerRun: number };
  readonly nodes: readonly TreeNodeSpec[];
}

/** 段の数。 */
export const TREE_TIERS = 5;

/** `tree` が無い JSON の空のツリー（常連P は貯まるが使えない。数値は spec/25 の初期値）。 */
export const EMPTY_TREE: TreeSpec = {
  pointsPerRank: 10,
  runBonusAt: [1e11, 1e12, 1e13, 1e14, 1e15, 1e16],
  tierUnlock: [0, 4, 12, 24, 36],
  bantou: { share: 0.5, maxPerRun: 100 },
  nodes: [],
};

/** 検証に要る経済定義の値。 */
export interface TreeParseContext {
  readonly awakenMedalBase: number;
  readonly factorsClosed: number;
}

/** 合計の上限の比較の許容誤差（0.1 + 0.2 のような小数の和）。 */
const EPS = 1e-9;
/** starter の要素数（役物の数）。 */
const STARTER_LEN = 8;
/** starter_rel の割合の上限（前の周回の最高 Lv の半分まで）。 */
const STARTER_REL_MAX = 0.5;
/** open_boost の Σms の上限（8時間）。 */
const OPEN_BOOST_MAX_MS = 8 * 3600000;

function isKeepTarget(value: string): value is TreeKeepTarget {
  for (let i = 0; i < TREE_KEEP_TARGETS.length; i = i + 1) {
    if (TREE_KEEP_TARGETS[i] === value) {
      return true;
    }
  }
  return false;
}

function asAdd(value: unknown, what: string): number {
  return asPositive(value, what);
}

function parseEffect(value: unknown, what: string, ctx: TreeParseContext): TreeEffect {
  const r = asRecord(value, what);
  const k = asString(r['k'], what + '.k');
  switch (k) {
    case 'prod_add':
    case 'regular_add':
    case 'ach_per_add':
    case 'closed_add':
    case 'tank_add_h':
    case 'boost_cap_add_h':
    case 'boost_mult_add':
    case 'prod_min_add':
    case 'resonance_add':
      return { k, add: asAdd(r['add'], what + '.add') };
    case 'starter_rel': {
      const ratio = asPositive(r['ratio'], what + '.ratio');
      if (ratio > STARTER_REL_MAX) {
        fail(what + '.ratio out of range');
      }
      return { k, ratio };
    }
    case 'streak_max_add':
    case 'fever_ms_add':
    case 'fever_mult_add':
    case 'rush_cap_add_s':
    case 'notice_bonus_weight_add':
    case 'points_add':
      return { k, add: asIntRange(r['add'], what + '.add', 1, 1000000) };
    case 'prod_add_machine':
      return { k, machine: asString(r['machine'], what + '.machine'), add: asAdd(r['add'], what + '.add') };
    case 'price_sub':
    case 'notice_interval_sub':
      return { k, sub: asAdd(r['sub'], what + '.sub') };
    case 'keep': {
      const raw = asArray(r['targets'], what + '.targets');
      if (raw.length === 0) {
        fail(what + '.targets must not be empty');
      }
      const targets: TreeKeepTarget[] = [];
      for (let i = 0; i < raw.length; i = i + 1) {
        const t = asString(raw[i], what + '.targets[' + i + ']');
        if (!isKeepTarget(t)) {
          fail(what + '.targets[' + i + '] unknown');
        }
        targets.push(t);
      }
      return { k, targets };
    }
    case 'starter': {
      const raw = asArray(r['lv'], what + '.lv');
      if (raw.length !== STARTER_LEN) {
        fail(what + '.lv must have 8 entries');
      }
      const lv: number[] = [];
      for (let i = 0; i < raw.length; i = i + 1) {
        const n = asIntRange(raw[i], what + '.lv[' + i + ']', 0, 100);
        if (i > 0 && n > 0 && (lv[i - 1] ?? 0) === 0) {
          fail(what + '.lv[' + i + '] needs the previous yakumono');
        }
        lv.push(n);
      }
      return { k, lv };
    }
    case 'open_boost': {
      const ms = asIntRange(r['ms'], what + '.ms', 1, OPEN_BOOST_MAX_MS);
      const mult = asNumber(r['mult'], what + '.mult');
      if (mult <= 1) {
        fail(what + '.mult must be > 1');
      }
      return { k, ms, mult };
    }
    case 'notice_auto':
      return { k, ms: asIntRange(r['ms'], what + '.ms', 0, 60000) };
    case 'grant_hold_1_in':
      return { k, value: asIntRange(r['value'], what + '.value', 5, 10) };
    case 'awaken_medal_base': {
      const v = asPositive(r['value'], what + '.value');
      if (v >= ctx.awakenMedalBase) {
        fail(what + '.value must be < awaken.medal_base');
      }
      return { k, value: v };
    }
    case 'bantou':
      return { k };
    case 'unlock':
      return { k, key: asString(r['key'], what + '.key') };
    case 'unlock_machine':
      return { k, machine: asString(r['machine'], what + '.machine') };
    default:
      return fail(what + '.k unknown');
  }
}

/** 加算型の合計の上限（spec/25 の表）を検証する。集計は nodes の添字順。 */
function checkTotals(nodes: readonly TreeNodeSpec[], ctx: TreeParseContext): void {
  const sum: Record<string, number> = {};
  const count: Record<string, number> = {};
  const machineSum: Record<string, number> = {};
  const keepSeen: Record<string, boolean> = {};
  const unlockSeen: Record<string, boolean> = {};
  const machineSeen: Record<string, boolean> = {};
  let openBoostMs = 0;
  let openBoostMult = 1;
  for (let i = 0; i < nodes.length; i = i + 1) {
    const node = nodes[i] as TreeNodeSpec;
    for (let j = 0; j < node.effect.length; j = j + 1) {
      const e = node.effect[j] as TreeEffect;
      const what = 'tree.nodes[' + i + '].effect[' + j + ']';
      count[e.k] = (count[e.k] ?? 0) + 1;
      if (e.k === 'keep') {
        for (let t = 0; t < e.targets.length; t = t + 1) {
          const target = e.targets[t] as TreeKeepTarget;
          if (keepSeen[target] === true) {
            fail(what + '.targets duplicated: ' + target);
          }
          keepSeen[target] = true;
        }
      } else if (e.k === 'unlock') {
        if (unlockSeen[e.key] === true) {
          fail(what + '.key duplicated: ' + e.key);
        }
        unlockSeen[e.key] = true;
      } else if (e.k === 'unlock_machine') {
        if (machineSeen[e.machine] === true) {
          fail(what + '.machine duplicated: ' + e.machine);
        }
        machineSeen[e.machine] = true;
      } else if (e.k === 'prod_add_machine') {
        machineSum[e.machine] = (machineSum[e.machine] ?? 0) + e.add;
        if ((machineSum[e.machine] ?? 0) > 0.3 + EPS) {
          fail('tree prod_add_machine total over 0.3: ' + e.machine);
        }
      } else if (e.k === 'open_boost') {
        openBoostMs = openBoostMs + e.ms;
        openBoostMult = openBoostMult + (e.mult - 1);
      } else if ('add' in e) {
        sum[e.k] = (sum[e.k] ?? 0) + e.add;
      } else if ('sub' in e) {
        sum[e.k] = (sum[e.k] ?? 0) + e.sub;
      }
    }
  }
  const caps: readonly (readonly [string, number])[] = [
    ['prod_add', 1.0],
    ['regular_add', 0.2],
    ['ach_per_add', 0.006],
    ['streak_max_add', 10],
    ['price_sub', 0.1],
    ['closed_add', 0.05 - ctx.factorsClosed],
    ['tank_add_h', 24],
    ['boost_cap_add_h', 24],
    ['boost_mult_add', 1],
    ['notice_interval_sub', 0.3],
    ['fever_ms_add', 30000],
    ['fever_mult_add', 2],
    ['rush_cap_add_s', 600],
    ['notice_bonus_weight_add', 10],
    ['prod_min_add', 0.5],
    ['points_add', 5],
    ['resonance_add', 0.25],
  ];
  for (let i = 0; i < caps.length; i = i + 1) {
    const [k, cap] = caps[i] as readonly [string, number];
    if ((sum[k] ?? 0) > cap + EPS) {
      fail('tree ' + k + ' total over ' + cap);
    }
  }
  if (openBoostMs > OPEN_BOOST_MAX_MS) {
    fail('tree open_boost total ms over 8h');
  }
  if (openBoostMult > 3 + EPS) {
    fail('tree open_boost total mult over 3');
  }
  const single = ['notice_auto', 'grant_hold_1_in', 'awaken_medal_base', 'bantou'];
  for (let i = 0; i < single.length; i = i + 1) {
    const k = single[i] as string;
    if ((count[k] ?? 0) > 1) {
      fail('tree ' + k + ' must be at most 1');
    }
  }
}

function parseNode(value: unknown, index: number, prev: readonly TreeNodeSpec[], ctx: TreeParseContext): TreeNodeSpec {
  const what = 'tree.nodes[' + index + ']';
  const r = asRecord(value, what);
  const id = asString(r['id'], what + '.id');
  for (let i = 0; i < prev.length; i = i + 1) {
    if ((prev[i] as TreeNodeSpec).id === id) {
      fail(what + '.id duplicated');
    }
  }
  const name = asString(r['name'], what + '.name');
  const desc = asString(r['desc'], what + '.desc');
  const tier = asIntRange(r['tier'], what + '.tier', 1, TREE_TIERS);
  const cost = asInt(r['cost'], what + '.cost');
  if (cost < 1) {
    fail(what + '.cost must be >= 1');
  }
  const reqRaw = asArray(r['req'], what + '.req');
  const req: string[] = [];
  for (let i = 0; i < reqRaw.length; i = i + 1) {
    const rid = asString(reqRaw[i], what + '.req[' + i + ']');
    // 自分より前の添字だけを探す（自分・以降・未知はここで見つからない＝閉路が作れない）
    let found: TreeNodeSpec | undefined;
    for (let p = 0; p < prev.length; p = p + 1) {
      if ((prev[p] as TreeNodeSpec).id === rid) {
        found = prev[p];
      }
    }
    if (found === undefined) {
      fail(what + '.req[' + i + '] must be an earlier node: ' + rid);
    }
    if (found.tier > tier) {
      fail(what + '.req[' + i + '] is in a higher tier: ' + rid);
    }
    req.push(rid);
  }
  const effRaw = asArray(r['effect'], what + '.effect');
  if (effRaw.length === 0) {
    fail(what + '.effect must not be empty');
  }
  const effect: TreeEffect[] = [];
  for (let i = 0; i < effRaw.length; i = i + 1) {
    effect.push(parseEffect(effRaw[i], what + '.effect[' + i + ']', ctx));
  }
  return { id, name, desc, tier, cost, req, effect };
}

/** `tree` 節を検証して `TreeSpec` にする（undefined なら空のツリー）。 */
export function parseTree(value: unknown, ctx: TreeParseContext): TreeSpec {
  if (value === undefined) {
    return EMPTY_TREE;
  }
  const o = asRecord(value, 'tree');
  const pointsPerRank = asIntRange(o['points_per_rank'], 'tree.points_per_rank', 1, 1000);
  const runBonusRaw = asArray(o['run_bonus_at'], 'tree.run_bonus_at');
  const runBonusAt: number[] = [];
  for (let i = 0; i < runBonusRaw.length; i = i + 1) {
    runBonusAt.push(asNumber(runBonusRaw[i], 'tree.run_bonus_at[' + i + ']'));
  }
  checkAscending(runBonusAt, 'tree.run_bonus_at', 1, Number.MAX_VALUE);
  const tuRaw = asArray(o['tier_unlock'], 'tree.tier_unlock');
  if (tuRaw.length !== TREE_TIERS) {
    fail('tree.tier_unlock must have 5 entries');
  }
  const tierUnlock: number[] = [];
  for (let i = 0; i < tuRaw.length; i = i + 1) {
    const n = asIntRange(tuRaw[i], 'tree.tier_unlock[' + i + ']', 0, 1000);
    if (i > 0 && n < (tierUnlock[i - 1] ?? 0)) {
      fail('tree.tier_unlock must be non-decreasing');
    }
    tierUnlock.push(n);
  }
  const bo = asRecord(o['bantou'], 'tree.bantou');
  const share = asPositive(bo['share'], 'tree.bantou.share');
  if (share > 1) {
    fail('tree.bantou.share out of range');
  }
  const maxPerRun = asIntRange(bo['max_per_run'], 'tree.bantou.max_per_run', 1, 10000);
  const nodesRaw = asArray(o['nodes'], 'tree.nodes');
  const nodes: TreeNodeSpec[] = [];
  for (let i = 0; i < nodesRaw.length; i = i + 1) {
    nodes.push(parseNode(nodesRaw[i], i, nodes, ctx));
  }
  // 段 n に属するノードがあるなら、下の段のノード数が tier_unlock[n] に届くこと（開かない段を作らない）
  let below = 0;
  for (let t = 1; t <= TREE_TIERS; t = t + 1) {
    let inTier = 0;
    for (let i = 0; i < nodes.length; i = i + 1) {
      if ((nodes[i] as TreeNodeSpec).tier === t) {
        inTier = inTier + 1;
      }
    }
    if (inTier > 0 && below < (tierUnlock[t - 1] ?? 0)) {
      fail('tree tier ' + t + ' can never open');
    }
    below = below + inTier;
  }
  checkTotals(nodes, ctx);
  return { pointsPerRank, runBonusAt, tierUnlock, bantou: { share, maxPerRun }, nodes };
}

/** `prod_add_machine`・`unlock_machine` の machine のうち、機種一覧に無いもの（警告用。開ける前の店も買えるのでエラーにしない）。 */
export function treeUnknownMachines(tree: TreeSpec, machineIds: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < tree.nodes.length; i = i + 1) {
    const effect = (tree.nodes[i] as TreeNodeSpec).effect;
    for (let j = 0; j < effect.length; j = j + 1) {
      const e = effect[j] as TreeEffect;
      if ((e.k === 'prod_add_machine' || e.k === 'unlock_machine') && machineIds.indexOf(e.machine) < 0 && out.indexOf(e.machine) < 0) {
        out.push(e.machine);
      }
    }
  }
  return out;
}
