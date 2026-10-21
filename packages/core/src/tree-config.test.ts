import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseEconomy } from './economy-config.ts';
import { EMPTY_TREE, parseTree, treeUnknownMachines, type TreeNodeSpec } from './tree-config.ts';

const CTX = { awakenMedalBase: 20, factorsClosed: 0.005 };

function defaultJson(): Record<string, unknown> {
  return JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Record<string, unknown>;
}

function defaultTree(): Record<string, unknown> {
  return defaultJson()['tree'] as Record<string, unknown>;
}

type RawNode = Record<string, unknown>;

function nodesOf(tree: Record<string, unknown>): RawNode[] {
  return tree['nodes'] as RawNode[];
}

function node(id: string, tier: number, cost: number, req: string[], effect: unknown[]): RawNode {
  return { id, name: id, desc: id, tier, cost, req, effect };
}

/** 段1だけの最小のツリー（ここに1件足して1つのエラー条件を試す）。 */
function smallTree(extra: RawNode[]): Record<string, unknown> {
  return {
    points_per_rank: 10,
    run_bonus_at: [1e11, 1e12],
    tier_unlock: [0, 0, 0, 0, 0],
    bantou: { share: 0.5, max_per_run: 100 },
    nodes: [node('a', 1, 3, [], [{ k: 'prod_add', add: 0.1 }]), ...extra],
  };
}

test('既定 JSON のツリーが通る（55 個・5 段・総 1,174 P・spec/25 の段ごとの数と合計）', () => {
  const tree = parseEconomy(defaultJson()).tree;
  expect(tree.pointsPerRank).toBe(10);
  expect(tree.runBonusAt).toEqual([1e11, 1e12, 1e13, 1e14, 1e15, 1e16]);
  expect(tree.tierUnlock).toEqual([0, 4, 12, 24, 36]);
  expect(tree.bantou).toEqual({ share: 0.5, maxPerRun: 100 });
  expect(tree.nodes.length).toBe(55);
  const count = [0, 0, 0, 0, 0];
  const cost = [0, 0, 0, 0, 0];
  for (const n of tree.nodes) {
    count[n.tier - 1] = (count[n.tier - 1] ?? 0) + 1;
    cost[n.tier - 1] = (cost[n.tier - 1] ?? 0) + n.cost;
  }
  expect(count).toEqual([9, 15, 15, 12, 4]);
  expect(cost).toEqual([44, 187, 273, 320, 350]);
  const kanban = tree.nodes[0] as TreeNodeSpec;
  expect(kanban).toEqual({
    id: 'kanban',
    name: '常連の看板',
    desc: '生産 +10%',
    tier: 1,
    cost: 3,
    req: [],
    effect: [{ k: 'prod_add', add: 0.1 }],
  });
  const dendou = tree.nodes[54] as TreeNodeSpec;
  expect(dendou.id).toBe('dendou');
  expect(dendou.effect).toEqual([
    { k: 'unlock', key: 'dendou' },
    { k: 'ach_per_add', add: 0.002 },
  ]);
  expect(treeUnknownMachines(tree, ['light-middle-01', 'rush-middle-01', 'lt-middle-01'])).toEqual([]);
  expect(treeUnknownMachines(tree, ['light-middle-01'])).toEqual(['rush-middle-01', 'lt-middle-01']);
});

test('tree が無い JSON は空のツリー', () => {
  const json = defaultJson();
  delete json['tree'];
  const tree = parseEconomy(json).tree;
  expect(tree).toBe(EMPTY_TREE);
  expect(tree.nodes).toEqual([]);
  expect(tree.pointsPerRank).toBe(10);
});

test('最小のツリーは通る（各エラー条件の基準）', () => {
  expect(parseTree(smallTree([]), CTX).nodes.length).toBe(1);
});

