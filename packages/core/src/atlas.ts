import type { BallOutcome, BallOutcomeKind, LaunchParams } from './physics.ts';
import { RNGStream } from './rng.ts';

/** Outcome Atlas バイナリの版数。 */
export const ATLAS_VERSION = 1;

/** Atlas のエントリ件数（dirIndex 10bit × speed 6bit）。 */
export const ATLAS_ENTRY_COUNT = 65536;

/** 1方向あたりの速度バケット数（speedQ の上位6bit）。 */
export const ATLAS_BUCKETS_PER_DIR = 64;

/** Atlas エントリのバイト数（kind u8 + flightMs u16 + dirIndex u16 + speedQ u16）。 */
export const ATLAS_ENTRY_BYTES = 7;

/** Atlas ヘッダのバイト数（magic 4 + version u32 + boardHash 32 + count u32）。 */
export const ATLAS_HEADER_BYTES = 44;

/** Atlas ファイル全体のバイト数（ヘッダ + 65536エントリ）。 */
export const ATLAS_TOTAL_BYTES = ATLAS_HEADER_BYTES + ATLAS_ENTRY_COUNT * ATLAS_ENTRY_BYTES;

/** Atlas のマジック（ASCII 'ATLS'）。 */
export const ATLAS_MAGIC: readonly [number, number, number, number] = [65, 84, 76, 83];

/** verify が先頭から照合する既定件数（初回起動のブラウザ照合と同じ）。 */
export const ATLAS_VERIFY_PREFIX = 1024;

/** Atlas の kind 符号（u8）。 */
export const ATLAS_KIND_START1 = 0;

/** Atlas の kind 符号（u8）。 */
export const ATLAS_KIND_OUT = 1;

/** Atlas の kind 符号（u8）。 */
export const ATLAS_KIND_START2 = 2;

/** Atlas の kind 符号（u8）。 */
export const ATLAS_KIND_ATTACKER = 3;

/** Atlas の kind 符号（u8）。 */
export const ATLAS_KIND_V = 4;

/** Atlas の kind 符号（u8）。 */
export const ATLAS_KIND_LOST = 5;

/** Atlas の1エントリ（量子化キーの正準条件とその結果）。 */
export interface AtlasEntry {
  readonly kind: BallOutcomeKind;
  readonly flightMs: number;
  readonly params: LaunchParams;
}

/** Atlas ヘッダの復号結果。 */
export interface AtlasHeader {
  readonly version: number;
  readonly boardHash: Uint8Array;
  readonly count: number;
}

/** `verifyAtlas` の結果（checked 件中 mismatched 件が不一致、heso は照合分のヘソ数）。 */
export interface AtlasVerifyResult {
  readonly checked: number;
  readonly mismatched: number;
  readonly heso: number;
}

function fail(what: string): never {
  throw new Error('invalid atlas: ' + what);
}

function isInt(n: number): boolean {
  return Math.floor(n) === n;
}

/** speedQ（0..65535）の速度バケット（0..63。上位6bit）。 */
export function atlasBucketForSpeedQ(speedQ: number): number {
  if (!isInt(speedQ) || speedQ < 0 || speedQ > 65535) {
    fail('speedQ out of range');
  }
  return Math.floor(speedQ / 1024);
}

/** LaunchParams の量子化キー（dirIndex 10bit << 6 | bucket 6bit）。 */
export function atlasKeyForParams(p: LaunchParams): number {
  if (!isInt(p.dirIndex) || p.dirIndex < 0 || p.dirIndex >= 1024) {
    fail('dirIndex out of range');
  }
  return p.dirIndex * ATLAS_BUCKETS_PER_DIR + atlasBucketForSpeedQ(p.speedQ);
}

/** 量子化キーの正準条件（速度はバケット中央の speedQ = bucket * 1024 + 512）。 */
export function canonicalParamsForKey(key: number): LaunchParams {
  if (!isInt(key) || key < 0 || key >= ATLAS_ENTRY_COUNT) {
    fail('key out of range');
  }
  const dirIndex = Math.floor(key / ATLAS_BUCKETS_PER_DIR);
  const bucket = key - dirIndex * ATLAS_BUCKETS_PER_DIR;
  return { dirIndex, speedQ: bucket * 1024 + 512 };
}

