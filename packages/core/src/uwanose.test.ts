import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachine, parsePatternsText } from './machine.ts';
import type { HoldEntry, LotteryMode } from './lottery.ts';
import { jackpotPayoutBalls } from './lottery.ts';
import { SpinMachine } from './spin.ts';
import { Engine } from './engine.ts';
import type { Action, SimEvent } from './engine.ts';

function loadPatterns(): PatternTable {
  return parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
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

function bonusSpecFixture(): MachineSpec {
  return parseMachine({
    id: 'test-uwanose-01',
    version: 1,
    tier: 'middle',
    modes: {
      normal: { jackpot_1_in: 199.8, spins: 0 },
      jitan: { jackpot_1_in: 199.8, spins: 2 },
      st: { jackpot_1_in: 39.9, spins: 3 },
      lt: { jackpot_1_in: 39.9, spins: 2 },
    },
    jackpot_split: [
      { kind: 'tsujo', weight: 50, weight_jitan: 0, weight_st: 0, weight_lt: 0, rounds: 3, next: 'jitan' },
      { kind: 'kakuhen', weight: 50, weight_jitan: 100, weight_st: 0, weight_lt: 0, rounds: 3, next: 'st' },
      { kind: 'kakuhen', weight: 0, weight_jitan: 0, weight_st: 60, weight_lt: 0, rounds: 10, next: 'st' },
      { kind: 'kakuhen', weight: 0, weight_jitan: 0, weight_st: 40, weight_lt: 100, rounds: 10, bonus_rounds: 20, next: 'lt' },
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

function makeEntry(serial: number, modeAtDraw: LotteryMode, patternIndex: number, isHit: boolean, branchIndex: number | null): HoldEntry {
  return { serial, modeAtDraw, isHit, branchIndex, patternIndex, color: 'white', hot: 0, hesoPayoutBalls: 3 };
}

test('bonus_roundsの検証（省略時0・合計60以内・重複はbonus込み）', () => {
  const base = {
    id: 'x',
    version: 1,
    tier: 'middle',
    modes: {
      normal: { jackpot_1_in: 199.8, st_spins: 0 },
      st: { jackpot_1_in: 39.9, st_spins: 10 },
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
  const noBonus = parseMachine(JSON.parse(JSON.stringify(base)) as unknown);
  expect(noBonus.jackpotSplit[0]).toEqual({ kind: 'kakuhen', weight: 50, weightSt: 50, rounds: 10 });
  const withBonus = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  ((withBonus['jackpot_split'] as Array<Record<string, unknown>>)[0] as Record<string, unknown>)['bonus_rounds'] = 10;
  const parsed = parseMachine(withBonus);
  expect(parsed.jackpotSplit[0]).toEqual({ kind: 'kakuhen', weight: 50, weightSt: 50, rounds: 10, bonusRounds: 10 });
  expect(jackpotPayoutBalls(parsed, 0, 1)).toBe(20 * 10 * 15);
  const over = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  ((over['jackpot_split'] as Array<Record<string, unknown>>)[0] as Record<string, unknown>)['bonus_rounds'] = 51;
  expect(() => parseMachine(over)).toThrow();
  const dupSameBonus = {
    ...JSON.parse(JSON.stringify(base)) as Record<string, unknown>,
    modes: {
      normal: { jackpot_1_in: 199.8, st_spins: 0 },
      st: { jackpot_1_in: 39.9, st_spins: 10 },
    },
    jackpot_split: [
      { kind: 'kakuhen', weight: 50, rounds: 10, bonus_rounds: 5 },
      { kind: 'kakuhen', weight: 50, rounds: 10, bonus_rounds: 5 },
    ],
  };
  expect(() => parseMachine(dupSameBonus)).toThrow();
  const diffBonus = {
    ...JSON.parse(JSON.stringify(base)) as Record<string, unknown>,
    modes: {
      normal: { jackpot_1_in: 199.8, st_spins: 0 },
      st: { jackpot_1_in: 39.9, st_spins: 10 },
    },
    jackpot_split: [
      { kind: 'kakuhen', weight: 50, rounds: 10, bonus_rounds: 5 },
      { kind: 'kakuhen', weight: 50, rounds: 10, bonus_rounds: 10 },
    ],
  };
  expect(() => parseMachine(diffBonus)).not.toThrow();
});

test('uwanoseが「開始+rounds×ms_per_round」に出て出玉が合計ラウンド分になる', () => {
  const spec = bonusSpecFixture();
  const patterns = loadPatterns();
  const kakuteiIdx = patternIndexOf(patterns, 'kakutei');
  const m = new SpinMachine(spec, patterns, { mode: 'st', stRemaining: 3 });
  const bonusBranch = 3;
  const startAt = 1000;
  const started = m.startSpin(makeEntry(10, 'st', kakuteiIdx, true, bonusBranch), startAt, 0);
  expect(started[0]).toEqual({ k: 'spinStarted', entry: 10, at: startAt, pattern: 'kakutei', endsAt: startAt + 30000 });
  const hitAt = startAt + 30000;
  const resolved = m.resolveSpin(hitAt);
  expect(resolved).toEqual([
    { k: 'spinResolved', entry: 10, at: hitAt, hit: true },
    { k: 'jackpotStarted', entry: 10, at: hitAt, kind: 'kakuhen', rounds: 10, bonusRounds: 20 },
  ]);
  expect(m.jackpotEndsAt).toBe(hitAt + 30 * 25000);
  expect(m.uwanoseAt).toBe(hitAt + 10 * 25000);
  const uwAt = hitAt + 10 * 25000;
  const uw = m.emitUwanose(uwAt);
  expect(uw).toEqual([{ k: 'uwanose', entry: 10, at: uwAt, addRounds: 20, totalRounds: 30 }]);
  expect(m.uwanoseAt).toBeNull();
  const endAt = hitAt + 30 * 25000;
  const ended = m.finishJackpot(endAt, 1);
  expect(ended[0]).toEqual({ k: 'jackpotEnded', entry: 10, at: endAt, payout: 30 * 10 * 15 });
  expect(ended[1]).toEqual({ k: 'modeChanged', to: 'lt', at: endAt, stRemaining: 2 });
  expect(() => m.emitUwanose(endAt)).toThrow();
  const noBonusM = new SpinMachine(spec, patterns);
  noBonusM.startSpin(makeEntry(11, 'normal', kakuteiIdx, true, 0), 0, 0);
  noBonusM.resolveSpin(30000);
  expect(noBonusM.uwanoseAt).toBeNull();
  expect(() => noBonusM.emitUwanose(30000 + 3 * 25000)).toThrow();
});

test('chain・chainBallsがRUSH入りで0から数え始め通常に戻るとリセットされる', () => {
  const spec = bonusSpecFixture();
  const patterns = loadPatterns();
  const shortIdx = patternIndexOf(patterns, 'normal_short');
  const kakuteiIdx = patternIndexOf(patterns, 'kakutei');
  const m = new SpinMachine(spec, patterns);
  expect(m.chain).toBe(0);
  expect(m.chainBalls).toBe(0);
  let cur = 0;
  m.startSpin(makeEntry(0, 'normal', kakuteiIdx, true, 1), cur, 0);
  cur = cur + 30000;
  m.resolveSpin(cur);
  const jEnd = cur + 3 * 25000;
  const fin = m.finishJackpot(jEnd, 1);
  expect(fin[1]).toEqual({ k: 'modeChanged', to: 'st', at: jEnd, stRemaining: 3 });
  expect(m.mode).toBe('st');
  expect(m.chain).toBe(0);
  expect(m.chainBalls).toBe(0);
  cur = jEnd;
  m.startSpin(makeEntry(1, 'st', kakuteiIdx, true, 2), cur, 0);
  cur = cur + 30000;
  m.resolveSpin(cur);
  const e1 = cur + 10 * 25000;
  m.finishJackpot(e1, 1);
  expect(m.mode).toBe('st');
  expect(m.chain).toBe(1);
  expect(m.chainBalls).toBe(1500);
  cur = e1;
  m.startSpin(makeEntry(2, 'st', kakuteiIdx, true, 3), cur, 0);
  cur = cur + 30000;
  m.resolveSpin(cur);
  expect(m.uwanoseAt).toBe(cur + 10 * 25000);
  m.emitUwanose(cur + 10 * 25000);
  const e2 = cur + 30 * 25000;
  const fin2 = m.finishJackpot(e2, 1);
  expect(fin2[1]).toEqual({ k: 'modeChanged', to: 'lt', at: e2, stRemaining: 2 });
  expect(m.chain).toBe(2);
  expect(m.chainBalls).toBe(1500 + 4500);
  cur = e2;
  m.startSpin(makeEntry(3, 'lt', shortIdx, false, null), cur, 0);
  cur = cur + 5000;
  m.resolveSpin(cur);
  expect(m.chain).toBe(2);
  expect(m.chainBalls).toBe(6000);
  m.startSpin(makeEntry(4, 'lt', shortIdx, false, null), cur, 0);
  cur = cur + 5000;
  const tail = m.resolveSpin(cur);
  expect(tail).toEqual([
    { k: 'spinResolved', entry: 4, at: cur, hit: false },
    { k: 'modeChanged', to: 'normal', at: cur, stRemaining: 0 },
  ]);
  expect(m.chain).toBe(0);
  expect(m.chainBalls).toBe(0);
  const snap = m.snapshot();
  expect(snap.chain).toBe(0);
  expect(snap.chainBalls).toBe(0);
});

test('決定論契約1・2が上乗せを含む区間（大当たり中・LT中の区切り）で通る', () => {
  const highHit = parseMachine({
    id: 'test-uwanose-hit',
    version: 1,
    tier: 'middle',
    modes: {
      normal: { jackpot_1_in: 10, spins: 0 },
      st: { jackpot_1_in: 10, spins: 10 },
      lt: { jackpot_1_in: 10, spins: 10 },
    },
    jackpot_split: [
      { kind: 'kakuhen', weight: 100, weight_st: 0, weight_lt: 0, rounds: 3, next: 'st' },
      { kind: 'kakuhen', weight: 0, weight_st: 100, weight_lt: 0, rounds: 10, bonus_rounds: 5, next: 'lt' },
      { kind: 'kakuhen', weight: 0, weight_st: 0, weight_lt: 100, rounds: 10, bonus_rounds: 10, next: 'lt' },
    ],
    round: { count: 10, payout_per_ball: 15, ms_per_round: 1000 },
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
  const spec = highHit;
  const patterns = loadPatterns();
  const atlas = loadAtlas();
  const seed = 7;
  const mk = (actions: readonly Action[]): Engine =>
    new Engine({ seed, spec, patterns, atlas, initialBalls: 500000 }, [], actions);
  const actions: Action[] = [{ t: 0, k: 'auto', share: 1, rate: 1 }];
  const until = 5000000;
  const once = mk(actions).advance(until);
  const uw = once.find((e) => e.k === 'uwanose');
  expect(uw).toBeDefined();
  const uwAt = (uw as unknown as { at: number }).at;
  const jsForUw = once.filter((e) => e.k === 'jackpotStarted').find((e) => (e as { entry: number }).entry === (uw as unknown as { entry: number }).entry);
  expect(jsForUw).toBeDefined();
  // 契約1: 大当たり中（uwanose前後）で区切っても一致
  for (const cut of [uwAt, uwAt + 1, (jsForUw as unknown as { at: number }).at]) {
    const a = mk(actions);
    const head = a.advance(cut);
    const tail = a.advance(until);
    expect([...head, ...tail]).toEqual(once);
    expect(a.snapshot()).toEqual(((): unknown => {
      const b = mk(actions);
      b.advance(until);
      return b.snapshot();
    })());
  }
  // 契約1: LT中の区切り（modeChanged to lt の直後）でも一致
  const ltMode = once.find((e) => e.k === 'modeChanged' && (e as { to: string }).to === 'lt');
  expect(ltMode).toBeDefined();
  const ltAt = (ltMode as unknown as { at: number }).at;
  expect(ltAt + 1).toBeLessThan(until);
  {
    const a = mk(actions);
    const head = a.advance(ltAt + 1);
    const tail = a.advance(until);
    expect([...head, ...tail]).toEqual(once);
  }
  // 契約1: 1秒刻みN回（uwanose・LT突入を含む区間）の連結が一括と一致し、最終スナップショットも一致
  {
    const whole = mk(actions);
    whole.advance(until);
    const stepped = mk(actions);
    const joined: SimEvent[] = [];
    for (let t = 1000; t <= until; t = t + 1000) {
      const evs = stepped.advance(t);
      for (let i = 0; i < evs.length; i = i + 1) {
        joined.push(evs[i] as SimEvent);
      }
    }
    expect(until % 1000).toBe(0);
    expect(uwAt).toBeLessThan(until);
    expect(joined).toEqual(once);
    expect(stepped.snapshot()).toEqual(whole.snapshot());
  }
  // 契約2: uwanose前のスナップショットから復元して続行が一致
  const before = mk(actions);
  before.advance(uwAt);
  const snapBefore = before.snapshot();
  const tailThrough = before.advance(until);
  const resumed = Engine.restore(snapBefore, { seed, spec, patterns, atlas });
  const tailResumed = resumed.advance(until);
  expect(tailResumed).toEqual(tailThrough);
  expect(resumed.snapshot()).toEqual(before.snapshot());
  // 契約2: uwanose直後のスナップショットから復元しても一致
  const atUw = mk(actions);
  atUw.advance(uwAt + 1);
  const snapUw = atUw.snapshot();
  const tail2 = atUw.advance(until);
  const resumed2 = Engine.restore(snapUw, { seed, spec, patterns, atlas });
  expect(resumed2.advance(until)).toEqual(tail2);
  expect(resumed2.snapshot()).toEqual(atUw.snapshot());
});

function ltProjSpec(): MachineSpec {
  return parseMachine({
    id: 'test-uwanose-proj',
    version: 1,
    tier: 'middle',
    modes: {
      normal: { jackpot_1_in: 10, spins: 0 },
      st: { jackpot_1_in: 10, spins: 10 },
      lt: { jackpot_1_in: 10, spins: 10 },
    },
    jackpot_split: [
      { kind: 'kakuhen', weight: 100, weight_st: 0, weight_lt: 0, rounds: 3, next: 'st' },
      { kind: 'kakuhen', weight: 0, weight_st: 100, weight_lt: 0, rounds: 10, bonus_rounds: 5, next: 'lt' },
      { kind: 'kakuhen', weight: 0, weight_st: 0, weight_lt: 100, rounds: 10, bonus_rounds: 10, next: 'lt' },
    ],
    round: { count: 10, payout_per_ball: 15, ms_per_round: 1000 },
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

test('Engineのuwanose順序と投影chain（bonus機種でprojectにchainが載る）', () => {
  const spec = ltProjSpec();
  const patterns = loadPatterns();
  const atlas = loadAtlas();
  const eng = new Engine({ seed: 7, spec, patterns, atlas, initialBalls: 100000 }, [], [{ t: 0, k: 'auto', share: 1, rate: 1 }]);
  const evs = eng.advance(3000000);
  let uwIdx = -1;
  let jsIdx = -1;
  let jeIdx = -1;
  for (let i = 0; i < evs.length; i = i + 1) {
    const e = evs[i] as SimEvent;
    if (e.k === 'uwanose' && uwIdx < 0) {
      uwIdx = i;
    }
    if (e.k === 'jackpotStarted' && (e as { bonusRounds?: number }).bonusRounds !== undefined && (e as { bonusRounds?: number }).bonusRounds !== 0 && jsIdx < 0) {
      jsIdx = i;
    }
    if (e.k === 'jackpotEnded' && jeIdx < 0 && jsIdx >= 0) {
      jeIdx = i;
    }
  }
  if (uwIdx >= 0) {
    const uw = evs[uwIdx] as { k: string; entry: number; at: number; addRounds: number; totalRounds: number };
    let js: { at: number; rounds: number } | null = null;
    for (let i = uwIdx; i >= 0; i = i - 1) {
      const e = evs[i] as SimEvent;
      if (e.k === 'jackpotStarted' && (e as { entry: number }).entry === uw.entry) {
        js = e as unknown as { at: number; rounds: number };
        break;
      }
    }
    expect(js).not.toBeNull();
    if (js !== null) {
      expect(uw.at).toBe(js.at + (js.rounds as number) * 1000);
      expect(uw.totalRounds).toBe((js.rounds as number) + uw.addRounds);
    }
    for (let i = 1; i < evs.length; i = i + 1) {
      const prev = evs[i - 1] as SimEvent;
      const curEv = evs[i] as SimEvent;
      expect(curEv.at).toBeGreaterThanOrEqual(prev.at);
    }
  }
  expect(uwIdx).toBeGreaterThanOrEqual(0);
  expect(jsIdx).toBeGreaterThanOrEqual(0);
  // 投影chain/chainBalls: イベント列から集計した値（RUSH中→RUSH継続の jackpotEnded 回数と payout 合計）と一致
  const isRush = (m: string): boolean => m === 'st' || m === 'lt';
  let mode = 'normal';
  let chain = 0;
  let chainBalls = 0;
  let cutAt = -1;
  for (let i = 0; i < evs.length; i = i + 1) {
    const e = evs[i] as SimEvent;
    if (e.k === 'jackpotEnded') {
      // 同時刻の modeChanged は spinStarted 等の後ろに回るので、同時刻内を先読みして次モードを決める
      let next = mode;
      for (let j = i + 1; j < evs.length && (evs[j] as SimEvent).at === e.at; j = j + 1) {
        const f = evs[j] as SimEvent;
        if (f.k === 'modeChanged') {
          next = f.to;
          break;
        }
      }
      if (isRush(mode) && isRush(next)) {
        chain = chain + 1;
        chainBalls = chainBalls + e.payout;
      } else {
        chain = 0;
        chainBalls = 0;
      }
      if (chain >= 2 && cutAt < 0) {
        cutAt = e.at;
        break;
      }
    } else if (e.k === 'modeChanged') {
      mode = e.to;
      if (!isRush(mode)) {
        chain = 0;
        chainBalls = 0;
      }
    }
  }
  expect(cutAt).toBeGreaterThanOrEqual(0);
  expect(chainBalls).toBeGreaterThan(0);
  const atCut = new Engine({ seed: 7, spec, patterns, atlas, initialBalls: 100000 }, [], [{ t: 0, k: 'auto', share: 1, rate: 1 }]);
  atCut.advance(cutAt + 1);
  const proj = atCut.project();
  expect(proj.chain).toBe(chain);
  expect(proj.chainBalls).toBe(chainBalls);
});

test('投影: 上乗せの告知前は基本ラウンドだけ見せ、未告知分はhiddenRounds（告知後・restore後も一致）', () => {
  const spec = ltProjSpec();
  const patterns = loadPatterns();
  const atlas = loadAtlas();
  const actions: Action[] = [{ t: 0, k: 'auto', share: 1, rate: 1 }];
  const mk = (): Engine => new Engine({ seed: 7, spec, patterns, atlas, initialBalls: 100000 }, [], actions);
  const evs = mk().advance(3000000);
  const uw = evs.find((e) => e.k === 'uwanose');
  if (uw === undefined || uw.k !== 'uwanose') {
    throw new Error('no uwanose');
  }
  const js = evs.find((e) => e.k === 'jackpotStarted' && e.entry === uw.entry);
  if (js === undefined || js.k !== 'jackpotStarted') {
    throw new Error('no jackpotStarted');
  }
  const endsAt = js.at + uw.totalRounds * 1000;
  // 告知前: 基本ラウンドのみ・終了予定は上乗せ込み
  const before = mk();
  before.advance(js.at + 500);
  expect(before.project().jackpot).toEqual({ entry: uw.entry, kind: js.kind, rounds: js.rounds, endsAt, hiddenRounds: uw.addRounds });
  // snapshot→restore しても同じ（上乗せを先に見せない）
  const restored = Engine.restore(before.snapshot(), { seed: 7, spec, patterns, atlas });
  expect(restored.project().jackpot).toEqual(before.project().jackpot);
  // 告知後: 合計ラウンド・hiddenRoundsなし
  const after = mk();
  after.advance(uw.at + 1);
  expect(after.project().jackpot).toEqual({ entry: uw.entry, kind: js.kind, rounds: uw.totalRounds, endsAt });
});
