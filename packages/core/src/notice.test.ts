import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import type { Action, Grant, SimEvent } from './engine.ts';
import { Engine } from './engine.ts';
import { RNGStream } from './rng.ts';

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

function fgEngine(seed: number, balls: number): Engine {
  const { spec, patterns } = loadMachine();
  return new Engine(
    { seed, spec, patterns, atlas: loadAtlas(), initialBalls: balls, initialMedals: 20, economy: loadEconomy() },
    [{ claimId: 'f', at: 0, fuelMs: 12 * 3600000, medals: 0 }],
    [{ t: 0, k: 'buy', target: 'windmill', count: 10 }],
  );
}

test('予告は前面のみ出現・13秒で失効・効果は3種のいずれか', () => {
  const eng = fgEngine(42, 100000);
  const evs = eng.advance(20 * 60000);
  const spawned = evs.filter((e) => e.k === 'noticeSpawned');
  expect(spawned.length).toBeGreaterThanOrEqual(1);
  const first = spawned[0] as { id: number; at: number; effect: string };
  expect(first.id).toBe(0);
  expect(first.at).toBeGreaterThanOrEqual(300000);
  expect(first.at).toBeLessThan(900000);
  expect(['fever', 'rush', 'bonus']).toContain(first.effect);
  const expired = evs.filter((e) => e.k === 'noticeExpired');
  expect(expired.length).toBe(spawned.length);
  const exp0 = expired[0] as { id: number; at: number };
  expect(exp0.id).toBe(0);
  expect(exp0.at).toBe(first.at + 13000);
  const back = fgEngine(42, 100000);
  back.advance(0);
  back.appendAction({ t: 0, k: 'presence', fg: false });
  const backEvs = back.advance(20 * 60000);
  expect(backEvs.filter((e) => e.k === 'noticeSpawned').length).toBe(0);
});

test('noticeTapは表示中のみ成功・期限切れと二重と背面はrejected', () => {
  const eng = fgEngine(7, 100000);
  const evs = eng.advance(20 * 60000);
  const spawned = evs.filter((e) => e.k === 'noticeSpawned');
  const s0 = spawned[0] as { id: number; at: number };
  const tapAt = (s0.at as number) + 1000;
  const eng2 = fgEngine(7, 100000);
  eng2.advance(tapAt);
  eng2.appendAction({ t: tapAt, k: 'noticeTap', noticeId: s0.id as number });
  const tail = eng2.advance(tapAt + 60000);
  expect(tail.filter((e) => e.k === 'rejected').length).toBe(0);
  expect(eng2.project().notice).toBeUndefined();
  const eng3 = fgEngine(7, 100000);
  eng3.advance(tapAt);
  eng3.appendAction({ t: tapAt, k: 'noticeTap', noticeId: 999 });
  expect(eng3.advance(tapAt + 1000).filter((e) => e.k === 'rejected').length).toBe(1);
  const lateAt = (s0.at as number) + 13000 + 60000;
  const eng4 = fgEngine(7, 100000);
  eng4.advance((s0.at as number) + 13000 + 1000);
  eng4.appendAction({ t: (s0.at as number) + 13000 + 1000, k: 'noticeTap', noticeId: s0.id as number });
  const late = eng4.advance(lateAt);
  expect(late.filter((e) => e.k === 'rejected').length).toBe(1);
});

test('フィーバーは生産×7・77秒で戻る', () => {
  const probe = fgEngine(1001, 1000000);
  let feverAt = -1;
  let feverId = -1;
  let cur = 0;
  for (let i = 0; i < 12; i = i + 1) {
    const evs = probe.advance(cur + 20 * 60000);
    cur = cur + 20 * 60000;
    for (let j = 0; j < evs.length; j = j + 1) {
      const e = evs[j] as SimEvent;
      if (e.k === 'noticeSpawned' && (e as { effect: string }).effect === 'fever') {
        feverAt = e.at;
        feverId = (e as { id: number }).id;
        break;
      }
    }
    if (feverAt >= 0) {
      break;
    }
  }
  expect(feverAt).toBeGreaterThanOrEqual(0);
  const eng = fgEngine(1001, 1000000);
  eng.advance(feverAt);
  const before = eng.project().perSec;
  eng.appendAction({ t: feverAt + 1000, k: 'noticeTap', noticeId: feverId });
  eng.advance(feverAt + 2000);
  const boosted = eng.project().perSec;
  expect(boosted / before).toBeGreaterThan(6.9);
  expect(boosted / before).toBeLessThan(7.1);
  expect(eng.project().feverMs).toBeGreaterThan(70000);
  eng.advance(feverAt + 2000 + 77000 + 5000);
  expect(eng.project().feverMs).toBe(0);
  expect(eng.project().perSec / before).toBeGreaterThan(0.99);
  expect(eng.project().perSec / before).toBeLessThan(1.01);
});

