import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import type { Action, EngineSnapshot, Grant, SimEvent } from './engine.ts';
import { Engine } from './engine.ts';

const H = 3600000;
const NO_ENGINE = { firstHits: 0, jackpots: 0, maxChain: 0, closes: 0 };

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

function defaultJson(): Record<string, unknown> {
  return JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Record<string, unknown>;
}

function loadEconomy(): IdleEconomy {
  return new IdleEconomy(parseEconomy(defaultJson()));
}

/** 実績が次々に入る台本（役物3種・メダル・打つ・留守・予告込み）。 */
function script(): { grants: Grant[]; actions: Action[] } {
  return {
    grants: [
      { claimId: 'a', at: 0, fuelMs: 12 * H, medals: 12, streakDay: '2026-09-28' },
      { claimId: 'b', at: 2 * H + 500, fuelMs: H, medals: 30, streakDay: '2026-09-29' },
    ],
    actions: [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'buy', target: 'kaitentai', count: 1 },
      { t: 0, k: 'buy', target: 'croon', count: 1 },
      { t: 0, k: 'shoot', on: true, rate: 1 },
      { t: 1234, k: 'buy', target: 'rate', count: 1 },
      { t: H + 300, k: 'presence', fg: false },
      { t: 3 * H + 700, k: 'buy', target: 'rate', count: 1 },
      { t: 4 * H, k: 'presence', fg: true },
    ],
  };
}

function mkEngine(seed = 5): Engine {
  const { spec, patterns } = loadMachine();
  const s = script();
  return new Engine(
    { seed, spec, patterns, atlas: loadAtlas(), initialBalls: 1000000, economy: loadEconomy() },
    s.grants,
    s.actions,
  );
}

function achievedIds(evs: readonly SimEvent[]): string[] {
  return evs.flatMap((e) => (e.k === 'achieved' ? [e.id] : []));
}

test('default.json の実績は44個・id は一意・mult_per 0.01', () => {
  const spec = parseEconomy(defaultJson());
  expect(spec.achievements.multPer).toBe(0.01);
  expect(spec.achievements.list.length).toBe(44);
  const ids = spec.achievements.list.map((a) => a.id);
  expect(new Set(ids).size).toBe(44);
  for (const a of spec.achievements.list) {
    expect(a.id.startsWith(a.metric + '_')).toBe(true);
  }
});

test('実績の検証: id 重複・未知の metric・at ≤ 0・mult_per の範囲外はエラー', () => {
  const mutate = (f: (a: Record<string, unknown>) => void): Record<string, unknown> => {
    const j = defaultJson();
    f(j['achievements'] as Record<string, unknown>);
    return j;
  };
  const list = (a: Record<string, unknown>): Record<string, unknown>[] => a['list'] as Record<string, unknown>[];
  const bad = [
    mutate((a) => {
      (list(a)[1] as Record<string, unknown>)['id'] = list(a)[0]?.['id'];
    }),
    mutate((a) => {
      (list(a)[0] as Record<string, unknown>)['metric'] = 'unknownMetric';
    }),
    mutate((a) => {
      (list(a)[0] as Record<string, unknown>)['at'] = 0;
    }),
    mutate((a) => {
      (list(a)[0] as Record<string, unknown>)['at'] = -5;
    }),
    mutate((a) => {
      a['mult_per'] = 0.2;
    }),
    mutate((a) => {
      a['mult_per'] = -0.01;
    }),
  ];
  for (let i = 0; i < bad.length; i = i + 1) {
    expect(() => parseEconomy(bad[i]), 'case ' + i).toThrow();
  }
  const noAch = defaultJson();
  delete noAch['achievements'];
  expect(() => parseEconomy(noAch)).toThrow();
});

