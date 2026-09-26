import { expect, test } from 'vitest';
import { debugScaleFrom, makeClock } from './clock.ts';

test('?debug=1&x= の倍率だけを受け付ける', () => {
  expect(debugScaleFrom('')).toBe(1);
  expect(debugScaleFrom('?x=60')).toBe(1);
  expect(debugScaleFrom('?debug=1&x=60')).toBe(60);
  expect(debugScaleFrom('?debug=1&x=3600')).toBe(3600);
  expect(debugScaleFrom('?debug=1&x=5')).toBe(1);
});

test('倍率で進み、catchUp は先の時刻にだけ揃える', () => {
  let real = 1000;
  const c = makeClock(60, () => real);
  real += 500;
  expect(c.now()).toBe(1000 + 30000);
  c.catchUp(10);
  expect(c.now()).toBe(31000);
  c.catchUp(100000);
  expect(c.now()).toBe(100000);
  real += 1000;
  expect(c.now()).toBe(160000);
});
