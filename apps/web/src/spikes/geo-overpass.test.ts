import { expect, test } from 'vitest';
import { buildQuery, evaluate, parseOverpass } from './geo-overpass.ts';

test('builds the spec/32 query', () => {
  expect(buildQuery(35.1, 139.2)).toBe(
    '[out:json][timeout:10];nwr["leisure"~"^(fitness_centre|fitness_station|sports_centre|park|pitch|track|swimming_pool)$"](around:300,35.1,139.2);out tags center bb 50;',
  );
});

const sample = {
  elements: [
    { type: 'node', id: 1, lat: 35.0003, lon: 139.0, tags: { leisure: 'fitness_station' } },
    {
      type: 'way',
      id: 2,
      center: { lat: 35.001, lon: 139.001 },
      bounds: { minlat: 35.0005, minlon: 139.0005, maxlat: 35.0015, maxlon: 139.0015 },
      tags: { leisure: 'park', name: '中央公園' },
    },
    { type: 'node', id: 3, lat: 35.0, lon: 139.0001, tags: { leisure: 'pitch' } },
    { type: 'relation', id: 4, tags: { leisure: 'park' } },
  ],
};

test('parses nodes, ways with center/bounds, and drops elements without coordinates', () => {
  const list = parseOverpass(sample);
  expect(list.map((f) => f.id)).toEqual(['node/1', 'way/2', 'node/3']);
  expect(list[1]).toMatchObject({ name: '中央公園', lat: 35.001, bounds: { minlat: 35.0005 } });
  expect(parseOverpass(null)).toEqual([]);
});

test('evaluates range by bbox+margin, type radius, or none; sorted by distance', () => {
  const r = evaluate(35.0, 139.0, 20, parseOverpass(sample));
  expect(r.map((f) => [f.id, f.rule, f.inRange])).toEqual([
    ['node/3', 'none', false],
    ['node/1', 'radius', true],
    ['way/2', 'bbox', false],
  ]);
  expect(r[1]?.centerM).toBeCloseTo(33.4, 0);
  // bbox の南端まで約 56m: margin 50m では外、accuracy 50m（margin 80m）なら内。
  expect(evaluate(35.0, 139.0, 50, parseOverpass(sample)).find((f) => f.id === 'way/2')?.inRange).toBe(true);
});
