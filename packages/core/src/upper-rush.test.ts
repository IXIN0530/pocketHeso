import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachine, parseMachineText, parsePatternsText } from './machine.ts';
import type { HoldEntry, LotteryMode } from './lottery.ts';
import { drawHold, drawUpperLoops, jackpotPayoutBalls, jackpotTotalRounds } from './lottery.ts';
import { RNG_STREAM_IDS, streamSeedU32 } from './rng.ts';
import { SpinMachine, jackpotDurationMs } from './spin.ts';
import { Engine } from './engine.ts';
import type { Action, SimEvent } from './engine.ts';

function loadPatterns(): PatternTable {
  return parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
}

function loadRush(): MachineSpec {
  return parseMachineText(readFileSync('../../resources/machines/rush-middle-01.json', 'utf8'));
}

function loadAtlas(): ArrayBuffer {
  const dir = '../../resources/atlas';
  const names = readdirSync(dir);
  let found = '';
  for (let i = 0; i < names.length; i = i + 1) {
    const n = names[i] as string;
    if (n.length > 4 && n.slice(n.length - 4) === '.bin') {
      found = n;
      break;
    }
  }
  if (found === '') {
    throw new Error('atlas .bin not found');
  }
  const buf = readFileSync(dir + '/' + found);
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const ab = new ArrayBuffer(u8.length);
  new Uint8Array(ab).set(u8);
  return ab;
}

