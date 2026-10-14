import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import type { Action, EngineSnapshot, Grant, SimEvent } from './engine.ts';
import { Engine } from './engine.ts';

function loadMachine(): { spec: MachineSpec; patterns: PatternTable } {
  const spec = parseMachineText(readFileSync('../../resources/machines/light-middle-01.json', 'utf8'));
  const patterns = parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
  return { spec, patterns };
}

function loadAtlas(): ArrayBuffer {
  const dir = '../../resources/atlas';
  const names = readdirSync(dir);
  let found = '';
  for (let i = 0; i < names.length; i = i + 1) {
    const n = names[i] as string;
    if (n.length > 4 && n.slice(n.length - 4) === '.bin') {
      found = n;
      break;
    }
  }
  if (found === '') {
    throw new Error('atlas .bin not found');
  }
  const buf = readFileSync(dir + '/' + found);
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const ab = new ArrayBuffer(u8.length);
  new Uint8Array(ab).set(u8);
  return ab;
}

/** spec/23 表の初期値（手計算シナリオはこれで固定し、default.json の調整（D-048）に左右されないようにする）。 */
const SPEC_YIELDS = [1, 8, 60, 400, 2600, 16000, 100000, 650000];

function loadEconomy(): IdleEconomy {
  const json = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Record<string, unknown>;
  const yak = json['yakumono'] as Record<string, unknown>[];
  for (let i = 0; i < yak.length; i = i + 1) {
    (yak[i] as Record<string, unknown>)['yield'] = SPEC_YIELDS[i];
  }
  (json['awaken'] as Record<string, unknown>)['medal_base'] = 5;
  (json['factors'] as Record<string, unknown>)['closed'] = 0.1;
  (json['close'] as Record<string, unknown>)['required_run_total'] = 1000000000;
  (json['close'] as Record<string, unknown>)['divisor'] = 1000000000;
  (json['close'] as Record<string, unknown>)['medals_per_point'] = 7;
  // 実績の倍率が途中で入ると手計算がずれるので外す（実績は achievements.test.ts）。
  (json['achievements'] as Record<string, unknown>)['list'] = [];
  // medal_base・closed を変えると常連ツリーの検証に掛かるので外す（ツリーは tree-config.test.ts）。
  delete json['tree'];
  return new IdleEconomy(parseEconomy(json));
}

function relErr(got: number, want: number): number {
  if (want === 0) {
    return got === 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  const d = got - want;
  return (d < 0 ? -d : d) / (want < 0 ? -want : want);
}

const H = 3600000;
const H8 = 8 * H;
const H12 = 12 * H;
const H13 = 13 * H;

test('手書きシナリオ: 燃料12h→背面8h→前面購入→燃料切れ→閉店中10%', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const econ = loadEconomy();
  const grants: Grant[] = [{ claimId: 'fuel12h', at: 0, fuelMs: H12, medals: 0 }];
  const actions: Action[] = [
    { t: 0, k: 'buy', target: 'windmill', count: 10 },
    { t: 0, k: 'presence', fg: false },
    { t: H8, k: 'presence', fg: true },
    { t: H8, k: 'buy', target: 'kaitentai', count: 1 },
  ];
  const eng = new Engine(
    { seed: 42, spec, patterns, atlas, initialBalls: 10000, initialMedals: 0, economy: econ },
    grants,
    actions,
  );
  const e1 = eng.advance(H8);
  expect(e1.filter((e) => e.k === 'granted').length).toBe(1);
  expect(e1.filter((e) => e.k === 'rejected').length).toBe(0);
  const p1 = eng.project();
  expect(p1.fuelMs).toBe(4 * H);
  expect(relErr(p1.balls, 10000 - 304.5557735707909 + 72000)).toBeLessThan(1e-9);
  expect(relErr(p1.perSec, 2.5)).toBeLessThan(1e-12);
  const e2 = eng.advance(H12);
  const p2 = eng.project();
  expect(p2.fuelMs).toBe(0);
  expect(relErr(p2.balls, 10000 - 304.5557735707909 - 100 + 72000 + 100800)).toBeLessThan(1e-9);
  expect(relErr(p2.perSec, 0.7)).toBeLessThan(1e-12);
  const empty = e2.filter((e) => e.k === 'fuelEmpty');
  expect(empty.length).toBe(1);
  expect((empty[0] as { at: number }).at).toBe(H12 - 1000);
  const e3 = eng.advance(H13);
  expect(e3.filter((e) => e.k === 'fuelEmpty').length).toBe(0);
  const p3 = eng.project();
  expect(p3.fuelMs).toBe(0);
  expect(relErr(p3.balls, 10000 - 304.5557735707909 - 100 + 72000 + 100800 + 2520)).toBeLessThan(1e-9);
  expect(relErr(p3.perSec, 0.7)).toBeLessThan(1e-12);
  expect(p3.boostMs).toBe(0);
  expect(p3.yakumono.length).toBe(8);
  const wind = p3.yakumono[0] as { id: string; lv: number };
  const kai = p3.yakumono[1] as { id: string; lv: number };
  expect(wind.id).toBe('windmill');
  expect(wind.lv).toBe(10);
  expect(kai.lv).toBe(1);
  expect(relErr(econ.getRunTotal(), 175320)).toBeLessThan(1e-9);
  expect(relErr(econ.getTotalTotal(), 175320)).toBeLessThan(1e-9);
});

