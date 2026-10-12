import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';

type Json = Record<string, unknown>;

function loadJson(): Json {
  const json = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Json;
  const close = json['close'] as Json;
  close['required_run_total'] = 1000;
  close['divisor'] = 1000;
  close['medals_per_point'] = 7;
  return json;
}

const JSON_DEF = loadJson();
const NODE_COST: Record<string, number> = {};
const ALL_IDS: string[] = [];
{
  const nodes = (JSON_DEF['tree'] as Json)['nodes'] as { id: string; cost: number }[];
  for (let i = 0; i < nodes.length; i = i + 1) {
    NODE_COST[nodes[i]!.id] = nodes[i]!.cost;
    ALL_IDS.push(nodes[i]!.id);
  }
}

function make(): IdleEconomy {
  return new IdleEconomy(parseEconomy(JSON.parse(JSON.stringify(JSON_DEF))));
}

/** 複写の一部を書き換えて restore する。 */
function patch(econ: IdleEconomy, p: Json): void {
  econ.restore({ ...(econ.snapshot() as unknown as Json), ...p });
}

/** ids を所持した状態にする（points は余り leftover。pointsEarned = points + Σcost）。 */
function own(econ: IdleEconomy, ids: string[], leftover = 0): void {
  let sum = 0;
  const tree: Json[] = [];
  for (let i = 0; i < ids.length; i = i + 1) {
    const c = NODE_COST[ids[i] as string] as number;
    sum = sum + c;
    tree.push({ id: ids[i], cost: c, at: i });
  }
  patch(econ, { points: leftover, pointsEarned: leftover + sum, tree });
}

function made(ids: string[], extra: Json = {}): IdleEconomy {
  const e = make();
  own(e, ids);
  if (Object.keys(extra).length > 0) {
    patch(e, extra);
  }
  return e;
}

const LV = [10, 5, 0, 0, 0, 0, 0, 0];

function close(econ: IdleEconomy): void {
  econ.noteGain(1000);
  const r = econ.onClose(0);
  expect(r.ok).toBe(true);
}

test('空のツリー: 値は従来どおり（intervalMult 1・treeMult 1・price 1）', () => {
  const e = make();
  patch(e, { lv: LV });
  expect(e.treeMult()).toBe(1);
  expect(e.regularRate()).toBe(1);
  expect(e.priceMult()).toBe(1);
  expect(e.getProdMinMult()).toBe(1);
  expect(e.achMult()).toBe(1);
  expect(e.getOpenBoostMs()).toBe(0);
  const base = e.basePerSec();
  expect(e.getPerSec(true, 1000)).toBe(base * 1 * e.getTreeView().mult);
  expect(e.getRefPerSec()).toBeGreaterThanOrEqual(base);
  const n = e.getNoticeConfig();
  expect(n.intervalMult).toBe(1);
  expect(n.feverMult).toBe(7);
  expect(n.feverMs).toBeGreaterThan(0);
  expect(n.rushCapS).toBe(900);
  expect(n.bonusWeight).toBe(5);
});

test('prod_add: 購入の次の getPerSec / getRefPerSec から効く（kanban +10%）', () => {
  const e = make();
  patch(e, { lv: LV, points: 3, pointsEarned: 3 });
  const p0 = e.getPerSec(true, 1000);
  const r0 = e.getRefPerSec();
  expect(e.buyTreeNode('kanban', 1).ok).toBe(true);
  expect(e.treeMult()).toBeCloseTo(1.1, 12);
  expect(e.getPerSec(true, 1000)).toBeCloseTo(p0 * 1.1, 6);
  expect(e.getRefPerSec()).toBeCloseTo(r0 * 1.1, 6);
  expect(e.getTreeView().mult).toBe(e.treeMult());
  // onTick の産出も新しい値
  expect(e.onTick(true, 5000).ballGain).toBeCloseTo(p0 * 1.1, 6);
});

test('prod_add_machine: 機種が一致する時だけ足す', () => {
  const e = made(['shop_light1', 'shop_light2', 'shop_rush1'], { lv: LV });
  expect(e.treeMult()).toBe(1);
  e.setMachineId('light-middle-01');
  expect(e.treeMult()).toBeCloseTo(1.3, 12);
  e.setMachineId('rush-middle-01');
  expect(e.treeMult()).toBeCloseTo(1.1, 12);
  e.setMachineId('lt-middle-01');
  expect(e.treeMult()).toBe(1);
  e.setMachineId('light-middle-01');
  const p = e.getPerSec(true, 1000);
  e.setMachineId('lt-middle-01');
  expect(p / e.getPerSec(true, 1000)).toBeCloseTo(1.3, 9);
  e.setMachineId('light-middle-01');
  const r = e.getRefPerSec();
  e.setMachineId('lt-middle-01');
  expect(r / e.getRefPerSec()).toBeCloseTo(1.3, 9);
});

