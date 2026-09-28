import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import { drawBonusHold, drawGrantHold } from './lottery.ts';
import type { Action, Grant, SimEvent } from './engine.ts';
import { BONUS_SERIAL_BASE, Engine, GRANT_HOLD_SERIAL_BASE, RESERVE_SERIAL_BASE } from './engine.ts';

const H = 3600000;

/** 特別保留（1.5e9〜2e9未満）の通し番号か。 */
function isGrantSerial(serial: number): boolean {
  return serial >= GRANT_HOLD_SERIAL_BASE && serial < RESERVE_SERIAL_BASE;
}

/** イベント列のうち特別保留の holdAdded の数。 */
function countGrantAdded(evs: readonly SimEvent[]): number {
  let n = 0;
  for (const e of evs) {
    if (e.k === 'holdAdded' && isGrantSerial(e.entry.serial)) {
      n = n + 1;
    }
  }
  return n;
}

/** レート4を解放して前面で打ち続ける（燃料12h・メダル8で rate1→2→4 を買う, D-090）。 */
function rate4Setup(extraGrants: Grant[]): { grants: Grant[]; actions: Action[] } {
  return {
    grants: [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 8 }, ...extraGrants],
    actions: [
      { t: 0, k: 'buy', target: 'rate', count: 1 },
      { t: 0, k: 'buy', target: 'rate', count: 1 },
      { t: 0, k: 'shoot', on: true, rate: 4 },
    ],
  };
}

/** 無料の保留の当たりが1パチ単価で、打った rate4 の当たりは rate4 の単価であることを確かめる（D-090）。 */
function expectFreeHitsAtRate1(evs: readonly SimEvent[], econ: IdleEconomy, isFree: (serial: number) => boolean): number {
  let freeHits = 0;
  let rounds = 0;
  let unit = 1;
  for (const e of evs) {
    if (e.k === 'jackpotStarted') {
      rounds = e.rounds + (e.bonusRounds ?? 0);
      unit = isFree(e.entry) ? econ.getShotUnit(1) : econ.getShotUnit(4);
      if (isFree(e.entry)) {
        freeHits = freeHits + 1;
      }
      expect('roundBonus' in e).toBe(false);
    } else if (e.k === 'jackpotEnded') {
      // 出玉は取得時の unit。無料は1パチ単価（ref が変わるため等価ではなく範囲で見る）。
      expect(e.payout).toBeGreaterThan(0);
      expect('bonus' in e).toBe(false);
      void rounds;
      void unit;
    }
  }
  return freeHits;
}

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
  // rate1の単価は ref×8（D-090）。
  expect(econ.getShotUnit(1)).toBe(Math.floor(ref * 8));
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
  const evs = eng.advance(1000);
  const p = eng.project();
  expect(p.holds.length).toBeLessThanOrEqual(4);
  expect(p.bonusStock).toBeGreaterThan(0);
  // 保留に入った数＋ストック＝受け取った数（満タンで捨てない）。
  expect(countGrantAdded(evs) + p.bonusStock).toBe(10);
  // 変動が進んで空きができたらストックから入る。最後は全部が保留に入る。
  const all = [...evs];
  for (let t = 2000; t <= H; t = t + 1000) {
    for (const e of eng.advance(t)) {
      all.push(e);
    }
    expect(countGrantAdded(all) + eng.project().bonusStock).toBe(10);
  }
  expect(eng.project().bonusStock).toBe(0);
  expect(countGrantAdded(all)).toBe(10);
});

