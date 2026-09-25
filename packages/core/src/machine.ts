/** 機種仕様と変動パターン表（spec/21）。JSON の検証と uint32 閾値変換。 */

/** 2^32（閾値変換の被除数。`**`禁止のため数値リテラル）。 */
const UINT32_RANGE = 4294967296;

/** 機種の甘さ区分（新台入替で選ぶ）。 */
export type MachineTier = 'sweet' | 'middle' | 'max';

/** 既知の tier（順序固定。反復順に依存する処理はこの配列を使う）。 */
export const MACHINE_TIERS: readonly MachineTier[] = ['sweet', 'middle', 'max'];

/** 大当たり振分けの種別。 */
export type JackpotKind = 'kakuhen' | 'tsujo';

/** 既知の振分け種別（順序固定）。 */
export const JACKPOT_KINDS: readonly JackpotKind[] = ['kakuhen', 'tsujo'];

/** 保留色（`white` は重み残余として暗黙に存在）。 */
export type HoldColor = 'blue' | 'green' | 'red' | 'gold';

/** 既知の保留色（順序固定）。 */
export const HOLD_COLORS: readonly HoldColor[] = ['blue', 'green', 'red', 'gold'];

/** モード別確率（閾値はロード時に確定）。 */
export interface MachineMode {
  readonly jackpot1In: number;
  readonly thresholdU32: number;
  readonly stSpins: number;
}

/** 大当たり振分けの1枝。 */
export interface JackpotBranch {
  readonly kind: JackpotKind;
  readonly weight: number;
  readonly rounds: number;
}

/** 保留色の重み（当否別）。 */
export interface HoldColorWeight {
  readonly color: HoldColor;
  readonly wHit: number;
  readonly wMiss: number;
}

/** 機種仕様（検証済み）。 */
export interface MachineSpec {
  readonly id: string;
  readonly version: number;
  readonly tier: MachineTier;
  readonly normal: MachineMode;
  readonly st: MachineMode;
  readonly jackpotSplit: readonly JackpotBranch[];
  readonly roundCount: number;
  readonly payoutPerBall: number;
  readonly msPerRound: number;
  readonly hesoPayout: number;
  readonly holdMax: number;
  readonly medalPerJackpot: number;
  readonly medalPerKakuhen: number;
  readonly spinPatterns: string;
  readonly holdColors: readonly HoldColorWeight[];
}

/** 変動パターンの1行。 */
export interface SpinPattern {
  readonly id: string;
  readonly ms: number;
  readonly hitW: number;
  readonly missW: number;
  readonly hot: number;
  readonly climaxMs?: number | undefined;
}

/** 変動パターン表（検証済み）。 */
export type PatternTable = readonly SpinPattern[];