test('Grantはタンク上限・溢れ→ブースト・fuelRefilled、前面で×2', () => {
  const direct = loadEconomy();
  const g1 = direct.onGrant(H12, 0, undefined, 0, 0);
  expect(g1.fuelMs).toBe(H12);
  expect(g1.fuelRefilled).toBe(true);
  const g2 = direct.onGrant(H12, 0, undefined, g1.fuelMs, 0);
  expect(g2.fuelMs).toBe(H12);
  expect(g2.fuelRefilled).toBe(false);
  expect(direct.getBoostMs()).toBe(H12);
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const econ = loadEconomy();
  const eng = new Engine(
    { seed: 7, spec, patterns, atlas, initialBalls: 10000, initialMedals: 0, economy: econ },
    [
      { claimId: 'a', at: 1, fuelMs: H12, medals: 0 },
      { claimId: 'b', at: 1, fuelMs: H12, medals: 0 },
    ],
    [{ t: 1, k: 'buy', target: 'windmill', count: 10 }],
  );
  // t=0の経済tickは役物なしで0。入力はt=1に置き、次のtick（1000）前の状態を見る
  const evs = eng.advance(2);
  expect(eng.project().fuelMs).toBe(H12);
  expect(econ.getBoostMs()).toBe(H12);
  expect(evs.filter((e) => e.k === 'fuelRefilled').length).toBe(1);
  const perBoost = eng.project().perSec;
  expect(relErr(perBoost, 10)).toBeLessThan(1e-12);
  const ballsBefore = eng.project().balls;
  eng.appendAction({ t: 2, k: 'boost', on: false });
  eng.advance(2000);
  expect(relErr(eng.project().perSec, 5)).toBeLessThan(1e-12);
  expect(eng.project().balls > ballsBefore).toBe(true);
});

test('buy・awakenの検証と適用', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const econ = loadEconomy();
  const eng = new Engine(
    { seed: 11, spec, patterns, atlas, initialBalls: 500, initialMedals: 0, economy: econ },
    [],
    [
      { t: 1, k: 'buy', target: 'kaitentai', count: 1 },
      { t: 1, k: 'buy', target: 'windmill', count: 10 },
      { t: 1, k: 'buy', target: 'nope', count: 1 },
      { t: 1, k: 'buy', target: 'windmill', count: 7 },
      { t: 1, k: 'awaken', yakumono: 'windmill' },
    ],
  );
  const evs = eng.advance(2);
  const rej = evs.filter((e) => e.k === 'rejected');
  expect(rej.map((e) => (e as { reason: string }).reason)).toEqual([
    'locked',
    'unknown-target',
    'invalid-count',
    'not-ready',
  ]);
  expect(relErr(eng.project().balls, 500 - 304.5557735707909)).toBeLessThan(1e-9);
  const rich = new Engine(
    { seed: 11, spec, patterns, atlas, initialBalls: 1000000000, initialMedals: 100, economy: loadEconomy() },
    [],
    [
      { t: 0, k: 'buy', target: 'windmill', count: 100 },
      { t: 0, k: 'awaken', yakumono: 'windmill' },
    ],
  );
  const evs2 = rich.advance(1000);
  expect(evs2.filter((e) => e.k === 'rejected').length).toBe(0);
  const p = rich.project();
  const w = p.yakumono[0] as { lv: number; awakened?: number };
  expect(w.lv).toBe(0);
  expect(w.awakened).toBe(1);
  expect(p.medals).toBe(95);
});

