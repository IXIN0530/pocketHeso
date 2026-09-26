import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import type { ClaimRecord } from '@ph/claims';
import { parseBoard, parseLaunchDirs, type Board } from '@ph/core';
import { expect, test } from 'vitest';
import boardJson from '../../../../resources/boards/default.json';
import dirsJson from '../../../../resources/boards/launch_dirs.json';
import { EngineHost, type Shot } from '../engine/engine-host.ts';
import { openStorage } from '../platform/storage.ts';
import { BallTracks, DISPLAY_LAG_MS, MAX_BALLS } from './ball-tracks.ts';

const ATLAS = ((): ArrayBuffer => {
  const b = readFileSync('../../resources/atlas/default.9489bfc699495d5a.bin');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
})();
const BOARD = parseBoard(boardJson);
const DIRS = parseLaunchDirs(dirsJson);
const T0 = Date.UTC(2026, 8, 26, 6, 0, 0);
const MIN = 60000;
const FRAME_MS = 1000 / 60;

const fuel = (at: number): ClaimRecord => ({
  claimId: 'health:steps:2026-09-26:1',
  receivedAt: at,
  source: 'health',
  kind: 'steps',
  day: '2026-09-26',
  amount: 1000,
  trust: 1,
  grant: { claimId: 'health:steps:2026-09-26:1', at, fuelMs: 24 * 60 * MIN, medals: 0 },
});

function inHeso(board: Board, x: number, y: number): boolean {
  const h = board.sensors.find((s) => s.kind === 'start1');
  return h !== undefined && x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h;
}

interface Run {
  ends: { kind: Shot['kind']; x: number; y: number }[];
  maxActive: number;
  maxPending: number;
  maxCached: number;
  shots: number;
}

/** 前面で打ちながら realSec 秒（実時間）遊び、Engine の 1Hz の結果を倍率 scale の時計で描画側に流す。 */
async function play(scale: number, realSec: number, dbName: string): Promise<Run> {
  const db = await openStorage(dbName);
  let seed = 7;
  const { host, boot } = await EngineHost.open(db, ATLAS, T0, () => seed++);
  await host.receive([fuel(T0)], false, T0 + 1000);
  const tracks = new BallTracks(BOARD, DIRS);
  const run: Run = { ends: [], maxActive: 0, maxPending: 0, maxCached: 0, shots: 0 };
  const lag = DISPLAY_LAG_MS * scale;
  tracks.add(boot.shots, T0 - lag);
  const on = await host.act({ k: 'shoot', on: true, rate: 1 }, T0 + 2000);
  tracks.add(on.shots, T0 + 2000 - lag);
  for (let frame = 0; frame < realSec * 60; frame++) {
    const now = T0 + 2000 + Math.floor(frame * FRAME_MS * scale);
    if (frame % 60 === 59) {
      const r = await host.tick(now);
      run.shots += r.shots.length;
      tracks.add(r.shots, now - lag);
    }
    tracks.update(now - lag, (kind, x, y) => run.ends.push({ kind, x, y }));
    run.maxActive = Math.max(run.maxActive, tracks.balls.filter((b) => b.active).length);
    run.maxPending = Math.max(run.maxPending, tracks.pending);
    run.maxCached = Math.max(run.maxCached, tracks.cached);
  }
  return run;
}

test('ヘソに入った玉の描画終点はヘソセンサー内（x1、Engine の Shot から再生）', { timeout: 60000 }, async () => {
  const r = await play(1, 150, 't-tracks-x1');
  const heso = r.ends.filter((e) => e.kind === 'start1');
  expect(r.ends.length).toBeGreaterThan(150);
  expect(heso.length).toBeGreaterThan(0);
  for (const e of heso) expect(inHeso(BOARD, e.x, e.y)).toBe(true);
  // アウトは盤面下端のアウト口へ（ヘソの中では終わらない）。
  for (const e of r.ends.filter((x) => x.kind === 'out')) expect(inHeso(BOARD, e.x, e.y)).toBe(false);
});

