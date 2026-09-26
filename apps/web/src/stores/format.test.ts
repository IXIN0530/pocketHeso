import { expect, test } from 'vitest';
import { formatNum, formatSpan } from './format.ts';

test('数値は万・億・兆・京、1e20 以上は指数（切り捨て）', () => {
  expect(formatNum(0)).toBe('0');
  expect(formatNum(9999.9)).toBe('9,999');
  expect(formatNum(3.456, 1)).toBe('3.4');
  expect(formatNum(12345)).toBe('1.23万');
  expect(formatNum(19999)).toBe('1.99万');
  expect(formatNum(456000000)).toBe('4.56億');
  expect(formatNum(7.891e12)).toBe('7.89兆');
  expect(formatNum(1.234e16)).toBe('1.23京');
  expect(formatNum(130000)).toBe('13.0万');
  expect(formatNum(20000000)).toBe('2000万');
  expect(formatNum(4.567e9)).toBe('45.6億');
  expect(formatNum(1.2e20)).toBe('1.2e20');
  expect(formatNum(3.5e25)).toBe('3.5e25');
  expect(formatNum(-12345)).toBe('-1.23万');
  expect(formatNum(Number.NaN)).toBe('—');
});

test('経過時間', () => {
  expect(formatSpan(40000)).toBe('40秒');
  expect(formatSpan(12 * 60000)).toBe('12分');
  expect(formatSpan(5 * 3600000 + 2 * 60000)).toBe('5時間02分');
  expect(formatSpan(76 * 3600000)).toBe('3日4時間');
});