test('閉店は条件・常連P・リセット範囲', () => {
  const econ = loadEconomy();
  const early = econ.onClose(0);
  expect(early.ok).toBe(false);
  econ.noteGain(1000000000);
  econ.onGrant(0, 8, undefined, 0, 0);
  const r1 = econ.onBuy('idle', 1, 1000000000, 0);
  expect(r1.ok).toBe(true);
  expect(econ.getUnlockedRates()).toEqual([1]);
  const r2 = econ.onBuy('rate', 1, 0, 8);
  expect(r2.ok).toBe(true);
  expect(econ.getUnlockedRates().length).toBe(2);
  // 消費しても累計獲得メダルは減らない
  expect(econ.getMedalsEarned()).toBe(8);
  const done = econ.onClose(12345);
  expect(done.ok).toBe(true);
  if (done.ok) {
    expect(done.gain).toBe(1);
    expect(done.balls).toBe(econ.startBalls());
    expect(done.balls).toBeGreaterThan(0);
  }
  expect(econ.getRegular()).toBe(1);
  expect(econ.getRunTotal()).toBe(0);
  expect(econ.getTotalTotal()).toBe(1000000000);
  expect(econ.getMedalsEarned()).toBe(8);
  const views = econ.getYakumonoViews();
  expect((views[0] as { lv: number }).lv).toBe(0);
  expect(econ.idleValue()).toBe(0.5);
  const buyRate2 = econ.onBuy('rate', 1, 0, 20);
  expect(buyRate2.ok).toBe(true);
});

test('常連Pは行動由来が上限・生産×(1+1.0×P)（D-049）', () => {
  const econ = loadEconomy();
  // 玉由来3（27e9/1e9）でも行動0なら獲得0（閉店自体はできる, D-044）
  econ.noteGain(27000000000);
  const none = econ.onClose(0);
  expect(none.ok && none.gain).toBe(0);
  expect(econ.getRegular()).toBe(0);
  // 行動14枚で行動由来2 → 獲得2
  econ.noteGain(1000000000);
  econ.onGrant(0, 14, undefined, 0, 0);
  const two = econ.onClose(0);
  expect(two.ok && two.gain).toBe(2);
  // 行動を増やしても玉由来3（28e9）で頭打ち
  econ.noteGain(1000000000);
  econ.onGrant(0, 70, undefined, 0, 0);
  const cap = econ.onClose(0);
  expect(cap.ok && cap.gain).toBe(1);
  expect(econ.getRegular()).toBe(3);
  const buy = econ.onBuy('windmill', 1, 1000, 0);
  expect(buy.ok).toBe(true);
  expect(econ.getPerSec(true, 1000)).toBe(econ.basePerSec() * 4);
});

