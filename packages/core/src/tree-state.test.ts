import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';

type Json = Record<string, unknown>;

function node(id: string, tier: number, cost: number, req: string[], effect: unknown[]): Json {
  return { id, name: id, desc: id, tier, cost, req, effect };
}

/** 小さなツリー（段1: a〜d・lk（a が前提）・big（高い）・kuchi（口コミ +1）、段2: m）。run_bonus_at は 3000・10000。 */
function smallTree(): Json {
  return {
    points_per_rank: 10,
    run_bonus_at: [3000, 10000],
    tier_unlock: [0, 4, 12, 24, 36],
    bantou: { share: 0.5, max_per_run: 100 },
    nodes: [
      node('a', 1, 1, [], [{ k: 'unlock', key: 'ua' }]),
      node('b', 1, 1, [], [{ k: 'unlock', key: 'ub' }]),
      node('c', 1, 1, [], [{ k: 'unlock', key: 'uc' }]),
      node('d', 1, 1, [], [{ k: 'unlock', key: 'ud' }]),
      node('lk', 1, 1, ['a'], [{ k: 'unlock', key: 'ulk' }]),
      node('big', 1, 1000, [], [{ k: 'unlock', key: 'ubig' }]),
      node('kuchi', 1, 1, [], [{ k: 'points_add', add: 1 }]),
      node('m', 2, 2, [], [{ k: 'unlock', key: 'um' }]),
    ],
  };
}

/** tree: 'small'＝上の小さなツリー、'default'＝既定 JSON のまま、'none'＝tree なし。閉店は required 1000・divisor 1000・7 枚で 1P。 */
function make(tree: 'small' | 'default' | 'none'): IdleEconomy {
  const json = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Json;
  const close = json['close'] as Json;
  close['required_run_total'] = 1000;
  close['divisor'] = 1000;
  close['medals_per_point'] = 7;
  if (tree === 'small') {
    json['tree'] = smallTree();
  } else if (tree === 'none') {
    delete json['tree'];
  }
  return new IdleEconomy(parseEconomy(json));
}

/** 玉 balls・メダル medals を足して閉店する。 */
function closeWith(econ: IdleEconomy, balls: number, medals: number): { gain: number; points: number } {
  econ.noteGain(balls);
  econ.onGrant(0, medals, undefined, 0, 0);
  const r = econ.onClose(0);
  if (!r.ok) {
    throw new Error('close failed: ' + r.reason);
  }
  econ.onOpen();
  return { gain: r.gain, points: r.points };
}

/** points を直接持たせる（v7 の複写を書き換えて restore。tree が空の時だけ使う）。 */
function givePoints(econ: IdleEconomy, points: number): void {
  const s = econ.snapshot() as unknown as Json;
  econ.restore({ ...s, points, pointsEarned: points });
}

test('常連P: gain × 10 + runBonus（run_bonus_at ちょうど・直前）', () => {
  // 玉由来は floor(cbrt(total / 1000))。玉 2999 → 1・メダル 7 → 行動由来 1 → gain 1、runTotal 2999 < 3000 → runBonus 0
  const before = make('small');
  const r0 = closeWith(before, 2999, 7);
  expect(r0.gain).toBe(1);
  expect(r0.points).toBe(10);
  expect(before.getPoints()).toBe(10);
  // 玉 3000 ちょうど → runBonus 1
  const at = make('small');
  const r1 = closeWith(at, 3000, 7);
  expect(r1.gain).toBe(1);
  expect(r1.points).toBe(11);
  // 玉 10000 → 玉由来 2・メダル 14 → gain 2、runBonus 2
  const two = make('small');
  const r2 = closeWith(two, 10000, 14);
  expect(r2.gain).toBe(2);
  expect(r2.points).toBe(22);
  expect(two.getTreeView().pointsEarned).toBe(22);
});

test('常連P: gain 0 なら runTotal が大きくても 0', () => {
  const econ = make('small');
  const r = closeWith(econ, 1000000, 0);
  expect(r.gain).toBe(0);
  expect(r.points).toBe(0);
  expect(econ.getPoints()).toBe(0);
  expect(econ.getTreeView().pointsEarned).toBe(0);
});

