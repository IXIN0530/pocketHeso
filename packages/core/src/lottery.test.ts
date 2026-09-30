import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable, SpinPattern } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import type { LotteryMode } from './lottery.ts';
import {
  LOTTERY_HOLD_COLORS,
  drawHold,
  hesoPayoutBalls,
  holdColorWeights,
  holdHot,
  jackpotPayoutBalls,
  modeOf,
  splitWeights,
} from './lottery.ts';
import { RNGStream } from './rng.ts';

/** カイ二乗の上側0.1%点（自由度4の標準表。固定 seed で5セルを4回検定するので1%点だと裾に入りやすい）。 */
const CHI2_CRIT_DF4 = 18.467;

function loadMachine(): { spec: MachineSpec; patterns: PatternTable } {
  const spec = parseMachineText(readFileSync('../../resources/machines/light-middle-01.json', 'utf8'));
  const patterns = parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
  return { spec, patterns };
}

function chiSquare(observed: readonly number[], expected: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < observed.length; i = i + 1) {
    const o = observed[i] as number;
    const e = expected[i] as number;
    const d = o - e;
    s = s + (d * d) / e;
  }
  return s;
}

/** 重み列を件数 total の期待度数にする。 */
function expectedCounts(weights: readonly number[], total: number): number[] {
  let sum = 0;
  for (const w of weights) {
    sum = sum + w;
  }
  return weights.map((w) => (total * w) / sum);
}

test(
  '100万取得で当選率が 機種 JSON の確率 ±3σ（ST も同様）・色（モード別の表）と振分けも重みどおり',
  { timeout: 180000 },
  () => {
    const { spec, patterns } = loadMachine();
    const n = 1000000;
    let shortIdx = -1;
    let kakuteiIdx = -1;
    for (let i = 0; i < patterns.length; i = i + 1) {
      const p = patterns[i] as SpinPattern;
      if (p.id === 'normal_short') {
        shortIdx = i;
      }
      if (p.id === 'kakutei') {
        kakuteiIdx = i;
      }
    }
    expect(shortIdx).toBeGreaterThanOrEqual(0);
    expect(kakuteiIdx).toBeGreaterThanOrEqual(0);

    let hits = 0;
    let kakuhen = 0;
    let badHitPattern = 0;
    let badMissPattern = 0;
    let badMissBranch = 0;
    const hitColors = [0, 0, 0, 0, 0];
    const missColors = [0, 0, 0, 0, 0];
    for (let s = 0; s < n; s = s + 1) {
      const e = drawHold(spec, patterns, 20260925, 'normal', s, 1);
      if (e.isHit) {
        hits = hits + 1;
        if (e.branchIndex === null) {
          badMissBranch = badMissBranch + 1;
        } else {
          const b = spec.jackpotSplit[e.branchIndex];
          if (b === undefined) {
            badMissBranch = badMissBranch + 1;
          } else if (b.kind === 'kakuhen') {
            kakuhen = kakuhen + 1;
          }
        }
        if (e.patternIndex === shortIdx) {
          badHitPattern = badHitPattern + 1;
        }
        const ci = LOTTERY_HOLD_COLORS.indexOf(e.color);
        hitColors[ci] = (hitColors[ci] as number) + 1;
      } else {
        if (e.branchIndex !== null) {
          badMissBranch = badMissBranch + 1;
        }
        if (e.patternIndex === kakuteiIdx) {
          badMissPattern = badMissPattern + 1;
        }
        const ci = LOTTERY_HOLD_COLORS.indexOf(e.color);
        missColors[ci] = (missColors[ci] as number) + 1;
      }
    }

    const pN = 1 / spec.normal.jackpot1In;
    const expN = n * pN;
    const sdN = Math.sqrt(n * pN * (1 - pN));
    expect(hits).toBeGreaterThanOrEqual(Math.ceil(expN - 3 * sdN));
    expect(hits).toBeLessThanOrEqual(Math.floor(expN + 3 * sdN));

    const sdSplit = Math.sqrt(hits) / 2;
    expect(kakuhen).toBeGreaterThanOrEqual(Math.ceil(hits / 2 - 3 * sdSplit));
    expect(kakuhen).toBeLessThanOrEqual(Math.floor(hits / 2 + 3 * sdSplit));

    const miss = n - hits;
    expect(chiSquare(hitColors, expectedCounts(holdColorWeights(spec, 'normal', true), hits))).toBeLessThan(CHI2_CRIT_DF4);
    expect(chiSquare(missColors, expectedCounts(holdColorWeights(spec, 'normal', false), miss))).toBeLessThan(CHI2_CRIT_DF4);

    expect(badHitPattern).toBe(0);
    expect(badMissPattern).toBe(0);
    expect(badMissBranch).toBe(0);

    let stHits = 0;
    const stHitColors = [0, 0, 0, 0, 0];
    const stMissColors = [0, 0, 0, 0, 0];
    for (let s = 0; s < n; s = s + 1) {
      const e = drawHold(spec, patterns, 987654321, 'st', s, 1);
      const ci = LOTTERY_HOLD_COLORS.indexOf(e.color);
      if (e.isHit) {
        stHits = stHits + 1;
        stHitColors[ci] = (stHitColors[ci] as number) + 1;
      } else {
        stMissColors[ci] = (stMissColors[ci] as number) + 1;
      }
    }
    const pS = 1 / 39.9;
    const expS = n * pS;
    const sdS = Math.sqrt(n * pS * (1 - pS));
    expect(stHits).toBeGreaterThanOrEqual(Math.ceil(expS - 3 * sdS));
    expect(stHits).toBeLessThanOrEqual(Math.floor(expS + 3 * sdS));
    expect(chiSquare(stHitColors, expectedCounts(holdColorWeights(spec, 'st', true), stHits))).toBeLessThan(CHI2_CRIT_DF4);
    expect(chiSquare(stMissColors, expectedCounts(holdColorWeights(spec, 'st', false), n - stHits))).toBeLessThan(
      CHI2_CRIT_DF4,
    );
  },
);

