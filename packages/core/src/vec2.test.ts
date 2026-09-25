import { expect, test } from 'vitest';
import {
  addVec2,
  dotVec2,
  lengthSquaredVec2,
  lengthVec2,
  scaleVec2,
  subVec2,
  vec2,
} from './vec2.ts';

test('vec2 add/sub/scale は新値を返し引数を壊さない', () => {
  const a = vec2(1, 2);
  const b = vec2(10, 20);
  const c = addVec2(a, b);
  expect(c).toEqual({ x: 11, y: 22 });
  expect(a).toEqual({ x: 1, y: 2 });
  expect(b).toEqual({ x: 10, y: 20 });
  expect(subVec2(b, a)).toEqual({ x: 9, y: 18 });
  expect(scaleVec2(a, 3)).toEqual({ x: 3, y: 6 });
  expect(a).toEqual({ x: 1, y: 2 });
});

test('vec2 dot/length', () => {
  expect(dotVec2(vec2(1, 2), vec2(3, 4))).toBe(11);
  expect(lengthSquaredVec2(vec2(3, 4))).toBe(25);
  expect(lengthVec2(vec2(3, 4))).toBe(5);
  expect(lengthVec2(vec2(0, 0))).toBe(0);
});