test('発射単価は rate×ref×shotS（切り捨て・最低 rate）・役物なしは下限1/秒（D-090）', () => {
  const econ = loadEconomy();
  // 役物なしは下限 1/秒
  expect(econ.getRefPerSec()).toBe(1);
  expect(econ.getShotS()).toBe(8);
  expect(econ.getShotUnit(1)).toBe(8);
  expect(econ.shotUnitUnchecked(2)).toBe(16);
  econ.onBuy('windmill', 10, 100000, 0);
  const ref = econ.getRefPerSec();
  expect(ref).toBeGreaterThan(1);
  expect(econ.getShotUnit(1)).toBe(Math.floor(ref * 8));
  expect(econ.getShotUnit(4)).toBe(Math.floor(4 * ref * 8));
  expect(econ.isRateAllowed(3)).toBe(false);
  expect(econ.isRateAllowed(100)).toBe(false);
  expect(econ.getShotUnit(3)).toBe(Math.floor(3 * ref * 8));
  // 予告フィーバーは生産に掛かるが基準生産には掛からない
  const base = econ.getPerSec(true, 1000);
  econ.onNoticeFever();
  expect(econ.getPerSec(true, 1000)).toBe(base * 7);
  expect(econ.getRefPerSec()).toBe(ref);
  // 旧版 snapshot（v3・jackpotFeverMultあり）から restore しても落ちない
  const v3: Record<string, unknown> = {
    ...(econ.snapshot() as unknown as Record<string, unknown>),
    v: 3,
    jackpotFeverMult: 4.5,
  };
  const old = loadEconomy();
  old.restore(v3);
  expect(old.getRefPerSec()).toBe(ref);
  expect(old.snapshot().v).toBe(7);
  expect('jackpotFeverMult' in (old.snapshot() as unknown as Record<string, unknown>)).toBe(false);
  // 旧版 snapshot（v2）は累計獲得メダル0で読む
  const v2: Record<string, unknown> = { ...(econ.snapshot() as unknown as Record<string, unknown>), v: 2 };
  delete v2['medalsEarned'];
  const old2 = loadEconomy();
  old2.restore(v2);
  expect(old2.getMedalsEarned()).toBe(0);
  // v4 の旧レート段（1,4,10,40,100,400,1000）を新表に移行（400・1000→100, D-090）
  const v4: Record<string, unknown> = { ...(econ.snapshot() as unknown as Record<string, unknown>), v: 4, rateStage: 5 };
  const migrated = loadEconomy();
  migrated.restore(v4);
  expect(migrated.getUnlockedRates()).toEqual([1, 2, 4, 10, 20, 40, 100]);
});

test('連日は同日維持・翌日+1・空きリセット・不正無視', () => {
  const econ = loadEconomy();
  econ.onGrant(0, 0, '2026-09-24', 0, 0);
  expect(econ.getStreakDays()).toBe(1);
  econ.onGrant(0, 0, '2026-09-24', 0, 0);
  expect(econ.getStreakDays()).toBe(1);
  econ.onGrant(0, 0, '2026-09-25', 0, 0);
  expect(econ.getStreakDays()).toBe(2);
  econ.onGrant(0, 0, '2026-09-27', 0, 0);
  expect(econ.getStreakDays()).toBe(1);
  econ.onGrant(0, 0, 'not-a-day', 0, 0);
  expect(econ.getStreakDays()).toBe(1);
  econ.onGrant(0, 0, '2026-02-28', 0, 0);
  expect(econ.getStreakDays()).toBe(1);
  const leap = loadEconomy();
  leap.onGrant(0, 0, '2024-02-28', 0, 0);
  leap.onGrant(0, 0, '2024-02-29', 0, 0);
  leap.onGrant(0, 0, '2024-03-01', 0, 0);
  expect(leap.getStreakDays()).toBe(3);
});

test('決定論: 1回vs1秒刻み・snapshot/restoreが経済込みで一致', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const mk = (): Engine =>
    new Engine(
      { seed: 99, spec, patterns, atlas, initialBalls: 20000, initialMedals: 5, economy: loadEconomy() },
      [{ claimId: 'g', at: 5000, fuelMs: 60000, medals: 1 }],
      [
        { t: 0, k: 'buy', target: 'windmill', count: 10 },
        { t: 0, k: 'presence', fg: false },
        { t: 120000, k: 'presence', fg: true },
      ],
    );
  const until = 600000;
  const a = mk();
  const once = a.advance(until);
  const snapOnce = a.snapshot();
  const b = mk();
  const parts: SimEvent[] = [];
  for (let t = 1000; t <= until; t = t + 1000) {
    const step = b.advance(t);
    for (let i = 0; i < step.length; i = i + 1) {
      parts.push(step[i] as SimEvent);
    }
  }
  expect(parts).toEqual(once);
  expect(b.snapshot()).toEqual(snapOnce);
  const mid = 300000;
  const through = mk();
  through.advance(mid);
  const snap = through.snapshot();
  const tailThrough = through.advance(until);
  const resumed = Engine.restore(snap, {
    seed: 99,
    spec,
    patterns,
    atlas,
    economy: loadEconomy(),
  });
  expect(resumed.advance(until)).toEqual(tailThrough);
});

