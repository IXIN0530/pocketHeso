import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachine, parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import type { Action, Grant, SimEvent } from './engine.ts';
import { Engine, RESERVE_SERIAL_BASE } from './engine.ts';

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
  const json = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Record<string, unknown>;
  // 実績の倍率が途中で入ると手計算がずれるので外す（実績は achievements.test.ts）。
  (json['achievements'] as Record<string, unknown>)['list'] = [];
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

test('出玉は取得時の unit で払い、ボーナスは無い（D-090）', () => {
  const econ = loadEconomy();
  const eng = autoEngine(econ);
  let sawStarted = false;
  let sawEnded = false;
  for (let t = 1000; t <= 6 * H; t = t + 1000) {
    for (const e of eng.advance(t)) {
      if (e.k === 'jackpotStarted') {
        sawStarted = true;
        expect('roundBonus' in e).toBe(false);
      } else if (e.k === 'jackpotEnded') {
        sawEnded = true;
        expect('bonus' in e).toBe(false);
        expect(e.payout).toBeGreaterThan(0);
      }
    }
  }
  expect(sawStarted).toBe(true);
  expect(sawEnded).toBe(true);
  expect('bonusBalls' in eng.project().totals).toBe(false);
});

test('燃料0ではオートが発射せず、燃料が入れば再開し、手動は燃料0でも打てる（D-049・D-090）', () => {
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
  // オートは生産×share を unit で割るため 100発/分より遅い（ref=1・unit=8で約7〜8発/分, D-090）
  const autoFired = countIn(events, 'fired', 60000, 120000);
  expect(autoFired).toBeGreaterThan(0);
  expect(autoFired).toBeLessThan(99);
  expect(events.filter((e) => e.k === 'fuelEmpty').map((e) => ('at' in e ? e.at : -1))).toEqual([119000]);
  expect(countIn(events, 'fired', 120000, 180000)).toBe(0);
  expect(countIn(events, 'fired', 180000, 240000)).toBe(100);
});

test('レート4: 1発は unit（rate×ref×8）・出玉は取得時の unit・RUSH の自動保留も同じ単価（D-090・D-125）', () => {
  const econ = loadEconomy();
  const initialBalls = 10000000;
  const eng = makeEngine(
    econ,
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 8 }],
    [
      { t: 0, k: 'buy', target: 'rate', count: 1 },
      { t: 0, k: 'buy', target: 'rate', count: 1 },
      { t: 0, k: 'shoot', on: true, rate: 4 },
    ],
    { seed: 3, balls: initialBalls },
  );
  // 役物なし・ref=1なので unit4=32
  const unit4 = 4 * 1 * 8;
  let rounds = 0;
  let sawEnded = false;
  let sawReserveJackpot = false;
  const all: SimEvent[] = [];
  for (let t = 1000; t <= 6 * H; t = t + 1000) {
    for (const e of eng.advance(t)) {
      all.push(e);
      if (e.k === 'jackpotStarted') {
        rounds = e.rounds + (e.bonusRounds ?? 0);
        // 自動保留（D-079）は RUSH を始めた大当たりの単価を引き継ぐ（D-125）。
        if (e.entry >= RESERVE_SERIAL_BASE) {
          sawReserveJackpot = true;
        }
        expect('roundBonus' in e).toBe(false);
      } else if (e.k === 'jackpotEnded') {
        expect(e.payout).toBe(rounds * 10 * 15 * unit4);
        expect('bonus' in e).toBe(false);
        sawEnded = true;
      }
    }
  }
  expect(sawEnded).toBe(true);
  expect(sawReserveJackpot).toBe(true);
  const fired = all.filter((e) => e.k === 'fired');
  expect(fired.length).toBeGreaterThan(1000);
  expect(fired.every((e) => e.k === 'fired' && e.rate === 4)).toBe(true);
  // 役物なし（生産0・基準1/秒）なので 玉 = 初期 − unit×発射 + 払い戻し（ヘソ＋出玉）
  const snap = eng.snapshot();
  expect(snap.balls).toBe(initialBalls - unit4 * fired.length + snap.totals.payoutBalls);
  expect(eng.project().medals).toBe(0);
  expect(econ.getMedalsEarned()).toBe(8);
});

