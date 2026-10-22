import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachine, parseMachineText, parsePatternsText } from './machine.ts';
import type { HoldEntry, LotteryMode } from './lottery.ts';
import { drawHold, modeOf, splitWeights } from './lottery.ts';
import { SpinMachine } from './spin.ts';
import type { SpinEvent } from './spin.ts';

function loadPatterns(): PatternTable {
  return parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
}

function testSpecFixture(): MachineSpec {
  return parseMachine({
    id: 'test-jitan-lt-01',
    version: 1,
    tier: 'middle',
    modes: {
      normal: { jackpot_1_in: 199.8, spins: 0 },
      jitan: { jackpot_1_in: 199.8, spins: 2 },
      st: { jackpot_1_in: 39.9, spins: 3 },
      lt: { jackpot_1_in: 39.9, spins: 2 },
    },
    jackpot_split: [
      { kind: 'tsujo', weight: 75, weight_jitan: 0, weight_st: 0, weight_lt: 0, rounds: 3, next: 'jitan' },
      { kind: 'kakuhen', weight: 25, weight_jitan: 100, weight_st: 0, weight_lt: 0, rounds: 3, next: 'st' },
      { kind: 'kakuhen', weight: 0, weight_jitan: 0, weight_st: 96, weight_lt: 0, rounds: 10, next: 'st' },
      { kind: 'kakuhen', weight: 0, weight_jitan: 0, weight_st: 4, weight_lt: 100, rounds: 10, next: 'lt' },
    ],
    round: { count: 10, payout_per_ball: 15, ms_per_round: 25000 },
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
}

function patternIndexOf(patterns: PatternTable, id: string): number {
  for (let i = 0; i < patterns.length; i = i + 1) {
    if ((patterns[i] as { id: string }).id === id) {
      return i;
    }
  }
  throw new Error('pattern not found: ' + id);
}

function makeEntry(
  serial: number,
  modeAtDraw: LotteryMode,
  patternIndex: number,
  isHit: boolean,
  branchIndex: number | null,
): HoldEntry {
  return { serial, modeAtDraw, isHit, branchIndex, patternIndex, color: 'white', hot: 0, hesoPayoutBalls: 3 };
}

test('既存機種は省略時の既定値で今と同じ動き（jitan/ltなし・split既定）', () => {
  const light = parseMachineText(readFileSync('../../resources/machines/light-middle-01.json', 'utf8'));
  const rush = parseMachineText(readFileSync('../../resources/machines/rush-middle-01.json', 'utf8'));
  expect(light.jitan).toBeUndefined();
  expect(light.lt).toBeUndefined();
  expect(rush.jitan).toBeUndefined();
  expect(rush.lt).toBeUndefined();
  expect(light.jackpotSplit).toEqual([
    { kind: 'kakuhen', weight: 50, weightSt: 50, rounds: 10 },
    { kind: 'tsujo', weight: 50, weightSt: 50, rounds: 4 },
  ]);
  expect(splitWeights(light, 'jitan')).toEqual(splitWeights(light, 'normal'));
  expect(splitWeights(light, 'lt')).toEqual(splitWeights(light, 'st'));
  expect(splitWeights(rush, 'jitan')).toEqual([0, 0, 35, 65]);
  expect(splitWeights(rush, 'lt')).toEqual([75, 25, 0, 0]);
  expect(() => modeOf(light, 'jitan')).toThrow();
  expect(() => modeOf(light, 'lt')).toThrow();
  expect(modeOf(light, 'normal').thresholdU32).toBe(light.normal.thresholdU32);
  expect(modeOf(light, 'st').thresholdU32).toBe(light.st.thresholdU32);
});

test('spins/st_spins両対応・next/weight既定・不正の拒否', () => {
  const base = {
    id: 'x',
    version: 1,
    tier: 'middle',
    modes: {
      normal: { jackpot_1_in: 199.8, st_spins: 0 },
      st: { jackpot_1_in: 39.9, spins: 10 },
    },
    jackpot_split: [{ kind: 'kakuhen', weight: 50, rounds: 10 }],
    round: { count: 10, payout_per_ball: 15, ms_per_round: 25000 },
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
  };
  const spec = parseMachine(JSON.parse(JSON.stringify(base)) as unknown);
  expect(spec.st.stSpins).toBe(10);
  expect(spec.jackpotSplit).toEqual([{ kind: 'kakuhen', weight: 50, weightSt: 50, rounds: 10 }]);
  const bothSame = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  ((bothSame['modes'] as Record<string, unknown>)['st'] as Record<string, unknown>)['st_spins'] = 10;
  expect(parseMachine(bothSame).st.stSpins).toBe(10);
  const bothDiff = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  ((bothDiff['modes'] as Record<string, unknown>)['st'] as Record<string, unknown>)['spins'] = 11;
  ((bothDiff['modes'] as Record<string, unknown>)['st'] as Record<string, unknown>)['st_spins'] = 10;
  expect(() => parseMachine(bothDiff)).toThrow();
  const badNext = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  ((badNext['jackpot_split'] as Array<Record<string, unknown>>)[0] as Record<string, unknown>)['next'] = 'lt';
  expect(() => parseMachine(badNext)).toThrow();
  const dupNext = {
    ...JSON.parse(JSON.stringify(base)) as Record<string, unknown>,
    modes: {
      normal: { jackpot_1_in: 199.8, st_spins: 0 },
      st: { jackpot_1_in: 39.9, st_spins: 10 },
    },
    jackpot_split: [
      { kind: 'kakuhen', weight: 50, rounds: 10, next: 'st' },
      { kind: 'kakuhen', weight: 50, rounds: 10 },
    ],
  };
  expect(() => parseMachine(dupNext)).toThrow();
  const distinctNext = {
    ...JSON.parse(JSON.stringify(base)) as Record<string, unknown>,
    modes: {
      normal: { jackpot_1_in: 199.8, st_spins: 0 },
      jitan: { jackpot_1_in: 199.8, spins: 2 },
      st: { jackpot_1_in: 39.9, st_spins: 10 },
    },
    jackpot_split: [
      { kind: 'kakuhen', weight: 50, rounds: 10, next: 'st' },
      { kind: 'kakuhen', weight: 50, rounds: 10, next: 'jitan' },
    ],
  };
  expect(() => parseMachine(distinctNext)).not.toThrow();
});

test('手書きシナリオ: 通常→通常当たり→時短→引き戻し→RUSH→LT昇格→LT→LT抜け→通常', () => {
  const spec = testSpecFixture();
  const patterns = loadPatterns();
  const shortIdx = patternIndexOf(patterns, 'normal_short');
  const kakuteiIdx = patternIndexOf(patterns, 'kakutei');
  const m = new SpinMachine(spec, patterns);
  const all: SpinEvent[] = [];
  const run = (evs: SpinEvent[]): void => {
    for (let i = 0; i < evs.length; i = i + 1) {
      all.push(evs[i] as SpinEvent);
    }
  };
  let cur = 0;

  run(m.startSpin(makeEntry(0, 'normal', kakuteiIdx, true, 0), cur, 1));
  expect(all[0]).toEqual({ k: 'spinStarted', entry: 0, at: 0, pattern: 'kakutei', endsAt: 30000 });
  cur = 30000;
  run(m.resolveSpin(cur));
  expect(all[1]).toEqual({ k: 'spinResolved', entry: 0, at: cur, hit: true });
  expect(all[2]).toEqual({ k: 'jackpotStarted', entry: 0, at: cur, kind: 'tsujo', rounds: 3 });
  cur = cur + 3 * 25000;
  run(m.finishJackpot(cur, 1));
  expect(all[3]).toEqual({ k: 'jackpotEnded', entry: 0, at: cur, payout: 450 });
  expect(all[4]).toEqual({ k: 'modeChanged', to: 'jitan', at: cur, stRemaining: 2 });
  expect(m.mode).toBe('jitan');
  expect(m.stRemaining).toBe(2);

  run(m.startSpin(makeEntry(1, 'jitan', shortIdx, false, null), cur, 1));
  cur = cur + 5000;
  run(m.resolveSpin(cur));
  expect(all[all.length - 1]).toEqual({ k: 'spinResolved', entry: 1, at: cur, hit: false });
  expect(m.mode).toBe('jitan');
  expect(m.stRemaining).toBe(1);

  run(m.startSpin(makeEntry(2, 'jitan', kakuteiIdx, true, 1), cur, 0));
  const hitAt = cur + 30000;
  run(m.resolveSpin(hitAt));
  expect(all[all.length - 2]).toEqual({ k: 'spinResolved', entry: 2, at: hitAt, hit: true });
  expect(all[all.length - 1]).toEqual({ k: 'jackpotStarted', entry: 2, at: hitAt, kind: 'kakuhen', rounds: 3 });
  cur = hitAt + 3 * 25000;
  run(m.finishJackpot(cur, 1));
  expect(all[all.length - 2]).toEqual({ k: 'jackpotEnded', entry: 2, at: cur, payout: 450 });
  expect(all[all.length - 1]).toEqual({ k: 'modeChanged', to: 'st', at: cur, stRemaining: 3 });
  expect(m.mode).toBe('st');

  run(m.startSpin(makeEntry(3, 'st', shortIdx, false, null), cur, 0));
  cur = cur + 5000;
  run(m.resolveSpin(cur));
  expect(m.stRemaining).toBe(2);

  run(m.startSpin(makeEntry(4, 'st', kakuteiIdx, true, 3), cur, 0));
  const ltAt = cur + 30000;
  run(m.resolveSpin(ltAt));
  expect(all[all.length - 1]).toEqual({ k: 'jackpotStarted', entry: 4, at: ltAt, kind: 'kakuhen', rounds: 10 });
  cur = ltAt + 10 * 25000;
  run(m.finishJackpot(cur, 1));
  expect(all[all.length - 2]).toEqual({ k: 'jackpotEnded', entry: 4, at: cur, payout: 1500 });
  expect(all[all.length - 1]).toEqual({ k: 'modeChanged', to: 'lt', at: cur, stRemaining: 2 });
  expect(m.mode).toBe('lt');

  run(m.startSpin(makeEntry(5, 'lt', kakuteiIdx, true, 3), cur, 0));
  const lt2At = cur + 30000;
  run(m.resolveSpin(lt2At));
  cur = lt2At + 10 * 25000;
  run(m.finishJackpot(cur, 1));
  expect(all[all.length - 1]).toEqual({ k: 'modeChanged', to: 'lt', at: cur, stRemaining: 2 });
  expect(m.mode).toBe('lt');
  expect(m.stRemaining).toBe(2);

  run(m.startSpin(makeEntry(6, 'lt', shortIdx, false, null), cur, 0));
  cur = cur + 5000;
  run(m.resolveSpin(cur));
  expect(m.mode).toBe('lt');
  expect(m.stRemaining).toBe(1);

  run(m.startSpin(makeEntry(7, 'lt', shortIdx, false, null), cur, 0));
  cur = cur + 5000;
  const tail = m.resolveSpin(cur);
  run(tail);
  expect(tail).toEqual([
    { k: 'spinResolved', entry: 7, at: cur, hit: false },
    { k: 'modeChanged', to: 'normal', at: cur, stRemaining: 0 },
  ]);
  expect(m.mode).toBe('normal');
  expect(m.stRemaining).toBe(0);

  const kinds = all.map((e) => e.k);
  expect(kinds).toEqual([
    'spinStarted',
    'spinResolved',
    'jackpotStarted',
    'jackpotEnded',
    'modeChanged',
    'spinStarted',
    'spinResolved',
    'spinStarted',
    'spinResolved',
    'jackpotStarted',
    'jackpotEnded',
    'modeChanged',
    'spinStarted',
    'spinResolved',
    'spinStarted',
    'spinResolved',
    'jackpotStarted',
    'jackpotEnded',
    'modeChanged',
    'spinStarted',
    'spinResolved',
    'jackpotStarted',
    'jackpotEnded',
    'modeChanged',
    'spinStarted',
    'spinResolved',
    'spinStarted',
    'spinResolved',
    'modeChanged',
  ]);
  const modes = all.filter((e) => e.k === 'modeChanged').map((e) => (e as { to: string }).to);
  expect(modes).toEqual(['jitan', 'st', 'lt', 'lt', 'normal']);

  const snap = m.snapshot();
  const restored = SpinMachine.restore(spec, patterns, snap);
  expect(restored.snapshot()).toEqual(snap);
});

test(
  '時短・LT中の取得はそのモードの確率と重みで判定される（100万取得で±3σ）',
  { timeout: 180000 },
  () => {
    const spec = testSpecFixture();
    const patterns = loadPatterns();
    const n = 1000000;
    let jitanHits = 0;
    let jitanBadBranch = 0;
    for (let s = 0; s < n; s = s + 1) {
      const e = drawHold(spec, patterns, 777001, 'jitan', s, 1);
      if (e.isHit) {
        jitanHits = jitanHits + 1;
        if (e.branchIndex !== 1) {
          jitanBadBranch = jitanBadBranch + 1;
        }
      } else if (e.branchIndex !== null) {
        jitanBadBranch = jitanBadBranch + 1;
      }
    }
    const pJ = 1 / 199.8;
    const expJ = n * pJ;
    const sdJ = Math.sqrt(n * pJ * (1 - pJ));
    expect(jitanHits).toBeGreaterThanOrEqual(Math.ceil(expJ - 3 * sdJ));
    expect(jitanHits).toBeLessThanOrEqual(Math.floor(expJ + 3 * sdJ));
    expect(jitanBadBranch).toBe(0);

    let ltHits = 0;
    let ltBadBranch = 0;
    for (let s = 0; s < n; s = s + 1) {
      const e = drawHold(spec, patterns, 777002, 'lt', s, 1);
      if (e.isHit) {
        ltHits = ltHits + 1;
        if (e.branchIndex !== 3) {
          ltBadBranch = ltBadBranch + 1;
        }
      } else if (e.branchIndex !== null) {
        ltBadBranch = ltBadBranch + 1;
      }
    }
    const pL = 1 / 39.9;
    const expL = n * pL;
    const sdL = Math.sqrt(n * pL * (1 - pL));
    expect(ltHits).toBeGreaterThanOrEqual(Math.ceil(expL - 3 * sdL));
    expect(ltHits).toBeLessThanOrEqual(Math.floor(expL + 3 * sdL));
    expect(ltBadBranch).toBe(0);
  },
);
