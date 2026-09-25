import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  GOLDEN_LAUNCH_COUNT,
  GOLDEN_OUTCOMES_HASH,
  encodeOutcomes,
  goldenBoard,
  goldenDirs,
  goldenLaunchParams,
  hashOutcomes,
} from './determinism.ts';
import { BallSimulator, type BallOutcome } from './physics.ts';

/** Node 用 SHA-256（ブラウザでは同じ正規化列を `crypto.subtle` でハッシュする前提）。 */
function sha256Hex(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

test('固定 1,000 LaunchParams は範囲内で決定的', () => {
  expect(GOLDEN_LAUNCH_COUNT).toBe(1000);
  for (let i = 0; i < GOLDEN_LAUNCH_COUNT; i = i + 1) {
    const a = goldenLaunchParams(i);
    const b = goldenLaunchParams(i);
    expect(a).toEqual(b);
    expect(a.dirIndex).toBeGreaterThanOrEqual(0);
    expect(a.dirIndex).toBeLessThan(1024);
    expect(a.speedQ).toBeGreaterThanOrEqual(0);
    expect(a.speedQ).toBeLessThanOrEqual(65535);
  }
  expect(() => goldenLaunchParams(-1)).toThrow();
  expect(() => goldenLaunchParams(GOLDEN_LAUNCH_COUNT)).toThrow();
  expect(() => goldenLaunchParams(1.5)).toThrow();
});

test(
  'ゴールデンハッシュ固定（1,000発・SHA-256先頭16桁）',
  { timeout: 60000 },
  () => {
    expect(GOLDEN_OUTCOMES_HASH).toMatch(/^[0-9a-f]{16}$/);
    const sim = new BallSimulator(goldenBoard(), goldenDirs());
    const outcomes: BallOutcome[] = [];
    for (let i = 0; i < GOLDEN_LAUNCH_COUNT; i = i + 1) {
      outcomes.push(sim.run(goldenLaunchParams(i)));
    }
    // 正規化列は ASCII のみ（Node とブラウザで同一文字列になる前提）。
    const canonical = encodeOutcomes(outcomes);
    expect(canonical).toMatch(/^[a-z0-9:.;]+$/);
    expect(hashOutcomes(outcomes, sha256Hex)).toBe(GOLDEN_OUTCOMES_HASH);
  },
);

test(
  '同じ条件は2回とも同じハッシュ（決定論）',
  { timeout: 60000 },
  () => {
    const runAll = (): readonly BallOutcome[] => {
      const sim = new BallSimulator(goldenBoard(), goldenDirs());
      const out: BallOutcome[] = [];
      for (let i = 0; i < GOLDEN_LAUNCH_COUNT; i = i + 1) {
        out.push(sim.run(goldenLaunchParams(i)));
      }
      return out;
    };
    const a = runAll();
    const b = runAll();
    expect(encodeOutcomes(b)).toBe(encodeOutcomes(a));
    expect(hashOutcomes(b, sha256Hex)).toBe(hashOutcomes(a, sha256Hex));
  },
);