/** 上位の枝つきの検証用 JSON（split を差し替えられる）。 */
function upperJson(split: readonly unknown[], stSpins = 10, oneIn = 10, msPerRound = 1000): Record<string, unknown> {
  return {
    id: 'test-upper-01',
    version: 1,
    tier: 'middle',
    modes: {
      normal: { jackpot_1_in: oneIn, spins: 0 },
      st: { jackpot_1_in: oneIn, spins: stSpins },
    },
    jackpot_split: split,
    round: { count: 10, payout_per_ball: 15, ms_per_round: msPerRound },
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
}

/** 当たりやすい上位の機種（ST 中は半分が上位、上乗せは 1/2 で次へ・最大4回）。 */
function upperSpec(stSpins = 10): MachineSpec {
  return parseMachine(upperJson([
    { kind: 'kakuhen', weight: 100, weight_st: 0, rounds: 3 },
    { kind: 'kakuhen', weight: 0, weight_st: 50, rounds: 10 },
    { kind: 'kakuhen', weight: 0, weight_st: 50, rounds: 10, bonus_rounds: 10, upper: { add_rounds: 10, loop_1_in: 2, loop_max: 4 } },
  ], stSpins));
}

function patternIndexOf(patterns: PatternTable, id: string): number {
  for (let i = 0; i < patterns.length; i = i + 1) {
    if ((patterns[i] as { id: string }).id === id) {
      return i;
    }
  }
  throw new Error('pattern not found: ' + id);
}

function makeEntry(serial: number, modeAtDraw: LotteryMode, patternIndex: number, isHit: boolean, branchIndex: number | null, loops?: number): HoldEntry {
  const base: HoldEntry = { serial, modeAtDraw, isHit, branchIndex, patternIndex, color: 'white', hot: 0, hesoPayoutBalls: 3 };
  return loops === undefined ? base : { ...base, upper: true, loops };
}

test('upper の parse と検証（60R 超え・next が st でない・不正な値・重複は upper 込み）', () => {
  const ok = upperSpec();
  expect(ok.jackpotSplit[2]).toEqual({
    kind: 'kakuhen', weight: 0, weightSt: 50, rounds: 10, bonusRounds: 10,
    upper: { addRounds: 10, loop1In: 2, loopMax: 4, loopThresholdU32: 2147483648 },
  });
  expect(ok.jackpotSplit[1]?.upper).toBeUndefined();
  const base = { kind: 'kakuhen', weight: 1, weight_st: 1, rounds: 10, bonus_rounds: 10 };
  const mk = (upper: unknown, extra: Record<string, unknown> = {}): unknown =>
    parseMachine(upperJson([{ ...base, ...extra, upper }]));
  expect(() => mk({ add_rounds: 10, loop_1_in: 4, loop_max: 4 })).not.toThrow();
  // 合計: 10 + 10 + 10×4 = 60 は可、61 以上はエラー
  expect(() => mk({ add_rounds: 10, loop_1_in: 4, loop_max: 5 })).toThrow(/<= 60/);
  expect(() => mk({ add_rounds: 41, loop_1_in: 4, loop_max: 1 })).toThrow(/<= 60/);
  expect(() => mk({ add_rounds: 0, loop_1_in: 4, loop_max: 4 })).toThrow(/add_rounds/);
  expect(() => mk({ add_rounds: 1.5, loop_1_in: 4, loop_max: 4 })).toThrow(/add_rounds/);
  expect(() => mk({ add_rounds: 10, loop_1_in: 1, loop_max: 4 })).toThrow(/loop_1_in/);
  expect(() => mk({ add_rounds: 10, loop_1_in: 'x', loop_max: 4 })).toThrow(/loop_1_in/);
  expect(() => mk({ add_rounds: 10, loop_1_in: 4, loop_max: 0 })).toThrow(/loop_max/);
  expect(() => mk({ add_rounds: 10, loop_1_in: 4 })).toThrow(/loop_max/);
  expect(() => mk(5)).toThrow(/upper/);
  // RUSH に戻る枝だけ（tsujo は normal 行き・next normal もエラー）
  expect(() => mk({ add_rounds: 10, loop_1_in: 4, loop_max: 4 }, { kind: 'tsujo' })).toThrow(/next st/);
  expect(() => mk({ add_rounds: 10, loop_1_in: 4, loop_max: 4 }, { next: 'normal' })).toThrow(/next st/);
  // 同じ (kind, rounds, bonus, next) でも upper の有無が違えば並べられる・同じなら重複
  const u = { add_rounds: 10, loop_1_in: 4, loop_max: 4 };
  expect(() => parseMachine(upperJson([base, { ...base, upper: u }]))).not.toThrow();
  expect(() => parseMachine(upperJson([{ ...base, upper: u }, { ...base, upper: u }]))).toThrow(/duplicates/);
});

test('uwanose ストリームは既存のストリームの値を変えない（名前で分かれる）', () => {
  expect(RNG_STREAM_IDS[RNG_STREAM_IDS.length - 1]).toBe('uwanose');
  expect(streamSeedU32(42, 'jackpot', 7)).toBe(streamSeedU32(42, 'jackpot', 7));
  for (let i = 0; i < RNG_STREAM_IDS.length - 1; i = i + 1) {
    expect(streamSeedU32(42, 'uwanose', 7)).not.toBe(streamSeedU32(42, RNG_STREAM_IDS[i] as 'jackpot', 7));
  }
});

test('rush-middle-01 の上乗せ K の分布（1万回で P(K≥1)≈0.25・P(K≥2)≈0.0625・K ≤ 4）', () => {
  const spec = loadRush();
  expect(spec.version).toBe(2);
  expect(spec.st.stSpins).toBe(66);
  const upperIdx = 1;
  expect(spec.jackpotSplit[upperIdx]?.upper).toBeDefined();
  expect(drawUpperLoops(spec, 1, 0, 0)).toBeNull();
  expect(drawUpperLoops(spec, 1, 0, null)).toBeNull();
  const n = 10000;
  const ge = [0, 0, 0, 0, 0, 0];
  for (let serial = 0; serial < n; serial = serial + 1) {
    const k = drawUpperLoops(spec, 2026, serial, upperIdx) as number;
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThanOrEqual(4);
    for (let j = 0; j <= k; j = j + 1) {
      ge[j] = (ge[j] as number) + 1;
    }
  }
  expect(Math.abs((ge[1] as number) / n - 0.25)).toBeLessThanOrEqual(0.01);
  expect(Math.abs((ge[2] as number) / n - 0.0625)).toBeLessThanOrEqual(0.005);
  expect(ge[5]).toBe(0);
  // 同じ seed・serial で同じ K（取得時に確定）
  expect(drawUpperLoops(spec, 2026, 123, upperIdx)).toBe(drawUpperLoops(spec, 2026, 123, upperIdx));
});

test('drawHold は上位の当たりに upper・loops を付け、外れ・他の枝には付けない', () => {
  const spec = loadRush();
  const patterns = loadPatterns();
  let upperHits = 0;
  for (let serial = 0; serial < 16000; serial = serial + 1) {
    const e = drawHold(spec, patterns, 9, 'st', serial, 1);
    if (e.branchIndex === 1) {
      upperHits = upperHits + 1;
      expect(e.upper).toBe(true);
      expect(e.loops).toBe(drawUpperLoops(spec, 9, serial, 1));
    } else {
      expect('upper' in e).toBe(false);
      expect('loops' in e).toBe(false);
    }
  }
  expect(upperHits).toBeGreaterThan(40);
});

test('上位の大当たり: 出玉・時間が合計ラウンド分、uwanose を出さず、rushUpper は次の当たりまで', () => {
  const spec = upperSpec(3);
  const patterns = loadPatterns();
  const kakutei = patternIndexOf(patterns, 'kakutei');
  const short = patternIndexOf(patterns, 'normal_short');
  expect(jackpotTotalRounds(spec, 2, 2)).toBe(40);
  expect(jackpotPayoutBalls(spec, 2, 7, 2)).toBe(40 * 10 * 15 * 7);
  expect(jackpotDurationMs(spec, 2, 2)).toBe(40 * 1000);
  expect(() => jackpotTotalRounds(spec, 2, 5)).toThrow();
  expect(() => jackpotTotalRounds(spec, 1, 1)).toThrow();
  const m = new SpinMachine(spec, patterns, { mode: 'st', stRemaining: 3 });
  m.startSpin({ ...makeEntry(10, 'st', kakutei, true, 2, 2), unit: 7 }, 0, 0);
  const res = m.resolveSpin(30000);
  expect(res[1]).toEqual({ k: 'jackpotStarted', entry: 10, at: 30000, kind: 'kakuhen', rounds: 10, bonusRounds: 30, upper: true, loops: 2 });
  expect(m.uwanoseAt).toBeNull();
  expect(m.jackpotEndsAt).toBe(30000 + 40 * 1000);
  expect(m.jackpotTotalRounds).toBe(40);
  expect(m.rushUpper).toBe(false);
  expect(m.snapshot().jackpot).toMatchObject({ upper: true, loops: 2, bonusRounds: 30 });
  const ended = m.finishJackpot(70000, 7);
  expect(ended[0]).toEqual({ k: 'jackpotEnded', entry: 10, at: 70000, payout: 40 * 10 * 15 * 7 });
  expect(m.rushUpper).toBe(true);
  expect(m.snapshot().rushUpper).toBe(true);
  // restore しても残る
  const r = SpinMachine.restore(spec, patterns, m.snapshot());
  expect(r.rushUpper).toBe(true);
  // 次の当たり（上位でない）の jackpotStarted で下がる
  m.startSpin(makeEntry(11, 'st', kakutei, true, 1), 70000, 0);
  m.resolveSpin(100000);
  expect(m.rushUpper).toBe(false);
  expect('rushUpper' in m.snapshot()).toBe(false);
  // K = 0 の上位: bonusRounds は bonus_rounds だけ
  const m0 = new SpinMachine(spec, patterns, { mode: 'st', stRemaining: 3 });
  m0.startSpin(makeEntry(20, 'st', kakutei, true, 2, 0), 0, 0);
  expect(m0.resolveSpin(30000)[1]).toEqual({ k: 'jackpotStarted', entry: 20, at: 30000, kind: 'kakuhen', rounds: 10, bonusRounds: 10, upper: true, loops: 0 });
  m0.finishJackpot(50000, 1);
  expect(m0.rushUpper).toBe(true);
  // ST を抜けると下がる
  let t = 80000;
  for (let i = 0; i < 3; i = i + 1) {
    m0.startSpin(makeEntry(30 + i, 'st', short, false, null), t, 0);
    t = m0.activeEndsAt as number;
    const evs = m0.resolveSpin(t);
    if (i < 2) {
      expect(m0.rushUpper).toBe(true);
    } else {
      expect(evs[1]).toEqual({ k: 'modeChanged', to: 'normal', at: t, stRemaining: 0 });
    }
  }
  expect(m0.rushUpper).toBe(false);
});

/** オート打ちで上位の大当たりが出る Engine（seed 固定）。 */
function upperEngineRun(): { spec: MachineSpec; patterns: PatternTable; atlas: ArrayBuffer; actions: Action[]; until: number; once: SimEvent[] } {
  const spec = upperSpec(10);
  const patterns = loadPatterns();
  const atlas = loadAtlas();
  const actions: Action[] = [{ t: 0, k: 'auto', share: 1, rate: 1 }];
  const until = 1800000;
  const once = new Engine({ seed: 7, spec, patterns, atlas, initialBalls: 500000 }, [], actions).advance(until);
  return { spec, patterns, atlas, actions, until, once };
}

test('Engine: 上位の枝で uwanose を出さず、出玉は合計ラウンド分、投影に upper・loops・rushUpper', () => {
  const { spec, patterns, atlas, actions, once } = upperEngineRun();
  expect(once.some((e) => e.k === 'uwanose')).toBe(false);
  const uppers = once.filter((e): e is Extract<SimEvent, { k: 'jackpotStarted' }> => e.k === 'jackpotStarted' && e.upper === true);
  expect(uppers.length).toBeGreaterThan(3);
  expect(uppers.some((e) => (e.loops as number) > 0)).toBe(true);
  for (const js of uppers) {
    const loops = js.loops as number;
    expect(js.rounds).toBe(10);
    expect(js.bonusRounds).toBe(10 + 10 * loops);
    const ended = once.find((e) => e.k === 'jackpotEnded' && e.entry === js.entry);
    expect(ended).toEqual({ k: 'jackpotEnded', entry: js.entry, at: js.at + (20 + 10 * loops) * 1000, payout: (20 + 10 * loops) * 10 * 15 });
  }
  const mk = (): Engine => new Engine({ seed: 7, spec, patterns, atlas, initialBalls: 500000 }, [], actions);
  const js = uppers.find((e) => (e.loops as number) > 0) as Extract<SimEvent, { k: 'jackpotStarted' }>;
  const during = mk();
  during.advance(js.at + 500);
  const total = 20 + 10 * (js.loops as number);
  expect(during.project().jackpot).toEqual({ entry: js.entry, kind: 'kakuhen', rounds: total, endsAt: js.at + total * 1000, upper: true, loops: js.loops });
  expect(during.project().rushUpper).toBe(false);
  const endAt = js.at + total * 1000;
  const after = mk();
  after.advance(endAt + 1);
  expect(after.project().mode).toBe('st');
  expect(after.project().rushUpper).toBe(true);
});

test('決定論: 上位の大当たり中・上位の後の ST 中で区切っても1秒刻みと restore が通しと一致', () => {
  const { spec, patterns, atlas, actions, until, once } = upperEngineRun();
  const mk = (): Engine => new Engine({ seed: 7, spec, patterns, atlas, initialBalls: 500000 }, [], actions);
  const js = once.find((e) => e.k === 'jackpotStarted' && e.upper === true && (e.loops as number) > 0) as Extract<SimEvent, { k: 'jackpotStarted' }>;
  const endAt = once.find((e) => e.k === 'jackpotEnded' && e.entry === js.entry)?.at as number;
  const whole = mk();
  whole.advance(until);
  // 1秒刻み
  const stepped = mk();
  const joined: SimEvent[] = [];
  for (let t = 1000; t <= until; t = t + 1000) {
    const evs = stepped.advance(t);
    for (let i = 0; i < evs.length; i = i + 1) {
      joined.push(evs[i] as SimEvent);
    }
  }
  expect(joined).toEqual(once);
  expect(stepped.snapshot()).toEqual(whole.snapshot());
  // restore（上位の大当たり中・上位の後の ST 中）
  for (const cut of [js.at + 1500, endAt + 1]) {
    const a = mk();
    const head = a.advance(cut);
    const snap = a.snapshot();
    if (cut === endAt + 1) {
      expect(snap.spin.rushUpper).toBe(true);
    } else {
      expect(snap.spin.jackpot).toMatchObject({ upper: true, loops: js.loops });
    }
    const tail = a.advance(until);
    expect([...head, ...tail]).toEqual(once);
    const resumed = Engine.restore(snap, { seed: 7, spec, patterns, atlas });
    expect(resumed.advance(until)).toEqual(tail);
    expect(resumed.snapshot()).toEqual(whole.snapshot());
  }
});