test('取得時判定が各ストリームの手計算と一致しモード別閾値を使う（D-017）', () => {
  const { spec, patterns } = loadMachine();
  const seed = 12345;
  const modes: readonly LotteryMode[] = ['normal', 'st'];
  for (let m = 0; m < modes.length; m = m + 1) {
    const mode = modes[m] as LotteryMode;
    const th = modeOf(spec, mode).thresholdU32;
    for (let serial = 0; serial < 4; serial = serial + 1) {
      const e = drawHold(spec, patterns, seed, mode, serial, 1);
      expect(e.isHit).toBe(new RNGStream(seed, 'jackpot', serial).nextU32() < th);
      expect(e.modeAtDraw).toBe(mode);
      expect(e.serial).toBe(serial);
      const pw = patterns.map((p) => (e.isHit ? p.hitW : p.missW));
      expect(e.patternIndex).toBe(new RNGStream(seed, 'pattern', serial).pick(pw));
      const cw = holdColorWeights(spec, mode, e.isHit);
      expect(e.color).toBe(LOTTERY_HOLD_COLORS[new RNGStream(seed, 'holdColor', serial).pick(cw) as number]);
      const baseHot = (patterns[e.patternIndex] as SpinPattern).hot;
      let wantHot = baseHot;
      if (e.color === 'red') {
        wantHot = Math.min(5, baseHot + 1);
      }
      if (e.color === 'gold') {
        wantHot = Math.min(5, baseHot + 2);
      }
      expect(e.hot).toBe(wantHot);
      if (e.isHit) {
        expect(e.branchIndex).toBe(new RNGStream(seed, 'split', serial).pick(spec.jackpotSplit.map((b) => b.weight)));
      } else {
        expect(e.branchIndex).toBeNull();
      }
      expect(e.hesoPayoutBalls).toBe(8);
    }
  }
  expect(drawHold(spec, patterns, seed, 'normal', 0, 1)).toEqual(drawHold(spec, patterns, seed, 'normal', 0, 1));
});

