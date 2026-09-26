import { readdirSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { atlasKeyForBall, decodeAtlasEntry } from './atlas.ts';
import type { Action, Grant, SimEvent } from './engine.ts';
import { Engine } from './engine.ts';
import type { EconomyPort } from './economy.ts';

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

function makeEngine(
  seed: number,
  atlas: ArrayBuffer,
  spec: MachineSpec,
  patterns: PatternTable,
  actions: readonly Action[],
  grants: readonly Grant[],
  initialBalls: number,
): Engine {
  return new Engine({ seed, spec, patterns, atlas, initialBalls }, grants, actions);
}

function orderIndex(e: SimEvent): number {
  if (e.k === 'granted' || e.k === 'rejected') {
    return 0;
  }
  if (e.k === 'fired') {
    return 1;
  }
  if (e.k === 'sensor') {
    return 2;
  }
  if (e.k === 'holdAdded' || e.k === 'holdOverflow') {
    return 3;
  }
  if (e.k === 'spinResolved') {
    return 4;
  }
  if (e.k === 'jackpotStarted' || e.k === 'jackpotEnded') {
    return 5;
  }
  if (e.k === 'spinStarted') {
    return 6;
  }
  return 7;
}

function expectTimeOrdered(events: readonly SimEvent[]): void {
  for (let i = 1; i < events.length; i = i + 1) {
    const prev = events[i - 1] as SimEvent;
    const cur = events[i] as SimEvent;
    expect(cur.at).toBeGreaterThanOrEqual(prev.at);
    if (cur.at === prev.at) {
      expect(orderIndex(cur)).toBeGreaterThanOrEqual(orderIndex(prev));
    }
  }
}

function sensorKindOf(atlasKind: string): 'start1' | 'out' | 'lost' {
  if (atlasKind === 'start1') {
    return 'start1';
  }
  if (atlasKind === 'lost') {
    return 'lost';
  }
  return 'out';
}

test('発射は600ms絶対倍数・Atlas参照でセンサー時刻が決まる（advanceは半開区間）', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const seed = 42;
  const eng = makeEngine(seed, atlas, spec, patterns, [{ t: 0, k: 'shoot', on: true, rate: 1 }], [], 100000);
  const evs = eng.advance(1800);
  const fired = evs.filter((e) => e.k === 'fired');
  expect(fired).toEqual([
    { k: 'fired', ball: 0, at: 0, rate: 1 },
    { k: 'fired', ball: 1, at: 600, rate: 1 },
    { k: 'fired', ball: 2, at: 1200, rate: 1 },
  ]);
  // 投影に打つの状態と解放済みレート（経済なしは [1]）が出る。
  expect(eng.project().shoot).toEqual({ on: true, rate: 1 });
  expect(eng.project().rates).toEqual([1]);
  const later = eng.advance(90000);
  const all = [...evs, ...later];
  expectTimeOrdered(all);
  for (let b = 0; b < 3; b = b + 1) {
    const fireAt = 600 * b;
    const key = atlasKeyForBall(seed, b);
    const entry = decodeAtlasEntry(atlas, key);
    const wantKind = sensorKindOf(entry.kind);
    const wantAt = fireAt + entry.flightMs;
    let foundFire = false;
    let foundSensor = false;
    for (let i = 0; i < all.length; i = i + 1) {
      const e = all[i] as SimEvent;
      if (e.k === 'fired' && e.ball === b) {
        expect(e.at).toBe(fireAt);
        foundFire = true;
      }
      if (e.k === 'sensor' && e.ball === b) {
        expect(e.at).toBe(wantAt);
        expect(e.kind).toBe(wantKind);
        foundSensor = true;
      }
    }
    expect(foundFire).toBe(true);
    expect(foundSensor).toBe(true);
  }
});