test('Debug の x60: Engine の Shot をほぼ全部描き、ヘソの終点も正しい', { timeout: 60000 }, async () => {
  const r = await play(60, 20, 't-tracks-x60');
  const heso = r.ends.filter((e) => e.kind === 'start1');
  // 初期玉を打ち切るまで（最後の約 1.3 秒×60 分は表示の遅れでまだ描いていない）。
  expect(r.shots).toBeGreaterThan(100);
  expect(r.ends.length).toBeGreaterThan(r.shots * 0.8);
  expect(heso.length).toBeGreaterThan(0);
  for (const e of heso) expect(inHeso(BOARD, e.x, e.y)).toBe(true);
  expect(r.maxActive).toBeLessThanOrEqual(MAX_BALLS);
});

test('Debug の x60 で打ち続けても破綻しない（600ms ごとの発射を 1 秒=60 秒分ずつ受け取る）', { timeout: 60000 }, () => {
  const tracks = new BallTracks(BOARD, DIRS);
  const scale = 60;
  const lag = DISPLAY_LAG_MS * scale;
  const ends: { kind: Shot['kind']; x: number; y: number }[] = [];
  let ball = 0;
  let maxActive = 0;
  let maxPending = 0;
  let fired = 0;
  let key = 1;
  for (let frame = 0; frame < 30 * 60; frame++) {
    const now = T0 + Math.floor(frame * FRAME_MS * scale);
    if (frame % 60 === 0) {
      const shots: Shot[] = [];
      for (; T0 + fired <= now; fired += 600) {
        key = (key * 48271) % 65521;
        const t = tracks.trajectoryFor({ ball: 0, fireAt: 0, sensorAt: 1, kind: 'lost', key });
        const kind = t.outcome.kind === 'start1' || t.outcome.kind === 'out' ? t.outcome.kind : 'lost';
        shots.push({ ball: ball++, fireAt: T0 + fired, sensorAt: T0 + fired + Math.round(t.outcome.flightMs), kind, key });
      }
      tracks.add(shots, now - lag);
    }
    tracks.update(now - lag, (kind, x, y) => ends.push({ kind, x, y }));
    maxActive = Math.max(maxActive, tracks.balls.filter((b) => b.active).length);
    maxPending = Math.max(maxPending, tracks.pending);
  }
  expect(ends.length).toBeGreaterThan(2000);
  const heso = ends.filter((e) => e.kind === 'start1');
  expect(heso.length).toBeGreaterThan(0);
  for (const e of heso) expect(inHeso(BOARD, e.x, e.y)).toBe(true);
  expect(maxActive).toBeLessThanOrEqual(MAX_BALLS);
  expect(maxPending).toBeLessThanOrEqual(512);
  expect(tracks.cached).toBeLessThanOrEqual(512);
});

test('釘の強化で out→start1 になった玉は、ヘソに着く軌跡に差し替えてセンサー時刻に終わる', () => {
  const tracks = new BallTracks(BOARD, DIRS);
  // 正準の軌跡がアウトになるキーを1つ探す。
  let key = 0;
  for (let k = 1000; k < 65536; k += 97) {
    if (tracks.trajectoryFor({ ball: 0, fireAt: 0, sensorAt: 1, kind: 'lost', key: k }).outcome.kind === 'out') {
      key = k;
      break;
    }
  }
  const shot: Shot = { ball: 1, fireAt: T0, sensorAt: T0 + 4000, kind: 'start1', key };
  expect(tracks.trajectoryFor(shot).outcome.kind).toBe('start1');
  tracks.add([shot], T0 - 1);
  const ends: { x: number; y: number }[] = [];
  for (let t = T0; t <= T0 + 4100; t += 16) tracks.update(t, (_k, x, y) => ends.push({ x, y }));
  expect(ends.length).toBe(1);
  expect(inHeso(BOARD, ends[0]?.x ?? -1, ends[0]?.y ?? -1)).toBe(true);
});

test('同じ玉は重複して描かず、着いた玉・5秒より前に発射した玉は受け取らない', () => {
  const tracks = new BallTracks(BOARD, DIRS);
  const s: Shot = { ball: 5, fireAt: T0, sensorAt: T0 + 3000, kind: 'out', key: 12345 };
  tracks.add([s, s], T0 - 100);
  tracks.add([s], T0 - 50);
  tracks.add([{ ...s, ball: 6, sensorAt: T0 - 10 }], T0);
  tracks.add([{ ...s, ball: 7, fireAt: T0 - 6000 }], T0);
  expect(tracks.pending).toBe(1);
  tracks.update(T0 + 10, () => undefined);
  expect(tracks.balls.filter((b) => b.active).length).toBe(1);
});
