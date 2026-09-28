import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import type { ClaimRecord } from '@ph/claims';
import type { HoldEntry, LotteryHoldColor } from '@ph/core';
import { HOLD_BREAK_MS, HOLD_CRACK_CUE, HOLD_CRACK_STEPS_MS, SAKIBARE_CUE, SAKIBARE_DELAY_MS, holdBreakScale, planHoldChange } from '@ph/fx';
import { expect, test } from 'vitest';
import packJson from '../../../../resources/packs/default/pack.json';
import { EngineHost, type TickResult } from '../engine/engine-host.ts';
import { openStorage } from '../platform/storage.ts';
import { DISPLAY_LAG_MS } from './ball-tracks.ts';
import {
  LcdTimeline,
  applyLcdEvent,
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