/** 玉 i の LaunchParams（`RNGStream('launch', i)` の2出力で dir と speed を決める）。 */
export function launchParamsForBall(seed: number, index: number): LaunchParams {
  if (!isInt(index) || index < 0) {
    fail('ball index out of range');
  }
  const rng = new RNGStream(seed, 'launch', index);
  const uDir = rng.nextU32();
  const uSpeed = rng.nextU32();
  return {
    dirIndex: uDir - Math.floor(uDir / 1024) * 1024,
    speedQ: uSpeed - Math.floor(uSpeed / 65536) * 65536,
  };
}

/** 玉 i の Atlas 参照キー（上記 LaunchParams を量子化）。 */
export function atlasKeyForBall(seed: number, index: number): number {
  return atlasKeyForParams(launchParamsForBall(seed, index));
}

/** kind の符号化（u8）。 */
export function encodeAtlasKind(kind: BallOutcomeKind): number {
  if (kind === 'start1') {
    return ATLAS_KIND_START1;
  }
  if (kind === 'out') {
    return ATLAS_KIND_OUT;
  }
  if (kind === 'start2') {
    return ATLAS_KIND_START2;
  }
  if (kind === 'attacker') {
    return ATLAS_KIND_ATTACKER;
  }
  if (kind === 'v') {
    return ATLAS_KIND_V;
  }
  if (kind === 'lost') {
    return ATLAS_KIND_LOST;
  }
  fail('unknown kind');
}

/** kind の復号（u8 → kind。不明値は拒否）。 */
export function decodeAtlasKind(code: number): BallOutcomeKind {
  if (code === ATLAS_KIND_START1) {
    return 'start1';
  }
  if (code === ATLAS_KIND_OUT) {
    return 'out';
  }
  if (code === ATLAS_KIND_START2) {
    return 'start2';
  }
  if (code === ATLAS_KIND_ATTACKER) {
    return 'attacker';
  }
  if (code === ATLAS_KIND_V) {
    return 'v';
  }
  if (code === ATLAS_KIND_LOST) {
    return 'lost';
  }
  fail('unknown kind code');
}

/** flightMs の符号化（四捨五入して u16 に収める）。 */
export function encodeAtlasFlightMs(flightMs: number): number {
  if (!(flightMs >= 0)) {
    fail('flightMs out of range');
  }
  const q = Math.floor(flightMs + 0.5);
  if (q > 65535) {
    return 65535;
  }
  return q;
}

/** flightMs の復号（u16 → 整数 ms）。 */
export function decodeAtlasFlightMs(q: number): number {
  if (!isInt(q) || q < 0 || q > 65535) {
    fail('flightMs code out of range');
  }
  return q;
}

function checkHash(boardHash: Uint8Array): void {
  if (!(boardHash instanceof Uint8Array) || boardHash.length !== 32) {
    fail('boardHash must be 32 bytes');
  }
}

/** Atlas 全体を符号化する（ヘッダ + 65536エントリ。キー順に並べる）。 */
export function encodeAtlas(boardHash: Uint8Array, entries: readonly AtlasEntry[]): ArrayBuffer {
  checkHash(boardHash);
  if (entries.length !== ATLAS_ENTRY_COUNT) {
    fail('entries must have ' + ATLAS_ENTRY_COUNT + ' items');
  }
  const buffer = new ArrayBuffer(ATLAS_TOTAL_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, ATLAS_MAGIC[0] as number);
  view.setUint8(1, ATLAS_MAGIC[1] as number);
  view.setUint8(2, ATLAS_MAGIC[2] as number);
  view.setUint8(3, ATLAS_MAGIC[3] as number);
  view.setUint32(4, ATLAS_VERSION, true);
  for (let i = 0; i < 32; i = i + 1) {
    view.setUint8(8 + i, boardHash[i] as number);
  }
  view.setUint32(40, ATLAS_ENTRY_COUNT, true);
  for (let key = 0; key < ATLAS_ENTRY_COUNT; key = key + 1) {
    const e = entries[key] as AtlasEntry;
    if (e === undefined) {
      fail('entry ' + key + ' is missing');
    }
    const at = ATLAS_HEADER_BYTES + key * ATLAS_ENTRY_BYTES;
    view.setUint8(at, encodeAtlasKind(e.kind));
    view.setUint16(at + 1, encodeAtlasFlightMs(e.flightMs), true);
    if (!isInt(e.params.dirIndex) || e.params.dirIndex < 0 || e.params.dirIndex >= 1024) {
      fail('entry ' + key + ' dirIndex out of range');
    }
    if (!isInt(e.params.speedQ) || e.params.speedQ < 0 || e.params.speedQ > 65535) {
      fail('entry ' + key + ' speedQ out of range');
    }
    view.setUint16(at + 3, e.params.dirIndex, true);
    view.setUint16(at + 5, e.params.speedQ, true);
  }
  return buffer;
}

