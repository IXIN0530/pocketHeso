import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import type { ClaimRecord } from '@ph/claims';
import { GRANT_HOLD_SERIAL_BASE, type HallProjection, type HoldEntry, type LotteryHoldColor, type LotteryMode } from '@ph/core';
import {
  HOLD_BREAK_MS,
  HOLD_CRACK_CUE,
  HOLD_CRACK_STEPS_MS,
  SAKIBARE_CUE,
  SAKIBARE_CUSTOMS,
  SAKIBARE_DELAY_MS,
  holdBreakScale,
  holdChangeCue,
  planHoldChange,
  planHoldChangeCustom,
  type SakibareCustom,
} from '@ph/fx';
import { expect, test } from 'vitest';
import packJson from '../../../../resources/packs/default/pack.json';
import { EngineHost, type TickResult } from '../engine/engine-host.ts';
import { openStorage } from '../platform/storage.ts';
import { machineSakibareOdds } from '../engine/game-config.ts';
import { DISPLAY_LAG_MS } from './ball-tracks.ts';
import {
  LcdTimeline,
  applyLcdEvent,
  applyLcdEventWith,
  isGrantHold,
  matchesProjection,
  sakibareTimes,
  shownLcdState,
  stateFromProjection,
  type LcdState,
} from './lcd-timeline.ts';
import { spinTargets } from './lcd.ts';

const ATLAS = ((): ArrayBuffer => {
  const b = readFileSync('../../resources/atlas/default.27038344f36daf46.bin');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
})();

const T0 = Date.UTC(2026, 8, 26, 6, 0, 0);
const MIN = 60000;
let seedN = 500;
let dbN = 0;

const fuel = (at: number): ClaimRecord => ({
  claimId: `health:steps:2026-09-26:${at}`,
  receivedAt: at,
  source: 'health',
  kind: 'steps',
  day: '2026-09-26',
  amount: 1000,
  trust: 1,
  grant: { claimId: `health:steps:2026-09-26:${at}`, at, fuelMs: 60 * MIN, medals: 0, prodMin: 2000 },
});

/** 画面と同じ流れ: 1Hz の前進結果を積み、「時計 − 表示の遅れ」を 100ms 刻みで進めて状態の移り変わりを集める。 */
async function watch(host: EngineHost, tl: LcdTimeline, from: number, to: number, onStep: (prev: LcdState, next: LcdState) => void) {
  let display = from - DISPLAY_LAG_MS;
  for (let now = from; now < to; now += 1000) {
    const r: TickResult = await host.tick(now);
    tl.push(r.projection, r.events);
    for (; display <= now - DISPLAY_LAG_MS; display += 100) {
      const prev = tl.state;
      onStep(prev, tl.advance(display));
    }
  }
}