test('上乗せ込みの実ラウンド数で出玉は unit×・Stubは unit=rate（D-090）', () => {
  const patterns = parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
  const spec = parseMachine({
    id: 'test-bonus-01',
    version: 1,
    tier: 'middle',
    modes: {
      normal: { jackpot_1_in: 2, spins: 0 },
      st: { jackpot_1_in: 2, spins: 10 },
    },
    jackpot_split: [{ kind: 'tsujo', weight: 1, rounds: 4, bonus_rounds: 6 }],
    round: { count: 10, payout_per_ball: 15, ms_per_round: 1000 },
    heso_payout: 3,
    hold_max: 4,
    spin_patterns: 'patterns.json',
    hold_colors: [
      { color: 'blue', w_hit: 10, w_miss: 900 },
      { color: 'green', w_hit: 20, w_miss: 70 },
      { color: 'red', w_hit: 50, w_miss: 25 },
      { color: 'gold', w_hit: 20, w_miss: 0 },
      { color: 'white', w_hit: 0, w_miss: 5 },
    ],
  });
  // 役物なし（ref=1）・rate1: unit=8・実10Rで payout=10*10*15*8=12000
  const econ = loadEconomy();
  expect(econ.getRefPerSec()).toBe(1);
  expect(econ.getShotUnit(1)).toBe(8);
  const eng = new Engine(
    { seed: 1, spec, patterns, atlas: ATLAS, initialBalls: 1000000, initialMedals: 0, economy: econ },
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 0 }],
    [
      { t: 0, k: 'buy', target: 'auto', count: 1 },
      { t: 0, k: 'auto', share: 1, rate: 1 },
      { t: 0, k: 'presence', fg: false },
    ],
  );
  let sawStarted = false;
  let endedPayout = -1;
  for (let t = 1000; t <= 2 * H; t = t + 1000) {
    for (const e of eng.advance(t)) {
      if (e.k === 'jackpotStarted') {
        sawStarted = true;
        expect('roundBonus' in e).toBe(false);
      } else if (e.k === 'jackpotEnded') {
        endedPayout = e.payout;
        expect('bonus' in e).toBe(false);
      }
    }
    if (endedPayout >= 0) {
      break;
    }
  }
  expect(sawStarted).toBe(true);
  expect(endedPayout).toBe(10 * 10 * 15 * 8);
  expect('bonusBalls' in eng.project().totals).toBe(false);
  // rate100 の unit は 100*1*8=800
  expect(econ.getShotUnit(100)).toBe(800);
  // Stub（経済なし）では unit=rate
  const stub = new Engine(
    { seed: 1, spec, patterns, atlas: ATLAS, initialBalls: 1000000 },
    [],
    [
      { t: 0, k: 'auto', share: 1, rate: 1 },
      { t: 0, k: 'presence', fg: false },
    ],
  );
  let stubStarted = false;
  let stubEnded = false;
  for (let t = 1000; t <= 2 * H; t = t + 1000) {
    for (const e of stub.advance(t)) {
      if (e.k === 'jackpotStarted') {
        stubStarted = true;
        expect('roundBonus' in e).toBe(false);
      } else if (e.k === 'jackpotEnded') {
        stubEnded = true;
        expect('bonus' in e).toBe(false);
        expect(e.payout).toBe(10 * 10 * 15 * 1);
      }
    }
    if (stubEnded) {
      break;
    }
  }
  expect(stubStarted).toBe(true);
  expect(stubEnded).toBe(true);
  expect('bonusBalls' in stub.project().totals).toBe(false);
  expect(stub.project().refPerSec).toBe(0);
});

test('決定論契約1/2: 単価込みで不揃い刻み・大当たり中の snapshot/restore が1回と一致', () => {
  // オートは生産連動で遅いため 12H 回して大当たりを出す（D-090）。
  const until = 12 * H;
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
  expect('jackpotBonus' in c.snapshot()).toBe(false);
  const tail = d.advance(until);
  expect([...head, ...tail]).toEqual(once);
  expect(d.snapshot()).toEqual(a.snapshot());
});

/** 背面オート rate4 で [1000, H) を留守にするエンジン。 */
function awayRate4Engine(econ: IdleEconomy): Engine {
  return makeEngine(
    econ,
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 8 }],
    [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'buy', target: 'rate', count: 1 },
      { t: 0, k: 'buy', target: 'rate', count: 1 },
      { t: 0, k: 'buy', target: 'auto', count: 1 },
      { t: 0, k: 'auto', share: 1, rate: 4 },
      { t: 1000, k: 'presence', fg: false },
      { t: H, k: 'presence', fg: true },
    ],
    { seed: 3 },
  );
}

test('留守中サマリーの獲得玉は rate>1 でも 玉差分＋消費玉（Σunit, D-090）', () => {
  const econ = loadEconomy();
  const eng = awayRate4Engine(econ);
  const head = eng.advance(1000);
  expect(head.filter((e) => e.k === 'rejected')).toEqual([]);
  const before = eng.snapshot();
  const events = eng.advance(H);
  const after = eng.snapshot();
  eng.advance(H + 1);
  const fired = events.filter((e) => e.k === 'fired');
  expect(fired.length).toBeGreaterThan(0);
  expect(fired.every((e) => e.k === 'fired' && e.rate === 4)).toBe(true);
  const unit = econ.getShotUnit(4);
  const s = eng.awaySummary();
  expect(s).not.toBeNull();
  expect(s?.gainedBalls).toBe(after.balls - before.balls + unit * (after.totals.fired - before.totals.fired));
});

test('留守中の snapshot/restore で消費玉が引き継がれ、awayConsumed 無しの旧 snapshot は rate1 前提で読む', () => {
  const a = awayRate4Engine(loadEconomy());
  a.advance(H + 1);
  const { spec, patterns } = loadMachine();
  const econB = loadEconomy();
  const b = awayRate4Engine(econB);
  b.advance(H / 2);
  const mid = b.snapshot();
  expect(mid.away.awayConsumed).toBe(econB.getShotUnit(4) * (mid.totals.fired - mid.away.awayFired));
  const econC = loadEconomy();
  const c = Engine.restore(mid, { seed: 3, spec, patterns, atlas: ATLAS, economy: econC });
  c.advance(H + 1);
  expect(c.awaySummary()).toEqual(a.awaySummary());

  const legacyAway = { ...mid.away };
  delete legacyAway.awayConsumed;
  const legacy = Engine.restore({ ...mid, away: legacyAway }, { seed: 3, spec, patterns, atlas: ATLAS, economy: loadEconomy() });
  expect(legacy.snapshot().away.awayConsumed).toBe(mid.totals.fired - mid.away.awayFired);
});

test('持ち玉 < unit なら発射しない（手動・オートとも。持ち玉は負にならない, D-090）', () => {
  const econ = loadEconomy();
  const eng = makeEngine(
    econ,
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 8 }],
    [
      { t: 0, k: 'buy', target: 'rate', count: 1 },
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
    { seed: 3, balls: 50000 + 1000 }, // オート購入50,000玉の残り1000玉（unit=8で打てる）
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
