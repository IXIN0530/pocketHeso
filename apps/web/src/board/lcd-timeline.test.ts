import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import type { ClaimRecord } from '@ph/claims';
import { expect, test } from 'vitest';
import { EngineHost, type TickResult } from '../engine/engine-host.ts';
import { openStorage } from '../platform/storage.ts';
import { DISPLAY_LAG_MS } from './ball-tracks.ts';
import { LcdTimeline, matchesProjection, type LcdState } from './lcd-timeline.ts';
import { spinTargets } from './lcd.ts';

const ATLAS = ((): ArrayBuffer => {
  const b = readFileSync('../../resources/atlas/default.9489bfc699495d5a.bin');
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
    const last = await host.tick(T0 + 6 * MIN);
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