test('保留が増減し、変動の開始で先頭が1つ消化される（取りこぼし無し・最後は Projection と一致）', async () => {
  let maxHolds = 0;
  let increases = 0;
  let consumed = 0;
  // 単価8玉のため初期100玉だけでは足りず、受け取りで玉を足してから打つ（4台ぶんを合わせる）。
  for (let n = 0; n < 4; n++) {
    const db = await openStorage(`t-lcd-${dbN++}`);
    const { host, boot } = await EngineHost.open(db, ATLAS, T0, () => seedN++);
    const tl = new LcdTimeline();
    tl.push(boot.projection, []);
    await host.receive([fuel(T0)], false, T0 + 500);
    const r = await host.act({ k: 'shoot', on: true, rate: 1 }, T0 + 1000);
    tl.push(r.projection, r.events);
    await watch(host, tl, T0 + 2000, T0 + 6 * MIN, (prev, next) => {
      maxHolds = Math.max(maxHolds, next.holds.length);
      expect(next.holds.length).toBeLessThanOrEqual(4);
      if (next.spin && next.spin.entry !== prev.spin?.entry) {
        // 変動は先頭の保留から（100ms の間に取得と開始が重なった時は、増えた分を差し引く）。
        const added = next.holds.filter((h) => !prev.holds.some((q) => q.entry === h.entry)).length;
        const head = prev.holds[0];
        if (head) {
          expect(next.spin.entry).toBe(head.entry);
          expect(next.spin.color).toBe(head.color);
          expect(next.holds.length).toBe(prev.holds.length - 1 + added);
        } else {
          expect(next.holds.some((h) => h.entry === next.spin!.entry)).toBe(false);
        }
        consumed++;
      } else if (next.holds.length > prev.holds.length) {
        increases++;
      }
    });
    expect(tl.resyncs).toBe(0);
    // 表示時刻が追いつけば Projection と同じ（保留の色の並び・変動中の番号）。
    // 大当たりの出玉で打ち続ける台もあるので、打つのを止めてから保留と大当たりが終わるまで待つ。
    const stop = await host.act({ k: 'shoot', on: false, rate: 1 }, T0 + 6 * MIN);
    tl.push(stop.projection, stop.events);
    const last = await host.tick(T0 + 20 * MIN);
    tl.push(last.projection, last.events);
    expect(matchesProjection(tl.advance(last.projection.at), last.projection)).toBe(true);
    expect(last.projection.holds.length).toBe(0);
  }
  expect(increases).toBeGreaterThanOrEqual(10);
  expect(consumed).toBeGreaterThanOrEqual(10);
  expect(maxHolds).toBeGreaterThanOrEqual(3);
});

test('背面から戻っても保留と変動が Projection とずれない', async () => {
  const db = await openStorage(`t-lcd-${dbN++}`);
  const { host, boot } = await EngineHost.open(db, ATLAS, T0, () => seedN++);
  const tl = new LcdTimeline();
  tl.push(boot.projection, []);
  await host.receive([fuel(T0)], false, T0 + 500);
  const r0 = await host.act({ k: 'shoot', on: true, rate: 1 }, T0 + 1000);
  tl.push(r0.projection, r0.events);
  await watch(host, tl, T0 + 2000, T0 + 2 * MIN, () => {});
  const bg = await host.presence(false, T0 + 2 * MIN);
  tl.push(bg.projection, bg.events);
  const fg = await host.presence(true, T0 + 9 * MIN);
  tl.push(fg.projection, fg.events);
  expect(matchesProjection(tl.advance(fg.projection.at), fg.projection)).toBe(true);
  // 以後も取りこぼし無しでイベントで進む。
  const before = tl.resyncs;
  await watch(host, tl, T0 + 9 * MIN + 1000, T0 + 12 * MIN, () => {});
  expect(tl.resyncs).toBe(before);
});

test('出目: 当たりは3つ揃い・リーチのハズレは中だけずれる・通常のハズレは左右が揃わない', () => {
  for (let e = 0; e < 200; e++) {
    const [a, b, c] = spinTargets(e, true, true);
    expect(a === b && b === c).toBe(true);
    const [l, m, r] = spinTargets(e, true, false);
    expect(l === r && m !== l).toBe(true);
    const [x, , z] = spinTargets(e, false, false);
    expect(x).not.toBe(z);
  }
});

const hold = (serial: number, color: LotteryHoldColor): HoldEntry =>
  ({ serial, modeAtDraw: 'normal', isHit: false, branchIndex: null, patternIndex: 0, color, hot: 0, hesoPayoutBalls: 3 }) as HoldEntry;

/** 見せ方が plan の条件に合う番号を探す（seed 固定）。 */
function findSerial(seed: number, final: LotteryHoldColor, ok: (p: ReturnType<typeof planHoldChange>) => boolean): number {
  for (let s = 0; s < 10000; s++) if (ok(planHoldChange(seed, s, final))) return s;
  throw new Error('not found');
}

