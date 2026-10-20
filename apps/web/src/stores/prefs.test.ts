import { expect, test } from 'vitest';
import { parsePrefs } from './prefs.ts';

test('抽選カスタムの保存値: 正しい値はそのまま・不正な値や欠けは normal に戻る', () => {
  for (const c of ['normal', 'sb40', 'sb90', 'sb100']) expect(parsePrefs({ sakibareCustom: c }).sakibareCustom).toBe(c);
  for (const bad of ['sb50', '', 'SB40', 40, null, undefined, {}, ['sb40']]) expect(parsePrefs({ sakibareCustom: bad }).sakibareCustom).toBe('normal');
  expect(parsePrefs({}).sakibareCustom).toBe('normal');
  expect(parsePrefs(null).sakibareCustom).toBe('normal');
  // 他の項目は従来どおり。
  expect(parsePrefs({ volume: 500, bloom: 'x' })).toMatchObject({ volume: 100, bloom: true, haptics: true, looksOff: [] });
});
