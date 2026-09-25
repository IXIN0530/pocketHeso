import type { Vec2 } from './vec2.ts';
import { vec2 } from './vec2.ts';

/** センサー種別（spec/20）。将来 `start2` / `attacker` / `v` を使う。 */
export type SensorKind = 'start1' | 'out' | 'start2' | 'attacker' | 'v';

/** 既知のセンサー種別（順序固定。反復順に依存する処理はこの配列を使う）。 */
export const SENSOR_KINDS: readonly SensorKind[] = ['start1', 'out', 'start2', 'attacker', 'v'];

/** 発射方向表の ID と件数（`resources/boards/launch_dirs.json`）。 */
export const LAUNCH_DIR_TABLE_ID = 'launch_dirs';
export const LAUNCH_DIR_COUNT = 1024;

/** 発射速度の上限 mm/s（物理の速度クランプと同じ 6000）。 */
export const MAX_LAUNCH_SPEED_MM_S = 6000;

/** 単位ベクトル判定の許容（長さの2乗と 1 の差。表は小数6桁丸めのため余裕を持つ）。 */
const UNIT_LEN_SQ_TOL = 0.00001;

/** 盤面サイズの上限 mm（タイプミス検出用）。 */
const MAX_BOARD_MM = 2000;

/** 釘。 */
export interface BoardPin {
  readonly p: Vec2;
  readonly r: number;
}

/** 壁・レール（線分）。 */
export interface BoardSegment {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly restitution: number;
  readonly friction: number;
}

/** センサー（玉中心が矩形に入った最初のステップで確定）。 */
export interface BoardSensor {
  readonly id: string;
  readonly kind: SensorKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 発射条件。方向は `dirTable`（1024 件の単位ベクトル表）の添字で指定する。 */
export interface BoardLaunch {
  readonly origin: Vec2;
  readonly dirTable: string;
  readonly speedMinMmS: number;
  readonly speedMaxMmS: number;
}

/** 役物（描画位置のみ。物理には関与しない）。 */
export interface BoardYakumono {
  readonly id: string;
  readonly p: Vec2;
  readonly r: number;
}

/** 盤面（検証済み）。 */
export interface Board {
  readonly id: string;
  readonly version: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly gravityMmS2: number;
  readonly pins: readonly BoardPin[];
  readonly segments: readonly BoardSegment[];
  readonly sensors: readonly BoardSensor[];
  readonly launch: BoardLaunch;
  readonly pinRestitution: number;
  readonly pinFriction: number;
  readonly yakumono: readonly BoardYakumono[];
}

function fail(message: string): never {
  throw new Error('invalid board: ' + message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(what + ' must be an object');
  }
  return value;
}

function asArray(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(what + ' must be an array');
  }
  return value;
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(what + ' must be a finite number');
  }
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(what + ' must be a non-empty string');
  }
  return value;
}

function asPair(value: unknown, what: string): readonly [number, number] {
  const arr = asArray(value, what);
  if (arr.length !== 2) {
    fail(what + ' must be [x, y]');
  }
  return [asNumber(arr[0], what + '[0]'), asNumber(arr[1], what + '[1]')];
}

function asUnitRange(value: unknown, what: string): number {
  const n = asNumber(value, what);
  if (n < 0 || n > 1) {
    fail(what + ' must be in [0, 1]');
  }
  return n;
}

function isSensorKind(value: string): value is SensorKind {
  for (let i = 0; i < SENSOR_KINDS.length; i = i + 1) {
    if (SENSOR_KINDS[i] === value) {
      return true;
    }
  }
  return false;
}

/**
 * 盤面 JSON を検証して `Board` にする。
 * 範囲外・重複・センサー欠如（start1 / out なし）を拒否する。入力のキー順には依存しない。
 */
