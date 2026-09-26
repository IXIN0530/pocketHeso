import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import type { Action, Grant, SimEvent } from './engine.ts';
import { Engine } from './engine.ts';

const H = 3600000;

function loadMachine(): { spec: MachineSpec; patterns: PatternTable } {
  const spec = parseMachineText(readFileSync('../../resources/machines/light-middle-01.json', 'utf8'));
  const patterns = parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
  return { spec, patterns };
}

function loadAtlas(): ArrayBuffer {
  const dir = '../../resources/atlas';
  const found = readdirSync(dir).find((n) => n.endsWith('.bin'));
  if (found === undefined) {
    throw new Error('atlas .bin not found');
  }
  const buf = readFileSync(dir + '/' + found);
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return ab;
}

function loadEconomy(): IdleEconomy {
  const json = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as unknown;
  return new IdleEconomy(parseEconomy(json));
}

const ATLAS = loadAtlas();

function makeEngine(
  econ: IdleEconomy,
  grants: Grant[],
  actions: Action[],
  opts: { seed?: number; balls?: number; medals?: number } = {},
): Engine {
  const { spec, patterns } = loadMachine();
  return new Engine(
    {
      seed: opts.seed ?? 7,
      spec,
      patterns,
      atlas: ATLAS,
      initialBalls: opts.balls ?? 10000000,
      initialMedals: opts.medals ?? 0,
      economy: econ,
    },
    grants,
    actions,
  );
}

/** オート（背面・rate1）で打ち続ける経済込みエンジン。 */
function autoEngine(econ: IdleEconomy, seed = 7): Engine {
  return makeEngine(
    econ,
    [
      { claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 0 },
      { claimId: 'm', at: 1000, fuelMs: 0, medals: 3 },
    ],
    [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'buy', target: 'auto', count: 1 },
      { t: 0, k: 'auto', share: 1, rate: 1 },
      { t: 0, k: 'presence', fg: false },
    ],
    { seed },
  );
}

function countIn(events: SimEvent[], k: SimEvent['k'], from: number, to: number): number {
  return events.filter((e) => e.k === k && 'at' in e && e.at >= from && e.at < to).length;
}

test('大当たりでメダルは増えず、累計獲得メダルは Grant でだけ増える（D-049）', () => {
  const econ = loadEconomy();
  const eng = autoEngine(econ);
  const events = eng.advance(6 * H);
  expect(events.filter((e) => e.k === 'jackpotEnded').length).toBeGreaterThan(0);
  for (const e of events) {
    if (e.k === 'jackpotEnded') {
      expect('medals' in e).toBe(false);
    }
  }
  expect(eng.project().medals).toBe(3);
  expect(econ.getMedalsEarned()).toBe(3);
});

test('大当たりフィーバーは jackpotStarted〜Ended の間だけ掛かる（D-050）', () => {
  const econ = loadEconomy();
  const eng = autoEngine(econ);
  let inJackpot = false;
  let checkedIn = 0;
  let checkedOut = 0;
  for (let t = 1000; t <= 6 * H; t = t + 1000) {
    for (const e of eng.advance(t)) {
      if (e.k === 'jackpotStarted') {
        inJackpot = true;
      } else if (e.k === 'jackpotEnded') {
        inJackpot = false;
      }
    }
    expect(econ.getJackpotFeverMult()).toBe(inJackpot ? 4 : 1);
    if (inJackpot) {
      checkedIn = checkedIn + 1;
    } else {
      checkedOut = checkedOut + 1;
    }
  }
  expect(checkedIn).toBeGreaterThan(100);
  expect(checkedOut).toBeGreaterThan(100);
});

