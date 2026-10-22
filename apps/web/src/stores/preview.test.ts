import type { AwaySummary } from '@ph/core';
import { expect, test } from 'vitest';
import { replayRequest } from './preview.ts';

const away: AwaySummary = {
  from: 1000,
  to: 6 * 3600000,
  gainedBalls: 12345,
  jackpots: 3,
  maxChain: 2,
  maxChainBalls: 3000,
  fuelEmptyAt: null,
  hottestEntry: 41,
  maxHot: 3,
  replay: { entry: 41, pattern: 'spsp_gekiatsu', color: 'red', hot: 3, startedAt: 500000, endsAt: 541200, kind: 'kakuhen', rounds: 10 },
  achievements: 0,
};

test('留守中リプレイは Engine の保留の番号・パターン・実際の変動時間・大当たりの種類で流す', () => {
  expect(replayRequest(away)).toEqual({
    pattern: 'spsp_gekiatsu',
    hit: true,
    serial: 41,
    color: 'red',
    durationMs: 41200,
    kind: 'kakuhen',
    rounds: 10,
    replayAt: 500000,
  });
});

test('留守中に当たりが無ければリプレイしない', () => {
  expect(replayRequest({ ...away, jackpots: 0, replay: null })).toBeNull();
});

test('上位の当たりのリプレイは上乗せの回数ぶん上位の流れで見せる（D-120）', () => {
  const upper = { ...away.replay!, upper: true as const, loops: 2 };
  expect(replayRequest({ ...away, replay: upper })).toMatchObject({ upper: { loops: 2 }, rounds: 10 });
  expect(replayRequest(away)).not.toHaveProperty('upper');
});
