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

/** 白以外の保留色（熱さ順）。 */
export type HoldColor = 'blue' | 'green' | 'red' | 'gold';

/** 既知の白以外の保留色（順序固定）。 */
export const HOLD_COLORS: readonly HoldColor[] = ['blue', 'green', 'red', 'gold'];

/** 保留色の表に書く色（白も重みを JSON に書く, P7-T4）。 */
export type HoldTableColor = HoldColor | 'white';

/** 保留色の表に必須の色（順序固定）。 */
export const HOLD_TABLE_COLORS: readonly HoldTableColor[] = ['blue', 'green', 'red', 'gold', 'white'];

/** 抽選モード（通常・時短・ST(RUSH)・LT。spec/21 モード拡張節）。 */
export type LotteryModeId = 'normal' | 'jitan' | 'st' | 'lt';

/** 既知の抽選モード（順序固定）。 */
export const LOTTERY_MODE_IDS: readonly LotteryModeId[] = ['normal', 'jitan', 'st', 'lt'];

/** 大当たり終了後の遷移先モード。 */
export type JackpotNext = LotteryModeId;

/** 既知の遷移先（順序固定）。 */
export const JACKPOT_NEXTS: readonly JackpotNext[] = ['normal', 'jitan', 'st', 'lt'];

/** モード別確率（閾値はロード時に確定。`stSpins` は残り回転数で `spins` 別名も読む）。 */
export interface MachineMode {
  readonly jackpot1In: number;
  readonly thresholdU32: number;
  readonly stSpins: number;
}

/** 大当たり振分けの1枝（weightは通常時・各モード重み。省略時は既定値。0なら当該モードで出ない。next省略時はkakuhen→st・tsujo→normal。bonusRounds省略時は0）。 */
export interface JackpotBranch {
  readonly kind: JackpotKind;
  readonly weight: number;
  readonly weightSt: number;
  readonly weightJitan?: number | undefined;
  readonly weightLt?: number | undefined;
  readonly rounds: number;
  readonly bonusRounds?: number | undefined;
  readonly next?: JackpotNext | undefined;
}

/** 保留色の重み（当否別）。 */
export interface HoldColorWeight {
  readonly color: HoldTableColor;
  readonly wHit: number;
  readonly wMiss: number;
}