test('判定は economyTick の最後・一覧の順・achMult は次の tick から', () => {
  const econ = loadEconomy();
  econ.onBuy('windmill', 10, 1000000, 0);
  econ.onGrant(12 * H, 10, undefined, 0, 0);
  const g1 = econ.onTick(true, 12 * H).ballGain;
  expect(econ.onAchievementTick(1000, NO_ENGINE)).toEqual(['medalsEarned_10']);
  expect(econ.achMult()).toBe(1.01);
  // 同じ tick の生産は変えない（g1 は達成前）。次の tick から ×1.01。
  const g2 = econ.onTick(true, 12 * H).ballGain;
  expect(g2).toBe(g1 * 1.01);
  expect(econ.getRefPerSec()).toBe(5 * 1.01);
  // 達成済みは2度出ない。複数同時は一覧の順。
  expect(econ.onAchievementTick(2000, NO_ENGINE)).toEqual([]);
  expect(econ.onAchievementTick(3000, { firstHits: 10, jackpots: 12, maxChain: 5, closes: 0 })).toEqual([
    'firstHits_1',
    'firstHits_10',
    'maxChain_3',
    'maxChain_5',
  ]);
  const view = econ.getAchievementsView(NO_ENGINE);
  expect(view.done).toEqual([
    { id: 'medalsEarned_10', at: 1000 },
    { id: 'firstHits_1', at: 3000 },
    { id: 'firstHits_10', at: 3000 },
    { id: 'maxChain_3', at: 3000 },
    { id: 'maxChain_5', at: 3000 },
  ]);
  expect(view.mult).toBe(1 + 0.01 * 5);
  expect(view.metrics.medalsEarned).toBe(10);
  expect(view.metrics.yakumono).toBe(1);
});

test('Engine: achieved は tick 時刻に出て、同じ時刻のイベントの最後', () => {
  const evs = mkEngine().advance(6 * H);
  const ids = achievedIds(evs);
  expect(ids).toContain('medalsEarned_10');
  expect(ids).toContain('yakumono_3');
  expect(ids).toContain('refPerSec_10');
  expect(ids).toContain('rateStage_2');
  for (let i = 0; i < evs.length; i = i + 1) {
    const e = evs[i] as SimEvent;
    if (e.k !== 'achieved') {
      continue;
    }
    expect(e.at % 1000).toBe(0);
    const next = evs[i + 1];
    if (next !== undefined && next.k !== 'achieved') {
      expect(next.at).toBeGreaterThan(e.at);
    }
  }
});

test('決定論: advance 1回と1秒刻み・半端な刻みで一致（実績込み）', () => {
  const until = 5 * H;
  const once = mkEngine();
  const evOnce = once.advance(until);
  expect(achievedIds(evOnce).length).toBeGreaterThan(5);
  const stepped = mkEngine();
  const evStep: SimEvent[] = [];
  for (let t = 1000; t <= until; t = t + 1000) {
    evStep.push(...stepped.advance(t));
  }
  expect(evStep).toEqual(evOnce);
  expect(stepped.snapshot()).toEqual(once.snapshot());
  const odd = mkEngine();
  const evOdd: SimEvent[] = [];
  let t = 0;
  const steps = [337, 999, 1234, 7777];
  for (let i = 0; t < until; i = i + 1) {
    t = Math.min(until, t + (steps[i % steps.length] as number));
    evOdd.push(...odd.advance(t));
  }
  expect(evOdd).toEqual(evOnce);
});

test('決定論: snapshot → restore → 続行が通しと一致（実績・留守の達成数込み）', () => {
  const { spec, patterns } = loadMachine();
  const through = mkEngine();
  through.advance(2 * H + 123);
  const snap = through.snapshot();
  const tail = through.advance(6 * H);
  const resumed = Engine.restore(snap, { seed: 5, spec, patterns, atlas: loadAtlas(), economy: loadEconomy() });
  expect(resumed.advance(6 * H)).toEqual(tail);
  expect(resumed.snapshot()).toEqual(through.snapshot());
});

test('留守中サマリーは留守中の達成数', () => {
  const eng = mkEngine();
  const evs = eng.advance(4 * H + 1);
  const away = eng.awaySummary();
  expect(away).not.toBeNull();
  const inAway = evs.filter((e) => e.k === 'achieved' && e.at >= H + 300 && e.at < 4 * H).length;
  expect(inAway).toBe(2);
  expect(away?.achievements).toBe(inAway);
});

test('lookahead は状態を変えずに achieved を出す', () => {
  const eng = mkEngine();
  eng.advance(1);
  const before = eng.snapshot();
  const done = eng.project().achievements.done.length;
  const la = eng.lookahead(H);
  expect(achievedIds(la)).toContain('ballsTotal_1e4');
  expect(eng.snapshot()).toEqual(before);
  expect(eng.project().achievements.done.length).toBe(done);
});

