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
  customSakibareRates,
  planHoldChange,
  planHoldChangeCustom,
  planSakibare,
  sakibareAt,
  sakibareOdds,
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
const MACHINES = ['light-middle-01', 'rush-middle-01', 'lt-middle-01'] as const;

function oddsFor(machine: string, mode: LotteryMode) {
  return sakibareOdds(loadSpec(machine), mode);
}

test('抽選カスタム normal: planHoldChange と全て一致（当否・モードによらない）', () => {
  const odds = oddsFor('rush-middle-01', 'st');
  for (const color of LOTTERY_HOLD_COLORS) {
    for (let s = 0; s < 3000; s++) {
      const want = planHoldChange(5, s, color);
      expect(planHoldChangeCustom(5, s, color, true, odds, 'normal')).toEqual(want);
      expect(planHoldChangeCustom(5, s, color, false, odds, 'normal')).toEqual(want);
      expect(planSakibare(5, s, color, true, odds, 'normal')).toBe(want.sakibare);
    }
  }
});

function modesOf(machine: string): LotteryMode[] {
  const spec = loadSpec(machine);
  const modes: LotteryMode[] = ['normal', 'st'];
  if (spec.jitan !== undefined) modes.push('jitan');
  if (spec.lt !== undefined) modes.push('lt');
  return modes;
}

test('抽選カスタム: 式の信頼度・占有率はカスタムの値のまま（3機種・取得時の各モード, P13-T8c）', () => {
  const white = LOTTERY_HOLD_COLORS.indexOf('white');
  for (const machine of MACHINES) {
    const spec = loadSpec(machine);
    for (const mode of modesOf(machine)) {
      const odds = sakibareOdds(spec, mode);
      expect(odds.p).toBe(holdHitProb(spec, mode));
      const sh = odds.hitW.reduce((a, b) => a + b, 0);
      const sm = odds.missW.reduce((a, b) => a + b, 0);
      for (const c of CUSTOMS) {
        const r = customSakibareRates(odds, c);
        let occ = 0;
        let miss = 0;
        for (let i = 0; i < odds.hitW.length; i++) {
          expect(r.hit[i]).toBeGreaterThanOrEqual(0);
          expect(r.hit[i]).toBeLessThanOrEqual(1);
          expect(r.miss[i]).toBeGreaterThanOrEqual(0);
          expect(r.miss[i]).toBeLessThanOrEqual(1);
          occ += (r.hit[i]! * odds.hitW[i]!) / sh;
          miss += (r.miss[i]! * odds.missW[i]!) / sm;
        }
        expect(occ).toBeCloseTo(r.occ, 9);
        expect(r.occ).toBeCloseTo(SAKIBARE_CUSTOM_RATES[c].occ, 9);
        expect((odds.p * occ) / (odds.p * occ + (1 - odds.p) * miss)).toBeCloseTo(SAKIBARE_CUSTOM_RATES[c].rel, 9);
        expect(r.showHit[white]).toBe(0);
        expect(r.showMiss[white]).toBe(0);
        // 通常・時短（当たりの約95%が白以外）は T8b のまま白に先バレしない。ST・LT は sb40・sb90 で白の当たりにも先バレする。
        if (mode === 'normal' || mode === 'jitan') {
          expect(r.hit[white]).toBe(0);
          expect(r.miss[white]).toBe(0);
        } else if (c !== 'sb100') {
          expect(r.hit[white]).toBeGreaterThan(0);
        }
        if (c === 'sb100') expect(miss).toBe(0);
      }
    }
  }
});

/** 見せる色ごとの当たり・ハズレ（1保留あたりの確率）。plans(hit, color) は最終色 color・当否 hit の保留を引いた結果の割合。 */
function shownRel(
  odds: { p: number; hitW: readonly number[]; missW: readonly number[] },
  share: (hit: boolean, color: LotteryHoldColor) => Map<LotteryHoldColor, number>,
): Map<LotteryHoldColor, number> {
  const sh = odds.hitW.reduce((a, b) => a + b, 0);
  const sm = odds.missW.reduce((a, b) => a + b, 0);
  const h = new Map<LotteryHoldColor, number>();
  const m = new Map<LotteryHoldColor, number>();
  LOTTERY_HOLD_COLORS.forEach((color, i) => {
    for (const [shown, x] of share(true, color)) h.set(shown, (h.get(shown) ?? 0) + (x * odds.p * odds.hitW[i]!) / sh);
    for (const [shown, x] of share(false, color)) m.set(shown, (m.get(shown) ?? 0) + (x * (1 - odds.p) * odds.missW[i]!) / sm);
  });
  const rel = new Map<LotteryHoldColor, number>();
  for (const color of LOTTERY_HOLD_COLORS) {
    const t = (h.get(color) ?? 0) + (m.get(color) ?? 0);
    if (t > 0) rel.set(color, (h.get(color) ?? 0) / t);
  }
  return rel;
}

