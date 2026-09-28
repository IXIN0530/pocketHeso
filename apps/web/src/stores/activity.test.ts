import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { describeRecord, formatFuel, localDay, planInput, planShortcut, planTotals, summarize } from './activity.ts';

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
  expect(planTotals(more.plan)).toEqual({ fuelMs: 10 * 60000, medals: 0 });
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