test('保留変化: 変化する保留は灰色で点滅して出て、消化されても灰色のまま、自分の変動で割れて最終色になる', () => {
  const seed = 99;
  const serial = findSerial(seed, 'red', (p) => p.change && !p.sakibare);
  const plain = findSerial(seed, 'blue', (p) => !p.change);
  let s: LcdState = { holds: [], spin: null, resolved: null, jackpot: null };
  s = applyLcdEvent(s, { k: 'holdAdded', entry: hold(plain, 'blue'), at: 1000 });
  s = applyLcdEvent(s, { k: 'holdAdded', entry: hold(serial, 'red'), at: 2000 });
  const a = shownLcdState(s, seed, 2000);
  expect(a.holds.map((h) => [h.color, h.blink ?? false])).toEqual([['blue', false], ['white', true]]);
  s = applyLcdEvent(s, { k: 'spinStarted', entry: plain, at: 60000, pattern: 'normal_short', endsAt: 65000 });
  expect(shownLcdState(s, seed, 64000).spin!.breaks).toBeUndefined();
  expect(shownLcdState(s, seed, 64000).holds[0]).toMatchObject({ color: 'white', blink: true });
  s = applyLcdEvent(s, { k: 'spinStarted', entry: serial, at: 65000, pattern: 'normal_short', endsAt: 70000 });
  expect(shownLcdState(s, seed, 65000).spin).toMatchObject({ color: 'white', breaks: true });
  // 5秒の変動は割れる演出を縮めて、割れた後に図柄が回る時間を残す。
  const reveal = HOLD_BREAK_MS.reveal * holdBreakScale(5000);
  expect(reveal).toBeLessThan(HOLD_BREAK_MS.reveal);
  expect(5000 - HOLD_BREAK_MS.reels * holdBreakScale(5000)).toBeGreaterThanOrEqual(1200);
  expect(shownLcdState(s, seed, 65000 + Math.ceil(reveal) - 1).spin!.color).toBe('white');
  expect(shownLcdState(s, seed, 65000 + Math.ceil(reveal)).spin!.color).toBe('red');
});

test('割れる演出の縮尺: 長い変動は元の尺、短い変動ほど縮む（下限あり）', () => {
  expect(holdBreakScale(20000)).toBe(1);
  expect(holdBreakScale(HOLD_BREAK_MS.reels + 1200)).toBe(1);
  expect(holdBreakScale(5000)).toBeCloseTo(0.76);
  expect(holdBreakScale(1458)).toBe(0.15);
});

test('保留変化: リプレイ（取得時刻が不明）でも同じ時刻に割れて同じ色になる', () => {
  const seed = 7;
  const serial = findSerial(seed, 'gold', (p) => p.change);
  let live: LcdState = { holds: [], spin: null, resolved: null, jackpot: null };
  live = applyLcdEvent(live, { k: 'holdAdded', entry: hold(serial, 'gold'), at: 1000 });
  live = applyLcdEvent(live, { k: 'spinStarted', entry: serial, at: 9000, pattern: 'sp_reach', endsAt: 54000 });
  const replay: LcdState = {
    holds: [],
    spin: { entry: serial, pattern: 'sp_reach', startAt: 9000, endsAt: 54000, color: 'gold', hit: true, addedAt: null },
    resolved: null,
    jackpot: null,
  };
  for (const t of [9000, 9000 + HOLD_BREAK_MS.reveal - 1, 9000 + HOLD_BREAK_MS.reveal, 20000]) {
    const r = shownLcdState(replay, seed, t).spin!;
    const l = shownLcdState(live, seed, t).spin!;
    expect([r.color, r.breaks]).toEqual([l.color, l.breaks]);
  }
  expect(shownLcdState(live, seed, 9000).spin!.color).toBe('white');
  expect(shownLcdState(live, seed, 9000 + HOLD_BREAK_MS.reveal).spin!.color).toBe('gold');
});