test('抽選カスタム: 白の先バレ保留に見せる色で、見せた色の信頼度は保留色の表のまま（式, 3機種 × ST/LT, P13-T8c）', () => {
  const white = LOTTERY_HOLD_COLORS.indexOf('white');
  for (const machine of MACHINES) {
    for (const mode of modesOf(machine)) {
      const odds = oddsFor(machine, mode);
      const base = shownRel(odds, (_, color) => new Map([[color, 1]]));
      for (const c of CUSTOMS) {
        const r = customSakibareRates(odds, c);
        const rel = shownRel(odds, (hit, color) => {
          const out = new Map<LotteryHoldColor, number>();
          if (color !== 'white') return out.set(color, 1);
          const q = (hit ? r.hit : r.miss)[white]!;
          const show = hit ? r.showHit : r.showMiss;
          const total = show.reduce((a, b) => a + b, 0);
          out.set('white', 1 - q);
          if (q > 0) show.forEach((w, i) => w > 0 && out.set(LOTTERY_HOLD_COLORS[i]!, (q * w) / total));
          return out;
        });
        for (const color of LOTTERY_HOLD_COLORS) {
          if (color === 'white') continue;
          // sb90 の ST・LT は白の先バレがほぼ当たりだけなので、一番熱い金だけで見せる（金の信頼度だけ少し上がる）。
          const tol = color === 'gold' ? 0.04 : 1e-9;
          expect(Math.abs(rel.get(color)! - base.get(color)!)).toBeLessThan(tol);
        }
      }
    }
  }
});

test('抽選カスタム: 乱数で引いた実測の信頼度・占有率が ±0.02（3機種 × 通常/ST/LT）', () => {
  const n = 8000;
  for (const machine of MACHINES) {
    for (const mode of modesOf(machine)) {
      const odds = oddsFor(machine, mode);
      const sh = odds.hitW.reduce((a, b) => a + b, 0);
      const sm = odds.missW.reduce((a, b) => a + b, 0);
      for (const c of CUSTOMS) {
        let occ = 0;
        let miss = 0;
        let serial = 0;
        let bad = 0;
        LOTTERY_HOLD_COLORS.forEach((color, i) => {
          let kh = 0;
          let km = 0;
          for (let s = 0; s < n; s++) {
            const h = planHoldChangeCustom(21, serial++, color, true, odds, c);
            const m = planHoldChangeCustom(21, serial++, color, false, odds, c);
            for (const x of [h, m]) {
              if (x.sakibare && (!x.change || x.final === 'white')) bad++;
              if (!x.sakibare && x.final !== color) bad++;
              if (x.sakibare && color !== 'white' && x.final !== color) bad++;
            }
            if (h.sakibare) kh++;
            if (m.sakibare) km++;
          }
          occ += ((kh / n) * odds.hitW[i]!) / sh;
          miss += ((km / n) * odds.missW[i]!) / sm;
        });
        const rel = (odds.p * occ) / (odds.p * occ + (1 - odds.p) * miss);
        expect(bad).toBe(0);
        expect(Math.abs(occ - SAKIBARE_CUSTOM_RATES[c].occ)).toBeLessThan(0.02);
        expect(Math.abs(rel - SAKIBARE_CUSTOM_RATES[c].rel)).toBeLessThan(0.02);
        if (c === 'sb100') expect(miss).toBe(0);
      }
    }
  }
}, 60_000);

test('抽選カスタム: 白の先バレ保留に引いた色の実測の割合が式の重みどおり（ST）', () => {
  const odds = oddsFor('rush-middle-01', 'st');
  const r = customSakibareRates(odds, 'sb40');
  for (const hit of [true, false]) {
    const show = hit ? r.showHit : r.showMiss;
    const total = show.reduce((a, b) => a + b, 0);
    const count = new Map<LotteryHoldColor, number>();
    let k = 0;
    for (let s = 0; s < 400000 && k < 20000; s++) {
      const x = planHoldChangeCustom(3, s, 'white', hit, odds, 'sb40');
      if (!x.sakibare) continue;
      k++;
      count.set(x.final, (count.get(x.final) ?? 0) + 1);
    }
    expect(k).toBeGreaterThan(1000);
    LOTTERY_HOLD_COLORS.forEach((color, i) => expect(Math.abs((count.get(color) ?? 0) / k - show[i]! / total)).toBeLessThan(0.02));
  }
});

test('抽選カスタム: 先バレしない保留は planHoldChange のまま・同じ引数なら同じ・特別保留とボーナス保留は先バレしない', () => {
  const odds = oddsFor('rush-middle-01', 'normal');
  for (const c of CUSTOMS) {
    for (const color of LOTTERY_HOLD_COLORS) {
      for (let s = 0; s < 1500; s++) {
        for (const hit of [true, false]) {
          const x = planHoldChangeCustom(9, s, color, hit, odds, c);
          const base = planHoldChange(9, s, color);
          expect(x).toEqual(planHoldChangeCustom(9, s, color, hit, odds, c));
          expect(x.final).toBe(base.final);
          if (!x.sakibare) expect(x.change).toBe(base.change);
        }
      }
    }
  }
  for (const serial of [BONUS_SERIAL_BASE, GRANT_HOLD_SERIAL_BASE + 3, RESERVE_SERIAL_BASE - 1]) {
    for (const c of CUSTOMS) {
      expect(planSakibare(1, serial, 'gold', true, odds, c)).toBe(false);
      expect(planHoldChangeCustom(1, serial, 'gold', true, odds, c).change).toBe(planHoldChange(1, serial, 'gold').change);
    }
  }
  // 電サポの自動保留は対象。
  let any = false;
  for (let k = 0; k < 50 && !any; k++) any = planSakibare(1, RESERVE_SERIAL_BASE + k, 'red', true, oddsFor('rush-middle-01', 'st'), 'sb40');
  expect(any).toBe(true);
  expect(isSakibareCustom('sb90')).toBe(true);
  expect(isSakibareCustom('sb50')).toBe(false);
  expect(SAKIBARE_CUSTOMS).toEqual(['normal', 'sb40', 'sb90', 'sb100']);
});
