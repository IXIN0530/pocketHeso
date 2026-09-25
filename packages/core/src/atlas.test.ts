import { expect, test } from 'vitest';
import {
  ATLAS_ENTRY_COUNT,
  ATLAS_HEADER_BYTES,
  ATLAS_TOTAL_BYTES,
  ATLAS_VERIFY_PREFIX,
  atlasBucketForSpeedQ,
  atlasHashEquals,
  atlasKeyForBall,
  atlasKeyForParams,
  canonicalParamsForKey,
  decodeAtlasEntry,
  decodeAtlasFlightMs,
  decodeAtlasHeader,
  decodeAtlasKind,
  encodeAtlas,
  encodeAtlasFlightMs,
  encodeAtlasKind,
  launchParamsForBall,
  verifyAtlas,
  type AtlasEntry,
  type BallOutcome,
  type LaunchParams,
} from './index.ts';

const KINDS = ['start1', 'out', 'lost', 'start2', 'attacker', 'v'] as const;

function hash32(fill: number): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i = i + 1) {
    out[i] = (fill + i) % 256;
  }
  return out;
}

test('速度バケットの境界（1024 刻み・上位6bit）', () => {
  expect(atlasBucketForSpeedQ(0)).toBe(0);
  expect(atlasBucketForSpeedQ(1023)).toBe(0);
  expect(atlasBucketForSpeedQ(1024)).toBe(1);
  expect(atlasBucketForSpeedQ(65535)).toBe(63);
  expect(() => atlasBucketForSpeedQ(-1)).toThrow();
  expect(() => atlasBucketForSpeedQ(65536)).toThrow();
  expect(() => atlasBucketForSpeedQ(1.5)).toThrow();
});

test('キーと正準条件が全65536件で往復する', () => {
  expect(canonicalParamsForKey(0)).toEqual({ dirIndex: 0, speedQ: 512 });
  expect(canonicalParamsForKey(63)).toEqual({ dirIndex: 0, speedQ: 65024 });
  expect(canonicalParamsForKey(64)).toEqual({ dirIndex: 1, speedQ: 512 });
  expect(canonicalParamsForKey(65535)).toEqual({ dirIndex: 1023, speedQ: 65024 });
  for (let key = 0; key < ATLAS_ENTRY_COUNT; key = key + 1) {
    const p = canonicalParamsForKey(key);
    expect(atlasKeyForParams(p)).toBe(key);
  }
  expect(() => canonicalParamsForKey(-1)).toThrow();
  expect(() => canonicalParamsForKey(65536)).toThrow();
  expect(() => atlasKeyForParams({ dirIndex: 1024, speedQ: 0 })).toThrow();
});

test('玉 i の LaunchParams は決定的で範囲内', () => {
  const a = launchParamsForBall(12345, 7);
  const b = launchParamsForBall(12345, 7);
  expect(a).toEqual(b);
  expect(atlasKeyForBall(12345, 7)).toBe(atlasKeyForParams(a));
  for (let i = 0; i < 100; i = i + 1) {
    const p = launchParamsForBall(999, i);
    expect(p.dirIndex).toBeGreaterThanOrEqual(0);
    expect(p.dirIndex).toBeLessThan(1024);
    expect(p.speedQ).toBeGreaterThanOrEqual(0);
    expect(p.speedQ).toBeLessThan(65536);
    expect(Math.floor(p.dirIndex)).toBe(p.dirIndex);
    expect(Math.floor(p.speedQ)).toBe(p.speedQ);
  }
  expect(() => launchParamsForBall(1, -1)).toThrow();
});

test('kind の符号化が往復する（6種・不明値拒否）', () => {
  for (const k of KINDS) {
    expect(decodeAtlasKind(encodeAtlasKind(k))).toBe(k);
  }
  expect(() => decodeAtlasKind(6)).toThrow();
  expect(() => encodeAtlasKind('unknown' as never)).toThrow();
});

test('flightMs は四捨五入して u16 に収まる', () => {
  expect(encodeAtlasFlightMs(0)).toBe(0);
  expect(encodeAtlasFlightMs(20000)).toBe(20000);
  expect(encodeAtlasFlightMs(410.4166666666667)).toBe(410);
  expect(encodeAtlasFlightMs(410.5)).toBe(411);
  expect(encodeAtlasFlightMs(100000)).toBe(65535);
  expect(decodeAtlasFlightMs(410)).toBe(410);
  expect(() => encodeAtlasFlightMs(-1)).toThrow();
  expect(() => decodeAtlasFlightMs(65536)).toThrow();
});