test('保留変化: Projection から作った保留は最終色のまま・パックに hold_crack と hold_<色> の演出がある', () => {
  const s = stateFromProjection({ holds: ['gold', 'red'], spin: undefined, jackpot: undefined } as never);
  expect(shownLcdState(s, 1, 0)).toBe(s);
  const names = packJson.sheets.map((x) => x.pattern);
  for (const c of ['blue', 'green', 'red', 'gold']) expect(names).toContain('hold_' + c);
  expect(names).toContain(HOLD_CRACK_CUE);
  // ひびのピキッ（液晶）と crack の音は同じ時刻。
  const crack = packJson.sheets.find((x) => x.pattern === HOLD_CRACK_CUE)!;
  const at = crack.cues.filter((c) => 'asset' in c && c.asset === 'crack').map((c) => c.at);
  expect(at).toEqual([...HOLD_CRACK_STEPS_MS]);
});

test('先バレ: 玉が入ってすぐ鳴り、保留は灰色で点滅して出る。変動に移っても同じ時刻・リプレイでは鳴らない', () => {
  const seed = 5;
  const serial = findSerial(seed, 'green', (p) => p.sakibare);
  const other = findSerial(seed, 'red', (p) => !p.change);
  let s: LcdState = { holds: [], spin: null, resolved: null, jackpot: null };
  s = applyLcdEvent(s, { k: 'holdAdded', entry: hold(other, 'red'), at: 500 });
  s = applyLcdEvent(s, { k: 'holdAdded', entry: hold(serial, 'green'), at: 1000 });
  expect(sakibareTimes(s, seed)).toEqual([{ entry: serial, at: 1000 + SAKIBARE_DELAY_MS }]);
  expect(shownLcdState(s, seed, 1000).holds[1]).toMatchObject({ color: 'white', blink: true });
  expect(shownLcdState(s, seed, 1e9).holds[1]).toMatchObject({ color: 'white', blink: true });
  s = applyLcdEvent(s, { k: 'spinStarted', entry: other, at: 3000, pattern: 'normal_short', endsAt: 8000 });
  s = applyLcdEvent(s, { k: 'spinStarted', entry: serial, at: 8000, pattern: 'normal_short', endsAt: 13000 });
  expect(sakibareTimes(s, seed)).toEqual([{ entry: serial, at: 1000 + SAKIBARE_DELAY_MS }]);
  const replay: LcdState = { ...s, spin: { ...s.spin!, addedAt: null } };
  expect(sakibareTimes(replay, seed)).toEqual([]);
  expect(shownLcdState(replay, seed, 8000 + HOLD_BREAK_MS.reveal * holdBreakScale(5000)).spin!.color).toBe('green');
  expect(packJson.sheets.map((x) => x.pattern)).toContain(SAKIBARE_CUE);
});

test('特別保留（通し番号 1.5e9 台）だけに「特」の札', () => {
  expect(isGrantHold(1500000000)).toBe(true);
  expect(isGrantHold(1500000007)).toBe(true);
  expect(isGrantHold(1000000003)).toBe(false); // 予告のボーナス保留
  expect(isGrantHold(2000000000)).toBe(false); // 電サポの自動保留
  expect(isGrantHold(42)).toBe(false);
  expect(isGrantHold(-1)).toBe(false);
});

// --- 抽選カスタム（P13-T1） ---
const holdAs = (serial: number, color: LotteryHoldColor, isHit: boolean, modeAtDraw: LotteryMode = 'normal'): HoldEntry =>
  ({ ...hold(serial, color), isHit, modeAtDraw }) as HoldEntry;
const EMPTY_STATE: LcdState = { holds: [], spin: null, resolved: null, jackpot: null };
const ODDS = { p: 0.1, hitW: [20, 20, 20, 10, 30], missW: [10, 5, 4, 1, 80] };
const fixedP = () => ODDS;
const sb = (seed: number, n: number, color: LotteryHoldColor, hit: boolean) => planHoldChangeCustom(seed, n, color, hit, ODDS, 'sb100').sakibare;