/** Atlas ヘッダを復号する（マジック・版数・件数を検証する）。 */
export function decodeAtlasHeader(buffer: ArrayBuffer): AtlasHeader {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== ATLAS_TOTAL_BYTES) {
    fail('byteLength must be ' + ATLAS_TOTAL_BYTES);
  }
  const view = new DataView(buffer);
  if (
    view.getUint8(0) !== (ATLAS_MAGIC[0] as number) ||
    view.getUint8(1) !== (ATLAS_MAGIC[1] as number) ||
    view.getUint8(2) !== (ATLAS_MAGIC[2] as number) ||
    view.getUint8(3) !== (ATLAS_MAGIC[3] as number)
  ) {
    fail('bad magic');
  }
  const version = view.getUint32(4, true);
  if (version !== ATLAS_VERSION) {
    fail('unsupported version ' + version);
  }
  const boardHash = new Uint8Array(32);
  for (let i = 0; i < 32; i = i + 1) {
    boardHash[i] = view.getUint8(8 + i);
  }
  const count = view.getUint32(40, true);
  if (count !== ATLAS_ENTRY_COUNT) {
    fail('bad count ' + count);
  }
  return { version, boardHash, count };
}

function entryFromView(view: DataView, key: number): AtlasEntry {
  const at = ATLAS_HEADER_BYTES + key * ATLAS_ENTRY_BYTES;
  return {
    kind: decodeAtlasKind(view.getUint8(at)),
    flightMs: decodeAtlasFlightMs(view.getUint16(at + 1, true)),
    params: {
      dirIndex: view.getUint16(at + 3, true),
      speedQ: view.getUint16(at + 5, true),
    },
  };
}

/** Atlas の1エントリを復号する（`ArrayBuffer` → `DataView` で読む）。 */
export function decodeAtlasEntry(buffer: ArrayBuffer, key: number): AtlasEntry {
  if (!isInt(key) || key < 0 || key >= ATLAS_ENTRY_COUNT) {
    fail('key out of range');
  }
  decodeAtlasHeader(buffer);
  return entryFromView(new DataView(buffer), key);
}

/** 盤面ハッシュ32B が一致するか（決定的なバイト比較）。 */
export function atlasHashEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== 32 || b.length !== 32) {
    return false;
  }
  for (let i = 0; i < 32; i = i + 1) {
    if ((a[i] as number) !== (b[i] as number)) {
      return false;
    }
  }
  return true;
}

/**
 * Atlas の先頭 prefixCount 件を再計算して照合する（ヘッダの盤面ハッシュも比べる）。
 * run は正準条件から `BallSimulator.run` と同じ結果を返す関数。
 */
export function verifyAtlas(
  buffer: ArrayBuffer,
  expectedBoardHash: Uint8Array,
  run: (p: LaunchParams) => BallOutcome,
  prefixCount: number = ATLAS_VERIFY_PREFIX,
): AtlasVerifyResult {
  checkHash(expectedBoardHash);
  if (!isInt(prefixCount) || prefixCount < 1 || prefixCount > ATLAS_ENTRY_COUNT) {
    fail('prefixCount out of range');
  }
  const header = decodeAtlasHeader(buffer);
  if (!atlasHashEquals(header.boardHash, expectedBoardHash)) {
    fail('board hash mismatch');
  }
  const view = new DataView(buffer);
  let mismatched = 0;
  let heso = 0;
  for (let key = 0; key < prefixCount; key = key + 1) {
    const stored = entryFromView(view, key);
    const canonical = canonicalParamsForKey(key);
    const actual = run(canonical);
    const sameParams =
      stored.params.dirIndex === canonical.dirIndex && stored.params.speedQ === canonical.speedQ;
    const sameKind = stored.kind === actual.kind;
    const sameFlight = stored.flightMs === encodeAtlasFlightMs(actual.flightMs);
    if (!(sameParams && sameKind && sameFlight)) {
      mismatched = mismatched + 1;
    }
    if (stored.kind === 'start1') {
      heso = heso + 1;
    }
  }
  return { checked: prefixCount, mismatched, heso };
}