test('常連P: points_add の所持で閉店ごとに加算（見込みも一致）', () => {
  const econ = make('small');
  givePoints(econ, 1);
  expect(econ.buyTreeNode('kuchi', 5)).toEqual({ ok: true });
  expect(econ.getPoints()).toBe(0);
  econ.noteGain(2999);
  econ.onGrant(0, 7, undefined, 0, 0);
  expect(econ.getTreeView().nextClosePoints).toBe(11);
  expect(econ.getShopView().close.points).toBe(11);
  const r = econ.onClose(0);
  expect(r.ok && r.points).toBe(11);
  expect(econ.getPoints()).toBe(11);
  expect(econ.getTreeView().pointsEarned).toBe(12);
});

test('ランク（regular）と closeGain はツリーの有無・購入で変わらない', () => {
  const none = make('none');
  const dflt = make('default');
  const bought = make('small');
  givePoints(bought, 3);
  expect(bought.buyTreeNode('kuchi', 1).ok).toBe(true);
  expect(bought.buyTreeNode('a', 1).ok).toBe(true);
  const seq: [number, number][] = [
    [3000, 7],
    [20000, 14],
    [30000, 0],
    [400000, 140],
  ];
  for (let i = 0; i < seq.length; i = i + 1) {
    const [balls, medals] = seq[i] as [number, number];
    const g0 = closeWith(none, balls, medals).gain;
    const g1 = closeWith(dflt, balls, medals).gain;
    const g2 = closeWith(bought, balls, medals).gain;
    expect(g1).toBe(g0);
    expect(g2).toBe(g0);
    expect(dflt.getRegular()).toBe(none.getRegular());
    expect(bought.getRegular()).toBe(none.getRegular());
  }
  expect(none.getRegular()).toBeGreaterThan(0);
});

test('購入の拒否5種と成功（points が cost 減り pointsEarned 不変）', () => {
  const econ = make('small');
  givePoints(econ, 3);
  expect(econ.buyTreeNode('nothing', 0)).toEqual({ ok: false, reason: 'unknown-node' });
  expect(econ.buyTreeNode('lk', 0)).toEqual({ ok: false, reason: 'locked' });
  expect(econ.buyTreeNode('m', 0)).toEqual({ ok: false, reason: 'tier-locked' });
  expect(econ.buyTreeNode('big', 0)).toEqual({ ok: false, reason: 'insufficient-points' });
  expect(econ.getPoints()).toBe(3);
  expect(econ.buyTreeNode('a', 10)).toEqual({ ok: true });
  expect(econ.getPoints()).toBe(2);
  expect(econ.getTreeView().pointsEarned).toBe(3);
  expect(econ.buyTreeNode('a', 11)).toEqual({ ok: false, reason: 'owned' });
  expect(econ.getPoints()).toBe(2);
  // a を買ったので lk の前提は満たされる
  expect(econ.buyTreeNode('lk', 12)).toEqual({ ok: true });
  expect(econ.snapshot().tree).toEqual([
    { id: 'a', cost: 1, at: 10 },
    { id: 'lk', cost: 1, at: 12 },
  ]);
  const view = econ.getTreeView();
  const states: Record<string, string> = {};
  for (let i = 0; i < view.nodes.length; i = i + 1) {
    states[view.nodes[i]!.id] = view.nodes[i]!.state;
  }
  expect(states['a']).toBe('owned');
  expect(states['b']).toBe('buyable');
  expect(states['big']).toBe('short');
  expect(states['m']).toBe('locked');
});

