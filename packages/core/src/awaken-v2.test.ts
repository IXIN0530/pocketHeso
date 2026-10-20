/** 覚醒 v2（reset_lv・共鳴）とツリーの新しい効果（awaken_low/awaken_all・starter_rel・resonance_add）。P13-T6。 */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';

type Json = Record<string, unknown>;

/** テスト用ノード（段1・コスト1。default.json のノードの後ろに足す）。 */
const TEST_NODES: Json[] = [
  { id: 't_keep_low', name: 't', desc: 't', tier: 1, cost: 1, req: [], effect: [{ k: 'keep', targets: ['awaken_low'] }] },
  { id: 't_keep_all', name: 't', desc: 't', tier: 1, cost: 1, req: [], effect: [{ k: 'keep', targets: ['awaken_all'] }] },
  { id: 't_rel10', name: 't', desc: 't', tier: 1, cost: 1, req: [], effect: [{ k: 'starter_rel', ratio: 0.1 }] },
  { id: 't_rel25', name: 't', desc: 't', tier: 1, cost: 1, req: [], effect: [{ k: 'starter_rel', ratio: 0.25 }] },
  { id: 't_res', name: 't', desc: 't', tier: 1, cost: 1, req: [], effect: [{ k: 'resonance_add', add: 0.05 }] },
];

function baseJson(awaken: Json = {}): Json {
  const json = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Json;
  const close = json['close'] as Json;
  close['required_run_total'] = 1000;
  close['divisor'] = 1000;
  close['medals_per_point'] = 7;
  json['awaken'] = { ...(json['awaken'] as Json), ...awaken };
  const tree = json['tree'] as Json;
  tree['nodes'] = [...(tree['nodes'] as Json[]), ...TEST_NODES];
  return json;
}

function make(awaken: Json = {}): IdleEconomy {
  return new IdleEconomy(parseEconomy(baseJson(awaken)));
}

function patch(econ: IdleEconomy, p: Json): void {
  econ.restore({ ...(econ.snapshot() as unknown as Json), ...p });
}

/** テスト用ノードを所持させる（点は余らせない）。 */
function own(econ: IdleEconomy, ids: string[]): void {
  const tree: Json[] = [];
  for (let i = 0; i < ids.length; i = i + 1) {
    tree.push({ id: ids[i], cost: 1, at: i });
  }
  patch(econ, { points: 0, pointsEarned: ids.length, tree });
}

function close(econ: IdleEconomy): void {
  econ.noteGain(1000);
  expect(econ.onClose(0).ok).toBe(true);
  expect(econ.onOpen().ok).toBe(true);
}

const LV100 = [100, 100, 100, 100, 0, 0, 0, 0];

test('既定（reset_lv true・resonance 0）: 覚醒で Lv は 0・その役物 ×10・共鳴なし', () => {
  const e = make();
  patch(e, { lv: LV100 });
  const r = e.onAwaken('windmill', 100);
  expect(r).toEqual({ ok: true, medals: 80 });
  expect(e.snapshot().lv).toEqual([0, 100, 100, 100, 0, 0, 0, 0]);
  expect(e.yakumonoMult(0)).toBe(10);
});

test('reset_lv false: Lv が残り、その役物だけ ×mult', () => {
  const e = make({ reset_lv: false });
  patch(e, { lv: LV100 });
  const before = e.getShopView().yakumono.map((y) => y.perSec);
  const total = e.basePerSec();
  expect(e.onAwaken('kaitentai', 20).ok).toBe(true);
  const s = e.snapshot();
  expect(s.lv).toEqual(LV100);
  expect(s.awakened).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
  const after = e.getShopView().yakumono.map((y) => y.perSec);
  expect(after[1]).toBeCloseTo((before[1] as number) * 10, 6);
  expect(after[0]).toBe(before[0]);
  expect(e.basePerSec()).toBeCloseTo(total + (before[1] as number) * 9, 6);
});