export function parseBoard(json: unknown): Board {
  const o = asRecord(json, 'board');
  const id = asString(o['id'], 'id');
  if (id.length > 64) {
    fail('id too long');
  }
  const version = asNumber(o['version'], 'version');
  if (Math.floor(version) !== version || version < 1) {
    fail('version must be a positive int');
  }
  const size = asPair(o['size_mm'], 'size_mm');
  const widthMm = size[0];
  const heightMm = size[1];
  if (widthMm <= 0 || widthMm > MAX_BOARD_MM || heightMm <= 0 || heightMm > MAX_BOARD_MM) {
    fail('size_mm out of range');
  }
  const gravityMmS2 = asNumber(o['gravity_mm_s2'], 'gravity_mm_s2');
  if (gravityMmS2 <= 0 || gravityMmS2 > 50000) {
    fail('gravity_mm_s2 out of range');
  }

  const pinsRaw = asArray(o['pins'], 'pins');
  const pins: BoardPin[] = [];
  for (let i = 0; i < pinsRaw.length; i = i + 1) {
    const what = 'pins[' + i + ']';
    const po = asRecord(pinsRaw[i], what);
    const pp = asPair(po['p'], what + '.p');
    const pr = asNumber(po['r'], what + '.r');
    if (pp[0] < 0 || pp[0] > widthMm || pp[1] < 0 || pp[1] > heightMm) {
      fail(what + ' out of range');
    }
    if (pr <= 0 || pr > 10) {
      fail(what + '.r out of range');
    }
    for (let j = 0; j < pins.length; j = j + 1) {
      const q = pins[j] as BoardPin;
      if (q.p.x === pp[0] && q.p.y === pp[1]) {
        fail(what + ' duplicates pins[' + j + ']');
      }
    }
    pins.push({ p: vec2(pp[0], pp[1]), r: pr });
  }

  const segmentsRaw = asArray(o['segments'], 'segments');
  const segments: BoardSegment[] = [];
  for (let i = 0; i < segmentsRaw.length; i = i + 1) {
    const what = 'segments[' + i + ']';
    const so = asRecord(segmentsRaw[i], what);
    const pa = asPair(so['a'], what + '.a');
    const pb = asPair(so['b'], what + '.b');
    if (pa[0] < 0 || pa[0] > widthMm || pa[1] < 0 || pa[1] > heightMm) {
      fail(what + '.a out of range');
    }
    if (pb[0] < 0 || pb[0] > widthMm || pb[1] < 0 || pb[1] > heightMm) {
      fail(what + '.b out of range');
    }
    const restitution = asUnitRange(so['restitution'], what + '.restitution');
    const friction = asUnitRange(so['friction'], what + '.friction');
    for (let j = 0; j < segments.length; j = j + 1) {
      const s = segments[j] as BoardSegment;
      const same =
        s.a.x === pa[0] && s.a.y === pa[1] && s.b.x === pb[0] && s.b.y === pb[1];
      const flipped =
        s.a.x === pb[0] && s.a.y === pb[1] && s.b.x === pa[0] && s.b.y === pa[1];
      if (same || flipped) {
        fail(what + ' duplicates segments[' + j + ']');
      }
    }
    segments.push({ a: vec2(pa[0], pa[1]), b: vec2(pb[0], pb[1]), restitution, friction });
  }

  const sensorsRaw = asArray(o['sensors'], 'sensors');
  const sensors: BoardSensor[] = [];
  let hasStart1 = false;
  let hasOut = false;
  for (let i = 0; i < sensorsRaw.length; i = i + 1) {
    const what = 'sensors[' + i + ']';
    const so = asRecord(sensorsRaw[i], what);
    const sid = asString(so['id'], what + '.id');
    if (sid.length > 64) {
      fail(what + '.id too long');
    }
    const kindRaw = asString(so['kind'], what + '.kind');
    if (!isSensorKind(kindRaw)) {
      fail(what + '.kind unknown');
    }
    const rectRaw = asArray(so['rect'], what + '.rect');
    if (rectRaw.length !== 4) {
      fail(what + '.rect must be [x, y, w, h]');
    }
    const x = asNumber(rectRaw[0], what + '.rect[0]');
    const y = asNumber(rectRaw[1], what + '.rect[1]');
    const w = asNumber(rectRaw[2], what + '.rect[2]');
    const h = asNumber(rectRaw[3], what + '.rect[3]');
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > widthMm || y + h > heightMm) {
      fail(what + '.rect out of range');
    }
    for (let j = 0; j < sensors.length; j = j + 1) {
      if ((sensors[j] as BoardSensor).id === sid) {
        fail(what + '.id duplicates sensors[' + j + ']');
      }
    }
    if (kindRaw === 'start1') {
      hasStart1 = true;
    }
    if (kindRaw === 'out') {
      hasOut = true;
    }
    sensors.push({ id: sid, kind: kindRaw, x, y, w, h });
  }
  if (!hasStart1) {
    fail('sensors missing start1');
  }
  if (!hasOut) {
    fail('sensors missing out');
  }

  const lo = asRecord(o['launch'], 'launch');
  const originPair = asPair(lo['origin'], 'launch.origin');
  if (originPair[0] < 0 || originPair[0] > widthMm || originPair[1] < 0 || originPair[1] > heightMm) {
    fail('launch.origin out of range');
  }
  const dirTable = asString(lo['dir_table'], 'launch.dir_table');
  if (dirTable !== LAUNCH_DIR_TABLE_ID) {
    fail('launch.dir_table must be ' + LAUNCH_DIR_TABLE_ID);
  }
  const speed = asPair(lo['speed_mm_s'], 'launch.speed_mm_s');
  if (speed[0] <= 0 || speed[1] < speed[0] || speed[1] > MAX_LAUNCH_SPEED_MM_S) {
    fail('launch.speed_mm_s out of range');
  }

  const pinRestitution = asUnitRange(o['pin_restitution'], 'pin_restitution');
  const pinFriction = asUnitRange(o['pin_friction'], 'pin_friction');

  const yakumonoRaw = asArray(o['yakumono'], 'yakumono');
  const yakumono: BoardYakumono[] = [];
  for (let i = 0; i < yakumonoRaw.length; i = i + 1) {
    const what = 'yakumono[' + i + ']';
    const yo = asRecord(yakumonoRaw[i], what);
    const yid = asString(yo['id'], what + '.id');
    if (yid.length > 64) {
      fail(what + '.id too long');
    }
    const yp = asPair(yo['p'], what + '.p');
    const yr = asNumber(yo['r'], what + '.r');
    if (yp[0] < 0 || yp[0] > widthMm || yp[1] < 0 || yp[1] > heightMm) {
      fail(what + ' out of range');
    }
    if (yr <= 0 || yr > 50) {
      fail(what + '.r out of range');
    }
    for (let j = 0; j < yakumono.length; j = j + 1) {
      const y = yakumono[j] as BoardYakumono;
      if (y.id === yid) {
        fail(what + '.id duplicates yakumono[' + j + ']');
      }
      if (y.p.x === yp[0] && y.p.y === yp[1]) {
        fail(what + ' duplicates yakumono[' + j + ']');
      }
    }
    yakumono.push({ id: yid, p: vec2(yp[0], yp[1]), r: yr });
  }

  return {
    id,
    version,
    widthMm,
    heightMm,
    gravityMmS2,
    pins,
    segments,
    sensors,
    launch: { origin: vec2(originPair[0], originPair[1]), dirTable, speedMinMmS: speed[0], speedMaxMmS: speed[1] },
    pinRestitution,
    pinFriction,
    yakumono,
  };
}

