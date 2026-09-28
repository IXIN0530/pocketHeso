import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { describeReceived, describeRecord, formatFuel, formatProd, localDay, planInput, planShortcut, planTotals, projectBalls, summarize, todayRemaining } from './activity.ts';

const KEY = 'abcdefghjkmnpqrs';
const NOW = Date.parse('2026-09-26T15:00:00+09:00');

function code(days: { d: string; steps: number; distM: number }[], key = KEY): string {
  const json = JSON.stringify({ v: 1, gen: '2026-09-26T14:55:00+09:00', tz: '+09:00', days });
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  const sig = createHash('sha256').update(key + b64).digest('hex').slice(0, 16);
  return `PH1.${b64}.${sig}`;
}

test('shortcut code → plan; the second paste only adds the difference', () => {
  const first = planShortcut([], code([{ d: '2026-09-26', steps: 8234, distM: 6120 }]), KEY, NOW);
  if (first.k !== 'plan') throw new Error(first.message);
  const t1 = planTotals(first.plan);
  expect(t1.fuelMs).toBeGreaterThan(0);
  expect(t1.medals).toBe(4);
  const again = planShortcut(first.plan.records, code([{ d: '2026-09-26', steps: 8234, distM: 6120 }]), KEY, NOW);
  expect(again.k === 'plan' && again.plan.records).toEqual([]);
  const more = planShortcut(first.plan.records, code([{ d: '2026-09-26', steps: 9234, distM: 7000 }]), KEY, NOW);
  if (more.k !== 'plan') throw new Error(more.message);
  expect(planTotals(more.plan)).toEqual({ fuelMs: 10 * 60000, medals: 0, prodMin: 30, bonusHolds: 0 });
});

test('wrong key is an error with the user-facing message', () => {
  const r = planShortcut([], code([{ d: '2026-09-26', steps: 1, distM: 1 }], 'zzzzzzzzzzzzzzzz'), KEY, NOW);
  expect(r.k).toBe('error');
});

test('summary sums grants, today and the streak', () => {
  const r = planShortcut([], code([{ d: '2026-09-26', steps: 6000, distM: 0 }]), KEY, NOW);
  if (r.k !== 'plan') throw new Error(r.message);
  const self = planInput(r.plan.records, { k: 'self', receivedAt: NOW, today: '2026-09-26', day: '2026-09-26' }, 't');
  const ledger = [...r.plan.records, ...self.records];
  const s = summarize(ledger, localDay(NOW));
  expect(s.fuelMs).toBe(60 * 60000 + 3 * 60000);
  expect(s.todayFuelMs).toBe(s.fuelMs);
  expect(s.medals).toBe(3);
  expect(s.streak).toBe(1);
});

test('formatting', () => {
  expect(formatFuel(25 * 60000 + 59000)).toBe('25分');
  expect(formatFuel(65 * 60000)).toBe('1時間05分');
  const r = planShortcut([], code([{ d: '2026-09-25', steps: 8234, distM: 6120 }]), KEY, NOW);
  if (r.k !== 'plan') throw new Error(r.message);
  expect(r.plan.records.map(describeRecord)).toEqual(['9/25 歩数 8,234歩（ヘルスケア）', '9/25 距離 6,120m（記録のみ）']);
});

test('即時の玉の見込みは refPerSec × 分 × 60、生産◯分ぶんの表示', () => {
  expect(projectBalls(90, 2)).toBe(10800);
  expect(formatProd(90)).toBe('1時間30分');
  expect(formatProd(0.5)).toBe('1分未満');
});

test('今日の上限までの残り: 何もない日は歩数・運動・自己申告の上限の合計、受け取った分だけ減る', () => {
  const empty = todayRemaining([], NOW);
  // 歩数 10,000 等倍＋5,000 半分 = 12.5×30分、運動 60 等倍＋60 半分 = 90×10分、自己申告 5件×10分×0.3。
  expect(empty.prodMin).toBeCloseTo(12.5 * 30 + 90 * 10 + 5 * 10 * 0.3);
  expect(empty.medals).toBe(5 + 6);
  expect(empty.bonusHolds).toBe(3);
  const r = planShortcut([], code([{ d: '2026-09-26', steps: 4000, distM: 0 }]), KEY, NOW);
  if (r.k !== 'plan') throw new Error(r.message);
  const after = todayRemaining(r.plan.records, NOW);
  expect(empty.prodMin - after.prodMin).toBeCloseTo(4 * 30);
  expect(after.medals).toBe(5 + 6 - 2);
});

test('確定後のトーストは granted の合計（何も無ければ null）', () => {
  expect(describeReceived({ balls: 12345, bonusHolds: 2, medals: 1, fuelMs: 600000 })).toBe('受け取りました: 玉 +1.23万・特別保留 +2・メダル +1・燃料 +10分');
  expect(describeReceived({ balls: 0, bonusHolds: 0, medals: 0, fuelMs: 0 })).toBeNull();
});