function patternEntries(): AtlasEntry[] {
  const out: AtlasEntry[] = [];
  for (let key = 0; key < ATLAS_ENTRY_COUNT; key = key + 1) {
    out.push({
      kind: KINDS[key % KINDS.length] as AtlasEntry['kind'],
      flightMs: (key * 7) % 20001,
      params: canonicalParamsForKey(key),
    });
  }
  return out;
}

test('バイナリは約450KB・ヘッダとエントリが往復する', () => {
  const hash = hash32(9);
  const buffer = encodeAtlas(hash, patternEntries());
  expect(buffer.byteLength).toBe(ATLAS_TOTAL_BYTES);
  expect(ATLAS_TOTAL_BYTES).toBe(ATLAS_HEADER_BYTES + ATLAS_ENTRY_COUNT * 7);
  expect(ATLAS_TOTAL_BYTES).toBeGreaterThan(440 * 1024);
  expect(ATLAS_TOTAL_BYTES).toBeLessThan(470 * 1024);
  const header = decodeAtlasHeader(buffer);
  expect(header.version).toBe(1);
  expect(header.count).toBe(ATLAS_ENTRY_COUNT);
  expect(atlasHashEquals(header.boardHash, hash)).toBe(true);
  expect(atlasHashEquals(header.boardHash, hash32(10))).toBe(false);
  for (const key of [0, 1, 63, 64, 1023, 1024, 32768, 65535]) {
    const e = decodeAtlasEntry(buffer, key);
    expect(e.kind).toBe(KINDS[key % KINDS.length]);
    expect(e.flightMs).toBe((key * 7) % 20001);
    expect(e.params).toEqual(canonicalParamsForKey(key));
  }
  expect(() => decodeAtlasEntry(buffer, -1)).toThrow();
  expect(() => decodeAtlasEntry(buffer, 65536)).toThrow();
  expect(() => encodeAtlas(hash, patternEntries().slice(0, 100))).toThrow();
  expect(() => encodeAtlas(new Uint8Array(16), patternEntries())).toThrow();
});

/** スタブの物理（正準条件だけで結果が決まる。IO なし）。 */
function stubRun(p: LaunchParams): BallOutcome {
  const m = (p.dirIndex + p.speedQ) % 3;
  const kind = m === 0 ? 'start1' : m === 1 ? 'out' : 'lost';
  return { kind, flightMs: (p.dirIndex * 13 + p.speedQ) % 20000, steps: 1 };
}

function stubEntries(): AtlasEntry[] {
  const out: AtlasEntry[] = [];
  for (let key = 0; key < ATLAS_ENTRY_COUNT; key = key + 1) {
    const p = canonicalParamsForKey(key);
    const o = stubRun(p);
    out.push({ kind: o.kind, flightMs: o.flightMs, params: p });
  }
  return out;
}

test('verify(prefix) は一致・改ざん検出・ハッシュ不一致を扱う', () => {
  const hash = hash32(3);
  const buffer = encodeAtlas(hash, stubEntries());
  const ok = verifyAtlas(buffer, hash, stubRun, ATLAS_VERIFY_PREFIX);
  expect(ok.checked).toBe(ATLAS_VERIFY_PREFIX);
  expect(ok.mismatched).toBe(0);
  expect(ok.heso).toBeGreaterThan(0);
  const full = verifyAtlas(buffer, hash, stubRun, ATLAS_ENTRY_COUNT);
  expect(full.mismatched).toBe(0);
  expect(full.checked).toBe(ATLAS_ENTRY_COUNT);

  const tampered = buffer.slice(0);
  const view = new DataView(tampered);
  const at = ATLAS_HEADER_BYTES + 5 * 7;
  view.setUint8(at, (view.getUint8(at) + 1) % 6);
  const bad = verifyAtlas(tampered, hash, stubRun, ATLAS_VERIFY_PREFIX);
  expect(bad.mismatched).toBeGreaterThan(0);

  expect(() => verifyAtlas(buffer, hash32(4), stubRun, 16)).toThrow();
  expect(() => verifyAtlas(buffer, hash, stubRun, 0)).toThrow();
  expect(() => verifyAtlas(buffer, hash, stubRun, ATLAS_ENTRY_COUNT + 1)).toThrow();
});