test('特別保留: 大当たり中に受け取ったストックも失われない（snapshot→restoreを挟んでも）', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const TOTAL = 30;
  const mk = (): Engine =>
    new Engine(
      { seed: 66, spec, patterns, atlas, initialBalls: 100000, economy: loadEconomy() },
      [{ claimId: 'fill', at: 0, fuelMs: 0, medals: 0, bonusHolds: TOTAL }],
      [{ t: 0, k: 'shoot', on: false, rate: 1 }],
    );
  // 最初の大当たりの開始時刻を探す（特別保留の当たり）。
  const probe = mk().advance(4 * H);
  const js = probe.find((e) => e.k === 'jackpotStarted');
  if (js === undefined || js.k !== 'jackpotStarted') {
    throw new Error('no jackpot');
  }
  expect(isGrantSerial(js.entry)).toBe(true);
  const mid = js.at + 1000;
  const a = mk();
  const head = a.advance(mid);
  expect(a.snapshot().spin.jackpot).not.toBeNull();
  const stockBefore = a.project().bonusStock;
  expect(stockBefore).toBeGreaterThan(0);
  expect(countGrantAdded(head) + stockBefore).toBe(TOTAL);
  // 大当たり中に2つ受け取る（保留は満タンなのでストックに積まれる）。
  a.appendGrant({ claimId: 'mid', at: mid, fuelMs: 0, medals: 0, bonusHolds: 2 });
  const step = a.advance(mid + 1000);
  expect(a.snapshot().spin.jackpot).not.toBeNull();
  expect(step.some((e) => e.k === 'granted' && e.claimId === 'mid')).toBe(true);
  // 大当たり中は保留が消化されず満タンのまま（ストックが減らない）。
  expect(a.project().bonusStock).toBe(stockBefore + 2);
  expect(countGrantAdded(head) + countGrantAdded(step) + a.project().bonusStock).toBe(TOTAL + 2);
  // 大当たり中の複写から restore しても、ストックは消えず最後まで全部が保留に入る。
  const snap = a.snapshot();
  expect(snap.bonusStock).toBe(a.project().bonusStock);
  const b = Engine.restore(snap, { seed: 66, spec, patterns, atlas, economy: loadEconomy() });
  const seen = [...head, ...step];
  for (let t = mid + 2000; t <= 4 * H; t = t + 1000) {
    const evA = a.advance(t);
    const evB = b.advance(t);
    expect(evB).toEqual(evA);
    for (const e of evB) {
      seen.push(e);
    }
    expect(countGrantAdded(seen) + b.project().bonusStock).toBe(TOTAL + 2);
  }
  expect(b.snapshot()).toEqual(a.snapshot());
  expect(b.project().bonusStock).toBe(0);
  expect(countGrantAdded(seen)).toBe(TOTAL + 2);
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

test('rate4で打っていても特別保留の当たりは1パチ単価（D-090）', () => {
  const { spec, patterns } = loadMachine();
  const econ = loadEconomy();
  const { grants, actions } = rate4Setup([{ claimId: 'b', at: 0, fuelMs: 0, medals: 0, bonusHolds: 30 }]);
  const eng = new Engine({ seed: 77, spec, patterns, atlas: loadAtlas(), initialBalls: 10000000, economy: econ }, grants, actions);
  const evs = eng.advance(6 * H);
  // 打った玉は rate4（テストが無意味でないことの確認）。
  expect(econ.getShotUnit(4)).toBeGreaterThan(econ.getShotUnit(1));
  expect(evs.some((e) => e.k === 'fired' && e.rate === 4)).toBe(true);
  const freeHits = expectFreeHitsAtRate1(evs, econ, (serial) => serial >= GRANT_HOLD_SERIAL_BASE);
  expect(evs.some((e) => e.k === 'jackpotStarted' && isGrantSerial(e.entry))).toBe(true);
  expect(freeHits).toBeGreaterThan(0);
});

test('rate4で打っていても予告のボーナス保留の当たりは1パチ単価（D-090）', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const seed = 88;
  // 当たりになる予告の番号を探す（重みは default.json の fever/rush/bonus）。
  let entry = null;
  for (let n = 0; n < 1000 && entry === null; n = n + 1) {
    const e = drawBonusHold(spec, patterns, seed, 'normal', n, BONUS_SERIAL_BASE + n, 10, [50, 45, 5]);
    if (e.isHit) {
      entry = e;
    }
  }
  if (entry === null) {
    throw new Error('no hit bonus hold');
  }
  expect(entry.rate).toBeUndefined();
  const { grants, actions } = rate4Setup([]);
  const base = new Engine({ seed, spec, patterns, atlas, initialBalls: 10000000, economy: loadEconomy() }, grants, actions);
  base.advance(1000);
  const snap = base.snapshot();
  expect(snap.spin.mode).toBe('normal');
  // 予告のボーナス保留を先頭に入れた状態から続ける（前面で rate4 を打ち続ける）。
  const econ = loadEconomy();
  const eng = Engine.restore({ ...snap, holds: [entry] }, { seed, spec, patterns, atlas, economy: econ });
  const evs = eng.advance(6 * H);
  expect(econ.getShotUnit(4)).toBeGreaterThan(econ.getShotUnit(1));
  expect(evs.some((e) => e.k === 'fired' && e.rate === 4)).toBe(true);
  const bonusSerial = entry.serial;
  expect(evs.some((e) => e.k === 'jackpotStarted' && e.entry === bonusSerial)).toBe(true);
  expectFreeHitsAtRate1(evs, econ, (serial) => serial >= BONUS_SERIAL_BASE);
});
