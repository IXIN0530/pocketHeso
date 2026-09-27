import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import type { ClaimRecord } from '@ph/claims';
import type { HoldEntry, LotteryHoldColor } from '@ph/core';
import { HOLD_CHANGE_DELAY_MS, holdRank, planHoldChange } from '@ph/fx';
import { expect, test } from 'vitest';
import packJson from '../../../../resources/packs/default/pack.json';
import { EngineHost, type TickResult } from '../engine/engine-host.ts';
import { openStorage } from '../platform/storage.ts';
import { DISPLAY_LAG_MS } from './ball-tracks.ts';
import { LcdTimeline, applyLcdEvent, matchesProjection, shownLcdState, stateFromProjection, type LcdState } from './lcd-timeline.ts';
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
  grant: { claimId: `health:steps:2026-09-26:${at}`, at, fuelMs: 60 * MIN, medals: 0 },
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
  // 初期の持ち玉（100玉）は2分ほどで打ち切るので、seed を変えた4台ぶんを合わせて見る。
  for (let n = 0; n < 4; n++) {
    const db = await openStorage(`t-lcd-${dbN++}`);
    const { host, boot } = await EngineHost.open(db, ATLAS, T0, () => seedN++);
    const tl = new LcdTimeline();
    tl.push(boot.projection, []);
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

test('保留変化: 前の保留の消化で変わる保留は、消化の少し後に最終色になり、途中で最終色を超えない', () => {
  const seed = 99;
  const serial = findSerial(seed, 'red', (p) => p.steps.length === 1 && p.steps[0]!.timing === 'shift');
  const plan = planHoldChange(seed, serial, 'red');
  let s: LcdState = { holds: [], spin: null, resolved: null, jackpot: null };
  s = applyLcdEvent(s, { k: 'holdAdded', entry: hold(1, 'white'), at: 1000 });
  s = applyLcdEvent(s, { k: 'holdAdded', entry: hold(serial, 'red'), at: 2000 });
  expect(shownLcdState(s, seed, 50000).holds[1]!.color).toBe(plan.start);
  s = applyLcdEvent(s, { k: 'spinStarted', entry: 1, at: 60000, pattern: 'normal_short', endsAt: 65000 });
  expect(s.holds[0]!.shiftAt).toBe(60000);
  expect(shownLcdState(s, seed, 60000 + HOLD_CHANGE_DELAY_MS.shift - 1).holds[0]!.color).toBe(plan.start);
  expect(shownLcdState(s, seed, 60000 + HOLD_CHANGE_DELAY_MS.shift).holds[0]!.color).toBe('red');
  // 変動に移っても最終色のまま。
  s = applyLcdEvent(s, { k: 'spinStarted', entry: serial, at: 65000, pattern: 'normal_short', endsAt: 70000 });
  expect(shownLcdState(s, seed, 65000).spin!.color).toBe('red');
});

test('保留変化: 変動開始で変わる保留は、リプレイ（取得時刻が不明）でも同じ時刻に同じ色になる', () => {
  const seed = 7;
  const serial = findSerial(seed, 'gold', (p) => p.steps.some((x) => x.timing === 'spin'));
  let live: LcdState = { holds: [], spin: null, resolved: null, jackpot: null };
  live = applyLcdEvent(live, { k: 'holdAdded', entry: hold(serial, 'gold'), at: 1000 });
  live = applyLcdEvent(live, { k: 'spinStarted', entry: serial, at: 9000, pattern: 'sp_reach', endsAt: 54000 });
  const replay: LcdState = {
    holds: [],
    spin: { entry: serial, pattern: 'sp_reach', startAt: 9000, endsAt: 54000, color: 'gold', hit: true, addedAt: null, shiftAt: null },
    resolved: null,
    jackpot: null,
  };
  for (const t of [9000, 9000 + HOLD_CHANGE_DELAY_MS.spin - 1, 9000 + HOLD_CHANGE_DELAY_MS.spin, 20000]) {
    expect(shownLcdState(replay, seed, t).spin!.color).toBe(shownLcdState(live, seed, t).spin!.color);
  }
  expect(holdRank(shownLcdState(live, seed, 9000).spin!.color!)).toBeLessThan(holdRank('gold'));
  expect(shownLcdState(live, seed, 9000 + HOLD_CHANGE_DELAY_MS.spin).spin!.color).toBe('gold');
});

test('保留変化: Projection から作った保留は最終色のまま・パックに hold_<色> の演出がある', () => {
  const s = stateFromProjection({ holds: ['gold', 'red'], spin: undefined, jackpot: undefined } as never);
  expect(shownLcdState(s, 1, 0)).toBe(s);
  const names = packJson.sheets.map((x) => x.pattern);
  for (const c of ['blue', 'green', 'red', 'gold']) expect(names).toContain('hold_' + c);
});