/** JSON テキストを検証して `Board` にする（`JSON.parse` の SyntaxError はそのまま投げる）。 */
export function parseBoardText(text: string): Board {
  return parseBoard(JSON.parse(text) as unknown);
}

/** 数値を正規化（小数6桁。ECMA 仕様で決定的）。 */
function num(n: number): string {
  return n.toFixed(6);
}

/** 文字列を正規化（`JSON.stringify` は決定的）。 */
function str(s: string): string {
  return JSON.stringify(s);
}

/**
 * 正規化 JSON（キーソート・小数6桁）。入力のキー順によらず同一の `Board` は同一文字列になる。
 * 盤面ハッシュの入力にする（ハッシュ自体は `hashBoard` かブラウザの `crypto.subtle` で）。
 */
export function canonicalBoardJson(b: Board): string {
  let out =
    '{"gravity_mm_s2":' + num(b.gravityMmS2) +
    ',"id":' + str(b.id) +
    ',"launch":{"dir_table":' + str(b.launch.dirTable) +
    ',"origin":[' + num(b.launch.origin.x) + ',' + num(b.launch.origin.y) + ']' +
    ',"speed_mm_s":[' + num(b.launch.speedMinMmS) + ',' + num(b.launch.speedMaxMmS) + ']}' +
    ',"pin_friction":' + num(b.pinFriction) +
    ',"pin_restitution":' + num(b.pinRestitution) +
    ',"pins":[';
  for (let i = 0; i < b.pins.length; i = i + 1) {
    const pin = b.pins[i] as BoardPin;
    if (i > 0) {
      out = out + ',';
    }
    out = out + '{"p":[' + num(pin.p.x) + ',' + num(pin.p.y) + '],"r":' + num(pin.r) + '}';
  }
  out = out + '],"segments":[';
  for (let i = 0; i < b.segments.length; i = i + 1) {
    const s = b.segments[i] as BoardSegment;
    if (i > 0) {
      out = out + ',';
    }
    out =
      out +
      '{"a":[' + num(s.a.x) + ',' + num(s.a.y) + ']' +
      ',"b":[' + num(s.b.x) + ',' + num(s.b.y) + ']' +
      ',"friction":' + num(s.friction) +
      ',"restitution":' + num(s.restitution) + '}';
  }
  out = out + '],"sensors":[';
  for (let i = 0; i < b.sensors.length; i = i + 1) {
    const s = b.sensors[i] as BoardSensor;
    if (i > 0) {
      out = out + ',';
    }
    out =
      out +
      '{"id":' + str(s.id) +
      ',"kind":' + str(s.kind) +
      ',"rect":[' + num(s.x) + ',' + num(s.y) + ',' + num(s.w) + ',' + num(s.h) + ']}';
  }
  out = out + '],"size_mm":[' + num(b.widthMm) + ',' + num(b.heightMm) + ']';
  out = out + ',"version":' + num(b.version);
  out = out + ',"yakumono":[';
  for (let i = 0; i < b.yakumono.length; i = i + 1) {
    const y = b.yakumono[i] as BoardYakumono;
    if (i > 0) {
      out = out + ',';
    }
    out = out + '{"id":' + str(y.id) + ',"p":[' + num(y.p.x) + ',' + num(y.p.y) + '],"r":' + num(y.r) + '}';
  }
  return out + ']}';
}