test('min_lv: 条件の Lv から覚醒できる（未満は not-ready）', () => {
  const e = make({ min_lv: 25, reset_lv: false });
  patch(e, { lv: [24, 25, 0, 0, 0, 0, 0, 0] });
  expect(e.onAwaken('windmill', 100)).toEqual({ ok: false, reason: 'not-ready' });
  expect(e.onAwaken('kaitentai', 100).ok).toBe(true);
});

test('共鳴: 全役物 ×(1 + resonance × 今の周回の覚醒の総数)・resonance_add が足される', () => {
  const plain = make({ reset_lv: false });
  patch(plain, { lv: LV100, awakened: [2, 1, 0, 0, 0, 0, 0, 0] });
  const e = make({ reset_lv: false, resonance: 0.2 });
  patch(e, { lv: LV100, awakened: [2, 1, 0, 0, 0, 0, 0, 0] });
  expect(e.basePerSec()).toBeCloseTo(plain.basePerSec() * (1 + 0.2 * 3), 6);
  // 役物ごとの表示も共鳴込みで、和が basePerSec
  const sum = e.getShopView().yakumono.reduce((a, y) => a + y.perSec, 0);
  expect(sum).toBeCloseTo(e.basePerSec(), 6);
  // resonance_add は購入の次の basePerSec から（キャッシュを捨てる）
  own(e, ['t_res']);
  expect(e.basePerSec()).toBeCloseTo(plain.basePerSec() * (1 + 0.25 * 3), 6);
  expect(e.getRefPerSec()).toBeCloseTo(e.basePerSec(), 6);
  // resonance 0 でも resonance_add だけで効く
  const add = make({ reset_lv: false });
  patch(add, { lv: LV100, awakened: [2, 1, 0, 0, 0, 0, 0, 0] });
  own(add, ['t_res']);
  expect(add.basePerSec()).toBeCloseTo(plain.basePerSec() * (1 + 0.05 * 3), 6);
});

test('awakenGain: 覚醒後 ÷ 今の基準生産（Lv 不足は null）。reset_lv で Lv を戻す分も入る', () => {
  for (const reset of [true, false]) {
    const e = make({ reset_lv: reset, resonance: 0.1 });
    patch(e, { lv: [100, 100, 50, 0, 0, 0, 0, 0] });
    const shop = e.getShopView().yakumono;
    expect(shop[2]!.awakenGain).toBeNull();
    expect(shop[3]!.awakenGain).toBeNull();
    const now = e.basePerSec();
    const gain = shop[1]!.awakenGain as number;
    expect(e.onAwaken('kaitentai', 100).ok).toBe(true);
    expect(gain).toBeCloseTo(e.basePerSec() / now, 9);
  }
  const zero = make();
  expect(zero.getShopView().yakumono[0]!.awakenGain).toBeNull();
});

