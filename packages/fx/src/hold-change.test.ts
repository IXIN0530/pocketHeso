import { readFileSync } from 'node:fs';
import {
  BONUS_SERIAL_BASE,
  GRANT_HOLD_SERIAL_BASE,
  LOTTERY_HOLD_COLORS,
  RESERVE_SERIAL_BASE,
  holdColorWeights,
  modeOf,
  parseMachineText,
  type LotteryHoldColor,
  type LotteryMode,
} from '@ph/core';
import { expect, test } from 'vitest';
import {
  HOLD_BREAK_MIN_REELS_MS,
  HOLD_BREAK_MS,
  HOLD_CRACK_STEPS_MS,
  SAKIBARE_CUSTOMS,
  SAKIBARE_CUSTOM_RATES,
  SAKIBARE_DELAY_MS,
  holdChangeCue,
  holdBreakScale,
  holdColorAt,
  holdHitProb,
  isSakibareCustom,
  planHoldChange,
  planSakibare,
  sakibareAt,
  sakibareProb,
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
  expect(HOLD_CRACK_STEPS_MS.every((ms, i) => ms > t.crack && ms < t.reveal && (i === 0 || ms > HOLD_CRACK_STEPS_MS[i - 1]!))).toBe(true);
  // 縮めた尺でも割れる時刻に最終色。
  expect(holdColorAt(p, 5000, 5000 + t.reveal * 0.5 - 1, 0.5)).toBe('white');
  expect(holdColorAt(p, 5000, 5000 + t.reveal * 0.5, 0.5)).toBe('gold');
  const colors: LotteryHoldColor[] = ['blue', 'green', 'red', 'gold'];
  expect(colors.map(holdChangeCue)).toEqual(['hold_blue', 'hold_green', 'hold_red', 'hold_gold']);
});

function loadSpec(machine: string) {
  return parseMachineText(readFileSync(new URL(`../../../resources/machines/${machine}.json`, import.meta.url), 'utf8'));
}

test('3機種の spin_min_colored_ms は割れる演出を縮めない長さ（P13-T5）', () => {
  for (const m of ['light-middle-01', 'rush-middle-01', 'lt-middle-01']) {
    const min = loadSpec(m).spinMinColoredMs ?? 0;
    expect(min).toBeGreaterThanOrEqual(HOLD_BREAK_MS.end + HOLD_BREAK_MIN_REELS_MS);
    expect(holdBreakScale(min)).toBe(1);
  }
});

const CUSTOMS = ['sb40', 'sb90', 'sb100'] as const;

test('抽選カスタム normal: 従来の色で決める先バレと全て一致（当否・確率によらない）', () => {
  for (const color of LOTTERY_HOLD_COLORS) {
    for (let s = 0; s < 3000; s++) {
      const want = planHoldChange(5, s, color).sakibare;
      expect(planSakibare(5, s, color, true, 0.01, 'normal')).toBe(want);
      expect(planSakibare(5, s, color, false, 0.5, 'normal')).toBe(want);
    }
  }
});

test('抽選カスタム: 式から出る信頼度・占有率が指定どおり（3機種・取得時の各モード）', () => {
  for (const machine of ['light-middle-01', 'rush-middle-01', 'lt-middle-01']) {
    const spec = loadSpec(machine);
    const modes: LotteryMode[] = ['normal', 'st'];
    if (spec.jitan !== undefined) modes.push('jitan');
    if (spec.lt !== undefined) modes.push('lt');
    for (const mode of modes) {
      const p = holdHitProb(spec, mode);
      expect(p).toBeGreaterThan(0);
      for (const c of CUSTOMS) {
        const { rel, occ } = SAKIBARE_CUSTOM_RATES[c];
        const hit = p * sakibareProb(c, true, p);
        const all = hit + (1 - p) * sakibareProb(c, false, p);
        expect(hit / p).toBeCloseTo(occ, 9);
        expect(hit / all).toBeCloseTo(rel, 9);
      }
    }
  }
});

test('抽選カスタム: 乱数で引いた実測の信頼度・占有率が ±0.02（rush の通常時）', () => {
  const p = holdHitProb(loadSpec('rush-middle-01'), 'normal');
  const nHit = 100000;
  const nMiss = 600000;
  for (const c of CUSTOMS) {
    let sbHit = 0;
    let sbMiss = 0;
    for (let s = 0; s < nHit; s++) if (planSakibare(21, s, 'white', true, p, c)) sbHit++;
    for (let s = 0; s < nMiss; s++) if (planSakibare(21, nHit + s, 'white', false, p, c)) sbMiss++;
    const occ = sbHit / nHit;
    const hit = p * occ;
    const rel = hit / (hit + (1 - p) * (sbMiss / nMiss));
    expect(Math.abs(occ - SAKIBARE_CUSTOM_RATES[c].occ)).toBeLessThan(0.02);
    expect(Math.abs(rel - SAKIBARE_CUSTOM_RATES[c].rel)).toBeLessThan(0.02);
    if (c === 'sb100') expect(sbMiss).toBe(0);
  }
});

test('抽選カスタム: 色・保留変化に影響しない・同じ引数なら同じ・特別保留とボーナス保留は先バレしない', () => {
  for (let s = 0; s < 2000; s++) {
    const a = planSakibare(9, s, 'white', true, 0.003, 'sb40');
    for (const color of LOTTERY_HOLD_COLORS) expect(planSakibare(9, s, color, true, 0.003, 'sb40')).toBe(a);
    expect(planSakibare(9, s, 'red', true, 0.003, 'sb40')).toBe(planSakibare(9, s, 'red', true, 0.003, 'sb40'));
  }
  for (const serial of [BONUS_SERIAL_BASE, GRANT_HOLD_SERIAL_BASE + 3, RESERVE_SERIAL_BASE - 1]) {
    for (const c of CUSTOMS) expect(planSakibare(1, serial, 'gold', true, 0.1, c)).toBe(false);
  }
  // 電サポの自動保留は対象。
  let any = false;
  for (let k = 0; k < 50 && !any; k++) any = planSakibare(1, RESERVE_SERIAL_BASE + k, 'white', true, 0.025, 'sb40');
  expect(any).toBe(true);
  expect(isSakibareCustom('sb90')).toBe(true);
  expect(isSakibareCustom('sb50')).toBe(false);
  expect(SAKIBARE_CUSTOMS).toEqual(['normal', 'sb40', 'sb90', 'sb100']);
});
