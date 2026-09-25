import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import type { Action, Grant, SimEvent } from './engine.ts';
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

function loadEconomy(): IdleEconomy {
  const json = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as unknown;
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
  const r1 = econ.onBuy('idle', 1, 1000000000, 0);
  expect(r1.ok).toBe(true);
  const r2 = econ.onBuy('rate', 1, 0, 10);
  expect(r2.ok).toBe(true);
  const fuelBefore = 5000;
  void fuelBefore;
  const done = econ.onClose(12345);
  expect(done.ok).toBe(true);
  if (done.ok) {
    expect(done.gain).toBe(1);
    expect(done.balls).toBe(0);
  }
  expect(econ.getRegular()).toBe(1);
  expect(econ.getRunTotal()).toBe(0);
  expect(econ.getTotalTotal()).toBe(1000000000);
  const views = econ.getYakumonoViews();
  expect((views[0] as { lv: number }).lv).toBe(0);
  expect(econ.idleValue()).toBe(0.5);
  const buyRate2 = econ.onBuy('rate', 1, 0, 8);
  expect(buyRate2.ok).toBe(true);
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