test('awaken_low: 閉店後も風車〜クルーンの覚醒が残り、覚醒の値段にも数える。awaken_all は全役物', () => {
  const aw = [1, 2, 1, 3, 1, 0, 0, 0];
  const low = make();
  own(low, ['t_keep_low']);
  patch(low, { lv: [50, 50, 50, 50, 50, 0, 0, 0], awakened: aw, awakenTotal: 8 });
  close(low);
  expect(low.snapshot().awakened).toEqual([1, 2, 1, 0, 0, 0, 0, 0]);
  expect(low.snapshot().lv).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  expect(low.getAwakenTotal()).toBe(8);
  expect(low.getShopView().yakumono[1]!.awakenCost).toBe(20 * 4);
  expect(low.getShopView().yakumono[3]!.awakenCost).toBe(20);
  const all = make();
  own(all, ['t_keep_all']);
  patch(all, { awakened: aw, awakenTotal: 8 });
  close(all);
  expect(all.snapshot().awakened).toEqual(aw);
  const none = make();
  patch(none, { awakened: aw });
  close(none);
  expect(none.snapshot().awakened).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test('starter_rel: 前の周回の最高 Lv × 割合（切り捨て・最大の割合・starter と大きい方・前の役物 0 なら 0）', () => {
  // 覚醒で Lv を戻しても周回の最高 Lv は残る（reset_lv true）
  const e = make();
  own(e, ['t_rel10', 't_rel25']);
  patch(e, { lv: [0, 0, 0, 0, 0, 0, 0, 0] });
  expect(e.onBuy('windmill', 100, 1e30, 0).ok).toBe(true);
  expect(e.onBuy('windmill', 10, 1e30, 0).ok).toBe(true);
  expect(e.onBuy('kaitentai', 10, 1e30, 0).ok).toBe(true);
  expect(e.onBuy('croon', 1, 1e30, 0).ok).toBe(true);
  expect(e.onBuy('reel', 100, 1e30, 0).ok).toBe(true);
  expect(e.onAwaken('windmill', 100).ok).toBe(true);
  expect(e.snapshot().lv[0]).toBe(0);
  expect(e.snapshot().runMaxLv).toEqual([110, 10, 1, 100, 0, 0, 0, 0]);
  close(e);
  // 110×0.25=27・10×0.25=2・1×0.25=0 → クルーン 0 なので液晶リールも 0
  expect(e.snapshot().prevMaxLv).toEqual([110, 10, 1, 100, 0, 0, 0, 0]);
  expect(e.snapshot().lv).toEqual([27, 2, 0, 0, 0, 0, 0, 0]);
  expect(e.snapshot().runMaxLv).toEqual([27, 2, 0, 0, 0, 0, 0, 0]);
  // starter（絶対 Lv）と大きい方
  const s = make();
  own(s, ['starter1', 't_rel10']);
  patch(s, { lv: [100, 300, 0, 0, 0, 0, 0, 0] });
  close(s);
  expect(s.snapshot().lv).toEqual([25, 30, 0, 0, 0, 0, 0, 0]);
  // 前の周回の最高 Lv が 0（初回・v8 から）なら starter_rel は何もしない
  const first = make();
  own(first, ['t_rel25']);
  patch(first, { prevMaxLv: [0, 0, 0, 0, 0, 0, 0, 0], runMaxLv: [0, 0, 0, 0, 0, 0, 0, 0] });
  close(first);
  expect(first.snapshot().lv).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test('番頭さんの購入も周回の最高 Lv に入る', () => {
  const e = make();
  own(e, ['kanban', 'tank_keep', 'auto_keep', 'starter1']);
  const nodes = ((baseJson()['tree'] as Json)['nodes'] as Json[]).map((n) => n['id'] as string);
  expect(nodes).toContain('bantou');
  const tree = [...(e.snapshot().tree as unknown as Json[]), { id: 'bantou', cost: 1, at: 9 }];
  patch(e, { tree, pointsEarned: (e.snapshot().pointsEarned as number) + 1, bantouOn: true });
  e.onBantouTick(1e6);
  const s = e.snapshot();
  expect(s.lv[0]).toBeGreaterThan(0);
  expect(s.runMaxLv).toEqual(s.lv);
});

test('休業中の行動の玉は starter_rel・保持した覚醒・共鳴込みの開店後の基準生産で量る', () => {
  const e = make({ resonance: 0.1 });
  own(e, ['t_rel25', 't_keep_low']);
  patch(e, { lv: [200, 100, 80, 0, 0, 0, 0, 0], runMaxLv: [200, 100, 80, 0, 0, 0, 0, 0], awakened: [2, 1, 0, 0, 0, 0, 0, 0] });
  e.noteGain(1000);
  expect(e.onClose(0).ok).toBe(true);
  const balls = e.onRestGrant(30);
  expect(e.onOpen().ok).toBe(true);
  expect(e.snapshot().lv).toEqual([50, 25, 20, 0, 0, 0, 0, 0]);
  expect(e.snapshot().awakened).toEqual([2, 1, 0, 0, 0, 0, 0, 0]);
  expect(balls).toBeCloseTo(e.getRefPerSec() * 30 * e.getProdMinMult() * 60, 6);
});

test('v8 のセーブ: 今の周回の最高 Lv = 今の Lv・前の周回の最高 Lv = 0（v9 で保存）', () => {
  const e = make();
  patch(e, { lv: [30, 20, 10, 0, 0, 0, 0, 0] });
  const v8: Json = { ...(e.snapshot() as unknown as Json), v: 8 };
  delete v8['runMaxLv'];
  delete v8['prevMaxLv'];
  const back = make();
  back.restore(v8);
  const s = back.snapshot();
  expect(s.v).toBe(9);
  expect(s.runMaxLv).toEqual([30, 20, 10, 0, 0, 0, 0, 0]);
  expect(s.prevMaxLv).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test('snapshot/restore の往復（v9 の項目・休業中も）', () => {
  const e = make({ reset_lv: false, resonance: 0.15 });
  own(e, ['t_rel10', 't_keep_all', 't_res']);
  patch(e, { lv: [120, 100, 0, 0, 0, 0, 0, 0] });
  expect(e.onAwaken('windmill', 100).ok).toBe(true);
  close(e);
  expect(e.onBuy('windmill', 10, 1e30, 0).ok).toBe(true);
  e.noteGain(1000);
  expect(e.onClose(5).ok).toBe(true);
  const snap = e.snapshot();
  const back = make({ reset_lv: false, resonance: 0.15 });
  back.restore(JSON.parse(JSON.stringify(snap)));
  expect(back.snapshot()).toEqual(snap);
  expect(back.onOpen()).toEqual(e.onOpen());
  expect(back.snapshot()).toEqual(e.snapshot());
  expect(back.basePerSec()).toBe(e.basePerSec());
  // 不正な配列は拒否
  const bad = make();
  expect(() => bad.restore({ ...(snap as unknown as Json), prevMaxLv: [1, 2] })).toThrow();
  expect(() => bad.restore({ ...(snap as unknown as Json), runMaxLv: [1, 2, 3, 4, 5, 6, 7, -1] })).toThrow();
});

test('ツリーの行の timing: starter_rel・keep awaken は open、resonance_add は now', () => {
  const e = make();
  const nodes = e.getTreeView().nodes;
  const timing = (id: string): string => nodes.find((n) => n.id === id)!.timing;
  expect(timing('t_keep_low')).toBe('open');
  expect(timing('t_rel10')).toBe('open');
  expect(timing('t_res')).toBe('now');
});

test('設定の検証: reset_lv・resonance・starter_rel・resonance_add の範囲', () => {
  const bad = (mut: (j: Json) => void): void => {
    const j = baseJson();
    mut(j);
    expect(() => parseEconomy(j)).toThrow();
  };
  bad((j) => ((j['awaken'] as Json)['reset_lv'] = 1));
  bad((j) => ((j['awaken'] as Json)['resonance'] = -0.1));
  bad((j) => ((j['awaken'] as Json)['resonance'] = 1.5));
  const node = (effect: Json): Json => ({ id: 'x', name: 'x', desc: 'x', tier: 1, cost: 1, req: [], effect: [effect] });
  bad((j) => ((j['tree'] as Json)['nodes'] as Json[]).push(node({ k: 'starter_rel', ratio: 0.6 })));
  bad((j) => ((j['tree'] as Json)['nodes'] as Json[]).push(node({ k: 'starter_rel', ratio: 0 })));
  bad((j) => ((j['tree'] as Json)['nodes'] as Json[]).push(node({ k: 'resonance_add', add: 0.21 })));
  bad((j) => ((j['tree'] as Json)['nodes'] as Json[]).push(node({ k: 'keep', targets: ['awaken_low'] })));
  // reset_lv・resonance を省いた JSON は既定（true・0）
  const j = baseJson();
  const aw = j['awaken'] as Json;
  delete aw['reset_lv'];
  delete aw['resonance'];
  const spec = parseEconomy(j);
  expect(spec.awaken.resetLv).toBe(true);
  expect(spec.awaken.resonance).toBe(0);
});