/** 機種仕様（検証済み。`jitan`・`lt` は省略可で省略した機種では出ない）。 */
export interface MachineSpec {
  readonly id: string;
  readonly version: number;
  readonly tier: MachineTier;
  readonly normal: MachineMode;
  readonly jitan?: MachineMode | undefined;
  readonly st: MachineMode;
  readonly lt?: MachineMode | undefined;
  readonly jackpotSplit: readonly JackpotBranch[];
  readonly roundCount: number;
  readonly payoutPerBall: number;
  readonly msPerRound: number;
  readonly hesoPayout: number;
  readonly holdMax: number;
  readonly spinPatterns: string;
  /** 通常・時短の保留色の表。 */
  readonly holdColors: readonly HoldColorWeight[];
  /** ST・LT の保留色の表（`hold_colors_st`。省略時は `holdColors`）。 */
  readonly holdColorsSt: readonly HoldColorWeight[];
  /** 保留の最終色が白以外の変動の最短時間（`spin_min_colored_ms`。短縮の後に適用。省略・0 は無し, P13-T5）。 */
  readonly spinMinColoredMs?: number | undefined;
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

function isHoldTableColor(value: string): value is HoldTableColor {
  for (let i = 0; i < HOLD_TABLE_COLORS.length; i = i + 1) {
    if (HOLD_TABLE_COLORS[i] === value) {
      return true;
    }
  }
  return false;
}

/** 保留色の表を読む（5色すべて必須・重複不可。当否それぞれの合計は正, P7-T4）。 */
function parseHoldColors(raw: unknown, name: string): HoldColorWeight[] {
  const colorsRaw = asArray(raw, name);
  const rows: HoldColorWeight[] = [];
  let sumHit = 0;
  let sumMiss = 0;
  for (let i = 0; i < colorsRaw.length; i = i + 1) {
    const what = name + '[' + i + ']';
    const co = asRecord(colorsRaw[i], what);
    const colorRaw = asString(co['color'], what + '.color');
    if (!isHoldTableColor(colorRaw)) {
      fail(what + '.color unknown');
    }
    const wHit = asNonNegativeInt(co['w_hit'], what + '.w_hit');
    const wMiss = asNonNegativeInt(co['w_miss'], what + '.w_miss');
    for (let j = 0; j < rows.length; j = j + 1) {
      if ((rows[j] as HoldColorWeight).color === colorRaw) {
        fail(what + '.color duplicates ' + name + '[' + j + ']');
      }
    }
    rows.push({ color: colorRaw, wHit, wMiss });
    sumHit = sumHit + wHit;
    sumMiss = sumMiss + wMiss;
  }
  if (rows.length !== HOLD_TABLE_COLORS.length) {
    fail(name + ' must list white, blue, green, red and gold');
  }
  if (sumHit <= 0 || sumMiss <= 0) {
    fail(name + ' needs positive w_hit and w_miss totals');
  }
  return rows;
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

function isJackpotNext(value: string): value is JackpotNext {
  for (let i = 0; i < JACKPOT_NEXTS.length; i = i + 1) {
    if (JACKPOT_NEXTS[i] === value) {
      return true;
    }
  }
  return false;
}

/** 省略時の遷移先（kakuhen→st・tsujo→normal。今の機種と同じ動き）。 */
export function defaultNextForKind(kind: JackpotKind): JackpotNext {
  return kind === 'kakuhen' ? 'st' : 'normal';
}

function parseMode(value: unknown, what: string): MachineMode {
  const o = asRecord(value, what);
  const jackpot1In = asNumber(o['jackpot_1_in'], what + '.jackpot_1_in');
  if (jackpot1In <= 1 || jackpot1In > 100000) {
    fail(what + '.jackpot_1_in out of range');
  }
  const spinsRaw: unknown = o['spins'];
  const stSpinsRaw: unknown = o['st_spins'];
  let stSpins: number;
  if (spinsRaw !== undefined && stSpinsRaw !== undefined) {
    const a = asInt(spinsRaw, what + '.spins');
    const b = asInt(stSpinsRaw, what + '.st_spins');
    if (a !== b) {
      fail(what + '.spins and st_spins differ');
    }
    stSpins = a;
  } else if (spinsRaw !== undefined) {
    stSpins = asInt(spinsRaw, what + '.spins');
  } else {
    stSpins = asInt(stSpinsRaw, what + '.st_spins');
  }
  if (stSpins < 0 || stSpins > 10000) {
    fail(what + '.spins out of range');
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
  let jitan: MachineMode | undefined;
  let lt: MachineMode | undefined;
  if (modes['jitan'] !== undefined) {
    jitan = parseMode(modes['jitan'], 'modes.jitan');
  }
  if (modes['lt'] !== undefined) {
    lt = parseMode(modes['lt'], 'modes.lt');
  }

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
    const weight = asNonNegativeInt(bo['weight'], what + '.weight');
    const weightStRaw: unknown = bo['weight_st'];
    const weightJitanRaw: unknown = bo['weight_jitan'];
    const weightLtRaw: unknown = bo['weight_lt'];
    const weightSt = weightStRaw === undefined ? weight : asNonNegativeInt(weightStRaw, what + '.weight_st');
    let weightJitan: number | undefined;
    let weightLt: number | undefined;
    if (weightJitanRaw !== undefined) {
      weightJitan = asNonNegativeInt(weightJitanRaw, what + '.weight_jitan');
    }
    if (weightLtRaw !== undefined) {
      weightLt = asNonNegativeInt(weightLtRaw, what + '.weight_lt');
    }
    const effJitan = weightJitan === undefined ? weight : weightJitan;
    const effLt = weightLt === undefined ? weightSt : weightLt;
    if (weight > 1000000 || weightSt > 1000000 || effJitan > 1000000 || effLt > 1000000) {
      fail(what + '.weight out of range');
    }
    const rounds = asInt(bo['rounds'], what + '.rounds');
    if (rounds < 1 || rounds > 16) {
      fail(what + '.rounds out of range');
    }
    let bonusRounds = 0;
    const bonusRaw: unknown = bo['bonus_rounds'];
    if (bonusRaw !== undefined) {
      bonusRounds = asNonNegativeInt(bonusRaw, what + '.bonus_rounds');
      if (bonusRounds > 60) {
        fail(what + '.bonus_rounds out of range');
      }
    }
    const totalRounds = rounds + bonusRounds;
    if (totalRounds < 1 || totalRounds > 60) {
      fail(what + '.rounds + bonus_rounds out of range (must be 1..60)');
    }
    let next: JackpotNext | undefined;
    if (bo['next'] !== undefined) {
      const nextRaw = asString(bo['next'], what + '.next');
      if (!isJackpotNext(nextRaw)) {
        fail(what + '.next unknown');
      }
      next = nextRaw;
    }
    const normNext: JackpotNext = next === undefined ? defaultNextForKind(kindRaw) : next;
    for (let j = 0; j < jackpotSplit.length; j = j + 1) {
      const prev = jackpotSplit[j] as JackpotBranch;
      const prevNext: JackpotNext = prev.next === undefined ? defaultNextForKind(prev.kind) : prev.next;
      const prevBonus = prev.bonusRounds === undefined ? 0 : prev.bonusRounds;
      if (prev.kind === kindRaw && prev.rounds === rounds && prevBonus === bonusRounds && prevNext === normNext) {
        fail(what + ' duplicates jackpot_split[' + j + '] (same kind, rounds, bonus_rounds and next)');
      }
    }
    if (weightStRaw === undefined && weightJitan === undefined && weightLt === undefined && next === undefined) {
      jackpotSplit.push({ kind: kindRaw, weight, weightSt, rounds });
    } else if (weightStRaw === undefined) {
      // weight_st 省略時は weight と同値だが、既存の完全一致を保つため weightSt は必ず保持する
      const base = { kind: kindRaw, weight, weightSt, rounds };
      if (weightJitan !== undefined && weightLt !== undefined && next !== undefined) {
        jackpotSplit.push({ ...base, weightJitan, weightLt, next });
      } else if (weightJitan !== undefined && weightLt !== undefined) {
        jackpotSplit.push({ ...base, weightJitan, weightLt });
      } else if (weightJitan !== undefined && next !== undefined) {
        jackpotSplit.push({ ...base, weightJitan, next });
      } else if (weightLt !== undefined && next !== undefined) {
        jackpotSplit.push({ ...base, weightLt, next });
      } else if (weightJitan !== undefined) {
        jackpotSplit.push({ ...base, weightJitan });
      } else if (weightLt !== undefined) {
        jackpotSplit.push({ ...base, weightLt });
      } else {
        jackpotSplit.push({ ...base, next: next as JackpotNext });
      }
    } else if (weightJitan === undefined && weightLt === undefined && next === undefined) {
      jackpotSplit.push({ kind: kindRaw, weight, weightSt, rounds });
    } else {
      const base = { kind: kindRaw, weight, weightSt, rounds };
      if (weightJitan !== undefined && weightLt !== undefined && next !== undefined) {
        jackpotSplit.push({ ...base, weightJitan, weightLt, next });
      } else if (weightJitan !== undefined && weightLt !== undefined) {
        jackpotSplit.push({ ...base, weightJitan, weightLt });
      } else if (weightJitan !== undefined && next !== undefined) {
        jackpotSplit.push({ ...base, weightJitan, next });
      } else if (weightLt !== undefined && next !== undefined) {
        jackpotSplit.push({ ...base, weightLt, next });
      } else if (weightJitan !== undefined) {
        jackpotSplit.push({ ...base, weightJitan });
      } else if (weightLt !== undefined) {
        jackpotSplit.push({ ...base, weightLt });
      } else {
        jackpotSplit.push({ ...base, next: next as JackpotNext });
      }
    }
    if (bonusRounds > 0) {
      const last = jackpotSplit[jackpotSplit.length - 1] as JackpotBranch;
      jackpotSplit[jackpotSplit.length - 1] = { ...last, bonusRounds };
    }
  }
  let sumNormal = 0;
  let sumSt = 0;
  let sumJitan = 0;
  let sumLt = 0;
  for (let i = 0; i < jackpotSplit.length; i = i + 1) {
    const b = jackpotSplit[i] as JackpotBranch;
    const effJ = b.weightJitan === undefined ? b.weight : b.weightJitan;
    const effL = b.weightLt === undefined ? b.weightSt : b.weightLt;
    sumNormal = sumNormal + b.weight;
    sumSt = sumSt + b.weightSt;
    sumJitan = sumJitan + effJ;
    sumLt = sumLt + effL;
  }
  if (sumNormal <= 0 || sumSt <= 0) {
    fail('jackpot_split needs a positive total weight in each mode');
  }
  if (jitan !== undefined && sumJitan <= 0) {
    fail('jackpot_split needs a positive total weight_jitan');
  }
  if (lt !== undefined && sumLt <= 0) {
    fail('jackpot_split needs a positive total weight_lt');
  }
  for (let i = 0; i < jackpotSplit.length; i = i + 1) {
    const b = jackpotSplit[i] as JackpotBranch;
    const dst: JackpotNext = b.next === undefined ? defaultNextForKind(b.kind) : b.next;
    if (dst === 'jitan' && jitan === undefined) {
      fail('jackpot_split[' + i + '].next jitan needs modes.jitan');
    }
    if (dst === 'lt' && lt === undefined) {
      fail('jackpot_split[' + i + '].next lt needs modes.lt');
    }
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

  const spinPatterns = asString(o['spin_patterns'], 'spin_patterns');
  if (spinPatterns.length > 128) {
    fail('spin_patterns too long');
  }

  const holdColors = parseHoldColors(o['hold_colors'], 'hold_colors');
  const holdColorsSt = o['hold_colors_st'] === undefined ? holdColors : parseHoldColors(o['hold_colors_st'], 'hold_colors_st');
  const spinMinColoredMs = o['spin_min_colored_ms'] === undefined ? 0 : asInt(o['spin_min_colored_ms'], 'spin_min_colored_ms');
  if (spinMinColoredMs < 0 || spinMinColoredMs > 120000) {
    fail('spin_min_colored_ms out of range');
  }

  if (jitan === undefined && lt === undefined) {
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
      spinPatterns,
      holdColors,
      holdColorsSt,
      spinMinColoredMs,
    };
  }
  if (jitan !== undefined && lt === undefined) {
    return {
      id,
      version,
      tier: tierRaw,
      normal,
      jitan,
      st,
      jackpotSplit,
      roundCount,
      payoutPerBall,
      msPerRound,
      hesoPayout,
      holdMax,
      spinPatterns,
      holdColors,
      holdColorsSt,
      spinMinColoredMs,
    };
  }
  if (jitan === undefined && lt !== undefined) {
    return {
      id,
      version,
      tier: tierRaw,
      normal,
      st,
      lt,
      jackpotSplit,
      roundCount,
      payoutPerBall,
      msPerRound,
      hesoPayout,
      holdMax,
      spinPatterns,
      holdColors,
      holdColorsSt,
      spinMinColoredMs,
    };
  }
  return {
    id,
    version,
    tier: tierRaw,
    normal,
    jitan: jitan as MachineMode,
    st,
    lt: lt as MachineMode,
    jackpotSplit,
    roundCount,
    payoutPerBall,
    msPerRound,
    hesoPayout,
    holdMax,
    spinPatterns,
    holdColors,
    holdColorsSt,
    spinMinColoredMs,
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