test('燃料0ではオートが発射せず、燃料が入れば再開し、手動は燃料0でも打てる（D-049）', () => {
  const econ = loadEconomy();
  const eng = makeEngine(
    econ,
    [{ claimId: 'fuel', at: 60000, fuelMs: 60000, medals: 0 }],
    [
      { t: 0, k: 'buy', target: 'auto', count: 1 },
      { t: 0, k: 'auto', share: 1, rate: 1 },
      { t: 180000, k: 'shoot', on: true, rate: 1 },
    ],
  );
  const events = eng.advance(240000);
  expect(countIn(events, 'fired', 0, 60000)).toBe(0);
  // 60000〜118800 の 600ms 格子（燃料は 119000 の tick で尽きる）
  expect(countIn(events, 'fired', 60000, 120000)).toBe(99);
  expect(events.filter((e) => e.k === 'fuelEmpty').map((e) => ('at' in e ? e.at : -1))).toEqual([119000]);
  expect(countIn(events, 'fired', 120000, 180000)).toBe(0);
  expect(countIn(events, 'fired', 180000, 240000)).toBe(100);
});

test('レート4: 1発4玉・出玉×4・大当たりフィーバー×4（D-050）', () => {
  const econ = loadEconomy();
  const initialBalls = 10000000;
  const eng = makeEngine(
    econ,
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 2 }],
    [
      { t: 0, k: 'buy', target: 'rate', count: 1 },
      { t: 0, k: 'shoot', on: true, rate: 4 },
    ],
    { seed: 3, balls: initialBalls },
  );
  let inJackpot = false;
  let rounds = 0;
  let sawFever = false;
  const all: SimEvent[] = [];
  for (let t = 1000; t <= 6 * H; t = t + 1000) {
    for (const e of eng.advance(t)) {
      all.push(e);
      if (e.k === 'jackpotStarted') {
        inJackpot = true;
        rounds = e.rounds + (e.bonusRounds ?? 0);
      } else if (e.k === 'jackpotEnded') {
        inJackpot = false;
        expect(e.payout).toBe(rounds * 10 * 15 * 4);
      }
    }
    if (inJackpot) {
      expect(econ.getJackpotFeverMult()).toBe(5);
      sawFever = true;
    }
  }
  expect(sawFever).toBe(true);
  const fired = all.filter((e) => e.k === 'fired');
  expect(fired.length).toBeGreaterThan(1000);
  expect(fired.every((e) => e.k === 'fired' && e.rate === 4)).toBe(true);
  // 役物なし（生産0）なので 玉 = 初期 − 4×発射 + 払い戻し（ヘソ＋出玉）
  const snap = eng.snapshot();
  expect(snap.balls).toBe(initialBalls - 4 * fired.length + snap.totals.payoutBalls);
  expect(eng.project().medals).toBe(0);
  expect(econ.getMedalsEarned()).toBe(2);
});

test('決定論契約1/2: 大当たりフィーバー込みで不揃い刻み・大当たり中の snapshot/restore が1回と一致', () => {
  const until = 3 * H;
  const a = autoEngine(loadEconomy(), 11);
  const once = a.advance(until);
  expect(once.filter((e) => e.k === 'jackpotStarted').length).toBeGreaterThan(0);

  const b = autoEngine(loadEconomy(), 11);
  const steps = [1, 337, 499, 600, 999, 1234, 1500, 7777];
  const parts: SimEvent[] = [];
  let t = 0;
  let i = 0;
  while (t < until) {
    t = Math.min(until, t + (steps[i % steps.length] as number));
    i = i + 1;
    parts.push(...b.advance(t));
  }
  expect(parts).toEqual(once);
  expect(b.snapshot()).toEqual(a.snapshot());

  // 最初の大当たりの途中で snapshot → 新しい経済で restore → 続きが一致
  const started = once.find((e) => e.k === 'jackpotStarted');
  const mid = (started !== undefined && 'at' in started ? started.at : 0) + 1500;
  const c = autoEngine(loadEconomy(), 11);
  const head = c.advance(mid);
  const { spec, patterns } = loadMachine();
  const econD = loadEconomy();
  const d = Engine.restore(c.snapshot(), { seed: 11, spec, patterns, atlas: ATLAS, economy: econD });
  expect(econD.getJackpotFeverMult()).toBe(4);
  const tail = d.advance(until);
  expect([...head, ...tail]).toEqual(once);
  expect(d.snapshot()).toEqual(a.snapshot());
});

