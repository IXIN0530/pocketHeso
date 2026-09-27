import { readFileSync } from 'node:fs';
import { LOTTERY_HOLD_COLORS, holdColorWeights, modeOf, parseMachineText, type LotteryHoldColor, type LotteryMode } from '@ph/core';
import { expect, test } from 'vitest';
import {
  HOLD_BREAK_MS,
  SAKIBARE_DELAY_MS,
  holdChangeCue,
  holdColorAt,
  planHoldChange,
  sakibareAt,
  type HoldChangePlan,
} from './hold-change.ts';

test('白は変化しない・同じ seed と serial なら同じ見せ方', () => {
  for (let s = 0; s < 200; s++) expect(planHoldChange(7, s, 'white')).toEqual({ final: 'white', change: false, sakibare: false });
  expect(planHoldChange(7, 123, 'gold')).toEqual(planHoldChange(7, 123, 'gold'));
});

test('先バレは必ず変化で見せる・先バレしなかった保留のうち変化の割合は 青20%・緑35%・赤45%・金55%', () => {
  const n = 20000;
  const want: [LotteryHoldColor, number][] = [['blue', 0.2], ['green', 0.35], ['red', 0.45], ['gold', 0.55]];
  for (const [final, x] of want) {
    let plain = 0;
    let changed = 0;
    for (let s = 0; s < n; s++) {
      const p = planHoldChange(42, s, final);
      expect(p.final).toBe(final);
      if (p.sakibare) {
        expect(p.change).toBe(true);
        continue;
      }
      plain++;
      if (p.change) changed++;
    }
    expect(changed / plain).toBeCloseTo(x, 1);
  }
});

/** 色ごとの先バレの割合（実測。LOTTERY_HOLD_COLORS と同順）。 */
function sakibareRates(n: number): number[] {
  return LOTTERY_HOLD_COLORS.map((color) => {
    let k = 0;
    for (let s = 0; s < n; s++) if (planHoldChange(11, s, color).sakibare) k++;
    return k / n;
  });
}

/** 保留色の表と色ごとの先バレの割合から、先バレの信頼度（当たる割合）と当たりに付く割合を出す。 */
function sakibareStats(machine: string, mode: LotteryMode, f: readonly number[]): { rel: number; ofHits: number } {
  const spec = parseMachineText(readFileSync(new URL(`../../../resources/machines/${machine}.json`, import.meta.url), 'utf8'));
  const p = modeOf(spec, mode).thresholdU32 / 4294967296;
  const wHit = holdColorWeights(spec, mode, true);
  const wMiss = holdColorWeights(spec, mode, false);
  const sHit = wHit.reduce((a, b) => a + b, 0);
  const sMiss = wMiss.reduce((a, b) => a + b, 0);
  let hit = 0;
  let all = 0;
  for (let i = 0; i < f.length; i++) {
    const h = (p * wHit[i]!) / sHit;
    hit += f[i]! * h;
    all += f[i]! * (h + ((1 - p) * wMiss[i]!) / sMiss);
  }
  return { rel: hit / all, ofHits: hit / p };
}

test('先バレ: 色だけで決まり（白はなし）、通常時の表では信頼度が約40%（3機種）', () => {
  const f = sakibareRates(40000);
  const rate = (c: LotteryHoldColor) => f[LOTTERY_HOLD_COLORS.indexOf(c)]!;
  expect(rate('white')).toBe(0);
  // 青10%・緑18%・赤24%・金35%（熱い色ほど先バレしやすい）。
  const want: [LotteryHoldColor, number][] = [['blue', 0.1], ['green', 0.18], ['red', 0.24], ['gold', 0.35]];
  for (const [c, x] of want) expect(Math.abs(rate(c) - x)).toBeLessThan(0.01);
  for (const machine of ['light-middle-01', 'rush-middle-01', 'lt-middle-01']) {
    const normal = sakibareStats(machine, 'normal', f);
    expect(Math.abs(normal.rel - 0.4)).toBeLessThan(0.02);
    expect(normal.ofHits).toBeGreaterThan(0.2);
    // ST・LT の表（出たら熱い）では先バレもやや熱い。
    expect(sakibareStats(machine, 'st', f).rel).toBeGreaterThan(normal.rel);
  }
});

/** 色ごとの「灰色で点滅して出る」割合（先バレ＋変化。実測, LOTTERY_HOLD_COLORS と同順）。 */
function changeRates(n: number): number[] {
  return LOTTERY_HOLD_COLORS.map((color) => {
    let k = 0;
    for (let s = 0; s < n; s++) if (planHoldChange(11, s, color).change) k++;
    return k / n;
  });
}

test('灰色で点滅する保留の信頼度は通常時の表で約37%（3機種）', () => {
  const f = changeRates(40000);
  for (const machine of ['light-middle-01', 'rush-middle-01', 'lt-middle-01']) {
    expect(Math.abs(sakibareStats(machine, 'normal', f).rel - 0.37)).toBeLessThan(0.02);
  }
});

test('先バレの時刻: 取得の少し後（取得時刻が分からない・先バレしない時は null）', () => {
  const p: HoldChangePlan = { final: 'red', change: true, sakibare: true };
  expect(sakibareAt(p, 1000)).toBe(1000 + SAKIBARE_DELAY_MS);
  expect(sakibareAt(p, null)).toBeNull();
  expect(sakibareAt({ ...p, sakibare: false }, 1000)).toBeNull();
});

test('変化する保留は灰色のまま、自分の変動開始から割れる時刻に最終色になる', () => {
  const p: HoldChangePlan = { final: 'gold', change: true, sakibare: false };
  expect(holdColorAt(p, null, 1e12)).toBe('white');
  expect(holdColorAt(p, 5000, 5000 + HOLD_BREAK_MS.reveal - 1)).toBe('white');
  expect(holdColorAt(p, 5000, 5000 + HOLD_BREAK_MS.reveal)).toBe('gold');
  expect(holdColorAt({ ...p, change: false }, null, 0)).toBe('gold');
  // 玉になる → ひび → 割れる → 図柄が回る → 戻る、の順。
  const t = HOLD_BREAK_MS;
  expect(t.grow <= t.crack && t.crack < t.reveal && t.reveal < t.reels && t.reels < t.end).toBe(true);
  const colors: LotteryHoldColor[] = ['blue', 'green', 'red', 'gold'];
  expect(colors.map(holdChangeCue)).toEqual(['hold_blue', 'hold_green', 'hold_red', 'hold_gold']);
});
