import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  ATLAS_ENTRY_COUNT,
  BallSimulator,
  canonicalParamsForKey,
  decodeAtlasHeader,
  encodeAtlas,
  parseBoard,
  type Vec2,
} from '@ph/core';
import { generateLaunchDirs } from './launch-dirs.ts';
import {
  boardHashHex,
  buildAtlasParallel,
  buildAtlasSingle,
  computeChunkOutcomes,
  encodeAtlasStats,
  loadBoardAndDirs,
  parseAtlasArgs,
  splitRanges,
} from './atlas.ts';

const BOARDS_DIR = new URL('../../../resources/boards/', import.meta.url);

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, BOARDS_DIR), 'utf8') as string) as unknown;
}

function tinyBoard(): { board: ReturnType<typeof parseBoard>; dirs: Vec2[] } {
  const board = parseBoard({
    id: 'tiny',
    version: 1,
    size_mm: [420, 460],
    gravity_mm_s2: 9000,
    pins: [],
    segments: [
      { a: [0, 0], b: [0, 460], restitution: 0.35, friction: 0.1 },
      { a: [420, 0], b: [420, 460], restitution: 0.35, friction: 0.1 },
    ],
    sensors: [
      { id: 'heso', kind: 'start1', rect: [190, 300, 24, 10] },
      { id: 'out', kind: 'out', rect: [0, 452, 420, 8] },
    ],
    launch: { origin: [405, 440], dir_table: 'launch_dirs', speed_mm_s: [3200, 3600] },
    pin_restitution: 0.45,
    pin_friction: 0.05,
    yakumono: [],
  });
  const dirs: Vec2[] = generateLaunchDirs().map(([x, y]) => ({ x, y }) as Vec2);
  return { board, dirs };
}

test('splitRanges は決定的に全キーを隙間なく覆う', () => {
  for (const jobs of [1, 2, 3, 4, 7, 64]) {
    const rs = splitRanges(ATLAS_ENTRY_COUNT, jobs);
    expect(rs.length).toBe(jobs);
    expect(rs[0]?.startKey).toBe(0);
    expect(rs[jobs - 1]?.endKey).toBe(ATLAS_ENTRY_COUNT);
    for (let j = 0; j < jobs; j = j + 1) {
      const r = rs[j] as { startKey: number; endKey: number };
      expect(r.endKey).toBeGreaterThan(r.startKey);
      if (j + 1 < jobs) {
        expect((rs[j + 1] as { startKey: number }).startKey).toBe(r.endKey);
      }
    }
  }
  expect(() => splitRanges(ATLAS_ENTRY_COUNT, 0)).toThrow();
  expect(() => splitRanges(ATLAS_ENTRY_COUNT, 65)).toThrow();
});

test('parseAtlasArgs は --board と --jobs を読む', () => {
  expect(parseAtlasArgs(['--board', 'default'])).toEqual({ boardId: 'default', jobs: 1 });
  expect(parseAtlasArgs(['--board', 'default', '--jobs', '4'])).toEqual({ boardId: 'default', jobs: 4 });
  expect(() => parseAtlasArgs(['--board'])).toThrow();
  expect(() => parseAtlasArgs(['--jobs', '0', '--board', 'default'])).toThrow();
  expect(() => parseAtlasArgs(['--unknown'])).toThrow();
});

test('boardHashHex は64桁16進', () => {
  const { board } = tinyBoard();
  expect(boardHashHex(board)).toMatch(/^[0-9a-f]{64}$/);
});

test(
  'チャンク分割と単一計算でバイナリが一致する（合成盤面）',
  { timeout: 120000 },
  () => {
  const { board, dirs } = tinyBoard();
  const sim = new BallSimulator(board, dirs);
  const single = buildAtlasSingle(board, dirs);
  const ranges = splitRanges(ATLAS_ENTRY_COUNT, 4);
  const outcomes = ranges.flatMap((r) => computeChunkOutcomes(sim, r.startKey, r.endKey));
  const chunkedEntries = outcomes.map((o, key) => ({
    kind: o.kind,
    flightMs: o.flightMs,
    params: canonicalParamsForKey(key),
  }));
  const hashBytes = new Uint8Array(32).fill(7);
  const a = Buffer.from(encodeAtlas(hashBytes, single.entries)).toString('hex');
  const b = Buffer.from(encodeAtlas(hashBytes, chunkedEntries)).toString('hex');
  expect(a).toBe(b);
  },
);

test(
  '既定盤面で単スレッドと4並列がバイナリ完全一致・ヘソ率5〜8%',
  { timeout: 180000 },
  async () => {
    const boardJson = loadJson('default.json');
    const dirsJson = loadJson('launch_dirs.json');
    const { board, dirs } = loadBoardAndDirs(boardJson, dirsJson);
    const single = buildAtlasSingle(board, dirs);
    const parallel = await buildAtlasParallel(boardJson, dirsJson, 4);
    const { buffer: ab, hashHex } = encodeAtlasStats(board, single);
    const { buffer: bb } = encodeAtlasStats(board, parallel);
    expect(Buffer.from(bb).toString('hex')).toBe(Buffer.from(ab).toString('hex'));
    expect(hashHex).toMatch(/^[0-9a-f]{64}$/);
    const header = decodeAtlasHeader(ab);
    expect(header.count).toBe(ATLAS_ENTRY_COUNT);
    const rate = single.heso / ATLAS_ENTRY_COUNT;
    expect(rate).toBeGreaterThanOrEqual(0.05);
    expect(rate).toBeLessThanOrEqual(0.08);
    console.log(
      `atlas-test: heso=${single.heso} rate=${(rate * 100).toFixed(2)}% avgFlight=${(single.flightSumMs / ATLAS_ENTRY_COUNT / 1000).toFixed(2)}s`,
    );
  },
);