/** 背面オート rate4 で [1000, H) を留守にするエンジン。 */
function awayRate4Engine(econ: IdleEconomy): Engine {
  return makeEngine(
    econ,
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 2 }],
    [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'buy', target: 'rate', count: 1 },
      { t: 0, k: 'buy', target: 'auto', count: 1 },
      { t: 0, k: 'auto', share: 1, rate: 4 },
      { t: 1000, k: 'presence', fg: false },
      { t: H, k: 'presence', fg: true },
    ],
    { seed: 3 },
  );
}

test('留守中サマリーの獲得玉は rate>1 でも 玉差分＋消費玉（Σrate）', () => {
  const eng = awayRate4Engine(loadEconomy());
  const head = eng.advance(1000);
  expect(head.filter((e) => e.k === 'rejected')).toEqual([]);
  const before = eng.snapshot();
  const events = eng.advance(H);
  const after = eng.snapshot();
  eng.advance(H + 1);
  const fired = events.filter((e) => e.k === 'fired');
  expect(fired.length).toBeGreaterThan(1000);
  expect(fired.every((e) => e.k === 'fired' && e.rate === 4)).toBe(true);
  const s = eng.awaySummary();
  expect(s).not.toBeNull();
  expect(s?.gainedBalls).toBe(after.balls - before.balls + 4 * (after.totals.fired - before.totals.fired));
});

test('留守中の snapshot/restore で消費玉が引き継がれ、awayConsumed 無しの旧 snapshot は rate1 前提で読む', () => {
  const a = awayRate4Engine(loadEconomy());
  a.advance(H + 1);
  const { spec, patterns } = loadMachine();
  const b = awayRate4Engine(loadEconomy());
  b.advance(H / 2);
  const mid = b.snapshot();
  expect(mid.away.awayConsumed).toBe(4 * (mid.totals.fired - mid.away.awayFired));
  const econC = loadEconomy();
  const c = Engine.restore(mid, { seed: 3, spec, patterns, atlas: ATLAS, economy: econC });
  c.advance(H + 1);
  expect(c.awaySummary()).toEqual(a.awaySummary());

  const legacyAway = { ...mid.away };
  delete legacyAway.awayConsumed;
  const legacy = Engine.restore({ ...mid, away: legacyAway }, { seed: 3, spec, patterns, atlas: ATLAS, economy: loadEconomy() });
  expect(legacy.snapshot().away.awayConsumed).toBe(mid.totals.fired - mid.away.awayFired);
});

test('持ち玉 < rate なら発射しない（手動・オートとも。持ち玉は負にならない）', () => {
  const econ = loadEconomy();
  const eng = makeEngine(
    econ,
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 2 }],
    [
      { t: 0, k: 'buy', target: 'rate', count: 1 },
      { t: 0, k: 'shoot', on: true, rate: 4 },
    ],
    { seed: 3, balls: 3 },
  );
  const events = eng.advance(60000);
  expect(events.filter((e) => e.k === 'fired')).toEqual([]);
  expect(events.filter((e) => e.k === 'rejected')).toEqual([]);
  expect(eng.snapshot().balls).toBe(3);

  const auto = makeEngine(
    loadEconomy(),
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 0 }],
    [
      { t: 0, k: 'buy', target: 'auto', count: 1 },
      { t: 0, k: 'auto', share: 1, rate: 1 },
      { t: 0, k: 'presence', fg: false },
    ],
    { seed: 3, balls: 50000 + 5 }, // オート購入50,000玉の残り5玉
  );
  let firedAuto = 0;
  for (let t = 1000; t <= 10 * 60000; t = t + 1000) {
    const evs = auto.advance(t);
    expect(evs.filter((e) => e.k === 'rejected')).toEqual([]);
    firedAuto = firedAuto + evs.filter((e) => e.k === 'fired').length;
    expect(auto.snapshot().balls).toBeGreaterThanOrEqual(0);
  }
  expect(firedAuto).toBeGreaterThan(0);
});