/**
 * 盤面ハッシュ（SHA-256 の16進）。SHA-256 実装は引数で注入する
 *（Node は `node:crypto`、ブラウザは `crypto.subtle` で正規化 JSON をハッシュする）。
 */
export function hashBoard(board: Board, sha256Hex: (canonical: string) => string): string {
  return sha256Hex(canonicalBoardJson(board));
}

/** バイト列を小文字16進にする（ブラウザ側の `crypto.subtle` 結果表示用。決定的）。 */
export function bytesToHex(bytes: Uint8Array): string {
  const HEX = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < bytes.length; i = i + 1) {
    const v = bytes[i] as number;
    out = out + HEX.charAt((v >> 4) & 15) + HEX.charAt(v & 15);
  }
  return out;
}

/**
 * `launch_dirs` 表を読み込む（Core は表を読むだけ。生成は pachisim 側）。
 * 配列本体か `{dirs: [...]}` を受け、1024 件の単位ベクトルを検証する。
 */
export function parseLaunchDirs(json: unknown): readonly Vec2[] {
  let raw: readonly unknown[];
  if (Array.isArray(json)) {
    raw = json;
  } else if (isRecord(json) && Array.isArray(json['dirs'])) {
    raw = json['dirs'];
  } else {
    fail('launch_dirs must be an array or {dirs}');
    raw = [];
  }
  if (raw.length !== LAUNCH_DIR_COUNT) {
    fail('launch_dirs must have ' + LAUNCH_DIR_COUNT + ' entries');
  }
  const out: Vec2[] = [];
  for (let i = 0; i < raw.length; i = i + 1) {
    const pair = asPair(raw[i], 'dirs[' + i + ']');
    const x = pair[0];
    const y = pair[1];
    if (x < -1 || x > 1 || y < -1 || y > 1) {
      fail('dirs[' + i + '] out of range');
    }
    const d = x * x + y * y - 1;
    if (d > UNIT_LEN_SQ_TOL || d < -UNIT_LEN_SQ_TOL) {
      fail('dirs[' + i + '] is not a unit vector');
    }
    out.push(vec2(x, y));
  }
  return out;
}
