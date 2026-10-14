import type { AwaySummary } from '@ph/core';
import { expect, test } from 'vitest';
import { AWAY_NOTICE_MIN_MS, awayBannerLines, shouldNoticeAway } from './away.ts';

const away = (span: number, over: Partial<AwaySummary> = {}): AwaySummary => ({
  from: 1_000_000,
  to: 1_000_000 + span,
  gainedBalls: 123_000_000,
  jackpots: 3,
  maxChain: 1,
  maxChainBalls: 0,
  fuelEmptyAt: null,
  hottestEntry: null,
  maxHot: 0,
  replay: null,
  achievements: 0,
  ...over,
});

test('5分の境目: 4:59 は出さず 5:00 は出す', () => {
  expect(AWAY_NOTICE_MIN_MS).toBe(300_000);
  expect(shouldNoticeAway(away(4 * 60_000 + 59_000))).toBe(false);
  expect(shouldNoticeAway(away(5 * 60_000))).toBe(true);
});

test('バナーの文言: 基本は1行', () => {
  expect(awayBannerLines(away(2 * 3600_000 + 13 * 60_000))).toEqual(['留守 2時間13分  +1.23億玉・大当たり3回']);
});

test('バナーの文言: 実績と燃料切れ', () => {
  const lines = awayBannerLines(away(3600_000, { achievements: 2, fuelEmptyAt: 1_000_000 + 1800_000 }));
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe('留守 1時間00分  +1.23億玉・大当たり3回・実績 +2');
  expect(lines[1]).toMatch(/^燃料 \d{1,2}:\d{2} に切れました$/);
});
