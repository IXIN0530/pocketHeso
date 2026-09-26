import { expect, test } from 'vitest';
import { BOOT_KEEP, addAdvance, addBoot, addReceive, emptyMetrics, parseMetrics, type BootSample } from './metrics.ts';

const boot = (at: number): BootSample => ({ at, from: 'snapshot', totalMs: 10, loadMs: 2, catchUpMs: 5, spanMs: 1000, inputs: 3, dbBytes: null });

test('起動は新しい順に BOOT_KEEP 件まで', () => {
  let m = emptyMetrics(0);
  for (let i = 0; i < BOOT_KEEP + 5; i++) {
    m = addBoot(m, boot(i));
  }
  expect(m.boots).toHaveLength(BOOT_KEEP);
  expect(m.boots[0]?.at).toBe(BOOT_KEEP + 4);
});

test('advance は回数・合計・最大・直近、受け取りは回数・行数・最後の時刻', () => {
  const m = addReceive(addAdvance(addAdvance(emptyMetrics(5), 3), 1), 2, 99);
  expect(m.advance).toEqual({ since: 5, count: 2, totalMs: 4, maxMs: 3, lastMs: 1 });
  expect(m.receives).toEqual({ count: 1, claims: 2, lastAt: 99 });
});

test('壊れた項目は空に戻す', () => {
  const m = parseMetrics({ boots: [boot(1), { at: 'x' }, null], advance: { count: 1 }, receives: 'x' }, 7);
  expect(m.boots.map((b) => b.at)).toEqual([1]);
  expect(m.advance).toEqual(emptyMetrics(7).advance);
  expect(m.receives).toEqual(emptyMetrics(7).receives);
});
