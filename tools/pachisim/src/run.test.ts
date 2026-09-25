import { expect, test } from 'vitest';
import {
  computeTheory,
  formatReports,
  loadRunAtlas,
  loadRunMachine,
  observedStdErrors,
  parseRunArgs,
  runMachines,
  simulateBalls,
} from './run.ts';

test('parseRunArgs は --balls/--seed を読み省略時は light/rush 両方', () => {
  expect(parseRunArgs(['--balls', '1000', '--seed', '7'])).toEqual({
    balls: 1000,
    seed: 7,
    machines: ['light-middle-01', 'rush-middle-01'],
    json: false,
  });
  expect(parseRunArgs(['--balls', '10', '--seed', '1', '--machine', 'light-middle-01', '--json'])).toEqual({
    balls: 10,
    seed: 1,
    machines: ['light-middle-01'],
    json: true,
  });
  expect(() => parseRunArgs(['--balls', '10'])).toThrow();
  expect(() => parseRunArgs(['--balls', '0', '--seed', '1'])).toThrow();
  expect(() => parseRunArgs(['--balls', '10', '--seed', '-1'])).toThrow();
  expect(() => parseRunArgs(['--balls', '10', '--seed', '1', '--unknown'])).toThrow();
});

test('理論値は STATUS の目安と一致する（light 9.74・rush 9.85 付近）', () => {
  const { hesoRate } = loadRunAtlas();
  const light = loadRunMachine('light-middle-01');
  const rush = loadRunMachine('rush-middle-01');
  const lt = computeTheory(light.spec, hesoRate);
  const rt = computeTheory(rush.spec, hesoRate);
  expect(lt.hatsuari1In).toBeCloseTo(199.8, 6);
  expect(rt.hatsuari1In).toBeCloseTo(349.9, 6);
  expect(lt.stContinuation).toBeGreaterThan(0.4);
  expect(lt.stContinuation).toBeLessThan(0.52);
  expect(rt.stContinuation).toBeGreaterThan(0.8);
  expect(rt.stContinuation).toBeLessThan(0.9);
  expect(lt.perNormalSpin).toBeGreaterThan(9.0);
  expect(lt.perNormalSpin).toBeLessThan(10.5);
  expect(rt.perNormalSpin).toBeGreaterThan(9.0);
  expect(rt.perNormalSpin).toBeLessThan(10.5);
  expect(Math.abs(lt.perNormalSpin - 9.74) / 9.74).toBeLessThan(0.05);
  expect(Math.abs(rt.perNormalSpin - 9.85) / 9.85).toBeLessThan(0.05);
});

test('simulateBalls は決定的（同seedは一致・異seedはほぼ不一致）', () => {
  const { spec, patterns } = loadRunMachine('light-middle-01');
  const { buffer } = loadRunAtlas();
  const a = simulateBalls(11, spec, patterns, buffer, 20000);
  const b = simulateBalls(11, spec, patterns, buffer, 20000);
  expect(a).toEqual(b);
  const c = simulateBalls(12, spec, patterns, buffer, 20000);
  expect(c.spins).not.toBe(a.spins);
});

test(
  '理論値と観測値が許容差内（light/rush・100万球）',
  { timeout: 180000 },
  () => {
    const reports = runMachines(20260925, 1000000, ['light-middle-01', 'rush-middle-01']);
    expect(reports.length).toBe(2);
    for (let i = 0; i < reports.length; i = i + 1) {
      const r = reports[i];
      if (r === undefined) {
        throw new Error('missing report');
      }
      const t = r.theory;
      const o = r.observed;
      expect(o.balls).toBe(1000000);
      expect(o.spins).toBeGreaterThan(40000);
      expect(o.normalSpins).toBeGreaterThan(30000);
      expect(o.normalHits).toBeGreaterThan(50);
      expect(o.jackpots).toBeGreaterThan(50);
      expect(o.maxHama).toBeGreaterThan(0);
      // 回転率: 二項分布の 3σ
      const p = r.hesoRate;
      const seRate = 1000 * Math.sqrt((p * (1 - p)) / o.balls);
      expect(Math.abs(o.spinsPer1000 - t.spinsPer1000)).toBeLessThanOrEqual(3 * seRate + 1e-9);
      // 初当たり: 二項分布の 3σ
      const seHat = Math.sqrt((t.hatsuariProb * (1 - t.hatsuariProb)) / o.normalSpins);
      expect(Math.abs(o.hatsuariProb - t.hatsuariProb)).toBeLessThanOrEqual(3 * seHat + 1e-12);
      // ST 継続率: 二項分布の 3σ（entries が少なければ緩める）
      if (o.stEntries >= 30) {
        const seSt = Math.sqrt((t.stContinuation * (1 - t.stContinuation)) / o.stEntries);
        expect(Math.abs(o.stContinuation - t.stContinuation)).toBeLessThanOrEqual(3 * seSt + 1e-12);
      }
      // 出玉系: 標本分散からの標準誤差で 3σ（D-039）
      const se = observedStdErrors(o, loadRunMachine(r.machine).spec.hesoPayout);
      expect(Math.abs(o.avgJackpot - t.avgJackpot)).toBeLessThanOrEqual(3 * se.avgJackpot + 1e-9);
      expect(Math.abs(o.avgPerHatsuari - t.avgPerHatsuari)).toBeLessThanOrEqual(3 * se.avgPerHatsuari + 1e-9);
      expect(Math.abs(o.perNormalSpin - t.perNormalSpin)).toBeLessThanOrEqual(3 * se.perNormalSpin + 1e-9);
      expect(Math.abs(o.payoutPerBall - t.payoutPerBall)).toBeLessThanOrEqual(3 * se.payoutPerBall + 1e-9);
    }
    const text = formatReports(reports);
    expect(text).toContain('light-middle-01');
    expect(text).toContain('rush-middle-01');
    expect(text).toContain('payout/ball target(spec/21)');
  },
);