test('抽選カスタムを変えても、先バレしない保留の見せる色・点滅は変わらない。先バレした保留は必ず点滅する', () => {
  const seed = 31;
  const colors: LotteryHoldColor[] = ['white', 'blue', 'green', 'red', 'gold'];
  const serials = Array.from({ length: 60 }, (_, i) => i);
  const shown = (custom: SakibareCustom) => {
    let s = EMPTY_STATE;
    serials.forEach((n, i) => {
      s = applyLcdEventWith(s, { k: 'holdAdded', entry: holdAs(n, colors[i % colors.length]!, i % 3 === 0), at: 1000 + i }, custom);
    });
    return shownLcdState(s, seed, 5000, fixedP).holds.map((h) => [h.color, h.blink ?? false]);
  };
  const base = shown('normal');
  expect(base.some(([, b]) => b === true)).toBe(true);
  for (const c of SAKIBARE_CUSTOMS) {
    const got = shown(c);
    got.forEach((g, i) => {
      // 変化は増えるだけ（先バレで変化に変わる）。変化しない保留は normal と同じ。
      if (g[1] === false) expect(g).toEqual(base[i]);
      if (base[i]![1] === true) expect(g).toEqual(base[i]);
    });
  }
  expect(shown('sb100').filter(([, b]) => b).length).toBeGreaterThan(base.filter(([, b]) => b).length);
});

test('抽選カスタムは取得時の値が使われる（取得後に設定を変えても、取った保留の先バレは変わらない）', () => {
  const seed = 7;
  const hitSerial = (() => {
    for (let n = 0; n < 10000; n++) if (sb(seed, n, 'blue', true)) return n;
    throw new Error('not found');
  })();
  const other = (() => {
    for (let n = hitSerial + 1; n < 10000; n++) if (sb(seed, n, 'blue', true)) return n;
    throw new Error('not found');
  })();
  const tl = new LcdTimeline();
  const proj = (holds: LotteryHoldColor[]) => ({ holds, spin: undefined, jackpot: undefined, mode: 'normal', chain: 0, chainBalls: 0 }) as unknown as HallProjection;
  tl.push(proj([]), []);
  tl.custom = 'sb100';
  tl.push(proj(['blue']), [{ k: 'holdAdded', entry: holdAs(hitSerial, 'blue', true), at: 1000 } as never]);
  tl.advance(1000);
  const first = sakibareTimes(tl.state, seed, fixedP);
  expect(first).toEqual([{ entry: hitSerial, at: 1000 + SAKIBARE_DELAY_MS }]);
  // 設定を変える: 取った保留はそのまま、次に取る保留から新しい設定。
  tl.custom = 'sb40';
  expect(sakibareTimes(tl.state, seed, fixedP)).toEqual(first);
  tl.push(proj(['blue', 'blue']), [{ k: 'holdAdded', entry: holdAs(other, 'blue', true), at: 2000 } as never]);
  tl.advance(2000);
  expect(tl.state.holds.map((h) => h.custom)).toEqual(['sb100', 'sb40']);
  expect(sakibareTimes(tl.state, seed, fixedP).filter((x) => x.entry === hitSerial)).toEqual(first);
  // 変動に移っても取得時の値を引き継ぐ。
  const s = applyLcdEvent(tl.state, { k: 'spinStarted', entry: hitSerial, at: 3000, pattern: 'normal_short', endsAt: 8000 });
  expect(s.spin).toMatchObject({ custom: 'sb100', mode: 'normal', addedAt: 1000 });
  expect(sakibareTimes(s, seed, fixedP).find((x) => x.entry === hitSerial)).toEqual(first[0]);
});