test('regular_add: 常連係数 1 + (1 + Σ) × ランク（getPerSec / getRefPerSec）', () => {
  const plain = made([], { lv: LV, regular: 10 });
  const up = made(['regular_up1', 'regular_up2'], { lv: LV, regular: 10 });
  expect(up.regularRate()).toBeCloseTo(1.2, 12);
  expect(up.getTreeView().regularRate).toBeCloseTo(1.2, 12);
  expect(up.getPerSec(true, 1000) / plain.getPerSec(true, 1000)).toBeCloseTo(13 / 11, 9);
  expect(up.getRefPerSec() / plain.getRefPerSec()).toBeCloseTo(13 / 11, 9);
});

test('ach_per_add / streak_max_add', () => {
  const ids = JSON_DEF['achievements'] as Json;
  const list = ids['list'] as { id: string }[];
  const achieved: Json[] = [];
  for (let i = 0; i < 10; i = i + 1) {
    achieved.push({ id: list[i]!.id, at: i });
  }
  const plain = made([], { achieved });
  const t = made(['ach_link1', 'ach_link2'], { achieved });
  expect(plain.achMult()).toBeCloseTo(1.1, 12);
  expect(t.achMult()).toBeCloseTo(1 + 0.014 * 10, 12);
  // 連続日数の上限: 30 日連続でも既定は 20 日で頭打ち（1 + 0.05×20 = 2）
  const s0 = made([], { lv: LV, streakDays: 30 });
  const s1 = made(['streak_up1'], { lv: LV, streakDays: 30 });
  const s2 = made(['streak_up1', 'streak_up2'], { lv: LV, streakDays: 30 });
  const p0 = s0.getPerSec(true, 1000);
  expect(s1.getPerSec(true, 1000) / p0).toBeCloseTo(2.25 / 2, 9);
  expect(s2.getPerSec(true, 1000) / p0).toBeCloseTo(2.5 / 2, 9);
  // 上限未満の日数は変わらない
  const a = made([], { lv: LV, streakDays: 10 });
  const b = made(['streak_up1', 'streak_up2'], { lv: LV, streakDays: 10 });
  expect(b.getPerSec(true, 1000)).toBe(a.getPerSec(true, 1000));
});

test('price_sub: 1 回買い・まとめ買い（×10・×100）・shop・nextPrice が一致して下がる', () => {
  const plain = made([], { lv: [5, 0, 0, 0, 0, 0, 0, 0] });
  const cut = made(['price_cut1', 'price_cut2'], { lv: [5, 0, 0, 0, 0, 0, 0, 0] });
  expect(cut.priceMult()).toBeCloseTo(0.9, 12);
  const pv = plain.getShopView().yakumono[0]!.prices;
  const cv = cut.getShopView().yakumono[0]!.prices;
  expect(pv.length).toBe(3);
  expect(cut.getYakumonoViews()[0]!.nextPrice).toBeCloseTo(plain.getYakumonoViews()[0]!.nextPrice * 0.9, 6);
  for (let k = 0; k < cv.length; k = k + 1) {
    const c = cv[k];
    const p = pv[k];
    if (c === null || p === null || c === undefined || p === undefined) {
      continue;
    }
    expect(c).toBeCloseTo(p * 0.9, 4);
  }
  for (let ni = 0; ni < 3; ni = ni + 1) {
    const n = [1, 10, 100][ni] as number;
    const e = made(['price_cut1', 'price_cut2'], { lv: [5, 0, 0, 0, 0, 0, 0, 0] });
    const q = made([], { lv: [5, 0, 0, 0, 0, 0, 0, 0] });
    const have = (pv[ni] as number) * 2;
    const r = e.onBuy('windmill', n, have, 0);
    const r0 = q.onBuy('windmill', n, have, 0);
    expect(r.ok && r0.ok).toBe(true);
    if (r.ok && r0.ok) {
      const spent = have - r.balls;
      const spent0 = have - r0.balls;
      expect(spent / spent0).toBeCloseTo(0.9, 9);
      // shop の prices のどれかと一致（まとめ買いの価格表）
      let found = false;
      for (let k = 0; k < cv.length; k = k + 1) {
        const c = cv[k];
        if (c !== null && c !== undefined && Math.abs(c - spent) <= 1e-6 * spent) {
          found = true;
        }
      }
      expect(found).toBe(true);
    }
  }
});

