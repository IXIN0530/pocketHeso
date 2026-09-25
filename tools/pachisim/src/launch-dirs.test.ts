import { expect, test } from 'vitest';
import { LAUNCH_DIR_COUNT } from '@ph/core';
import { generateLaunchDirs, round6 } from './launch-dirs.ts';

test('1024 件の単位ベクトル（真上中心・左右対称）', () => {
  const dirs = generateLaunchDirs();
  expect(dirs.length).toBe(LAUNCH_DIR_COUNT);
  for (const [x, y] of dirs) {
    expect(Math.hypot(x, y)).toBeCloseTo(1, 10);
    expect(y).toBeLessThan(0);
  }
  const first = dirs[0] as readonly [number, number];
  const last = dirs[dirs.length - 1] as readonly [number, number];
  expect(first[0]).toBeCloseTo(-last[0], 12);
  expect(first[1]).toBeCloseTo(last[1], 12);
  const mid = dirs[512] as readonly [number, number];
  expect(Math.abs(mid[0])).toBeLessThan(0.001);
  expect(mid[1]).toBeCloseTo(-1, 3);
});

test('round6 は 6桁丸め', () => {
  expect(round6(0.12345678)).toBe(0.123457);
  expect(round6(-1)).toBe(-1);
});
