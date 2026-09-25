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
  jackpotMedals,
  jackpotPayoutBalls,
  modeOf,
} from './lottery.ts';
import { RNGStream } from './rng.ts';

/** カイ二乗の上側1%点（自由度3の標準表）。 */
const CHI2_CRIT_DF3_1PCT = 11.345;

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

test(
  '100万取得で当選率が 1/199.8 ±3σ（ST も同様）・色と振分けも重みどおり',
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
    let whiteHits = 0;
    let goldMiss = 0;
    let hitBlue = 0;
    let hitGreen = 0;
    let hitRed = 0;
    let hitGold = 0;
    let missBlue = 0;
    let missGreen = 0;
    let missRed = 0;
    let missWhite = 0;
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
        if (e.color === 'blue') {
          hitBlue = hitBlue + 1;
        } else if (e.color === 'green') {
          hitGreen = hitGreen + 1;
        } else if (e.color === 'red') {
          hitRed = hitRed + 1;
        } else if (e.color === 'gold') {
          hitGold = hitGold + 1;
        } else {
          whiteHits = whiteHits + 1;
        }
      } else {
        if (e.branchIndex !== null) {
          badMissBranch = badMissBranch + 1;
        }
        if (e.patternIndex === kakuteiIdx) {
          badMissPattern = badMissPattern + 1;
        }
        if (e.color === 'blue') {
          missBlue = missBlue + 1;
        } else if (e.color === 'green') {
          missGreen = missGreen + 1;
        } else if (e.color === 'red') {
          missRed = missRed + 1;
        } else if (e.color === 'white') {
          missWhite = missWhite + 1;
        } else {
          goldMiss = goldMiss + 1;
        }
      }
    }

    const pN = 1 / 199.8;
    const expN = n * pN;
    const sdN = Math.sqrt(n * pN * (1 - pN));
    expect(hits).toBeGreaterThanOrEqual(Math.ceil(expN - 3 * sdN));
    expect(hits).toBeLessThanOrEqual(Math.floor(expN + 3 * sdN));

    const sdSplit = Math.sqrt(hits) / 2;
    expect(kakuhen).toBeGreaterThanOrEqual(Math.ceil(hits / 2 - 3 * sdSplit));
    expect(kakuhen).toBeLessThanOrEqual(Math.floor(hits / 2 + 3 * sdSplit));

    expect(chiSquare([hitBlue, hitGreen, hitRed, hitGold], [hits * 0.1, hits * 0.2, hits * 0.5, hits * 0.2])).toBeLessThan(
      CHI2_CRIT_DF3_1PCT,
    );
    const miss = n - hits;
    expect(
      chiSquare([missBlue, missGreen, missRed, missWhite], [miss * 0.9, miss * 0.07, miss * 0.025, miss * 0.005]),
    ).toBeLessThan(CHI2_CRIT_DF3_1PCT);

    expect(badHitPattern).toBe(0);
    expect(badMissPattern).toBe(0);
    expect(badMissBranch).toBe(0);
    expect(whiteHits).toBe(0);
    expect(goldMiss).toBe(0);

    let stHits = 0;
    for (let s = 0; s < n; s = s + 1) {
      if (drawHold(spec, patterns, 987654321, 'st', s, 1).isHit) {
        stHits = stHits + 1;
      }
    }
    const pS = 1 / 39.9;
    const expS = n * pS;
    const sdS = Math.sqrt(n * pS * (1 - pS));
    expect(stHits).toBeGreaterThanOrEqual(Math.ceil(expS - 3 * sdS));
    expect(stHits).toBeLessThanOrEqual(Math.floor(expS + 3 * sdS));
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
      const cw = holdColorWeights(spec, e.isHit);
      expect(e.color).toBe(LOTTERY_HOLD_COLORS[new RNGStream(seed, 'holdColor', serial).pick(cw) as number]);
      const baseHot = (patterns[e.patternIndex] as SpinPattern).hot;
      let wantHot = baseHot;
      if (e.color === 'red') {
        wantHot = Math.min(5, baseHot + 1);
      }
      if (e.color === 'gold') {
        wantHot = 5;
      }
      expect(e.hot).toBe(wantHot);
      if (e.isHit) {
        expect(e.branchIndex).toBe(new RNGStream(seed, 'split', serial).pick(spec.jackpotSplit.map((b) => b.weight)));
      } else {
        expect(e.branchIndex).toBeNull();
      }
      expect(e.hesoPayoutBalls).toBe(3);
    }
  }
  expect(drawHold(spec, patterns, seed, 'normal', 0, 1)).toEqual(drawHold(spec, patterns, seed, 'normal', 0, 1));
});

test('保留色の white 残余が分母の10べきカバーになる（D-032）', () => {
  const { spec } = loadMachine();
  expect(holdColorWeights(spec, true)).toEqual([10, 20, 50, 20, 0]);
  expect(holdColorWeights(spec, false)).toEqual([900, 70, 25, 0, 5]);
});

test('レート倍率とメダル・不正入力', () => {
  const { spec, patterns } = loadMachine();
  expect(hesoPayoutBalls(spec, 1)).toBe(3);
  expect(hesoPayoutBalls(spec, 4)).toBe(12);
  expect(jackpotPayoutBalls(spec, 0, 1)).toBe(1500);
  expect(jackpotPayoutBalls(spec, 1, 4)).toBe(2400);
  expect(jackpotMedals(spec, 0)).toBe(2);
  expect(jackpotMedals(spec, 1)).toBe(1);
  expect(() => hesoPayoutBalls(spec, 0)).toThrow();
  expect(() => jackpotPayoutBalls(spec, 0, 0)).toThrow();
  expect(() => jackpotPayoutBalls(spec, 2, 1)).toThrow();
  expect(() => jackpotMedals(spec, -1)).toThrow();
  expect(() => drawHold(spec, patterns, 1, 'normal', -1, 1)).toThrow();
  expect(() => drawHold(spec, patterns, 1, 'normal', 1.5, 1)).toThrow();
  expect(() => drawHold(spec, patterns, 1, 'normal', 0, 0)).toThrow();
  expect(() => modeOf(spec, 'turbo' as LotteryMode)).toThrow();
  expect(() => drawHold(spec, [], 1, 'normal', 0, 1)).toThrow();
});