test('sb100: ハズレの保留は先バレしない・当たりの保留は先バレしうる（取得時のモードの確率で決まる）', () => {
  const seed = 11;
  // 当たりの保留色は ODDS.hitW（blue, green, red, gold, white の順）の重みどおりに並べる（白は先バレしない）。
  const colors: LotteryHoldColor[] = ['blue', 'green', 'red', 'gold', 'white'];
  const mix = colors.flatMap((c, i) => Array.from({ length: ODDS.hitW[i]! }, () => c));
  let sbHit = 0;
  for (let n = 0; n < 2000; n++) {
    const color = mix[(n * 37) % mix.length]!;
    const miss = applyLcdEventWith(EMPTY_STATE, { k: 'holdAdded', entry: holdAs(n, color, false), at: 100 }, 'sb100');
    expect(sakibareTimes(miss, seed, fixedP)).toEqual([]);
    const hit = applyLcdEventWith(EMPTY_STATE, { k: 'holdAdded', entry: holdAs(n, color, true), at: 100 }, 'sb100');
    const got = sakibareTimes(hit, seed, fixedP).length > 0;
    if (color === 'white') expect(got).toBe(false);
    if (got) sbHit++;
  }
  // 占有率 0.6 ほど（RNG の引きなので ±0.05）。
  expect(Math.abs(sbHit / 2000 - 0.6)).toBeLessThan(0.05);
  // 当たりの保留の先バレの時刻は取得 + SAKIBARE_DELAY_MS。
  const n = Array.from({ length: 100 }, (_, i) => i).find((i) => sb(seed, i, 'blue', true))!;
  const s = applyLcdEventWith(EMPTY_STATE, { k: 'holdAdded', entry: holdAs(n, 'blue', true), at: 400 }, 'sb100');
  expect(sakibareTimes(s, seed, fixedP)).toEqual([{ entry: n, at: 400 + SAKIBARE_DELAY_MS }]);
  // 当否が分からない（Projection から作った）保留は出さない。
  const unknown: LcdState = { ...s, holds: s.holds.map((h) => ({ ...h, hit: null })) };
  expect(sakibareTimes(unknown, seed, fixedP)).toEqual([]);
});

test('特別保留（1.5e9 台）はカスタムでは先バレしない', () => {
  for (const c of ['sb40', 'sb90', 'sb100'] as const) {
    for (let k = 0; k < 200; k++) {
      const s = applyLcdEventWith(EMPTY_STATE, { k: 'holdAdded', entry: holdAs(GRANT_HOLD_SERIAL_BASE + k, 'gold', true), at: 100 }, c);
      expect(sakibareTimes(s, 3, fixedP)).toEqual([]);
    }
  }
});

test('取得時のモードの材料で引く（機種の spec から: rush-middle-01 の通常と ST は確率が違う）', () => {
  const pn = machineSakibareOdds('rush-middle-01', 'normal').p;
  const ps = machineSakibareOdds('rush-middle-01', 'st').p;
  expect(pn).toBeGreaterThan(0);
  expect(ps).toBeGreaterThan(pn);
  expect(machineSakibareOdds('nothing', 'normal').p).toBe(0);
  // ST は当選確率が高く、ハズレの赤保留でも sb40 で先バレしやすい。
  const seed = 2;
  const count = (mode: LotteryMode) => {
    let n = 0;
    for (let i = 0; i < 20000; i++) {
      const s = applyLcdEventWith(EMPTY_STATE, { k: 'holdAdded', entry: holdAs(i, 'red', false, mode), at: 0 }, 'sb40');
      if (sakibareTimes(s, seed, (m) => machineSakibareOdds('rush-middle-01', m)).length > 0) n++;
    }
    return n;
  };
  expect(count('st')).toBeGreaterThan(count('normal'));
});