test('旧 v5 から復元すると、満たしている実績が最初の tick でまとめて達成になる', () => {
  const { spec, patterns } = loadMachine();
  const through = mkEngine();
  const evs = through.advance(3 * H + 500);
  const snap = through.snapshot();
  const expected = achievedIds([...evs, ...through.advance(3 * H + 1001)]);
  const econ: Record<string, unknown> = { ...(snap.economy as Record<string, unknown>), v: 5 };
  delete econ['achieved'];
  delete econ['awakenTotal'];
  const legacy: EngineSnapshot = { ...snap, economy: econ };
  const eng = Engine.restore(legacy, { seed: 5, spec, patterns, atlas: loadAtlas(), economy: loadEconomy() });
  expect(eng.project().achievements.done).toEqual([]);
  const first = eng.advance(3 * H + 1001);
  const got = first.filter((e) => e.k === 'achieved');
  // 一覧の順に並ぶ（通しでは達成順）。集合としては同じ。
  expect(got.map((e) => (e.k === 'achieved' ? e.id : '')).sort()).toEqual(expected.slice().sort());
  for (const e of got) {
    expect(e.at).toBe(3 * H + 1000);
  }
});

test('旧 v5 の awakenTotal は今の周回の Σawakened', () => {
  const econ = loadEconomy();
  const v5: Record<string, unknown> = {
    ...(econ.snapshot() as unknown as Record<string, unknown>),
    v: 5,
    awakened: [2, 1, 0, 0, 0, 0, 0, 0],
  };
  delete v5['achieved'];
  delete v5['awakenTotal'];
  const old = loadEconomy();
  old.restore(v5);
  expect(old.getAwakenTotal()).toBe(3);
  expect(old.snapshot().v).toBe(8);
  expect(old.onAchievementTick(0, NO_ENGINE)).toEqual(['awakenTotal_1']);
});

test('閉店しても達成・achMult・覚醒の累計は残る', () => {
  const econ = loadEconomy();
  econ.onGrant(0, 40, '2026-09-28', 0, 0);
  econ.onBuy('windmill', 100, 1e12, 0);
  expect(econ.onAwaken('windmill', 40).ok).toBe(true);
  econ.noteGain(2e10);
  const ids = econ.onAchievementTick(1000, NO_ENGINE);
  expect(ids).toContain('awakenTotal_1');
  expect(ids).toContain('ballsTotal_1e10');
  const mult = econ.achMult();
  expect(mult).toBe(1 + 0.01 * ids.length);
  expect(econ.onClose(0).ok).toBe(true);
  expect(econ.onOpen().ok).toBe(true);
  expect(econ.achMult()).toBe(mult);
  expect(econ.getAwakenTotal()).toBe(1);
  expect(econ.getAchievementsView(NO_ENGINE).done.length).toBe(ids.length);
  // 閉店で yakumono が 0 に戻っても、達成は残る。
  expect(econ.getAchievementsView(NO_ENGINE).metrics.yakumono).toBe(0);
  expect(econ.onAchievementTick(2000, { ...NO_ENGINE, closes: 1 })).toEqual(['closes_1']);
});

test('一覧から消えた id は snapshot に残すが数えない', () => {
  const econ = loadEconomy();
  const snap = { ...(econ.snapshot() as unknown as Record<string, unknown>), achieved: [{ id: 'gone_1', at: 0 }, { id: 'closes_1', at: 5 }] };
  econ.restore(snap);
  expect(econ.achMult()).toBe(1.01);
  expect(econ.snapshot().achieved).toEqual([{ id: 'gone_1', at: 0 }, { id: 'closes_1', at: 5 }]);
  // 消えた id が一覧に無いだけで、残りの判定は普通に進む（closes_1 は二重に出ない）。
  expect(econ.onAchievementTick(1000, { ...NO_ENGINE, closes: 3 })).toEqual(['closes_3']);
  const dup = { ...(econ.snapshot() as unknown as Record<string, unknown>), achieved: [{ id: 'x', at: 0 }, { id: 'x', at: 1 }] };
  expect(() => loadEconomy().restore(dup)).toThrow();
});