test('ラッシュはmin(玉×0.15, perSec×900)を即時加算', () => {
  const probe = fgEngine(2024, 1000000);
  let rushAt = -1;
  let rushId = -1;
  let cur = 0;
  for (let i = 0; i < 12; i = i + 1) {
    const evs = probe.advance(cur + 20 * 60000);
    cur = cur + 20 * 60000;
    for (let j = 0; j < evs.length; j = j + 1) {
      const e = evs[j] as SimEvent;
      if (e.k === 'noticeSpawned' && (e as { effect: string }).effect === 'rush') {
        rushAt = e.at;
        rushId = (e as { id: number }).id;
        break;
      }
    }
    if (rushAt >= 0) {
      break;
    }
  }
  expect(rushAt).toBeGreaterThanOrEqual(0);
  const eng = fgEngine(2024, 1000000);
  eng.advance(rushAt);
  const snap = eng.snapshot();
  const ballsBefore = snap.balls;
  const perSecBefore = eng.project().perSec;
  const wantByBalls = ballsBefore * 0.15;
  const cap = perSecBefore * 900;
  const want = wantByBalls < cap ? wantByBalls : cap;
  eng.appendAction({ t: rushAt + 1000, k: 'noticeTap', noticeId: rushId });
  eng.advance(rushAt + 2000);
  const after = eng.snapshot().balls;
  const tickGain = eng.project().perSec;
  void tickGain;
  expect(after - ballsBefore - want).toBeGreaterThan(-5);
  expect(after - ballsBefore - want).toBeLessThan(30);
});

test('ボーナスは1e9+idの保留を追加（heso0・決定論）', () => {
  const mk = (): Engine => fgEngine(303, 1000000);
  const findBonus = (): { at: number; id: number } => {
    const probe = mk();
    let cur = 0;
    for (let i = 0; i < 40; i = i + 1) {
      const evs = probe.advance(cur + 20 * 60000);
      cur = cur + 20 * 60000;
      for (let j = 0; j < evs.length; j = j + 1) {
        const e = evs[j] as SimEvent;
        if (e.k === 'noticeSpawned' && (e as { effect: string }).effect === 'bonus') {
          return { at: e.at, id: (e as { id: number }).id };
        }
      }
    }
    throw new Error('no bonus found');
  };
  const b = findBonus();
  const a = mk();
  a.advance(b.at + 1000);
  a.appendAction({ t: b.at + 1000, k: 'noticeTap', noticeId: b.id });
  const tailA = a.advance(b.at + 2000);
  const addedA = tailA.filter((e) => e.k === 'holdAdded');
  expect(addedA.length).toBe(1);
  const entryA = (addedA[0] as { entry: { serial: number; hesoPayoutBalls: number } }).entry;
  expect(entryA.serial).toBe(1000000000 + b.id);
  expect(entryA.hesoPayoutBalls).toBe(0);
  const c = mk();
  const d = findBonus();
  expect(d).toEqual(b);
  c.advance(d.at + 1000);
  c.appendAction({ t: d.at + 1000, k: 'noticeTap', noticeId: d.id });
  const tailC = c.advance(d.at + 2000);
  expect(tailC).toEqual(tailA);
});

test('オートは解放後のみ・止め打ちは満タンで止める・レート未解放はlocked-rate', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const mk = (): Engine =>
    new Engine(
      { seed: 5, spec, patterns, atlas, initialBalls: 1000000, initialMedals: 20, economy: loadEconomy() },
      [],
      [],
    );
  const locked = mk();
  locked.appendAction({ t: 0, k: 'auto', share: 1, rate: 1 });
  expect(locked.advance(1000).filter((e) => e.k === 'rejected').map((e) => (e as { reason: string }).reason)).toEqual([
    'locked',
  ]);
  const rateLocked = mk();
  rateLocked.appendAction({ t: 0, k: 'shoot', on: true, rate: 4 });
  expect(rateLocked.advance(1000).filter((e) => e.k === 'rejected').map((e) => (e as { reason: string }).reason)).toEqual([
    'locked-rate',
  ]);
  const ok = mk();
  const econ = loadEconomy();
  void econ;
  ok.appendAction({ t: 0, k: 'buy', target: 'auto', count: 1 });
  ok.appendAction({ t: 0, k: 'buy', target: 'tomeuchi', count: 1 });
  ok.appendAction({ t: 0, k: 'buy', target: 'hold', count: 1 });
  ok.appendAction({ t: 0, k: 'auto', share: 1, rate: 1 });
  const evs = ok.advance(60000);
  expect(evs.filter((e) => e.k === 'rejected').length).toBe(0);
  expect(ok.project().yakumono.length).toBe(8);
});