test('カスタムの先バレ: 取得時は灰色（白・点滅）で出て、自分の変動開始から 4500ms で最終色になる。白と特別保留は先バレしない', () => {
  const seed = 21;
  const serial = (() => {
    for (let n = 0; n < 10000; n++) if (planHoldChangeCustom(seed, n, 'green', true, ODDS, 'sb100').sakibare && !planHoldChange(seed, n, 'green').change) return n;
    throw new Error('not found');
  })();
  let s = applyLcdEventWith(EMPTY_STATE, { k: 'holdAdded', entry: holdAs(serial, 'green', true), at: 1000 }, 'sb100');
  // normal の見せ方なら変化しない保留が、カスタムの先バレで変化する。
  expect(shownLcdState(s, seed, 1000, fixedP).holds[0]).toMatchObject({ color: 'white', blink: true });
  expect(shownLcdState(s, seed, 1000).holds[0]).toMatchObject({ color: 'green' });
  expect(sakibareTimes(s, seed, fixedP)).toEqual([{ entry: serial, at: 1000 + SAKIBARE_DELAY_MS }]);
  s = applyLcdEvent(s, { k: 'spinStarted', entry: serial, at: 20000, pattern: 'sp_reach', endsAt: 60000 });
  expect(shownLcdState(s, seed, 20000, fixedP).spin).toMatchObject({ color: 'white', breaks: true });
  expect(shownLcdState(s, seed, 20000 + HOLD_BREAK_MS.reveal - 1, fixedP).spin!.color).toBe('white');
  expect(shownLcdState(s, seed, 20000 + HOLD_BREAK_MS.reveal, fixedP).spin!.color).toBe('green');
  // 取得後に設定が変わっても、取った保留の見え方は取得時の値のまま（custom は保留が持つ）。
  expect(s.spin!.custom).toBe('sb100');
  // 白の保留と特別保留は先バレしない。
  for (let n = 0; n < 500; n++) {
    expect(planHoldChangeCustom(seed, n, 'white', true, ODDS, 'sb100').sakibare).toBe(false);
    expect(planHoldChangeCustom(seed, GRANT_HOLD_SERIAL_BASE + n, 'gold', true, ODDS, 'sb100').sakibare).toBe(false);
  }
});

test('ST の sb40: 最終色が白の保留も先バレして、取得時は灰色、変動開始から 4500ms で白以外の色（plan.final）が見える。Core の色は白のまま', () => {
  const seed = 5;
  const oddsOf = (m: LotteryMode) => machineSakibareOdds('rush-middle-01', m);
  const odds = oddsOf('st');
  const serial = (() => {
    for (let n = 0; n < 100000; n++) {
      const p = planHoldChangeCustom(seed, n, 'white', true, odds, 'sb40');
      if (p.sakibare) return n;
    }
    throw new Error('not found');
  })();
  const plan = planHoldChangeCustom(seed, serial, 'white', true, odds, 'sb40');
  expect(plan.change).toBe(true);
  expect(plan.final).not.toBe('white');
  let s = applyLcdEventWith(EMPTY_STATE, { k: 'holdAdded', entry: holdAs(serial, 'white', true, 'st'), at: 1000 }, 'sb40');
  expect(s.holds[0]!.color).toBe('white'); // Core の色
  expect(shownLcdState(s, seed, 1000, oddsOf).holds[0]).toMatchObject({ color: 'white', blink: true });
  expect(sakibareTimes(s, seed, oddsOf)).toEqual([{ entry: serial, at: 1000 + SAKIBARE_DELAY_MS }]);
  s = applyLcdEvent(s, { k: 'spinStarted', entry: serial, at: 20000, pattern: 'sp_reach', endsAt: 60000 });
  expect(shownLcdState(s, seed, 20000 + HOLD_BREAK_MS.reveal - 1, oddsOf).spin!.color).toBe('white');
  const shown = shownLcdState(s, seed, 20000 + HOLD_BREAK_MS.reveal, oddsOf).spin!.color;
  expect(shown).toBe(plan.final);
  expect(holdChangeCue(shown!)).toBe(`hold_${plan.final}`);
  expect(s.spin!.color).toBe('white');
});
