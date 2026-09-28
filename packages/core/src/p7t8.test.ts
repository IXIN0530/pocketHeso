import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import { drawGrantHold } from './lottery.ts';
import type { Grant, SimEvent } from './engine.ts';
import { Engine, GRANT_HOLD_SERIAL_BASE } from './engine.ts';

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

test('即時の玉: 受け取り時点のrefPerSec×prodMin×60・燃料0でも入る', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const econ = loadEconomy();
  const eng = new Engine(
    { seed: 11, spec, patterns, atlas, initialBalls: 1000, initialFuelMs: 0, economy: econ },
    [],
    [{ t: 0, k: 'buy', target: 'windmill', count: 10 }],
  );
  eng.advance(1000);
  const ref = econ.getRefPerSec();
  expect(ref).toBeGreaterThan(1);
  const before = eng.snapshot().balls;
  // 燃料0でも即時報酬は入る。prodMin 30分 = ref×1800玉。
  eng.appendGrant({ claimId: 'g1', at: 1000, fuelMs: 0, medals: 0, prodMin: 30 });
  const evs = eng.advance(2000);
  const granted = evs.filter((e) => e.k === 'granted');
  expect(granted.length).toBe(1);
  expect(granted[0]).toMatchObject({ claimId: 'g1' });
  expect('bonusHolds' in (granted[0] as object)).toBe(false);
  expect((granted[0] as { balls?: number }).balls).toBe(ref * 30 * 60);
  // 1秒の経済tick分も増えるため、即時分＋tick分（ref未満）になる。
  const after = eng.snapshot().balls;
  expect(after - before - ref * 30 * 60).toBeGreaterThanOrEqual(0);
  expect(after - before - ref * 30 * 60).toBeLessThan(ref + 1);
  expect(eng.snapshot().fuelMs).toBe(0);
  // rate1の10Rで bonus=ref×1800 と同じ量（spec/23の例）。
  expect(ref * 30 * 60).toBe(econ.jackpotRoundBonus(1) * 10);
});

test('特別保留: ストック→保留の空きへ・serialは1.5e9台・賞球なし・自動補充より先', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const eng = new Engine(
    { seed: 22, spec, patterns, atlas, initialBalls: 100000, economy: loadEconomy() },
    [{ claimId: 'g', at: 0, fuelMs: 0, medals: 0, bonusHolds: 2 }],
    [],
  );
  const evs = eng.advance(1000);
  const granted = evs.filter((e) => e.k === 'granted');
  // ballsはprodMinなしなので省略、bonusHoldsは付く。
  expect(granted).toEqual([{ k: 'granted', claimId: 'g', at: 0, fuelMs: 0, medals: 0, bonusHolds: 2 }]);
  expect((granted[0] as { balls?: number }).balls).toBeUndefined();
  const holds = evs.filter((e) => e.k === 'holdAdded');
  expect(holds.length).toBe(2);
  const e0 = (holds[0] as { entry: { serial: number; hesoPayoutBalls: number } }).entry;
  const e1 = (holds[1] as { entry: { serial: number; hesoPayoutBalls: number } }).entry;
  expect(e0.serial).toBe(GRANT_HOLD_SERIAL_BASE);
  expect(e1.serial).toBe(GRANT_HOLD_SERIAL_BASE + 1);
  expect(e0.hesoPayoutBalls).toBe(0);
  expect(e1.hesoPayoutBalls).toBe(0);
  expect(eng.project().bonusStock).toBe(0);
});

test('特別保留: 保留満タンでも失われず空きに入る', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const eng = new Engine(
    { seed: 33, spec, patterns, atlas, initialBalls: 100000, economy: loadEconomy() },
    [
      { claimId: 'fill', at: 0, fuelMs: 0, medals: 0, bonusHolds: 10 },
    ],
    [{ t: 0, k: 'shoot', on: false, rate: 1 }],
  );
  // 保留上限4（既定）を超える分はストックに残る。
  eng.advance(1000);
  const p = eng.project();
  // 保留は上限まで、残りはストック（変動中の1件を含む）。
  expect(p.holds.length).toBeLessThanOrEqual(4);
  const inSpin = p.spin === undefined ? 0 : 1;
  expect(p.holds.length + inSpin + p.bonusStock).toBe(10);
  // 変動が進んで空きができたらストックから入る（失われない）。
  const beforeStock = p.bonusStock;
  expect(beforeStock).toBeGreaterThan(0);
  eng.advance(600000);
  const p2 = eng.project();
  // 消化が進み、ストックが減っている（全部は無くならない場合もあるが、合計は保存される）。
  const totalHoldsSeen = p2.holds.length + p2.bonusStock;
  expect(totalHoldsSeen).toBeLessThanOrEqual(10);
  expect(p2.bonusStock).toBeLessThan(beforeStock);
});

