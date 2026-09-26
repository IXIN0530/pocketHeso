import { expect, test } from 'vitest';
import type { Cue } from '@ph/shared';
import { CuePlayer } from './cue-player.ts';
import { FADE_MAX_ALPHA, FLASH_MAX_ALPHA, FLASH_MAX_PER_SEC, FlashLimiter, flashAlpha } from './flash.ts';
import { FlashLayer } from './flash-layer.ts';
import { createCueRouter } from './router.ts';

function maxInAnySecond(times: readonly number[]): number {
  let max = 0;
  for (const t of times) max = Math.max(max, times.filter((u) => u >= t && u < t + 1000).length);
  return max;
}

test('4 flashes per second are clamped to 3 per second', () => {
  const lim = new FlashLimiter();
  const ok: number[] = [];
  for (let t = 0; t < 10000; t += 250) if (lim.allow(t)) ok.push(t);
  expect(maxInAnySecond(ok)).toBe(FLASH_MAX_PER_SEC);
  expect(ok.length).toBeGreaterThanOrEqual(20);
});

test('a CueSheet with 4 flashes per second is clamped through CuePlayer and FlashLayer', () => {
  const cues: Cue[] = [];
  for (let at = 0; at < 5000; at += 250) cues.push({ at, kind: 'flash', style: 'rainbow', ms: 200 });
  const layer = new FlashLayer();
  const shown: number[] = [];
  const route = createCueRouter({ flash: layer });
  const player = new CuePlayer((cue, off, now) => {
    const before = layer.alpha(now + 1);
    route(cue, off, now);
    if (cue.kind === 'flash' && layer.alpha(now + 1) !== before) shown.push(now);
  });
  player.start(cues, 0);
  for (let t = 0; t <= 5000; t += 1000 / 60) player.update(t);
  expect(shown.length).toBeGreaterThan(0);
  expect(maxInAnySecond(shown)).toBeLessThanOrEqual(FLASH_MAX_PER_SEC);
  layer.dispose();
});

test('flash brightness is capped and ramps up; reduced motion is a weak fade', () => {
  let prev = 0;
  for (let t = 0; t < 800; t += 5) {
    const a = flashAlpha(t, 800, false);
    expect(a).toBeLessThanOrEqual(FLASH_MAX_ALPHA);
    expect(Math.abs(a - prev)).toBeLessThanOrEqual(FLASH_MAX_ALPHA / 10 + 1e-9);
    prev = a;
    expect(flashAlpha(t, 800, true)).toBeLessThanOrEqual(FADE_MAX_ALPHA);
  }
  expect(flashAlpha(0, 800, false)).toBe(0);
  expect(flashAlpha(800, 800, false)).toBe(0);
  expect(flashAlpha(400, 800, true)).toBeCloseTo(FADE_MAX_ALPHA);
});

test('bloom is on only during the cue', () => {
  const layer = new FlashLayer();
  layer.bloom(0.7, 3000, 1000, 500);
  expect(layer.bloomStrength(1000)).toBe(0.7);
  expect(layer.bloomStrength(3499)).toBe(0.7);
  expect(layer.bloomStrength(3500)).toBe(0);
  layer.dispose();
});
