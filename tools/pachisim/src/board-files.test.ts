import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  LAUNCH_DIR_COUNT,
  canonicalBoardJson,
  hashBoard,
  parseBoardText,
  parseLaunchDirs,
} from '@ph/core';
import { generateLaunchDirs, round6 } from './launch-dirs.ts';

const BOARDS_DIR = new URL('../../../resources/boards/', import.meta.url);

function loadText(name: string): string {
  return readFileSync(new URL(name, BOARDS_DIR), 'utf8');
}

/** オブジェクトのキー順を再帰的に反転（値は同一）。 */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) {
    return (v as unknown[]).map(reverseKeys);
  }
  if (typeof v === 'object' && v !== null) {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).reverse()) {
      out[k] = reverseKeys(src[k]);
    }
    return out;
  }
  return v;
}

test('default.json がロード・検証を通る（釘約300・役物8）', () => {
  const board = parseBoardText(loadText('default.json'));
  expect(board.id).toBe('default');
  expect(board.pins.length).toBeGreaterThanOrEqual(280);
  expect(board.pins.length).toBeLessThanOrEqual(340);
  expect(board.yakumono.length).toBe(8);
  const kinds = board.sensors.map((s) => s.kind);
  expect(kinds).toContain('start1');
  expect(kinds).toContain('out');
});

test('キー順違いの JSON で盤面ハッシュ（SHA-256）が一致', () => {
  const original = loadText('default.json');
  const shuffled = JSON.stringify(reverseKeys(JSON.parse(original) as unknown));
  expect(shuffled).not.toBe(original);
  const sha256Hex = (canonical: string): string =>
    createHash('sha256').update(canonical, 'utf8').digest('hex');
  const a = parseBoardText(original);
  const b = parseBoardText(shuffled);
  expect(canonicalBoardJson(a)).toBe(canonicalBoardJson(b));
  const ha = hashBoard(a, sha256Hex);
  expect(ha).toBe(hashBoard(b, sha256Hex));
  expect(ha).toMatch(/^[0-9a-f]{64}$/);
});

test('launch_dirs.json は生成表と一致（1024 件の単位ベクトル）', () => {
  const dirs = parseLaunchDirs(JSON.parse(loadText('launch_dirs.json')) as unknown);
  expect(dirs.length).toBe(LAUNCH_DIR_COUNT);
  const gen = generateLaunchDirs();
  for (let i = 0; i < dirs.length; i = i + 1) {
    const d = dirs[i] as { x: number; y: number };
    const g = gen[i] as readonly [number, number];
    expect(d.x).toBe(round6(g[0]));
    expect(d.y).toBe(round6(g[1]));
    const len = Math.sqrt(d.x * d.x + d.y * d.y);
    expect(Math.abs(len - 1)).toBeLessThan(0.0001);
  }
});