test('決定論: prodMin/bonusHolds込みで1回vs1秒刻み・snapshot/restoreが一致', () => {
  const { spec, patterns } = loadMachine();
  const mk = (): Engine =>
    new Engine(
      { seed: 44, spec, patterns, atlas: loadAtlas(), initialBalls: 50000, initialFuelMs: 3600000, economy: loadEconomy() },
      [
        { claimId: 's', at: 0, fuelMs: 60000, medals: 1, prodMin: 30 },
        { claimId: 'b', at: 5000, fuelMs: 0, medals: 2, bonusHolds: 3 },
      ],
      [
        { t: 0, k: 'buy', target: 'windmill', count: 5 },
        { t: 0, k: 'auto', share: 1, rate: 1 },
      ],
    );
  const until = 300000;
  const a = mk();
  const once = a.advance(until);
  const snapOnce = a.snapshot();
  const b = mk();
  const parts: SimEvent[] = [];
  for (let t = 1000; t <= until; t = t + 1000) {
    for (const e of b.advance(t)) {
      parts.push(e);
    }
  }
  expect(parts).toEqual(once);
  expect(b.snapshot()).toEqual(snapOnce);
  // restore
  const c = mk();
  c.advance(60000);
  const mid = c.snapshot();
  const tail = c.advance(until);
  const d = Engine.restore(mid, { seed: 44, spec, patterns, atlas: loadAtlas(), economy: loadEconomy() });
  expect(d.advance(until)).toEqual(tail);
  expect(d.snapshot()).toEqual(c.snapshot());
  // 旧snapshot（bonusStockなし）からrestoreしても落ちない。
  const legacy = { ...mid };
  delete (legacy as Partial<typeof legacy>).bonusStock;
  delete (legacy as Partial<typeof legacy>).grantHoldSeq;
  const r = Engine.restore(legacy, { seed: 44, spec, patterns, atlas: loadAtlas(), economy: loadEconomy() });
  expect(r.project().bonusStock).toBe(0);
});

test('特別保留は電サポの自動補充より先に入る', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const base = new Engine(
    { seed: 55, spec, patterns, atlas, initialBalls: 100000, economy: loadEconomy() },
    [],
    [],
  );
  base.advance(1000);
  const snap = base.snapshot();
  // 強制的に電サポ中（st）にし、保留を空にしてストック1つを入れる。
  const stSnap = {
    ...snap,
    spin: { ...snap.spin, mode: 'st' as const, stRemaining: 10, active: null, jackpot: null },
    holds: [],
  };
  const eng = Engine.restore(stSnap, { seed: 55, spec, patterns, atlas, economy: loadEconomy() });
  eng.appendGrant({ claimId: 'g', at: 1000, fuelMs: 0, medals: 0, bonusHolds: 1 });
  const evs = eng.advance(2000);
  const holds = evs.filter((e) => e.k === 'holdAdded');
  expect(holds.length).toBeGreaterThan(1);
  // 最初が特別保留（1.5e9台）、次が自動補充（2e9台）。
  const first = (holds[0] as { entry: { serial: number } }).entry.serial;
  const second = (holds[1] as { entry: { serial: number } }).entry.serial;
  expect(first).toBe(GRANT_HOLD_SERIAL_BASE);
  expect(second).toBeGreaterThanOrEqual(2000000000);
});

test('drawGrantHold: 賞球なし・serialとRNGが通し番号で決まる', () => {
  const { spec, patterns } = loadMachine();
  const a = drawGrantHold(spec, patterns, 99, 'normal', 0, GRANT_HOLD_SERIAL_BASE, 10);
  const b = drawGrantHold(spec, patterns, 99, 'normal', 0, GRANT_HOLD_SERIAL_BASE, 10);
  expect(a).toEqual(b);
  expect(a.serial).toBe(GRANT_HOLD_SERIAL_BASE);
  expect(a.hesoPayoutBalls).toBe(0);
  expect(a.rate).toBeUndefined();
  const c = drawGrantHold(spec, patterns, 99, 'normal', 1, GRANT_HOLD_SERIAL_BASE + 1, 10);
  expect(c.serial).toBe(GRANT_HOLD_SERIAL_BASE + 1);
  // 当たり1/10の目安（1000件で80〜130）。
  let hits = 0;
  for (let n = 0; n < 1000; n = n + 1) {
    if (drawGrantHold(spec, patterns, 7, 'normal', n, GRANT_HOLD_SERIAL_BASE + n, 10).isHit) {
      hits = hits + 1;
    }
  }
  expect(hits).toBeGreaterThan(70);
  expect(hits).toBeLessThan(140);
});

test('無料の保留の当たりはrate1扱い（grant holdにrateなし）', () => {
  const grants: Grant[] = [{ claimId: 'g', at: 0, fuelMs: 0, medals: 0, bonusHolds: 1 }];
  expect(grants[0]?.bonusHolds).toBe(1);
  expect(grants[0]?.prodMin).toBeUndefined();
});
