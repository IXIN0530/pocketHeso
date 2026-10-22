import { readFileSync } from 'node:fs';
import { parseMachineText } from '@ph/core';
import { expect, test } from 'vitest';
import {
  UPPER_CRACK_STEPS_MS,
  UPPER_GASE_RATE,
  UPPER_INTRO_MS,
  UPPER_MIN_SCALE,
  planUpperRush,
  upperCues,
  upperRushSpec,
  upperTimeline,
  upperViewAt,
  uwanoseDigitWeights,
  type UpperPlan,
  type UpperRushSpec,
} from './upper-rush.ts';

const machine = (id: string) => parseMachineText(readFileSync(new URL(`../../../resources/machines/${id}.json`, import.meta.url), 'utf8'));
const SPEC = upperRushSpec(machine('rush-middle-01'))!;
const BIG = 1e9;

test('upperRushSpec: 国道店だけ上位の枝がある', () => {
  expect(SPEC).toEqual({ baseRounds: 10, upperRounds: 10, addRounds: 10, loop1In: 4, loopMax: 4 });
  expect(upperRushSpec(machine('light-middle-01'))).toBeNull();
  expect(upperRushSpec(machine('lt-middle-01'))).toBeNull();
});

test('planUpperRush: 同じ seed・serial なら同じ計画、上位の枝の無い機種・初当たりでは何も出ない', () => {
  const j = { serial: 123, st: true, upper: true, loops: 3 };
  expect(planUpperRush(j, SPEC, 7)).toEqual(planUpperRush(j, SPEC, 7));
  expect(planUpperRush(j, null, 7)).toEqual({ k: 'none' });
  for (let s = 0; s < 500; s++) {
    expect(planUpperRush({ serial: s, st: false, upper: false, loops: 0 }, SPEC, 1)).toEqual({ k: 'none' });
    expect(planUpperRush({ serial: s, st: true, upper: false, loops: 0 }, null, 1)).toEqual({ k: 'none' });
  }
});

test('ガセ: 上位でない RUSH 中の当たりの 10%（1万回で ±1%）、上位にはガセが付かない', () => {
  let gase = 0;
  for (let s = 0; s < 10000; s++) {
    if (planUpperRush({ serial: s, st: true, upper: false, loops: 0 }, SPEC, 42).k === 'gase') gase++;
    const p = planUpperRush({ serial: s, st: true, upper: true, loops: s % 5 }, SPEC, 42);
    expect(p.k).toBe('upper');
  }
  expect(Math.abs(gase / 10000 - UPPER_GASE_RATE)).toBeLessThan(0.01);
});

test('当たる数字の分布: 3/2/1/0 = 27.8/25.8/24.0/22.4%（±1.5pt）、K = loop_max で MAX', () => {
  const w = uwanoseDigitWeights(4);
  const sum = w.reduce((a, b) => a + b, 0);
  // 4回のどこかで当たる合計は 1/4。
  expect(sum).toBeCloseTo(0.25, 10);
  const n = [0, 0, 0, 0];
  let total = 0;
  for (let s = 0; s < 5000; s++) {
    const p = planUpperRush({ serial: s, st: true, upper: true, loops: 4 }, SPEC, 9);
    if (p.k !== 'upper') throw new Error('not upper');
    expect(p.hits).toHaveLength(4);
    expect(p.max).toBe(true);
    for (const h of p.hits) n[h]!++;
    total += p.hits.length;
  }
  const want = [27.8, 25.8, 24.0, 22.4];
  n.forEach((c, i) => expect(Math.abs((c / total) * 100 - want[i]!)).toBeLessThan(1.5));
  const p1 = planUpperRush({ serial: 1, st: true, upper: true, loops: 1 }, SPEC, 9);
  expect(p1).toMatchObject({ k: 'upper', max: false });
});

const times = (plan: UpperPlan, budget = BIG) => upperTimeline(plan, budget).steps.map((x) => [x.k, x.at, x.n ?? null]);