test('保留色の重みは取得時のモードの表（白も JSON に書く。通常・時短は hold_colors、ST・LT は hold_colors_st, P7-T4）', () => {
  const { spec } = loadMachine();
  // 並びは LOTTERY_HOLD_COLORS（青・緑・赤・金・白）。
  expect(holdColorWeights(spec, 'normal', true)).toEqual([10, 15, 40, 30, 5]);
  expect(holdColorWeights(spec, 'normal', false)).toEqual([723, 326, 218, 28, 98705]);
  expect(holdColorWeights(spec, 'st', true)).toEqual([15, 15, 15, 15, 40]);
  expect(holdColorWeights(spec, 'st', false)).toEqual([2185, 716, 165, 20, 96914]);
  const noSt = parseMachineText(readFileSync('../../resources/machines/light-middle-01.json', 'utf8').replace('"hold_colors_st"', '"_unused"'));
  expect(holdColorWeights(noSt, 'st', false)).toEqual(holdColorWeights(noSt, 'normal', false));
  expect(holdHot(3, 'white')).toBe(3);
  expect(holdHot(3, 'red')).toBe(4);
  expect(holdHot(3, 'gold')).toBe(5);
  expect(holdHot(1, 'gold')).toBe(3);
  expect(holdHot(5, 'red')).toBe(5);
});

test('レート倍率とメダル・不正入力', () => {
  const { spec, patterns } = loadMachine();
  expect(hesoPayoutBalls(spec, 1)).toBe(8);
  expect(hesoPayoutBalls(spec, 4)).toBe(32);
  expect(jackpotPayoutBalls(spec, 0, 1)).toBe(1500);
  expect(jackpotPayoutBalls(spec, 1, 4)).toBe(2400);
  expect(() => hesoPayoutBalls(spec, 0)).toThrow();
  expect(() => jackpotPayoutBalls(spec, 0, 0)).toThrow();
  expect(() => jackpotPayoutBalls(spec, 2, 1)).toThrow();
  expect(() => drawHold(spec, patterns, 1, 'normal', -1, 1)).toThrow();
  expect(() => drawHold(spec, patterns, 1, 'normal', 1.5, 1)).toThrow();
  expect(() => drawHold(spec, patterns, 1, 'normal', 0, 0)).toThrow();
  expect(() => modeOf(spec, 'turbo' as LotteryMode)).toThrow();
  expect(() => drawHold(spec, [], 1, 'normal', 0, 1)).toThrow();
});

test('振分けは取得時モードの重みを使う（rush-middle-01: 通常は3R確変35/通常65・STは10R確変のみ）', () => {
  const spec = parseMachineText(readFileSync('../../resources/machines/rush-middle-01.json', 'utf8'));
  const { patterns } = loadMachine();
  expect(splitWeights(spec, 'normal')).toEqual([0, 35, 65]);
  expect(splitWeights(spec, 'st')).toEqual([100, 0, 0]);
  const seed = 2026;
  const normalCounts = [0, 0, 0];
  for (let serial = 0; serial < 200000; serial = serial + 1) {
    const e = drawHold(spec, patterns, seed, 'normal', serial, 1);
    if (e.branchIndex !== null) {
      normalCounts[e.branchIndex] = (normalCounts[e.branchIndex] as number) + 1;
    }
  }
  const hits = (normalCounts[1] as number) + (normalCounts[2] as number);
  expect(normalCounts[0]).toBe(0);
  expect(hits).toBeGreaterThan(400);
  const sd = Math.sqrt(hits * 0.35 * 0.65);
  expect(Math.abs((normalCounts[1] as number) - hits * 0.35)).toBeLessThanOrEqual(3 * sd);
  let stHits = 0;
  for (let serial = 0; serial < 20000; serial = serial + 1) {
    const e = drawHold(spec, patterns, seed, 'st', serial, 1);
    if (e.branchIndex !== null) {
      expect(e.branchIndex).toBe(0);
      stHits = stHits + 1;
    }
  }
  expect(stHits).toBeGreaterThan(300);
});