test('各エラー条件が1つずつ弾かれる', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['id 重複', smallTree([node('a', 1, 3, [], [{ k: 'prod_add', add: 0.1 }])])],
    ['req が未知', smallTree([node('b', 1, 3, ['zzz'], [{ k: 'prod_add', add: 0.1 }])])],
    ['req が自分', smallTree([node('b', 1, 3, ['b'], [{ k: 'prod_add', add: 0.1 }])])],
    [
      'req が自分以降の添字',
      smallTree([
        node('b', 1, 3, ['c'], [{ k: 'prod_add', add: 0.1 }]),
        node('c', 1, 3, [], [{ k: 'prod_add', add: 0.1 }]),
      ]),
    ],
    [
      'req が自分より上の段',
      smallTree([
        node('b', 2, 3, [], [{ k: 'prod_add', add: 0.1 }]),
        node('c', 1, 3, ['b'], [{ k: 'prod_add', add: 0.1 }]),
      ]),
    ],
    ['tier が 0', smallTree([node('b', 0, 3, [], [{ k: 'prod_add', add: 0.1 }])])],
    ['tier が 6', smallTree([node('b', 6, 3, [], [{ k: 'prod_add', add: 0.1 }])])],
    ['cost が 1 未満', smallTree([node('b', 1, 0, [], [{ k: 'prod_add', add: 0.1 }])])],
    ['cost が非整数', smallTree([node('b', 1, 2.5, [], [{ k: 'prod_add', add: 0.1 }])])],
    ['未知の k', smallTree([node('b', 1, 3, [], [{ k: 'cheat', add: 1 }])])],
    ['keep の未知の target', smallTree([node('b', 1, 3, [], [{ k: 'keep', targets: ['medal'] }])])],
    [
      'keep の targets 重複',
      smallTree([
        node('b', 1, 3, [], [{ k: 'keep', targets: ['tank'] }]),
        node('c', 1, 3, [], [{ k: 'keep', targets: ['idle', 'tank'] }]),
      ]),
    ],
    [
      'unlock の key 重複',
      smallTree([
        node('b', 1, 3, [], [{ k: 'unlock', key: 'gold' }]),
        node('c', 1, 3, [], [{ k: 'unlock', key: 'gold' }]),
      ]),
    ],
    [
      '1 個までの k が2つ（bantou）',
      smallTree([node('b', 1, 3, [], [{ k: 'bantou' }]), node('c', 1, 3, [], [{ k: 'bantou' }])]),
    ],
    [
      '1 個までの k が2つ（notice_auto）',
      smallTree([node('b', 1, 3, [], [{ k: 'notice_auto', ms: 3000 }, { k: 'notice_auto', ms: 3000 }])]),
    ],
    ['grant_hold_1_in が範囲外', smallTree([node('b', 1, 3, [], [{ k: 'grant_hold_1_in', value: 4 }])])],
    [
      'awaken_medal_base が既存以上',
      smallTree([node('b', 1, 3, [], [{ k: 'awaken_medal_base', value: 20 }])]),
    ],
    [
      'starter の前の役物が 0',
      smallTree([node('b', 1, 3, [], [{ k: 'starter', lv: [25, 0, 10, 0, 0, 0, 0, 0] }])]),
    ],
    ['starter の長さ違い', smallTree([node('b', 1, 3, [], [{ k: 'starter', lv: [25, 10] }])])],
    ['starter が 100 超', smallTree([node('b', 1, 3, [], [{ k: 'starter', lv: [101, 0, 0, 0, 0, 0, 0, 0] }])])],
    ['effect が空', smallTree([node('b', 1, 3, [], [])])],
    ['tier_unlock の長さ違い', { ...smallTree([]), tier_unlock: [0, 4, 12, 24] }],
    ['tier_unlock が減る', { ...smallTree([]), tier_unlock: [0, 4, 3, 24, 36] }],
    [
      '開かない段',
      { ...smallTree([node('b', 2, 3, [], [{ k: 'prod_add', add: 0.1 }])]), tier_unlock: [0, 4, 4, 4, 4] },
    ],
  ];
  for (const [label, tree] of cases) {
    expect(() => parseTree(tree, CTX), label).toThrow(/invalid economy/);
  }
});

test('合計の上限を超えると弾かれる（ちょうど上限は通る）', () => {
  const over: [string, unknown[]][] = [
    ['prod_add', [{ k: 'prod_add', add: 0.9 }, { k: 'prod_add', add: 0.11 }]],
    ['prod_add_machine', [
      { k: 'prod_add_machine', machine: 'm', add: 0.2 },
      { k: 'prod_add_machine', machine: 'm', add: 0.11 },
    ]],
    ['regular_add', [{ k: 'regular_add', add: 0.21 }]],
    ['ach_per_add', [{ k: 'ach_per_add', add: 0.0061 }]],
    ['streak_max_add', [{ k: 'streak_max_add', add: 11 }]],
    ['price_sub', [{ k: 'price_sub', sub: 0.11 }]],
    ['closed_add', [{ k: 'closed_add', add: 0.046 }]],
    ['tank_add_h', [{ k: 'tank_add_h', add: 25 }]],
    ['boost_cap_add_h', [{ k: 'boost_cap_add_h', add: 25 }]],
    ['boost_mult_add', [{ k: 'boost_mult_add', add: 1.1 }]],
    ['notice_interval_sub', [{ k: 'notice_interval_sub', sub: 0.31 }]],
    ['fever_ms_add', [{ k: 'fever_ms_add', add: 30001 }]],
    ['fever_mult_add', [{ k: 'fever_mult_add', add: 3 }]],
    ['rush_cap_add_s', [{ k: 'rush_cap_add_s', add: 601 }]],
    ['notice_bonus_weight_add', [{ k: 'notice_bonus_weight_add', add: 11 }]],
    ['prod_min_add', [{ k: 'prod_min_add', add: 0.51 }]],
    ['points_add', [{ k: 'points_add', add: 6 }]],
    ['open_boost ms', [{ k: 'open_boost', ms: 18000000, mult: 1.1 }, { k: 'open_boost', ms: 18000000, mult: 1.1 }]],
    ['open_boost mult', [{ k: 'open_boost', ms: 1000, mult: 2.5 }, { k: 'open_boost', ms: 1000, mult: 1.6 }]],
  ];
  for (const [label, effect] of over) {
    // 'a' の prod_add 0.1 と重ならないよう、prod_add の時は a を外す
    const tree = smallTree([node('b', 1, 3, [], effect)]);
    if (label === 'prod_add') {
      tree['nodes'] = [node('b', 1, 3, [], effect)];
    }
    expect(() => parseTree(tree, CTX), label).toThrow(/total/);
  }
  const atCap = smallTree([
    node('b', 1, 3, [], [{ k: 'prod_add', add: 0.9 }]),
    node('c', 1, 3, [], [{ k: 'closed_add', add: 0.045 }, { k: 'ach_per_add', add: 0.006 }]),
    node('d', 1, 3, [], [{ k: 'open_boost', ms: 28800000, mult: 3 }]),
  ]);
  expect(parseTree(atCap, CTX).nodes.length).toBe(4);
});

test('既定 JSON の1ノードを壊すと parseEconomy が弾く（densetsu の生産 +30% → +31% で prod_add の上限超え）', () => {
  const json = defaultJson();
  const tree = defaultTree();
  const densetsu = nodesOf(tree).find((n) => n['id'] === 'densetsu') as RawNode;
  densetsu['effect'] = [{ k: 'prod_add', add: 0.31 }];
  json['tree'] = tree;
  expect(() => parseEconomy(json)).toThrow(/prod_add total/);
});