test('時刻表 K = 0: フリーズ → ひび7段 → 割れる → 3/2/1/0 → 上乗せ終了 → 色が戻る', () => {
  const plan: UpperPlan = { k: 'upper', hits: [], max: false };
  expect(times(plan)).toEqual([
    ['freeze', 5000, null],
    ...UPPER_CRACK_STEPS_MS.map((at, i) => ['crack', at, i + 1]),
    ['break', 9600, null],
    ['uwanoseStart', 13100, null],
    ['digit', 14600, 3],
    ['digit', 19600, 2],
    ['digit', 24600, 1],
    ['digit', 29600, 0],
    ['uwanoseEnd', 34600, null],
    ['back', 36100, null],
  ]);
  const tl = upperTimeline(plan, BIG);
  expect(tl.end).toBe(36700);
  const at = (t: number) => upperViewAt(tl, SPEC, t)!;
  expect(at(4999)).toMatchObject({ gray: 0, frozen: false, crack: 0, banner: null, addedRounds: 0 });
  expect(at(5150)).toMatchObject({ gray: 0.5, frozen: true, frozenAt: 5000 });
  expect(at(7000)).toMatchObject({ gray: 1, crack: 2, shatter: null });
  expect(at(9100)).toMatchObject({ crack: 7 });
  expect(at(10000)).toMatchObject({ crack: 0, shatter: 400, addedRounds: 10, banner: { k: 'upperIn', t: 400, add: 10, rainbow: true } });
  expect(at(13200)).toMatchObject({ banner: { k: 'uwanoseStart', rainbow: false } });
  expect(at(20000)).toMatchObject({ banner: { k: 'digit', digit: 2 } });
  expect(at(35000)).toMatchObject({ banner: { k: 'uwanoseEnd' }, frozen: true, addedRounds: 10 });
  expect(at(36400)).toMatchObject({ gray: 0.5, frozen: false, banner: null });
  expect(at(37000)).toMatchObject({ gray: 0 });
  expect(upperCues(tl).map((c) => c.cue)).toEqual([
    'upper_freeze',
    ...UPPER_CRACK_STEPS_MS.map(() => 'upper_crack'),
    'upper_in',
    'uwanose_start',
    'uwanose_tick',
    'uwanose_tick',
    'uwanose_tick',
    'uwanose_tick',
    'uwanose_end',
  ]);
});

test('時刻表 K = 1: 当たりの数字の +2,000 で上乗せ、その後に外れの回（4つ全部）', () => {
  const plan: UpperPlan = { k: 'upper', hits: [1], max: false };
  expect(times(plan).slice(9)).toEqual([
    ['uwanoseStart', 13100, null],
    ['digit', 14600, 3],
    ['digit', 19600, 2],
    ['uwanoseHit', 21600, 1],
    ['uwanoseStart', 25600, null],
    ['digit', 27100, 3],
    ['digit', 32100, 2],
    ['digit', 37100, 1],
    ['digit', 42100, 0],
    ['uwanoseEnd', 47100, null],
    ['back', 48600, null],
  ]);
  const tl = upperTimeline(plan, BIG);
  expect(upperViewAt(tl, SPEC, 21000)).toMatchObject({ addedRounds: 10, banner: { k: 'digit', digit: 2 } });
  expect(upperViewAt(tl, SPEC, 22000)).toMatchObject({ addedRounds: 20, shatter: 400, banner: { k: 'uwanoseHit', add: 10, rainbow: true } });
});

test('時刻表 K = 4: 最後の当たりの後に「上乗せ MAX」（外れの回は無い）', () => {
  const plan: UpperPlan = { k: 'upper', hits: [0, 0, 0, 0], max: true };
  expect(times(plan).slice(9)).toEqual([
    ['uwanoseStart', 13100, null],
    ['digit', 14600, 3],
    ['uwanoseHit', 16600, 1],
    ['uwanoseStart', 20600, null],
    ['digit', 22100, 3],
    ['uwanoseHit', 24100, 2],
    ['uwanoseStart', 28100, null],
    ['digit', 29600, 3],
    ['uwanoseHit', 31600, 3],
    ['uwanoseStart', 35600, null],
    ['digit', 37100, 3],
    ['uwanoseHit', 39100, 4],
    ['uwanoseMax', 43100, null],
    ['back', 46100, null],
  ]);
  const tl = upperTimeline(plan, BIG);
  expect(upperViewAt(tl, SPEC, 44000)).toMatchObject({ addedRounds: 50, banner: { k: 'uwanoseMax', rainbow: true } });
  expect(upperCues(tl).at(-1)).toEqual({ at: 43100, cue: 'uwanose_end' });
});