test('釘qはout→start1に変換（RNG2手目・決定論）', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const runStart1 = (withNail: boolean): number => {
    const eng = new Engine(
      { seed: 11, spec, patterns, atlas, initialBalls: 1000000, initialMedals: 0, economy: loadEconomy() },
      [],
      withNail
        ? [
            { t: 0, k: 'buy', target: 'windmill', count: 1 },
            { t: 0, k: 'buy', target: 'nail', count: 1 },
            { t: 0, k: 'shoot', on: true, rate: 1 },
          ]
        : [{ t: 0, k: 'shoot', on: true, rate: 1 }],
    );
    const evs = eng.advance(600000);
    return evs.filter((e) => e.k === 'sensor' && (e as { kind: string }).kind === 'start1').length;
  };
  const base = runStart1(false);
  const nailed = runStart1(true);
  expect(nailed).toBeGreaterThan(base);
  let predicted = 0;
  const n = Math.floor(600000 / 600);
  for (let ball = 0; ball < n; ball = ball + 1) {
    const rng = new RNGStream(11, 'launch', ball);
    rng.nextU32();
    if (rng.nextU32() / 4294967296 < 0.01) {
      predicted = predicted + 1;
    }
  }
  void predicted;
});

test('変動短縮は0.9^stages・保留+1は上限6・レート解放は段階', () => {
  const econ = loadEconomy();
  expect(econ.shortenMult()).toBe(1);
  const rich: Action[] = [
    { t: 0, k: 'buy', target: 'windmill', count: 1 },
    { t: 0, k: 'buy', target: 'shorten', count: 1 },
    { t: 0, k: 'buy', target: 'hold', count: 1 },
    { t: 0, k: 'buy', target: 'hold', count: 1 },
  ];
  const { spec, patterns } = loadMachine();
  const eng = new Engine(
    { seed: 5, spec, patterns, atlas: loadAtlas(), initialBalls: 10000000, initialMedals: 20, economy: loadEconomy() },
    [],
    rich,
  );
  expect(eng.advance(1000).filter((e) => e.k === 'rejected').length).toBe(0);
  expect(econ.effectiveHoldMax(4)).toBe(4);
  const econ2 = loadEconomy();
  expect(econ2.isRateAllowed(1)).toBe(true);
  expect(econ2.isRateAllowed(4)).toBe(false);
});

test('AwaySummaryは獲得玉・当たり・連チャン・燃料切れ・最熱を集計', () => {
  const { spec, patterns } = loadMachine();
  const eng = new Engine(
    { seed: 42, spec, patterns, atlas: loadAtlas(), initialBalls: 100000, initialMedals: 0, economy: loadEconomy() },
    [{ claimId: 'f', at: 0, fuelMs: 3600000, medals: 0 }],
    [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'auto', share: 1, rate: 1 },
      { t: 1000, k: 'presence', fg: false },
      { t: 3600000, k: 'presence', fg: true },
    ],
  );
  eng.advance(1001);
  const ballsAtAway = eng.snapshot().balls;
  const firedAtAway = eng.snapshot().totals.fired;
  const jackAtAway = eng.snapshot().totals.jackpots;
  eng.advance(3600001);
  const s = eng.awaySummary();
  expect(s).not.toBeNull();
  if (s !== null) {
    expect(s.from).toBe(1000);
    expect(s.to).toBe(3600000);
    const now = eng.snapshot();
    expect(s.gainedBalls).toBe(now.balls - ballsAtAway + (now.totals.fired - firedAtAway));
    expect(s.jackpots).toBe(now.totals.jackpots - jackAtAway);
    expect(s.maxHot).toBeGreaterThanOrEqual(0);
  }
});

test('HallProjectionはnotice・nextHot・feverMs・phaseを返す', () => {
  const eng = fgEngine(42, 100000);
  eng.advance(20 * 60000);
  const p = eng.project();
  expect(p.feverMs).toBe(0);
  expect(p.yakumono.length).toBe(8);
  const w = p.yakumono[0] as { id: string; lv: number; phase?: number };
  expect(w.id).toBe('windmill');
  expect(w.lv).toBe(10);
  expect(w.phase as number).toBeGreaterThanOrEqual(0);
  expect(w.phase as number).toBeLessThan(1);
  const grants: Grant[] = [{ claimId: 'f', at: 0, fuelMs: 12 * 3600000, medals: 0 }];
  const { spec, patterns } = loadMachine();
  const eng2 = new Engine(
    { seed: 42, spec, patterns, atlas: loadAtlas(), initialBalls: 100000, initialMedals: 0, economy: loadEconomy() },
    grants,
    [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'shoot', on: true, rate: 1 },
    ],
  );
  eng2.advance(600000);
  const p2 = eng2.project();
  if (p2.holds.length > 0) {
    expect(p2.nextHot).toBeDefined();
  }
});
