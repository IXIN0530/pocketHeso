import { expect, test } from 'vitest';
import { RNGStream, fnv1a32, splitmix32, streamSeedU32, xoshiro128ss } from './rng.ts';

test('fnv1a32 は公開ベクタと一致', () => {
  expect(fnv1a32('')).toBe(2166136261);
  expect(fnv1a32('a')).toBe(3826002220);
  expect(fnv1a32('foobar')).toBe(3214735720);
  expect(fnv1a32('hello')).toBe(1335831723);
});

test('xoshiro128** は参照実装の既知出力と一致', () => {
  const g1 = xoshiro128ss(1, 2, 3, 4);
  expect(g1.nextU32()).toBe(11520);
  expect(g1.nextU32()).toBe(0);
  expect(g1.nextU32()).toBe(5927040);

  const g2 = xoshiro128ss(0x12345678, 0x9abcdef0, 0x0f1e2d3c, 0x4b5a6978);
  expect(g2.nextU32()).toBe(2576881682);
  expect(g2.nextU32()).toBe(3180352738);
  expect(g2.nextU32()).toBe(2669249250);
});

test('splitmix32 は決定的（seed 0 の先頭値を固定）', () => {
  const a = splitmix32(0);
  expect(a.nextU32()).toBe(1844547758);
  expect(a.nextU32()).toBe(1529284264);
  const b = splitmix32(0);
  expect(b.nextU32()).toBe(1844547758);
});

test('streamSeedU32 は仕様固定（seed:id:index の FNV-1a）', () => {
  expect(streamSeedU32(1, 'launch', 0)).toBe(fnv1a32('1:launch:0'));
  expect(streamSeedU32(1, 'launch', 1)).not.toBe(streamSeedU32(1, 'launch', 0));
  expect(streamSeedU32(1, 'jackpot', 0)).not.toBe(streamSeedU32(1, 'launch', 0));
});

test('RNGStream は同条件で同一列を返す', () => {
  const a = new RNGStream(12345, 'jackpot', 7);
  const b = new RNGStream(12345, 'jackpot', 7);
  for (let i = 0; i < 20; i = i + 1) {
    expect(a.nextU32()).toBe(b.nextU32());
  }
});

test('異なる id/index のストリームは独立（先頭100値の重複なし）', () => {
  const a = new RNGStream(999, 'jackpot', 0);
  const b = new RNGStream(999, 'pattern', 0);
  const c = new RNGStream(999, 'jackpot', 1);
  const va: number[] = [];
  const vb: number[] = [];
  const vc: number[] = [];
  for (let i = 0; i < 100; i = i + 1) {
    va.push(a.nextU32());
    vb.push(b.nextU32());
    vc.push(c.nextU32());
  }
  for (let i = 0; i < va.length; i = i + 1) {
    for (let j = 0; j < vb.length; j = j + 1) {
      expect(va[i]).not.toBe(vb[j]);
    }
  }
  for (let i = 0; i < va.length; i = i + 1) {
    for (let j = 0; j < vc.length; j = j + 1) {
      expect(va[i]).not.toBe(vc[j]);
    }
  }
});

test('nextUnit は [0,1)', () => {
  const s = new RNGStream(1, 'split', 0);
  for (let i = 0; i < 200; i = i + 1) {
    const u = s.nextUnit();
    expect(u >= 0).toBe(true);
    expect(u < 1).toBe(true);
  }
});

test('pick は決定的で重みに従う', () => {
  const a = new RNGStream(42, 'pattern', 3);
  const b = new RNGStream(42, 'pattern', 3);
  for (let i = 0; i < 20; i = i + 1) {
    expect(a.pick([1, 2, 3])).toBe(b.pick([1, 2, 3]));
  }
  const single = new RNGStream(7, 'holdColor', 0);
  expect(single.pick([5])).toBe(0);
  const skewed = new RNGStream(7, 'holdColor', 1);
  for (let i = 0; i < 20; i = i + 1) {
    expect(skewed.pick([0, 10])).toBe(1);
  }
  const bad = new RNGStream(7, 'holdColor', 2);
  expect(() => bad.pick([])).toThrow();
  expect(() => bad.pick([0, 0])).toThrow();
});