test('keep: 対象の段だけ閉店で残り、他は 0 に戻る', () => {
  const stages = { idleStage: 1, tankStage: 1, nailStage: 1, shortenStage: 1, holdStage: 1, autoOwned: true, tomeuchiOwned: true };
  const run = (ids: string[]): Json => {
    const e = made(ids, stages);
    close(e);
    return e.snapshot() as unknown as Json;
  };
  const none = run([]);
  for (const k of Object.keys(stages)) {
    expect(none[k]).toBe(k === 'autoOwned' || k === 'tomeuchiOwned' ? false : 0);
  }
  const auto = run(['auto_keep']);
  expect(auto['autoOwned']).toBe(true);
  expect(auto['tomeuchiOwned']).toBe(true);
  expect(auto['holdStage']).toBe(1);
  expect(auto['tankStage']).toBe(0);
  expect(auto['idleStage']).toBe(0);
  expect(auto['nailStage']).toBe(0);
  const tank = run(['tank_keep']);
  expect(tank['tankStage']).toBe(1);
  expect(tank['holdStage']).toBe(0);
  expect(tank['autoOwned']).toBe(false);
  const idle = run(['idle_keep']);
  expect(idle['idleStage']).toBe(1);
  expect(idle['tankStage']).toBe(0);
  const nail = run(['nail_keep']);
  expect(nail['nailStage']).toBe(1);
  expect(nail['shortenStage']).toBe(1);
  expect(nail['idleStage']).toBe(0);
  const all = run(['tank_keep', 'auto_keep', 'idle_keep', 'nail_keep']);
  for (const k of Object.keys(stages)) {
    expect(all[k]).toBe(stages[k as keyof typeof stages]);
  }
});

