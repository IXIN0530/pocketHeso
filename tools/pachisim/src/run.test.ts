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

test('parseRunArgs は --balls/--seed を読み省略時は light/rush/lt の3機種', () => {
  expect(parseRunArgs(['--balls', '1000', '--seed', '7'])).toEqual({
    balls: 1000,
    seed: 7,
    machines: ['light-middle-01', 'rush-middle-01', 'lt-middle-01'],
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

test('理論値は STATUS の目安と一致する（light 10.52・rush 10.51・lt 10.39 付近）', () => {
  const { hesoRate } = loadRunAtlas();
  const light = loadRunMachine('light-middle-01');
  const rush = loadRunMachine('rush-middle-01');
  const ltm = loadRunMachine('lt-middle-01');
  const lt = computeTheory(light.spec, hesoRate);
  const rt = computeTheory(rush.spec, hesoRate);
  const ltt = computeTheory(ltm.spec, hesoRate);
  expect(lt.hatsuari1In).toBeCloseTo(185, 6);
  expect(rt.hatsuari1In).toBeCloseTo(328, 6);
  expect(ltt.hatsuari1In).toBeCloseTo(337, 6);
  expect(lt.stContinuation).toBeGreaterThan(0.4);
  expect(lt.stContinuation).toBeLessThan(0.52);
  expect(rt.stContinuation).toBeGreaterThan(0.8);
  expect(rt.stContinuation).toBeLessThan(0.9);
  expect(lt.perNormalSpin).toBeGreaterThan(9.5);
  expect(lt.perNormalSpin).toBeLessThan(11);
  expect(rt.perNormalSpin).toBeGreaterThan(9.5);
  expect(rt.perNormalSpin).toBeLessThan(11);
  expect(Math.abs(lt.perNormalSpin - 10.52) / 10.52).toBeLessThan(0.05);
  expect(Math.abs(rt.perNormalSpin - 10.51) / 10.51).toBeLessThan(0.05);
  // lt-middle-01 は spec/21 の例どおり（P2-T9）
  expect(ltm.spec.jitan?.stSpins).toBe(100);
  expect(ltm.spec.st.stSpins).toBe(56);
  expect(ltm.spec.lt?.stSpins).toBe(91);
  expect(ltt.rushEntryRate).toBeGreaterThan(0.4);
  expect(ltt.rushEntryRate).toBeLessThan(0.48);
  expect(ltt.jitanContinuation).toBeGreaterThan(0.2);
  expect(ltt.jitanContinuation).toBeLessThan(0.3);
  expect(ltt.stContinuation).toBeGreaterThan(0.7);
  expect(ltt.stContinuation).toBeLessThan(0.82);
  expect(ltt.ltContinuation).toBeGreaterThan(0.85);
  expect(ltt.ltContinuation).toBeLessThan(0.95);
  expect(ltt.ltArrivalPerRush).toBeGreaterThan(0.07);
  expect(ltt.ltArrivalPerRush).toBeLessThan(0.16);
  expect(ltt.ltArrivalPerHatsuari).toBeGreaterThan(0.02);
  expect(ltt.ltArrivalPerHatsuari).toBeLessThan(0.08);
  expect(ltt.perNormalSpin).toBeGreaterThan(9.5);
  expect(ltt.perNormalSpin).toBeLessThan(11);
  expect(Math.abs(ltt.perNormalSpin - 10.39) / 10.39).toBeLessThan(0.05);
  // 通常1回転あたり期待出玉は light の ±5% 以内（P2-T9 Accept）
  expect(Math.abs(ltt.perNormalSpin - lt.perNormalSpin) / lt.perNormalSpin).toBeLessThan(0.05);
  expect(Math.abs(rt.perNormalSpin - lt.perNormalSpin) / lt.perNormalSpin).toBeLessThan(0.05);
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
  '理論値と観測値が許容差内（light/rush/lt の3機種・100万球）',
  { timeout: 180000 },
  () => {
    const reports = runMachines(20260925, 1000000, ['light-middle-01', 'rush-middle-01', 'lt-middle-01']);
    expect(reports.length).toBe(3);
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
      // 実質 RUSH 突入率: 二項分布の 3σ
      if (o.normalHits >= 30) {
        const seRush = Math.sqrt((t.rushEntryRate * (1 - t.rushEntryRate)) / o.normalHits);
        expect(Math.abs(o.rushEntryRate - t.rushEntryRate)).toBeLessThanOrEqual(3 * seRush + 1e-12);
      }
      // 各継続率: 二項分布の 3σ（entries が少なければ緩める）
      if (o.jitanEntries >= 30) {
        const seJitan = Math.sqrt((t.jitanContinuation * (1 - t.jitanContinuation)) / o.jitanEntries);
        expect(Math.abs(o.jitanContinuation - t.jitanContinuation)).toBeLessThanOrEqual(3 * seJitan + 1e-12);
      }
      if (o.stEntries >= 30) {
        const seSt = Math.sqrt((t.stContinuation * (1 - t.stContinuation)) / o.stEntries);
        expect(Math.abs(o.stContinuation - t.stContinuation)).toBeLessThanOrEqual(3 * seSt + 1e-12);
      }
      if (o.ltEntries >= 30) {
        const seLt = Math.sqrt((t.ltContinuation * (1 - t.ltContinuation)) / o.ltEntries);
        expect(Math.abs(o.ltContinuation - t.ltContinuation)).toBeLessThanOrEqual(3 * seLt + 1e-12);
      }
      // LT 到達率: 二項分布の 3σ
      if (o.normalHits >= 30 && t.ltArrivalPerHatsuari > 0) {
        const seLtHat = Math.sqrt((t.ltArrivalPerHatsuari * (1 - t.ltArrivalPerHatsuari)) / o.normalHits);
        expect(Math.abs(o.ltArrivalPerHatsuari - t.ltArrivalPerHatsuari)).toBeLessThanOrEqual(3 * seLtHat + 1e-12);
      }
      if (o.chainsReachedRush >= 30 && t.ltArrivalPerRush > 0) {
        const seLtRush = Math.sqrt((t.ltArrivalPerRush * (1 - t.ltArrivalPerRush)) / o.chainsReachedRush);
        expect(Math.abs(o.ltArrivalPerRush - t.ltArrivalPerRush)).toBeLessThanOrEqual(3 * seLtRush + 1e-12);
      }
      // 出玉系: 標本分散からの標準誤差で 3σ（D-039）
      const se = observedStdErrors(o, loadRunMachine(r.machine).spec.hesoPayout);
      expect(Math.abs(o.avgJackpot - t.avgJackpot)).toBeLessThanOrEqual(3 * se.avgJackpot + 1e-9);
      expect(Math.abs(o.avgPerHatsuari - t.avgPerHatsuari)).toBeLessThanOrEqual(3 * se.avgPerHatsuari + 1e-9);
      expect(Math.abs(o.perNormalSpin - t.perNormalSpin)).toBeLessThanOrEqual(3 * se.perNormalSpin + 1e-9);
      expect(Math.abs(o.payoutPerBall - t.payoutPerBall)).toBeLessThanOrEqual(3 * se.payoutPerBall + 1e-9);
      // 裾（5万/10万）は観測値の報告のみ（理論なし）。件数と率の整合だけ見る。
      expect(o.chainGe50kRate).toBeCloseTo(o.normalHits > 0 ? o.chainGe50k / o.normalHits : 0, 12);
      expect(o.chainGe100kRate).toBeCloseTo(o.normalHits > 0 ? o.chainGe100k / o.normalHits : 0, 12);
      expect(o.chainGe100k).toBeLessThanOrEqual(o.chainGe50k);
    }
    const text = formatReports(reports);
    expect(text).toContain('light-middle-01');
    expect(text).toContain('rush-middle-01');
    expect(text).toContain('lt-middle-01');
    expect(text).toContain('rush entry/hatsuari');
    expect(text).toContain('lt arrival/rush');
    expect(text).toContain('chain >=50k/hatsuari');
    expect(text).toContain('payout/ball target(spec/21)');
  },
);