test('強化画面の表示は onBuy・onAwaken・onClose の価格と条件に一致する（P5-T4）', () => {
  const econ = loadEconomy();
  const s0 = econ.getShopView();
  const w0 = s0.yakumono[0]!;
  expect(w0.locked).toBe(false);
  expect(s0.yakumono[1]!.locked).toBe(true);
  expect(w0.perSec).toBe(0);
  // ×10 の表示価格ちょうどで買え、1玉足りなければ買えない
  const p10 = w0.prices[1]!;
  expect(econ.onBuy('windmill', 10, p10 - 1, 0).ok).toBe(false);
  const bought = econ.onBuy('windmill', 10, p10, 0);
  expect(bought.ok && bought.balls).toBe(0);
  const s1 = econ.getShopView();
  expect(s1.yakumono[0]!.lv).toBe(10);
  expect(s1.yakumono[1]!.locked).toBe(false);
  expect(relErr(s1.yakumono[0]!.perSec, (1 * 10) / 2)).toBeLessThan(1e-12);
  expect(s1.yakumono[0]!.awakenReady).toBe(false);
  expect(s1.yakumono[0]!.awakenCost).toBe(5);
  // 強化: 段・次の価格・効果、最大で cost=null
  const idle = s1.upgrades.find((u) => u.id === 'idle')!;
  expect(idle).toEqual({ id: 'idle', stage: 0, stages: 5, currency: 'balls', cost: 1000, value: 0.5, next: 0.6 });
  expect(econ.onBuy('auto', 1, 50000, 0).ok).toBe(true);
  const auto = econ.getShopView().upgrades.find((u) => u.id === 'auto')!;
  expect(auto.cost).toBeNull();
  expect(auto.next).toBeNull();
  expect(auto.value).toBe(1);
  const rate = econ.getShopView().upgrades.find((u) => u.id === 'rate')!;
  expect(rate.currency).toBe('medals');
  expect(rate.value).toBe(1);
  expect(rate.next).toBe(2);
  // 閉店: 行動なしは玉由来があっても獲得0
  econ.noteGain(8000000000);
  const c0 = econ.getShopView().close;
  expect(c0.ready).toBe(true);
  expect(c0.byBalls).toBe(2);
  expect(c0.byMedals).toBe(0);
  expect(c0.gain).toBe(0);
  // 表示用: これまでの累計玉・次の +1 の境目（divisor 1e9・medals_per_point 7）
  expect(c0.totalTotal).toBe(8000000000);
  expect(c0.nextBallsAt).toBe(27000000000);
  expect(c0.nextMedalsAt).toBe(7);
  econ.onGrant(0, 14, undefined, 0, 0);
  const c1 = econ.getShopView().close;
  expect(c1.gain).toBe(2);
  expect(c1.nextMedalsAt).toBe((c1.byMedals + 1) * 7);
  const closed = econ.onClose(0);
  expect(closed.ok && closed.gain).toBe(c1.gain);
  expect(econ.getShopView().regular).toBe(2);
});

test('閉店の次の +1: 玉由来 0 の時は divisor ちょうど（P11-T2）', () => {
  const econ = loadEconomy();
  const c = econ.getShopView().close;
  expect(c.byBalls).toBe(0);
  expect(c.totalTotal).toBe(0);
  expect(c.nextBallsAt).toBe(1000000000);
  econ.noteGain(999999999);
  expect(econ.getShopView().close.byBalls).toBe(0);
  econ.noteGain(1);
  const c1 = econ.getShopView().close;
  expect(c1.byBalls).toBe(1);
  expect(c1.nextBallsAt).toBe(8000000000);
});

