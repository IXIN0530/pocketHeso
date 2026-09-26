import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  jackpotThresholdU32,
  parseMachine,
  parseMachineText,
  parsePatterns,
  parsePatternsText,
} from './machine.ts';

function machineFixture(): Record<string, unknown> {
  return {
    id: 'light-middle-01',
    version: 1,
    tier: 'middle',
    modes: {
      normal: { jackpot_1_in: 199.8, st_spins: 0 },
      st: { jackpot_1_in: 39.9, st_spins: 100 },
    },
    jackpot_split: [
      { kind: 'kakuhen', weight: 50, rounds: 10 },
      { kind: 'tsujo', weight: 50, rounds: 4 },
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
    ],
  };
}

function patternsFixture(): unknown {
  return [
    { id: 'normal_short', ms: 5000, hit_w: 0, miss_w: 600, hot: 0 },
    { id: 'reach_n', ms: 20000, hit_w: 5, miss_w: 150, hot: 1 },
    { id: 'sp_reach', ms: 45000, hit_w: 30, miss_w: 40, hot: 3, climax_ms: 38000 },
    { id: 'spsp_gekiatsu', ms: 70000, hit_w: 55, miss_w: 5, hot: 4, climax_ms: 62000 },
    { id: 'kakutei', ms: 60000, hit_w: 10, miss_w: 0, hot: 5, climax_ms: 50000 },
  ];
}

function clone(v: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
}

test('1/199.8 の閾値が期待値と一致する', () => {
  expect(jackpotThresholdU32(199.8)).toBe(21496332);
  expect(jackpotThresholdU32(39.9)).toBe(107643290);
  const t = jackpotThresholdU32(199.8);
  expect(t).toBeGreaterThan(0);
  expect(t <= 4294967296 / 199.8).toBe(true);
  expect(t + 1 > 4294967296 / 199.8).toBe(true);
});

test('機種 JSON を検証して読み込み、閾値を変換する', () => {
  const spec = parseMachineText(JSON.stringify(machineFixture()));
  expect(spec.id).toBe('light-middle-01');
  expect(spec.tier).toBe('middle');
  expect(spec.normal.jackpot1In).toBe(199.8);
  expect(spec.normal.thresholdU32).toBe(21496332);
  expect(spec.st.thresholdU32).toBe(107643290);
  expect(spec.st.stSpins).toBe(100);
  expect(spec.jackpotSplit.length).toBe(2);
  expect(spec.roundCount).toBe(10);
  expect(spec.payoutPerBall).toBe(15);
  expect(spec.hesoPayout).toBe(3);
  expect(spec.holdMax).toBe(4);
  expect(spec.holdColors.length).toBe(4);
});

test('変動パターン JSON を検証して読み込む', () => {
  const table = parsePatternsText(JSON.stringify(patternsFixture()));
  expect(table.length).toBe(5);
  expect((table[0] as { id: string }).id).toBe('normal_short');
  expect((table[2] as { climaxMs?: number }).climaxMs).toBe(38000);
  expect((table[0] as { climaxMs?: number }).climaxMs).toBeUndefined();
});

test('resources/machines の JSON が検証を通る', () => {
  const machineText = readFileSync('../../resources/machines/light-middle-01.json', 'utf8');
  const spec = parseMachineText(machineText);
  expect(spec.normal.thresholdU32).toBe(21496332);
  const patternsText = readFileSync('../../resources/machines/patterns.json', 'utf8');
  expect(parsePatternsText(patternsText).length).toBe(5);
});

test('不正な機種・パターンを拒否する', () => {
  expect(() => jackpotThresholdU32(1)).toThrow();
  expect(() => jackpotThresholdU32(Number.NaN)).toThrow();
  expect(() => jackpotThresholdU32(Number.POSITIVE_INFINITY)).toThrow();

  const badRate = clone(machineFixture());
  ((badRate['modes'] as Record<string, unknown>)['normal'] as Record<string, unknown>)['jackpot_1_in'] = 1;
  expect(() => parseMachine(badRate)).toThrow();

  const badTier = clone(machineFixture());
  badTier['tier'] = 'heavy';
  expect(() => parseMachine(badTier)).toThrow();

  const dupKind = clone(machineFixture());
  const split = dupKind['jackpot_split'] as unknown[];
  split.push(split[0]);
  expect(() => parseMachine(dupKind)).toThrow();

  const zeroWeight = clone(machineFixture());
  ((zeroWeight['jackpot_split'] as Array<Record<string, unknown>>)[0] as Record<string, unknown>)['weight'] = 0;
  expect(() => parseMachine(zeroWeight)).not.toThrow();

  const zeroNormal = clone(machineFixture());
  for (const b of zeroNormal['jackpot_split'] as Array<Record<string, unknown>>) {
    b['weight'] = 0;
    b['weight_st'] = 10;
  }
  expect(() => parseMachine(zeroNormal)).toThrow();

  const zeroSt = clone(machineFixture());
  for (const b of zeroSt['jackpot_split'] as Array<Record<string, unknown>>) {
    b['weight_st'] = 0;
  }
  expect(() => parseMachine(zeroSt)).toThrow();

  const negSt = clone(machineFixture());
  ((negSt['jackpot_split'] as Array<Record<string, unknown>>)[0] as Record<string, unknown>)['weight_st'] = -1;
  expect(() => parseMachine(negSt)).toThrow();

  const dupColor = clone(machineFixture());
  const colors = dupColor['hold_colors'] as unknown[];
  colors.push(colors[0]);
  expect(() => parseMachine(dupColor)).toThrow();

  const badHoldMax = clone(machineFixture());
  badHoldMax['hold_max'] = 0;
  expect(() => parseMachine(badHoldMax)).toThrow();

  expect(() => parseMachine({})).toThrow();
  expect(() => parseMachineText('not json')).toThrow();

  const dupId = patternsFixture() as Array<Record<string, unknown>>;
  dupId.push(dupId[0] as Record<string, unknown>);
  expect(() => parsePatterns(dupId)).toThrow();

  const badHot = patternsFixture() as Array<Record<string, unknown>>;
  (badHot[0] as Record<string, unknown>)['hot'] = 6;
  expect(() => parsePatterns(badHot)).toThrow();

  const badClimax = patternsFixture() as Array<Record<string, unknown>>;
  (badClimax[2] as Record<string, unknown>)['climax_ms'] = 45000;
  expect(() => parsePatterns(badClimax)).toThrow();

  expect(() => parsePatterns([])).toThrow();
  expect(() => parsePatternsText('not json')).toThrow();
});

test('weight_st はST中の振分け重み（省略時はweight）・同種別でもラウンド違いは並べられる', () => {
  const light = parseMachine(machineFixture());
  expect(light.jackpotSplit.map((b) => b.weightSt)).toEqual([50, 50]);
  const rush = parseMachineText(readFileSync('../../resources/machines/rush-middle-01.json', 'utf8'));
  expect(rush.jackpotSplit).toEqual([
    { kind: 'kakuhen', weight: 0, weightSt: 100, rounds: 10 },
    { kind: 'kakuhen', weight: 35, weightSt: 0, rounds: 3 },
    { kind: 'tsujo', weight: 65, weightSt: 0, rounds: 3 },
  ]);
  expect(rush.normal.jackpot1In).toBe(349.9);
  expect(rush.st.stSpins).toBe(75);
});