test('ガセ: 白黒・フリーズして 7,000 から色が戻る（ひび・割れは無い）、音は upper_freeze だけ', () => {
  const tl = upperTimeline({ k: 'gase' }, BIG);
  expect(times({ k: 'gase' })).toEqual([
    ['freeze', 5000, null],
    ['back', 7000, null],
  ]);
  expect(tl.end).toBe(7600);
  expect(upperViewAt(tl, SPEC, 6000)).toMatchObject({ gray: 1, frozen: true, crack: 0, banner: null });
  expect(upperViewAt(tl, SPEC, 7300)).toMatchObject({ gray: 0.5, frozen: false });
  expect(upperCues(tl)).toEqual([{ at: 5000, cue: 'upper_freeze' }]);
  expect(upperTimeline({ k: 'none' }, BIG)).toMatchObject({ steps: [], end: 0 });
  expect(upperViewAt(upperTimeline({ k: 'none' }, BIG), SPEC, 6000)).toBeNull();
});

test('縮める: 導入より後を縮めて予算に収める、下限を下回る時はカウントダウンを省く', () => {
  const plan: UpperPlan = { k: 'upper', hits: [3, 3, 3, 3], max: true };
  const full = upperTimeline(plan, BIG);
  const budget = UPPER_INTRO_MS + (full.end - UPPER_INTRO_MS) * 0.5;
  const half = upperTimeline(plan, budget);
  expect(half.compact).toBe(false);
  expect(half.scale).toBeCloseTo(0.5, 10);
  expect(half.end).toBeCloseTo(budget, 6);
  expect(half.steps[0]!.at).toBeCloseTo(UPPER_INTRO_MS + (5000 - UPPER_INTRO_MS) * 0.5, 6);
  // 下限を下回る: 数字を見せず、当たりだけ順に。
  const tiny = upperTimeline(plan, 15000);
  expect(tiny.compact).toBe(true);
  expect(tiny.end).toBeLessThanOrEqual(15000 + 1e-6);
  expect(tiny.steps.some((x) => x.k === 'digit' || x.k === 'uwanoseStart')).toBe(false);
  expect(tiny.steps.filter((x) => x.k === 'uwanoseHit')).toHaveLength(4);
  expect(tiny.steps.at(-2)!.k).toBe('uwanoseMax');
  // 当たりの数がいくつでも最後に全部足す。
  expect(upperViewAt(tiny, SPEC, tiny.end)).toMatchObject({ addedRounds: 50, gray: 0 });
  const tiny0 = upperTimeline({ k: 'upper', hits: [], max: false }, 9000);
  expect(tiny0.compact).toBe(true);
  expect(tiny0.steps.at(-2)!.k).toBe('uwanoseEnd');
  expect(full.scale).toBe(1);
  expect(UPPER_MIN_SCALE).toBe(0.25);
});

test('どの K でも時刻順・既定のラウンド（5,000ms）で予算に収まる', () => {
  const s: UpperRushSpec = SPEC;
  for (let k = 0; k <= s.loopMax; k++) {
    for (const h of [0, 3]) {
      const plan: UpperPlan = { k: 'upper', hits: Array.from({ length: k }, () => h), max: k === s.loopMax };
      const rounds = s.baseRounds + s.upperRounds + s.addRounds * k;
      const tl = upperTimeline(plan, rounds * 5000 - 4500);
      expect(tl.scale).toBe(1);
      for (let i = 1; i < tl.steps.length; i++) expect(tl.steps[i]!.at).toBeGreaterThanOrEqual(tl.steps[i - 1]!.at);
    }
  }
});
