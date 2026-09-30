import { expect, test } from 'vitest';
import { HOLDS_DEFAULT_SPINS, measureHoldColors, parseHoldsArgs } from './holds.ts';
import { DEFAULT_RUN_MACHINES, loadRunMachine } from './run.ts';

test('holds の引数: 省略時は 200万回転・seed 1・3機種', () => {
  expect(parseHoldsArgs([])).toEqual({ spins: HOLDS_DEFAULT_SPINS, seed: 1, machines: DEFAULT_RUN_MACHINES, json: false });
  expect(parseHoldsArgs(['--spins', '10', '--seed', '3', '--machine', 'lt-middle-01', '--json'])).toEqual({
    spins: 10,
    seed: 3,
    machines: ['lt-middle-01'],
    json: true,
  });
  expect(() => parseHoldsArgs(['--spins', '0'])).toThrow();
  expect(() => parseHoldsArgs(['--bogus'])).toThrow();
});

test('保留色の理論値: 通常時は 青7%・緑20%・赤50%・金85%、ST 中は 青15%・緑35%・赤70%・金95%（P7-T4）', () => {
  const { spec, patterns } = loadRunMachine('lt-middle-01');
  const byColor = (mode: 'normal' | 'st') => {
    const r = measureHoldColors('lt-middle-01', spec, patterns, mode, 1, 1000);
    return Object.fromEntries(r.colors.map((c) => [c.color, c]));
  };
  const n = byColor('normal');
  expect(n['blue']!.theoryRel).toBeCloseTo(0.07, 2);
  expect(n['green']!.theoryRel).toBeCloseTo(0.2, 2);
  expect(n['red']!.theoryRel).toBeCloseTo(0.5, 2);
  expect(n['gold']!.theoryRel).toBeCloseTo(0.85, 2);
  expect(Math.round(n['gold']!.theoryOneIn)).toBe(953);
  const s = byColor('st');
  expect(s['blue']!.theoryRel).toBeCloseTo(0.15, 2);
  expect(s['green']!.theoryRel).toBeCloseTo(0.35, 2);
  expect(s['red']!.theoryRel).toBeCloseTo(0.7, 2);
  expect(s['gold']!.theoryRel).toBeCloseTo(0.95, 2);
});