test('背面では手動がoff扱い・autoは毎グリッド・前面はshoot優先・share間引き', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const back = makeEngine(
    1,
    atlas,
    spec,
    patterns,
    [
      { t: 0, k: 'shoot', on: true, rate: 1 },
      { t: 0, k: 'presence', fg: false },
    ],
    [],
    100000,
  );
  expect(back.advance(1800).filter((e) => e.k === 'fired').length).toBe(0);
  const autoBack = makeEngine(1, atlas, spec, patterns, [{ t: 0, k: 'auto', share: 1, rate: 2 }], [], 100000);
  const autoFired = autoBack.advance(1800).filter((e) => e.k === 'fired');
  expect(autoFired.length).toBe(3);
  expect(autoFired[0]).toEqual({ k: 'fired', ball: 0, at: 0, rate: 2 });
  const front = makeEngine(
    1,
    atlas,
    spec,
    patterns,
    [
      { t: 0, k: 'shoot', on: true, rate: 5 },
      { t: 0, k: 'auto', share: 1, rate: 2 },
    ],
    [],
    100000,
  );
  const frontFired = front.advance(1200).filter((e) => e.k === 'fired');
  expect(frontFired).toEqual([
    { k: 'fired', ball: 0, at: 0, rate: 5 },
    { k: 'fired', ball: 1, at: 600, rate: 5 },
  ]);
  const half = makeEngine(1, atlas, spec, patterns, [{ t: 0, k: 'auto', share: 0.5, rate: 1 }], [], 100000);
  expect(half.advance(2400).filter((e) => e.k === 'fired').length).toBe(2);
});

test('grantは加算・未実装Actionはrejected・過去/逆順の追加は拒否', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const eng = makeEngine(
    9,
    atlas,
    spec,
    patterns,
    [
      { t: 1000, k: 'buy', target: 'x', count: 1 },
      { t: 1000, k: 'shoot', on: true, rate: 1 },
    ],
    [{ claimId: 'c1', at: 1000, fuelMs: 60000, medals: 3 }],
    0,
  );
  const evs = eng.advance(2000);
  const granted = evs.filter((e) => e.k === 'granted');
  expect(granted).toEqual([{ k: 'granted', claimId: 'c1', at: 1000, fuelMs: 60000, medals: 3 }]);
  const rejected = evs.filter((e) => e.k === 'rejected');
  expect(rejected).toEqual([{ k: 'rejected', at: 1000, action: 'buy', reason: 'not-implemented' }]);
  expect(eng.project().fuelMs).toBe(60000);
  expect(eng.project().medals).toBe(3);
  expect(() => eng.appendAction({ t: 500, k: 'shoot', on: true, rate: 1 })).toThrow();
  expect(() => eng.appendGrant({ claimId: 'c2', at: 500, fuelMs: 0, medals: 0 })).toThrow();
  expect(() => eng.advance(1000)).toThrow();
  const eng2 = makeEngine(9, atlas, spec, patterns, [{ t: 2000, k: 'shoot', on: true, rate: 1 }], [], 0);
  expect(() => eng2.appendAction({ t: 1000, k: 'shoot', on: true, rate: 1 })).toThrow();
});

test('決定論契約1: 1回vs1秒刻みN回でイベント列と最終状態が一致', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const seed = 123;
  const actions: Action[] = [
    { t: 0, k: 'auto', share: 1, rate: 1 },
    { t: 120000, k: 'presence', fg: false },
  ];
  const grants: Grant[] = [{ claimId: 'g1', at: 5000, fuelMs: 1000, medals: 1 }];
  const until = 600000;
  const a = makeEngine(seed, atlas, spec, patterns, actions, grants, 50000);
  const once = a.advance(until);
  const snapOnce = a.snapshot();
  const b = makeEngine(seed, atlas, spec, patterns, actions, grants, 50000);
  const parts: SimEvent[] = [];
  for (let t = 1000; t <= until; t = t + 1000) {
    const step = b.advance(t);
    for (let i = 0; i < step.length; i = i + 1) {
      parts.push(step[i] as SimEvent);
    }
  }
  expect(parts).toEqual(once);
  expect(b.snapshot()).toEqual(snapOnce);
  expectTimeOrdered(once);
});