test('Projection に強化画面の表示とオート打ちの状態が載る', () => {
  const { spec, patterns } = loadMachine();
  const eng = new Engine(
    { seed: 3, spec, patterns, atlas: loadAtlas(), initialBalls: 1000, initialMedals: 0, economy: loadEconomy() },
    [],
    [{ t: 0, k: 'buy', target: 'windmill', count: 1 }],
  );
  eng.advance(1000);
  const p = eng.project();
  expect(p.shop?.yakumono[0]?.lv).toBe(1);
  expect(p.auto).toEqual({ share: 0, rate: 1 });
});

test('統計: 初当たりは RUSH 外の大当たり・最大連チャンは snapshot に残る（P5-T4）', () => {
  const spec = parseMachineText(readFileSync('../../resources/machines/rush-middle-01.json', 'utf8'));
  const patterns = parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
  const eng = new Engine(
    { seed: 7, spec, patterns, atlas: loadAtlas(), initialBalls: 10000000, initialMedals: 0 },
    [],
    [{ t: 0, k: 'shoot', on: true, rate: 1 }],
  );
  eng.advance(6 * H);
  const t = eng.project().totals;
  expect(t.jackpots).toBeGreaterThan(0);
  expect(t.firstHits).toBeGreaterThan(0);
  expect(t.firstHits).toBeLessThanOrEqual(t.jackpots);
  expect(t.maxChain).toBeGreaterThanOrEqual(0);
  const again = Engine.restore(eng.snapshot(), { seed: 7, spec, patterns, atlas: loadAtlas(), initialBalls: 10000000, initialMedals: 0 });
  expect(again.project().totals).toEqual(t);
});

test('閉店の記録は Projection と snapshot に残る（P5-T4）', () => {
  const { spec, patterns } = loadMachine();
  const econ = loadEconomy();
  // 今回の累計玉を閉店条件まで先に積んでおく
  econ.noteGain(1000000000);
  const cfg = { seed: 5, spec, patterns, atlas: loadAtlas(), initialBalls: 100, initialMedals: 0 };
  const eng = new Engine({ ...cfg, economy: econ }, [{ claimId: 'm', at: 0, fuelMs: 0, medals: 7 }], [{ t: 1000, k: 'close' }]);
  const evs = eng.advance(2000);
  expect(evs.filter((e) => e.k === 'closed').length).toBe(1);
  const closes = eng.project().closes;
  expect(closes).toEqual([{ at: 1000, runTotal: 1000000000, gain: 1 }]);
  expect(Engine.restore(eng.snapshot(), { ...cfg, economy: loadEconomy() }).project().closes).toEqual(closes);
});

test('持ち玉と累計は double の最大値で止まり、セーブの復元と JSON 書き出しが壊れない', () => {
  const { spec, patterns } = loadMachine();
  const econ = loadEconomy();
  econ.noteGain(Number.MAX_VALUE);
  econ.noteGain(Number.MAX_VALUE);
  expect(econ.getRunTotal()).toBe(Number.MAX_VALUE);
  expect(econ.getTotalTotal()).toBe(Number.MAX_VALUE);
  const eng = new Engine(
    { seed: 5, spec, patterns, atlas: loadAtlas(), initialBalls: Number.MAX_VALUE, initialMedals: 0, economy: econ },
    [{ claimId: 'fuel12h', at: 0, fuelMs: H12, medals: 0 }],
    [{ t: 0, k: 'buy', target: 'windmill', count: 100 }],
  );
  eng.advance(H);
  const p = eng.project();
  expect(p.balls).toBe(Number.MAX_VALUE);
  expect(p.perSec).toBeGreaterThan(0);
  const snap = JSON.parse(JSON.stringify(eng.snapshot())) as EngineSnapshot;
  expect(snap.balls).toBe(Number.MAX_VALUE);
  const back = Engine.restore(snap, { seed: 5, spec, patterns, atlas: loadAtlas(), economy: loadEconomy() });
  expect(back.project().balls).toBe(Number.MAX_VALUE);
});