test('starter: 閉店後の Lv は各要素の最大・覚醒は 0', () => {
  const e = made(['starter1', 'starter2'], { lv: [50, 50, 50, 50, 50, 50, 50, 50], awakened: [1, 1, 1, 1, 1, 1, 1, 1] });
  close(e);
  const s = e.snapshot();
  expect(s.lv).toEqual([25, 10, 25, 10, 0, 0, 0, 0]);
  expect(s.awakened).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  const one = made(['starter1'], { lv: [50, 50, 50, 50, 50, 50, 50, 50] });
  close(one);
  expect(one.snapshot().lv).toEqual([25, 10, 0, 0, 0, 0, 0, 0]);
  const none = made([], { lv: [50, 50, 50, 50, 50, 50, 50, 50] });
  close(none);
  expect(none.snapshot().lv).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test('open_boost: 閉店で入り、onTick で 1000ms ずつ減って切れる（背面・燃料 0 でも減る）', () => {
  const e = made(['starter1', 'open_dash1', 'open_dash2']);
  expect(e.getOpenBoostMs()).toBe(0);
  close(e);
  expect(e.getOpenBoostMs()).toBe(14400000);
  expect(e.getTreeView().openBoostMs).toBe(14400000);
  // 背面（fg=false）・燃料 0 でも減る
  e.onTick(false, 0);
  expect(e.getOpenBoostMs()).toBe(14400000 - 1000);
  e.onTick(true, 50000);
  expect(e.getOpenBoostMs()).toBe(14400000 - 2000);
  // 倍率: 1 + (2−1) + (1.5−1)= 2.5
  const withB = e.getPerSec(true, 1000);
  patch(e, { openBoostMs: 0 });
  expect(withB / e.getPerSec(true, 1000)).toBeCloseTo(2.5, 9);
});

test('open_boost: 時間（onTick 回数）で切れて倍率が 1 に戻る', () => {
  const e = made(['open_dash1'], { lv: LV });
  const off = e.getPerSec(true, 1000);
  patch(e, { openBoostMs: 3000 });
  expect(e.getPerSec(true, 1000) / off).toBeCloseTo(2, 9);
  e.onTick(false, 0);
  e.onTick(false, 0);
  expect(e.getOpenBoostMs()).toBe(1000);
  expect(e.getPerSec(true, 1000) / off).toBeCloseTo(2, 9);
  e.onTick(false, 0);
  expect(e.getOpenBoostMs()).toBe(0);
  expect(e.getPerSec(true, 1000)).toBe(off);
  e.onTick(false, 0);
  expect(e.getOpenBoostMs()).toBe(0);
});

test('open_boost は getPerSec に入るが getRefPerSec には入らない', () => {
  const e = made(['open_dash1'], { lv: LV });
  const ref0 = e.getRefPerSec();
  const ps0 = e.getPerSec(true, 1000);
  patch(e, { openBoostMs: 5000 });
  expect(e.getRefPerSec()).toBe(ref0);
  expect(e.getPerSec(true, 1000)).toBeCloseTo(ps0 * 2, 6);
});

test('closed_add: 燃料切れの状態係数に足す（燃料ありには影響しない）', () => {
  const plain = made([], { lv: LV });
  const t = made(['night_light1', 'night_light2'], { lv: LV });
  expect(t.getPerSec(true, 0) / plain.getPerSec(true, 0)).toBeCloseTo(0.02 / 0.005, 9);
  expect(t.getPerSec(false, 0) / plain.getPerSec(false, 0)).toBeCloseTo(0.02 / 0.005, 9);
  expect(t.getPerSec(true, 1000)).toBe(plain.getPerSec(true, 1000));
  expect(t.getPerSec(false, 1000)).toBe(plain.getPerSec(false, 1000));
});

test('tank_add_h / boost_cap_add_h / boost_mult_add', () => {
  const plain = make();
  const t = made(['tank_big1', 'tank_big2', 'boost_up'], { lv: LV, boostMs: 100000, boostOn: true });
  expect(t.tankCapMs() - plain.tankCapMs()).toBe(12 * 3600000);
  expect(t.boostCapMs() - plain.boostCapMs()).toBe(12 * 3600000);
  const base = made([], { lv: LV, boostMs: 100000, boostOn: true });
  // ブースト 2 → 2.5（前面・燃料あり）
  expect(t.getPerSec(true, 1000) / base.getPerSec(true, 1000)).toBeCloseTo(1.25, 9);
  // 背面ではブーストは掛からない
  expect(t.getPerSec(false, 1000)).toBe(base.getPerSec(false, 1000));
  // 段が上がっても加算は全段に効く
  patch(t, { tankStage: 2 });
  patch(plain, { tankStage: 2 });
  expect(t.tankCapMs() - plain.tankCapMs()).toBe(12 * 3600000);
});

test('awaken_medal_base: shop の awakenCost と onAwaken の消費が 15×2^n になる', () => {
  const lv = [100, 0, 0, 0, 0, 0, 0, 0];
  const e = made(['awaken_disc'], { lv });
  const p = made([], { lv });
  expect(p.getShopView().yakumono[0]!.awakenCost).toBe(20);
  expect(e.getShopView().yakumono[0]!.awakenCost).toBe(15);
  const r = e.onAwaken('windmill', 100);
  expect(r).toEqual({ ok: true, medals: 85 });
  expect(e.getShopView().yakumono[0]!.awakenCost).toBe(30);
  expect(p.onAwaken('windmill', 19)).toEqual({ ok: false, reason: 'insufficient-medals' });
  expect(e.getShopView().yakumono[1]!.awakenCost).toBe(15);
});

test('prod_min_add: getProdMinMult = 1 + Σ', () => {
  expect(make().getProdMinMult()).toBe(1);
  expect(made(['sashiire1']).getProdMinMult()).toBeCloseTo(1.1, 12);
  expect(made(['sashiire1', 'sashiire2']).getProdMinMult()).toBeCloseTo(1.25, 12);
});

test('points_add: 閉店の常連P に足す（gain 0 なら足さない）', () => {
  const e = made(['kuchikomi1', 'kuchikomi2', 'kuchikomi3']);
  e.noteGain(2999);
  const r = e.onClose(0);
  expect(r.ok).toBe(true);
  const plain = make();
  plain.noteGain(2999);
  const r0 = plain.onClose(0);
  if (r.ok && r0.ok) {
    expect(r.gain).toBe(r0.gain);
    expect(r.points - r0.points).toBe(r0.gain >= 1 ? 4 : 0);
  }
});

test('予告の設定: fever / rush / bonus / interval がツリーで変わる（購入の次の読み出しから）', () => {
  const e = make();
  patch(e, { points: 200, pointsEarned: 200 });
  const n0 = e.getNoticeConfig();
  expect(e.buyTreeNode('kanban', 0).ok).toBe(true);
  expect(e.buyTreeNode('auto_keep', 0).ok).toBe(true);
  expect(e.buyTreeNode('notice_call1', 0).ok).toBe(true);
  expect(e.getNoticeConfig().intervalMult).toBeCloseTo(0.9, 12);
  own(e, ['kanban', 'auto_keep', 'notice_call1', 'fever_long1', 'rush_cap1', 'notice_call2', 'bonus_notice', 'fever_mult1']);
  const n = e.getNoticeConfig();
  expect(n.intervalMult).toBeCloseTo(0.8, 12);
  expect(n.feverMs - n0.feverMs).toBe(15000);
  expect(n.feverMult - n0.feverMult).toBe(1);
  expect(n.rushCapS - n0.rushCapS).toBe(300);
  expect(n.bonusWeight - n0.bonusWeight).toBe(5);
  // 変えない項目
  expect(n.feverWeight).toBe(n0.feverWeight);
  expect(n.rushWeight).toBe(n0.rushWeight);
  expect(n.rushRate).toBe(n0.rushRate);
  expect(n.bonus1In).toBe(n0.bonus1In);
  expect(n.minFgMs).toBe(n0.minFgMs);
  expect(n.maxFgMs).toBe(n0.maxFgMs);
  // フィーバー発動の時間・getPerSec の倍率にも反映
  e.onNoticeFever();
  expect(e.getFeverMs()).toBe(n.feverMs);
  patch(e, { lv: LV });
  const noFever = made(['kanban'], { lv: LV });
  expect(e.getPerSec(true, 1000) / noFever.getPerSec(true, 1000)).toBeCloseTo(n.feverMult, 9);
});

test('全ノード所持の天井（spec/25）', () => {
  const e = make();
  own(e, ALL_IDS, 3);
  expect(e.getPoints()).toBe(3);
  const t = e.getTreeTotals();
  expect(t.bantou).toBe(true);
  // treeMult: 機種別は 0.3 まで（機種ごと）→ 2.3
  for (const m of ['light-middle-01', 'rush-middle-01', 'lt-middle-01']) {
    e.setMachineId(m);
    expect(e.treeMult()).toBeCloseTo(2.3, 9);
    expect(e.getTreeView().mult).toBeCloseTo(2.3, 9);
  }
  e.setMachineId('other');
  expect(e.treeMult()).toBeCloseTo(2.0, 9);
  expect(e.regularRate()).toBeCloseTo(1.2, 12);
  // 実績 1 個あたり 1.6%
  expect(e.achMult()).toBe(1);
  const list = (JSON_DEF['achievements'] as Json)['list'] as { id: string }[];
  patch(e, { achieved: [{ id: list[0]!.id, at: 0 }] });
  expect(e.achMult()).toBeCloseTo(1.016, 12);
  expect(e.priceMult()).toBeCloseTo(0.9, 12);
  expect(e.getProdMinMult()).toBeCloseTo(1.25, 12);
  const n = e.getNoticeConfig();
  expect(n.intervalMult).toBeCloseTo(0.8, 12);
  expect(n.feverMult).toBe(8);
  expect(n.rushCapS).toBe(1200);
  expect(n.bonusWeight).toBe(10);
  expect(e.tankCapMs() - make().tankCapMs()).toBe(12 * 3600000);
  expect(e.boostCapMs() - make().boostCapMs()).toBe(12 * 3600000);
  // 連続の上限 30 日
  patch(e, { streakDays: 99, lv: LV });
  const base = e.basePerSec();
  e.setMachineId('other');
  const regular = 0;
  void regular;
  expect(e.getRefPerSec()).toBeCloseTo(base * 1 * 2.5 * 1.016 * 2.0, 6);
  // 全所持から閉店: 開店ダッシュ 4h・starter [25,10,25,10,0,0,0,0]
  close(e);
  expect(e.getOpenBoostMs()).toBe(14400000);
  expect(e.snapshot().lv).toEqual([25, 10, 25, 10, 0, 0, 0, 0]);
  expect(e.getPerSec(true, 1000) / (e.getPerSec(true, 1000) / 2.5)).toBeCloseTo(2.5, 9);
});

test('禁止演算を使わない（tree-state / tree-config / economy-state）', () => {
  const files = ['tree-state.ts', 'tree-config.ts', 'economy-state.ts'];
  const banned = [
    /Math\.(sin|cos|pow|exp|log|hypot|cbrt|random)\b/,
    /\*\*/,
    /Date\.now/,
  ];
  for (const f of files) {
    const src = readFileSync(new URL('./' + f, import.meta.url), 'utf8');
    // コメント行を除いて検査
    const code = src
      .split('\n')
      .filter((l) => {
        const s = l.trim();
        return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*'));
      })
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const re of banned) {
      expect(re.test(code), f + ' ' + String(re)).toBe(false);
    }
  }
});