test('決定論契約2: snapshot→restore→続行が通しと一致', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const seed = 777;
  const actions: Action[] = [{ t: 0, k: 'auto', share: 1, rate: 1 }];
  const mid = 300000;
  const until = 600000;
  const through = makeEngine(seed, atlas, spec, patterns, actions, [], 50000);
  through.advance(mid);
  const snap = through.snapshot();
  const tailThrough = through.advance(until);
  const snapThrough = through.snapshot();
  const resumed = Engine.restore(snap, { seed, spec, patterns, atlas });
  const tailResumed = resumed.advance(until);
  expect(tailResumed).toEqual(tailThrough);
  expect(resumed.snapshot()).toEqual(snapThrough);
});

test('advance(T)後にt===Tで追加した入力・付与は最初から渡した通しと一致', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const seed = 31;
  const start: Action[] = [{ t: 0, k: 'shoot', on: true, rate: 1 }];
  const late: Action = { t: 1200, k: 'shoot', on: false, rate: 1 };
  const lateGrant: Grant = { claimId: 'g1', at: 1200, fuelMs: 1000, medals: 1 };
  const through = makeEngine(seed, atlas, spec, patterns, [...start, late], [lateGrant], 1000);
  const once = through.advance(90000);
  const split = makeEngine(seed, atlas, spec, patterns, start, [], 1000);
  const head = split.advance(1200);
  split.appendAction(late);
  split.appendGrant(lateGrant);
  const tail = split.advance(90000);
  expect([...head, ...tail]).toEqual(once);
  expect(split.snapshot()).toEqual(through.snapshot());
  expect(once.filter((e) => e.k === 'fired').map((e) => e.at)).toEqual([0, 600]);
});

test('startMs: 実時刻起点でも0起点と同じ進み方（発射・経済の刻みが揃う倍数）・起点前の入力は拒否', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const T = 6000 * 298333333;
  const base = new Engine({ seed: 5, spec, patterns, atlas, initialBalls: 50000 }, [{ claimId: 'g', at: 3000, fuelMs: 60000, medals: 1 }], [
    { t: 0, k: 'auto', share: 1, rate: 1 },
  ]);
  const late = new Engine({ seed: 5, spec, patterns, atlas, initialBalls: 50000, startMs: T }, [{ claimId: 'g', at: T + 3000, fuelMs: 60000, medals: 1 }], [
    { t: T, k: 'auto', share: 1, rate: 1 },
  ]);
  expect(late.nowMs).toBe(T);
  const a = base.advance(300000);
  const b = late.advance(T + 300000);
  expect(b.map((e) => e.k)).toEqual(a.map((e) => e.k));
  expect(b.filter((e) => e.k === 'fired').map((e) => e.at - T)).toEqual(a.filter((e) => e.k === 'fired').map((e) => e.at));
  const sa = base.snapshot();
  const sb = late.snapshot();
  expect([sb.balls, sb.medals, sb.fuelMs, sb.totals]).toEqual([sa.balls, sa.medals, sa.fuelMs, sa.totals]);
  expect(() => new Engine({ seed: 5, spec, patterns, atlas, startMs: T }, [{ claimId: 'x', at: T - 1, fuelMs: 0, medals: 0 }], [])).toThrow();
});

/** 状態（呼び出し回数）を持つテスト用経済。 */
class CountingEconomy implements EconomyPort {
  count = 0;
  snapshot(): unknown {
    return { count: this.count };
  }
  restore(s: unknown): void {
    this.count = (s as { count: number }).count;
  }
  fork(): EconomyPort {
    const e = new CountingEconomy();
    e.count = this.count;
    return e;
  }
}

test('restoreはcfg.economyを使いsnap.economyを入れる・lookaheadは本体の経済を共有しない', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const economy = new CountingEconomy();
  economy.count = 7;
  const eng = new Engine({ seed: 3, spec, patterns, atlas, economy }, [], [{ t: 0, k: 'auto', share: 1, rate: 1 }]);
  eng.advance(6000);
  const snap = eng.snapshot();
  expect(snap.economy).toEqual({ count: 7 });
  const fresh = new CountingEconomy();
  const back = Engine.restore(snap, { seed: 3, spec, patterns, atlas, economy: fresh });
  expect(fresh.count).toBe(7);
  expect(back.snapshot()).toEqual(snap);
  let forked: EconomyPort | null = null;
  const origFork = economy.fork.bind(economy);
  economy.fork = (): EconomyPort => {
    forked = origFork();
    return forked;
  };
  eng.lookahead(12000);
  expect(forked).not.toBeNull();
  expect(forked).not.toBe(economy);
  expect(eng.snapshot()).toEqual(snap);
});

