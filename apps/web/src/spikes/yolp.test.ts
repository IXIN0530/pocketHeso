import { expect, test } from 'vitest';
import { evaluate } from './geo-overpass.ts';
import { buildYolpUrl, parseYolp } from './yolp.ts';

test('builds URL with km radius, genre codes and callback', () => {
  const u = new URL(buildYolpUrl('ID', 35.1, 139.2, 300, 'cb'));
  expect(u.searchParams.get('dist')).toBe('0.3');
  expect(u.searchParams.get('gc')).toBe('0405003,0301001,0301013,0303010,0305007');
  expect(u.searchParams.get('callback')).toBe('cb');
});

test('parses features and judges parks by the YOLP radius', () => {
  const list = parseYolp({
    Feature: [
      { Gid: 'a', Name: '公園A', Geometry: { Coordinates: '139.0,35.0008' }, Property: { Genre: [{ Code: '0305007' }] } },
      { Gid: 'b', Name: 'ジムB', Geometry: { Coordinates: '139.0,35.0' }, Property: { Genre: [{ Code: '0199' }, { Code: '0405003' }] } },
      { Gid: 'c', Geometry: { Coordinates: 'x' } },
    ],
  });
  expect(list.map((f) => [f.id, f.leisure, f.radiusM])).toEqual([
    ['yolp/a', '公園', 100],
    ['yolp/b', 'スポーツクラブ', 60],
  ]);
  // 公園A は約 89m 先: 半径 100m の内。
  expect(evaluate(35.0, 139.0, 10, list).map((f) => [f.id, f.rule, f.inRange])).toEqual([
    ['yolp/b', 'radius', true],
    ['yolp/a', 'radius', true],
  ]);
  expect(parseYolp(null)).toEqual([]);
});
