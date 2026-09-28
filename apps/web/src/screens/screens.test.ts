import { expect, test } from 'vitest';
import { debugRecord } from './debug-screen.tsx';
import { groupByDay } from './records-screen.tsx';
import { upgradeEffect } from './shop-screen.tsx';
import { dumpClaim, sumGranted } from '../stores/engine.ts';

test('記録は日別にまとめ、新しい日から並べる（Debug の付与は名前を変える）', () => {
  const at = new Date(2026, 8, 25, 10).getTime();
  const a = debugRecord(at, 3600000, 0);
  const b = { ...debugRecord(at + 86400000, 0, 2), claimId: 'self:2026-09-26:1' };
  const days = groupByDay([a, b]);
  expect(days.map((d) => d.day)).toEqual(['2026-09-26', '2026-09-25']);
  expect(days[1]).toMatchObject({ fuelMs: 3600000, medals: 0, lines: ['Debug の付与'] });
  expect(days[0]?.medals).toBe(2);
  expect(groupByDay([a, b], 1).length).toBe(1);
});

test('強化の効果は「今 → 次」、最大なら今だけ', () => {
  expect(upgradeEffect({ id: 'tank', stage: 0, stages: 4, currency: 'balls', cost: 5000, value: 12, next: 18 })).toBe('上限 12時間 → 上限 18時間');
  expect(upgradeEffect({ id: 'rate', stage: 6, stages: 6, currency: 'medals', cost: null, value: 1000, next: null })).toBe('1000パチまで');
});

test('計測ログの台帳は日・種類・量・燃料・メダルだけ（claimId・登録地点は含めない）', () => {
  const r = { ...debugRecord(5, 60000, 1), claimId: 'checkin:s1', kind: 'checkin' as const, source: 'checkin' as const, amount: 30, placeBonus: 'p1' };
  const d = dumpClaim(r);
  expect(d).toEqual({ at: 5, day: r.day, source: 'checkin', kind: 'checkin', amount: 30, trust: 1, fuelMs: 60000, medals: 1 });
  expect(JSON.stringify(d)).not.toMatch(/s1|p1/);
});

test('記録の日別に即時の玉（生産◯分ぶん）と特別保留を足す', () => {
  const at = new Date(2026, 8, 25, 10).getTime();
  const days = groupByDay([debugRecord(at, 0, 0, { prodMin: 60 }), debugRecord(at, 0, 0, { prodMin: 30, bonusHolds: 2 })]);
  expect(days[0]).toMatchObject({ prodMin: 90, bonusHolds: 2 });
});

test('受け取りで増えたものは今回の claimId の granted だけを足す', () => {
  const g = (claimId: string, balls?: number, bonusHolds?: number) =>
    ({ k: 'granted', claimId, at: 0, fuelMs: 1000, medals: 1, ...(balls !== undefined ? { balls } : {}), ...(bonusHolds !== undefined ? { bonusHolds } : {}) }) as const;
  const r = sumGranted([g('a', 100.5), g('b', 50, 3), g('other', 999, 9), { k: 'fuelEmpty', at: 0 }], new Set(['a', 'b']));
  expect(r).toEqual({ balls: 150.5, bonusHolds: 3, medals: 2, fuelMs: 2000 });
});