test('lookaheadは状態を変えず背面仮定・projectはパチンコ部を返す', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const eng = makeEngine(55, atlas, spec, patterns, [{ t: 0, k: 'shoot', on: true, rate: 1 }], [], 100000);
  eng.advance(60000);
  const before = eng.snapshot();
  const seen = eng.lookahead(66000);
  expect(eng.snapshot()).toEqual(before);
  expect(seen.filter((e) => e.k === 'fired').length).toBe(0);
  const proj = eng.project();
  expect(proj.at).toBe(eng.nowMs);
  expect(proj.balls).toBe(before.balls);
  expect(proj.totals).toEqual(before.totals);
  expect(proj.boostMs).toBe(0);
  expect(proj.perSec).toBe(0);
  expect(proj.yakumono).toEqual([]);
  const auto = makeEngine(55, atlas, spec, patterns, [{ t: 0, k: 'auto', share: 1, rate: 1 }], [], 100000);
  auto.advance(60000);
  const ahead = auto.lookahead(120000);
  expectTimeOrdered(ahead);
  expect(ahead.length).toBeGreaterThan(0);
});

test('inFlightは飛行中の玉の写しで、発射イベントと入賞先がセンサーイベントと一致する', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const eng = makeEngine(77, atlas, spec, patterns, [{ t: 0, k: 'shoot', on: true, rate: 1 }], [], 100000);
  const fired = eng.advance(30000).filter((e) => e.k === 'fired');
  const flying = eng.inFlight();
  expect(flying.length).toBeGreaterThan(0);
  for (let i = 0; i < flying.length; i = i + 1) {
    const p = flying[i];
    expect(p !== undefined && p.sensorAt >= eng.nowMs && fired.some((e) => e.ball === p.ball && e.at === p.fireAt)).toBe(true);
  }
  // 写しなので書き換えても本体は変わらない。
  const before = eng.snapshot();
  flying.length = 0;
  expect(eng.snapshot()).toEqual(before);
  const sensors = eng.advance(60000).filter((e) => e.k === 'sensor');
  for (let i = 0; i < before.pending.length; i = i + 1) {
    const p = before.pending[i];
    const s = sensors.find((e) => p !== undefined && e.ball === p.ball);
    expect(s !== undefined && p !== undefined && s.at === p.sensorAt && s.kind === p.kind).toBe(true);
  }
});

// CI（Vercel 等）は共有マシンで並列実行されるため計時がぶれる。目標 100ms はローカルで判定し、
// CI では桁違いの退行だけを検出する。並列負荷の spikes を避けるためウォームアップ＋5回中の最小で判定する。
const ADVANCE_8H_LIMIT_MS = process.env['CI'] || process.env['VERCEL'] ? 1000 : 100;

test(
  '放置8時間のオート打ちadvanceがNodeで100ms以内（CIは1000ms）',
  { timeout: 60000 },
  () => {
    const { spec, patterns } = loadMachine();
    const atlas = loadAtlas();
    const mk = (): Engine =>
      makeEngine(20260925, atlas, spec, patterns, [{ t: 0, k: 'auto', share: 1, rate: 1 }], [], 100000);
    mk().advance(3600000);
    const until = 8 * 60 * 60 * 1000;
    let best = Number.POSITIVE_INFINITY;
    let count = 0;
    let first: SimEvent[] = [];
    for (let i = 0; i < 5 && best >= ADVANCE_8H_LIMIT_MS; i = i + 1) {
      const eng = mk();
      const t0 = performance.now();
      const evs = eng.advance(until);
      const ms = performance.now() - t0;
      count = evs.length;
      if (i === 0) {
        first = evs;
      }
      if (ms < best) {
        best = ms;
      }
    }
    expect(count).toBeGreaterThan(40000);
    expect(best).toBeLessThan(ADVANCE_8H_LIMIT_MS);
    expectTimeOrdered(first.slice(0, 2000));
  },
);
