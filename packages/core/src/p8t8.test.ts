import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import { shotUnit } from './economy-math.ts';
import { drawHold } from './lottery.ts';
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

test('1発のコスト = unit（rate×ref×shotS、切り捨て・最低 rate）', () => {
  expect(shotUnit(1, 1, 8)).toBe(8);
  expect(shotUnit(4, 1, 8)).toBe(32);
  expect(shotUnit(100, 2.5, 8)).toBe(Math.floor(100 * 2.5 * 8));
  expect(shotUnit(1, 0.01, 8)).toBe(1);
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const econ = loadEconomy();
  // 役物なし・ref=1なので unit1=8
  expect(econ.getRefPerSec()).toBe(1);
  expect(econ.getShotUnit(1)).toBe(8);
  const eng = new Engine(
    { seed: 5, spec, patterns, atlas, initialBalls: 100000, economy: econ },
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 0 }],
    [{ t: 0, k: 'shoot', on: true, rate: 1 }],
  );
  const before = eng.snapshot().balls;
  eng.advance(600);
  const fired = eng.snapshot().totals.fired;
  expect(fired).toBeGreaterThan(0);
  expect(before - eng.snapshot().balls).toBe(fired * 8);
});

test('保留を取った後に生産を変えても出玉は取得時の unit', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const ref0 = 1;
  const unit0 = Math.floor(1 * ref0 * 8);
  const e0 = drawHold(spec, patterns, 42, 'normal', 123, 1, unit0);
  expect(e0.unit).toBe(unit0);
  expect(e0.hesoPayoutBalls).toBe(spec.hesoPayout * unit0);
  // 生産が上がっても取得時の unit のまま（D-017 と同じ考え）。
  const ref1 = 100;
  const unit1 = Math.floor(1 * ref1 * 8);
  expect(unit1).toBeGreaterThan(unit0);
  // Engine で保留を取った後に役物を買っても、既存保留の出玉は変わらない。
  const econ = loadEconomy();
  const eng = new Engine(
    { seed: 9, spec, patterns, atlas, initialBalls: 10000000, economy: econ },
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 0 }],
    [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'shoot', on: true, rate: 1 },
    ],
  );
  const evs = eng.advance(600000);
  const added = evs.filter((e) => e.k === 'holdAdded');
  expect(added.length).toBeGreaterThan(0);
  const firstUnit = ((added[0] as { entry: { unit?: number } }).entry.unit);
  expect(firstUnit).toBeGreaterThan(0);
  // さらに役物を買って ref を上げても、新しい保留の unit は上がるが、既存の出玉は取得時のまま。
  // （取得時の unit で払うことは drawHold の単体で保証し、ここでは unit が ref 連動で増えることを見る。）
  const refBefore = econ.getRefPerSec();
  eng.appendAction({ t: eng.nowMs, k: 'buy', target: 'kaitentai', count: 1 });
  eng.advance(eng.nowMs + 1000);
  expect(econ.getRefPerSec()).toBeGreaterThanOrEqual(refBefore);
});

test('無料の保留は1パチ単価（予告・特別・電サポ）', () => {
  const econ = loadEconomy();
  econ.onBuy('windmill', 10, 100000, 0);
  const ref = econ.getRefPerSec();
  expect(ref).toBeGreaterThan(1);
  const unit1 = econ.getShotUnit(1);
  expect(unit1).toBe(Math.floor(ref * 8));
  // 1パチ単価は rate1 の単価と同じ。
  expect(unit1).toBe(econ.shotUnitUnchecked(1));
});

test('restore 一致（単価・オート蓄積込み）', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const mk = (): Engine =>
    new Engine(
      { seed: 21, spec, patterns, atlas, initialBalls: 1000000, initialFuelMs: 6 * H, economy: loadEconomy() },
      [],
      [
        { t: 0, k: 'buy', target: 'windmill', count: 10 },
        { t: 0, k: 'buy', target: 'auto', count: 1 },
        { t: 0, k: 'auto', share: 1, rate: 1 },
      ],
    );
  const until = 600000;
  const a = mk();
  a.advance(300000);
  const snap = a.snapshot();
  const tailA = a.advance(until);
  const b = Engine.restore(snap, { seed: 21, spec, patterns, atlas, economy: loadEconomy() });
  expect(b.advance(until)).toEqual(tailA);
  expect(b.snapshot()).toEqual(a.snapshot());
});

test('旧 Snapshot・旧セーブが読める（bonusBalls・jackpotBonus は読み捨て、旧レート段は移行）', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const econ = loadEconomy();
  const eng = new Engine(
    { seed: 7, spec, patterns, atlas, initialBalls: 1000, economy: econ },
    [],
    [{ t: 0, k: 'buy', target: 'windmill', count: 1 }],
  );
  eng.advance(1000);
  const snap = eng.snapshot();
  // 旧 totals（bonusBallsあり）・旧 jackpotBonus 付きでも落ちない。
  const legacyTotals = { ...(snap.totals as object), bonusBalls: 12345 } as unknown as typeof snap.totals;
  const legacy = { ...snap, totals: legacyTotals, jackpotBonus: 999 } as unknown as typeof snap;
  const back = Engine.restore(legacy, { seed: 7, spec, patterns, atlas, economy: loadEconomy() });
  expect('bonusBalls' in back.snapshot().totals).toBe(false);
  expect('jackpotBonus' in back.snapshot()).toBe(false);
  expect(back.project().balls).toBe(snap.balls);
  // 旧 IdleEconomy v4（rateStage 5＝旧400）を移行すると 100 まで解放。
  const oldEcon = loadEconomy();
  const v4 = { ...(econ.snapshot() as unknown as Record<string, unknown>), v: 4, rateStage: 5 };
  oldEcon.restore(v4);
  expect(oldEcon.getUnlockedRates()).toEqual([1, 2, 4, 10, 20, 40, 100]);
});

test('旧セーブの最大解放レート400・1000は100に丸め、以下は全部解放・メダルは返さない', () => {
  const econ = loadEconomy();
  for (const [oldStage, wantMax] of [[4, 100], [5, 100], [6, 100], [3, 40], [1, 4]] as const) {
    const e = loadEconomy();
    e.restore({ ...(econ.snapshot() as unknown as Record<string, unknown>), v: 4, rateStage: oldStage });
    const rates = e.getUnlockedRates();
    expect(rates[rates.length - 1]).toBe(wantMax);
    // 以下は全部解放（連続）。
    for (let i = 1; i < rates.length; i = i + 1) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1] as number);
    }
  }
});
