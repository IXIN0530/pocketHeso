import { expect, test } from 'vitest';
import {
  LAUNCH_DIR_COUNT,
  bytesToHex,
  canonicalBoardJson,
  hashBoard,
  parseBoard,
  parseBoardText,
  parseLaunchDirs,
} from './board.ts';

function fixture(): Record<string, unknown> {
  return {
    id: 'fixture',
    version: 1,
    size_mm: [420, 460],
    gravity_mm_s2: 9000,
    pins: [
      { p: [120, 80], r: 1.1 },
      { p: [140, 80], r: 1.1 },
    ],
    segments: [{ a: [0, 0], b: [0, 460], restitution: 0.35, friction: 0.1 }],
    sensors: [
      { id: 'heso', kind: 'start1', rect: [200, 300, 20, 8] },
      { id: 'out', kind: 'out', rect: [0, 452, 420, 8] },
    ],
    launch: { origin: [405, 440], dir_table: 'launch_dirs', speed_mm_s: [3200, 3600] },
    pin_restitution: 0.45,
    pin_friction: 0.05,
    yakumono: [{ id: 'windmill', p: [90, 140], r: 14 }],
  };
}

function clone(v: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
}

/** オブジェクトのキー順を再帰的に反転（値は同一）。 */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i = i + 1) {
      out.push(reverseKeys(v[i]));
    }
    return out;
  }
  if (typeof v === 'object' && v !== null) {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(src);
    for (let i = keys.length - 1; i >= 0; i = i - 1) {
      const k = keys[i] as string;
      out[k] = reverseKeys(src[k]);
    }
    return out;
  }
  return v;
}

test('盤面 JSON を検証して読み込む', () => {
  const board = parseBoardText(JSON.stringify(fixture()));
  expect(board.id).toBe('fixture');
  expect(board.pins.length).toBe(2);
  expect(board.yakumono.length).toBe(1);
  expect(board.launch.dirTable).toBe('launch_dirs');
});

test('キー順違いの JSON で正規化・ハッシュが一致', () => {
  const original = JSON.stringify(fixture());
  const shuffled = JSON.stringify(reverseKeys(JSON.parse(original) as unknown));
  expect(shuffled).not.toBe(original);
  const a = parseBoardText(original);
  const b = parseBoardText(shuffled);
  expect(canonicalBoardJson(a)).toBe(canonicalBoardJson(b));
  const fakeHash = (canonical: string): string => 'len=' + canonical.length;
  expect(hashBoard(a, fakeHash)).toBe(hashBoard(b, fakeHash));
});

test('正規化は小数6桁で決定的', () => {
  const board = parseBoard(fixture());
  const once = canonicalBoardJson(board);
  expect(canonicalBoardJson(board)).toBe(once);
  expect(once).toContain('"version":1.000000');
  expect(once).toContain('"size_mm":[420.000000,460.000000]');
});

test('bytesToHex は小文字16進', () => {
  expect(bytesToHex(new Uint8Array([0, 15, 16, 255]))).toBe('000f10ff');
  expect(bytesToHex(new Uint8Array([]))).toBe('');
});

test('範囲外・重複・センサー欠如を拒否する', () => {
  const outOfRange = clone(fixture());
  (outOfRange['pins'] as Array<Record<string, unknown>>)[0] = { p: [9999, 0], r: 1.1 };
  expect(() => parseBoard(outOfRange)).toThrow();

  const dupPin = clone(fixture());
  const pins = dupPin['pins'] as unknown[];
  pins.push(pins[0]);
  expect(() => parseBoard(dupPin)).toThrow();

  const noOut = clone(fixture());
  noOut['sensors'] = (noOut['sensors'] as Array<Record<string, unknown>>).filter(
    (s) => s['kind'] !== 'out',
  );
  expect(() => parseBoard(noOut)).toThrow();

  const noStart = clone(fixture());
  noStart['sensors'] = (noStart['sensors'] as Array<Record<string, unknown>>).filter(
    (s) => s['kind'] !== 'start1',
  );
  expect(() => parseBoard(noStart)).toThrow();

  const dupSensor = clone(fixture());
  const sensors = dupSensor['sensors'] as unknown[];
  sensors.push(sensors[0]);
  expect(() => parseBoard(dupSensor)).toThrow();

  const badRest = clone(fixture());
  (badRest['segments'] as Array<Record<string, unknown>>)[0] = {
    a: [0, 0],
    b: [0, 460],
    restitution: 2,
    friction: 0.1,
  };
  expect(() => parseBoard(badRest)).toThrow();

  const badSpeed = clone(fixture());
  (badSpeed['launch'] as Record<string, unknown>)['speed_mm_s'] = [3600, 3200];
  expect(() => parseBoard(badSpeed)).toThrow();

  const badTable = clone(fixture());
  (badTable['launch'] as Record<string, unknown>)['dir_table'] = 'other';
  expect(() => parseBoard(badTable)).toThrow();

  const dupYakumono = clone(fixture());
  const ys = dupYakumono['yakumono'] as unknown[];
  ys.push(ys[0]);
  expect(() => parseBoard(dupYakumono)).toThrow();

  expect(() => parseBoard({})).toThrow();
  expect(() => parseBoardText('not json')).toThrow();
});

test('launch_dirs 表を検証する', () => {
  const flat: Array<[number, number]> = [];
  for (let i = 0; i < LAUNCH_DIR_COUNT; i = i + 1) {
    flat.push([0, -1]);
  }
  expect(parseLaunchDirs({ id: 'launch_dirs', dirs: flat }).length).toBe(LAUNCH_DIR_COUNT);
  expect(parseLaunchDirs(flat).length).toBe(LAUNCH_DIR_COUNT);
  expect(() => parseLaunchDirs({ dirs: [] })).toThrow();
  const bad = flat.slice();
  bad[7] = [0, 0];
  expect(() => parseLaunchDirs(bad)).toThrow();
});