test('段が開く境目（tier_unlock[1]=4: 段1を3つでは段2が閉じ、4つ目で開く）', () => {
  const econ = make('small');
  givePoints(econ, 20);
  expect(econ.getTreeView().tierOpen).toEqual([true, false, false, false, false]);
  const ids = ['a', 'b', 'c'];
  for (let i = 0; i < ids.length; i = i + 1) {
    expect(econ.buyTreeNode(ids[i] as string, i).ok).toBe(true);
  }
  expect(econ.getTreeView().tierOpen[1]).toBe(false);
  expect(econ.buyTreeNode('m', 9)).toEqual({ ok: false, reason: 'tier-locked' });
  expect(econ.buyTreeNode('d', 3).ok).toBe(true);
  expect(econ.getTreeView().tierOpen[1]).toBe(true);
  expect(econ.buyTreeNode('m', 10)).toEqual({ ok: true });
  expect(econ.getPoints()).toBe(20 - 4 - 2);
});

test('v6 から復元: points = pointsEarned = 10 × regular・tree 空・openBoostMs 0・bantouOn false', () => {
  const src = make('small');
  closeWith(src, 3000, 7);
  closeWith(src, 30000, 21);
  const regular = src.getRegular();
  expect(regular).toBeGreaterThan(0);
  const v6: Json = { ...(src.snapshot() as unknown as Json), v: 6 };
  for (const k of ['points', 'pointsEarned', 'tree', 'openBoostMs', 'bantouOn']) {
    delete v6[k];
  }
  const back = make('small');
  back.restore(v6);
  const s = back.snapshot();
  expect(s.v).toBe(9);
  expect(s.points).toBe(10 * regular);
  expect(s.pointsEarned).toBe(10 * regular);
  expect(s.tree).toEqual([]);
  expect(s.openBoostMs).toBe(0);
  expect(s.bantouOn).toBe(false);
});

test('snapshot → restore が購入込みで一致', () => {
  const econ = make('small');
  closeWith(econ, 10000, 14);
  expect(econ.buyTreeNode('a', 100).ok).toBe(true);
  expect(econ.buyTreeNode('kuchi', 200).ok).toBe(true);
  const snap = econ.snapshot();
  const back = make('small');
  back.restore(JSON.parse(JSON.stringify(snap)));
  expect(back.snapshot()).toEqual(snap);
  expect(back.getTreeView()).toEqual(econ.getTreeView());
  expect(back.getTreeTotals()).toEqual(econ.getTreeTotals());
  const forked = econ.fork();
  expect(forked.snapshot()).toEqual(snap);
});

test('消えた id は購入記録から除いて cost を返す（pointsEarned 不変・二重返金なし）', () => {
  const econ = make('small');
  givePoints(econ, 5);
  expect(econ.buyTreeNode('a', 1).ok).toBe(true);
  const s = econ.snapshot() as unknown as Json;
  // points 4・a(1) 購入済み・消えた id 'gone'(cost 3) → pointsEarned = 4 + 1 + 3 = 8
  const withGone: Json = {
    ...s,
    pointsEarned: 8,
    tree: [
      { id: 'a', cost: 1, at: 1 },
      { id: 'gone', cost: 3, at: 2 },
    ],
  };
  const back = make('small');
  back.restore(withGone);
  expect(back.getPoints()).toBe(7);
  expect(back.snapshot().pointsEarned).toBe(8);
  expect(back.snapshot().tree).toEqual([{ id: 'a', cost: 1, at: 1 }]);
  const again = make('small');
  again.restore(JSON.parse(JSON.stringify(back.snapshot())));
  expect(again.getPoints()).toBe(7);
  expect(again.snapshot().pointsEarned).toBe(8);
  expect(again.snapshot().tree).toEqual([{ id: 'a', cost: 1, at: 1 }]);
});

test('v7 の検証エラー', () => {
  const base = make('small').snapshot() as unknown as Json;
  const bad = (patch: Json): void => {
    expect(() => make('small').restore({ ...base, ...patch })).toThrow();
  };
  bad({ pointsEarned: 5 });
  bad({ points: -1, pointsEarned: -1 });
  bad({ points: 1.5, pointsEarned: 1.5 });
  bad({ bantouOn: 'yes' });
  bad({ points: 0, pointsEarned: 0, tree: [{ id: 'a', cost: 0, at: 0 }] });
  bad({
    points: 0,
    pointsEarned: 2,
    tree: [
      { id: 'a', cost: 1, at: 0 },
      { id: 'a', cost: 1, at: 1 },
    ],
  });
});
