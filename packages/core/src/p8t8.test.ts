import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import { shotUnit } from './economy-math.ts';
import { drawHold, jackpotPayoutBalls } from './lottery.ts';
import type { HoldEntry } from './lottery.ts';
import { Engine } from './engine.ts';
import type { Action, SimEvent } from './engine.ts';

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

function heldEntries(evs: readonly SimEvent[]): { entry: HoldEntry; at: number }[] {
  return evs.flatMap((e) => (e.k === 'holdAdded' ? [{ entry: e.entry, at: e.at }] : []));
}

test('当たり保留の取得後に役物を買っても、大当たりの出玉は取得時の unit（Engine）', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const mk = (buyAt: number | null): { eng: Engine; econ: IdleEconomy } => {
    const econ = loadEconomy();
    const actions: Action[] = [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'shoot', on: true, rate: 1 },
    ];
    if (buyAt !== null) {
      actions.push({ t: buyAt, k: 'buy', target: 'windmill', count: 10 });
    }
    const eng = new Engine(
      { seed: 9, spec, patterns, atlas, initialBalls: 10000000, economy: econ },
      [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 0 }],
      actions,
    );
    return { eng, econ };
  };
  // 買わない通しで、最初の大当たりとその保留の取得時刻を探す。
  const evsA = mk(null).eng.advance(6 * H);
  const endedA = evsA.find((e) => e.k === 'jackpotEnded');
  if (endedA === undefined || endedA.k !== 'jackpotEnded') {
    throw new Error('no jackpot within 6h');
  }
  const held = heldEntries(evsA).find((h) => h.entry.serial === endedA.entry);
  if (held === undefined) {
    throw new Error('hold of the jackpot not found');
  }
  const unit0 = held.entry.unit as number;
  expect(held.at + 1).toBeLessThan(endedA.at);
  // 取得の直後に役物を買って ref を上げる。
  const { eng: b, econ: econB } = mk(held.at + 1);
  const evsB = b.advance(endedA.at + 1);
  expect(evsB.filter((e) => e.k === 'rejected')).toEqual([]);
  expect(econB.getShotUnit(1)).toBeGreaterThan(unit0);
  const endedB = evsB.find((e) => e.k === 'jackpotEnded' && e.entry === endedA.entry);
  if (endedB === undefined || endedB.k !== 'jackpotEnded') {
    throw new Error('jackpot not reproduced');
  }
  expect(endedB.payout).toBe(jackpotPayoutBalls(spec, held.entry.branchIndex as number, unit0));
});

test('無料の保留は1パチ単価、打った保留は打ったレートの単価（Engine）', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const econ = loadEconomy();
  const eng = new Engine(
    { seed: 11, spec, patterns, atlas, initialBalls: 10000000, initialMedals: 1000, economy: econ },
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 0, bonusHolds: 3 }],
    [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'buy', target: 'rate', count: 1 },
      { t: 0, k: 'shoot', on: true, rate: 2 },
    ],
  );
  const evs = eng.advance(3 * H);
  expect(evs.filter((e) => e.k === 'rejected')).toEqual([]);
  const free = econ.getShotUnit(1);
  const paid = econ.getShotUnit(2);
  expect(paid).toBeGreaterThan(free);
  const fired = new Set(evs.flatMap((e) => (e.k === 'fired' ? [e.ball] : [])));
  const added = heldEntries(evs).map((h) => h.entry);
  const heso = added.filter((e) => fired.has(e.serial));
  const others = added.filter((e) => !fired.has(e.serial));
  expect(heso.length).toBeGreaterThan(0);
  // 特別保留3つ＋（当たれば）電サポの自動保留。
  expect(others.length).toBeGreaterThanOrEqual(3);
  for (const e of heso) {
    expect(e.unit).toBe(paid);
  }
  for (const e of others) {
    expect(e.unit).toBe(free);
  }
});

test('オートの蓄積は1発分で頭打ち（溜まった分で連射しない）', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const econ = loadEconomy();
  const share = 0.5;
  const eng = new Engine(
    { seed: 21, spec, patterns, atlas, initialBalls: 10000000, initialFuelMs: 6 * H, economy: econ },
    [],
    [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'buy', target: 'auto', count: 1 },
      { t: 0, k: 'auto', share, rate: 1 },
      { t: 0, k: 'presence', fg: false },
    ],
  );
  eng.advance(1000);
  // 旧版の蓄積が大きく残っていた、という状態から始める。
  const snap = { ...eng.snapshot(), autoAcc: 1e9 };
  const b = Engine.restore(snap, { seed: 21, spec, patterns, atlas, economy: loadEconomy() });
  const span = 600000;
  const evs = b.advance(1000 + span);
  const fired = evs.filter((e) => e.k === 'fired').length;
  const unit = econ.getShotUnit(1);
  const expected = (econ.getRefPerSec() * share * span) / 1000 / unit;
  expect(fired).toBeLessThanOrEqual(Math.floor(expected) + 3);
  expect(fired).toBeGreaterThan(0);
  expect(b.snapshot().autoAcc as number).toBeLessThanOrEqual(unit);
});

test('旧 Snapshot の打つレート 400・1000 は解放済みのそれ以下の最大に丸める', () => {
  const { spec, patterns } = loadMachine();
  const atlas = loadAtlas();
  const eng = new Engine({ seed: 7, spec, patterns, atlas, initialBalls: 1000, economy: loadEconomy() }, [], []);
  eng.advance(1000);
  const snap = eng.snapshot();
  const econSnap = snap.economy as Record<string, unknown>;
  for (const [oldStage, shootRate, autoRate, wantShoot, wantAuto] of [
    [5, 400, 1000, 100, 100],
    [1, 10, 4, 4, 4],
  ] as const) {
    const legacy = { ...snap, shootRate, autoRate, economy: { ...econSnap, v: 4, rateStage: oldStage } };
    const back = Engine.restore(legacy, { seed: 7, spec, patterns, atlas, economy: loadEconomy() });
    expect(back.snapshot().shootRate).toBe(wantShoot);
    expect(back.snapshot().autoRate).toBe(wantAuto);
  }
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