function fail(message: string): never {
  throw new Error('invalid machine: ' + message);
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

function asInt(value: unknown, what: string): number {
  const n = asNumber(value, what);
  if (Math.floor(n) !== n) {
    fail(what + ' must be an int');
  }
  return n;
}

function asNonNegativeInt(value: unknown, what: string): number {
  const n = asInt(value, what);
  if (n < 0) {
    fail(what + ' must be >= 0');
  }
  return n;
}

function isTier(value: string): value is MachineTier {
  for (let i = 0; i < MACHINE_TIERS.length; i = i + 1) {
    if (MACHINE_TIERS[i] === value) {
      return true;
    }
  }
  return false;
}

function isJackpotKind(value: string): value is JackpotKind {
  for (let i = 0; i < JACKPOT_KINDS.length; i = i + 1) {
    if (JACKPOT_KINDS[i] === value) {
      return true;
    }
  }
  return false;
}

function isHoldColor(value: string): value is HoldColor {
  for (let i = 0; i < HOLD_COLORS.length; i = i + 1) {
    if (HOLD_COLORS[i] === value) {
      return true;
    }
  }
  return false;
}

/** 確率表記（1/N）を uint32 閾値に変換する（`floor(2^32 / jackpot_1_in)`）。 */
export function jackpotThresholdU32(jackpot1In: number): number {
  if (typeof jackpot1In !== 'number' || !Number.isFinite(jackpot1In)) {
    throw new Error('invalid machine: jackpot_1_in must be a finite number');
  }
  if (jackpot1In <= 1) {
    throw new Error('invalid machine: jackpot_1_in must be > 1');
  }
  return (Math.floor(UINT32_RANGE / jackpot1In) >>> 0);
}

function parseMode(value: unknown, what: string): MachineMode {
  const o = asRecord(value, what);
  const jackpot1In = asNumber(o['jackpot_1_in'], what + '.jackpot_1_in');
  if (jackpot1In <= 1 || jackpot1In > 100000) {
    fail(what + '.jackpot_1_in out of range');
  }
  const stSpins = asInt(o['st_spins'], what + '.st_spins');
  if (stSpins < 0 || stSpins > 10000) {
    fail(what + '.st_spins out of range');
  }
  return { jackpot1In, thresholdU32: jackpotThresholdU32(jackpot1In), stSpins };
}

/** 機種 JSON を検証して `MachineSpec` にする。入力のキー順には依存しない。 */
export function parseMachine(json: unknown): MachineSpec {
  const o = asRecord(json, 'machine');
  const id = asString(o['id'], 'id');
  if (id.length > 64) {
    fail('id too long');
  }
  const version = asInt(o['version'], 'version');
  if (version < 1) {
    fail('version must be a positive int');
  }
  const tierRaw = asString(o['tier'], 'tier');
  if (!isTier(tierRaw)) {
    fail('tier unknown');
  }
  const modes = asRecord(o['modes'], 'modes');
  const normal = parseMode(modes['normal'], 'modes.normal');
  const st = parseMode(modes['st'], 'modes.st');

  const splitRaw = asArray(o['jackpot_split'], 'jackpot_split');
  if (splitRaw.length === 0) {
    fail('jackpot_split must not be empty');
  }
  const jackpotSplit: JackpotBranch[] = [];
  for (let i = 0; i < splitRaw.length; i = i + 1) {
    const what = 'jackpot_split[' + i + ']';
    const bo = asRecord(splitRaw[i], what);
    const kindRaw = asString(bo['kind'], what + '.kind');
    if (!isJackpotKind(kindRaw)) {
      fail(what + '.kind unknown');
    }
    const weight = asInt(bo['weight'], what + '.weight');
    if (weight < 1) {
      fail(what + '.weight must be a positive int');
    }
    const rounds = asInt(bo['rounds'], what + '.rounds');
    if (rounds < 1 || rounds > 16) {
      fail(what + '.rounds out of range');
    }
    for (let j = 0; j < jackpotSplit.length; j = j + 1) {
      if ((jackpotSplit[j] as JackpotBranch).kind === kindRaw) {
        fail(what + '.kind duplicates jackpot_split[' + j + ']');
      }
    }
    jackpotSplit.push({ kind: kindRaw, weight, rounds });
  }

  const round = asRecord(o['round'], 'round');
  const roundCount = asInt(round['count'], 'round.count');
  if (roundCount < 1 || roundCount > 16) {
    fail('round.count out of range');
  }
  const payoutPerBall = asInt(round['payout_per_ball'], 'round.payout_per_ball');
  if (payoutPerBall < 1 || payoutPerBall > 30) {
    fail('round.payout_per_ball out of range');
  }
  const msPerRound = asInt(round['ms_per_round'], 'round.ms_per_round');
  if (msPerRound <= 0 || msPerRound > 120000) {
    fail('round.ms_per_round out of range');
  }

  const hesoPayout = asInt(o['heso_payout'], 'heso_payout');
  if (hesoPayout < 0 || hesoPayout > 15) {
    fail('heso_payout out of range');
  }
  const holdMax = asInt(o['hold_max'], 'hold_max');
  if (holdMax < 1 || holdMax > 8) {
    fail('hold_max out of range');
  }

  const medal = asRecord(o['medal'], 'medal');
  const medalPerJackpot = asNonNegativeInt(medal['per_jackpot'], 'medal.per_jackpot');
  const medalPerKakuhen = asNonNegativeInt(medal['per_kakuhen'], 'medal.per_kakuhen');
  if (medalPerJackpot > 100 || medalPerKakuhen > 100) {
    fail('medal out of range');
  }

  const spinPatterns = asString(o['spin_patterns'], 'spin_patterns');
  if (spinPatterns.length > 128) {
    fail('spin_patterns too long');
  }

  const colorsRaw = asArray(o['hold_colors'], 'hold_colors');
  if (colorsRaw.length === 0) {
    fail('hold_colors must not be empty');
  }
  const holdColors: HoldColorWeight[] = [];
  for (let i = 0; i < colorsRaw.length; i = i + 1) {
    const what = 'hold_colors[' + i + ']';
    const co = asRecord(colorsRaw[i], what);
    const colorRaw = asString(co['color'], what + '.color');
    if (!isHoldColor(colorRaw)) {
      fail(what + '.color unknown');
    }
    const wHit = asNonNegativeInt(co['w_hit'], what + '.w_hit');
    const wMiss = asNonNegativeInt(co['w_miss'], what + '.w_miss');
    if (wHit + wMiss <= 0) {
      fail(what + ' needs a positive weight');
    }
    for (let j = 0; j < holdColors.length; j = j + 1) {
      if ((holdColors[j] as HoldColorWeight).color === colorRaw) {
        fail(what + '.color duplicates hold_colors[' + j + ']');
      }
    }
    holdColors.push({ color: colorRaw, wHit, wMiss });
  }

  return {
    id,
    version,
    tier: tierRaw,
    normal,
    st,
    jackpotSplit,
    roundCount,
    payoutPerBall,
    msPerRound,
    hesoPayout,
    holdMax,
    medalPerJackpot,
    medalPerKakuhen,
    spinPatterns,
    holdColors,
  };
}

/** JSON テキストを検証して `MachineSpec` にする（`JSON.parse` の SyntaxError はそのまま投げる）。 */
export function parseMachineText(text: string): MachineSpec {
  return parseMachine(JSON.parse(text) as unknown);
}

/** 変動パターン JSON を検証して `PatternTable` にする。入力のキー順には依存しない。 */
export function parsePatterns(json: unknown): PatternTable {
  const raw = asArray(json, 'patterns');
  if (raw.length === 0) {
    fail('patterns must not be empty');
  }
  const out: SpinPattern[] = [];
  for (let i = 0; i < raw.length; i = i + 1) {
    const what = 'patterns[' + i + ']';
    const po = asRecord(raw[i], what);
    const id = asString(po['id'], what + '.id');
    if (id.length > 64) {
      fail(what + '.id too long');
    }
    const ms = asInt(po['ms'], what + '.ms');
    if (ms <= 0 || ms > 300000) {
      fail(what + '.ms out of range');
    }
    const hitW = asNonNegativeInt(po['hit_w'], what + '.hit_w');
    const missW = asNonNegativeInt(po['miss_w'], what + '.miss_w');
    if (hitW + missW <= 0) {
      fail(what + ' needs a positive weight');
    }
    const hot = asInt(po['hot'], what + '.hot');
    if (hot < 0 || hot > 5) {
      fail(what + '.hot out of range');
    }
    let climaxMs: number | undefined;
    const climaxRaw: unknown = po['climax_ms'];
    if (climaxRaw !== undefined) {
      const c = asInt(climaxRaw, what + '.climax_ms');
      if (c <= 0 || c >= ms) {
        fail(what + '.climax_ms out of range');
      }
      climaxMs = c;
    }
    for (let j = 0; j < out.length; j = j + 1) {
      if ((out[j] as SpinPattern).id === id) {
        fail(what + '.id duplicates patterns[' + j + ']');
      }
    }
    if (climaxMs === undefined) {
      out.push({ id, ms, hitW, missW, hot });
    } else {
      out.push({ id, ms, hitW, missW, hot, climaxMs });
    }
  }
  return out;
}

/** JSON テキストを検証して `PatternTable` にする（`JSON.parse` の SyntaxError はそのまま投げる）。 */
export function parsePatternsText(text: string): PatternTable {
  return parsePatterns(JSON.parse(text) as unknown);
}
