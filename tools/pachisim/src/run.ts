import { existsSync, readFileSync } from 'node:fs';
import {
  ATLAS_ENTRY_BYTES,
  ATLAS_ENTRY_COUNT,
  ATLAS_HEADER_BYTES,
  ATLAS_KIND_START1,
  atlasKeyForBall,
  bytesToHex,
  decodeAtlasHeader,
  defaultNextForKind,
  drawHold,
  jackpotPayoutBalls,
  parseBoardText,
  parseMachineText,
  parsePatternsText,
  type LotteryMode,
  type MachineSpec,
  type PatternTable,
} from '@ph/core';
import { boardHashHex } from './atlas.ts';

const MACHINES_DIR = new URL('../../../resources/machines/', import.meta.url);
const ATLAS_DIR = new URL('../../../resources/atlas/', import.meta.url);
const BOARDS_DIR = new URL('../../../resources/boards/', import.meta.url);
const RUN_BOARD_ID = 'default';
const RUN_USAGE = 'usage: pachisim run --balls <n> --seed <s> [--machine <id>]... [--json]';

/** 1玉あたり払い戻しの目安（spec/21「出玉」: 初期・レート1で ≈0.85）。 */
export const PAYOUT_PER_BALL_TARGET = 0.85;

function readText(url: URL): string {
  return readFileSync(url, 'utf8');
}

/** run コマンドの引数。 */
export interface RunArgs {
  readonly balls: number;
  readonly seed: number;
  readonly machines: readonly string[];
  readonly json: boolean;
}

/** 既定で比べる機種（P2-T9: light/rush/lt の3機種比較）。 */
export const DEFAULT_RUN_MACHINES: readonly string[] = ['light-middle-01', 'rush-middle-01', 'lt-middle-01'];

function asIntOption(value: string | undefined, what: string): number {
  if (value === undefined) {
    throw new Error(RUN_USAGE);
  }
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) {
    throw new Error(RUN_USAGE);
  }
  if (what === 'balls' && n < 1) {
    throw new Error(RUN_USAGE);
  }
  if (what === 'seed' && n < 0) {
    throw new Error(RUN_USAGE);
  }
  return n;
}

/** `run` コマンドの引数を解釈する（--balls/--seed 必須、--machine 省略時は light/rush 両方）。 */
export function parseRunArgs(argv: string[]): RunArgs {
  let ballsRaw: string | undefined;
  let seedRaw: string | undefined;
  const machines: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i = i + 1) {
    const a = argv[i] as string;
    if (a === '--balls') {
      ballsRaw = argv[i + 1] as string | undefined;
      i = i + 1;
    } else if (a === '--seed') {
      seedRaw = argv[i + 1] as string | undefined;
      i = i + 1;
    } else if (a === '--machine') {
      const v = argv[i + 1] as string | undefined;
      if (v === undefined || v.length === 0) {
        throw new Error(RUN_USAGE);
      }
      machines.push(v);
      i = i + 1;
    } else if (a === '--json') {
      json = true;
    } else {
      throw new Error(RUN_USAGE);
    }
  }
  const balls = asIntOption(ballsRaw, 'balls');
  const seed = asIntOption(seedRaw, 'seed');
  const ids = machines.length === 0 ? [...DEFAULT_RUN_MACHINES] : machines;
  return { balls, seed, machines: ids, json };
}

/** 機種 JSON と変動パターン表を読む。 */
export function loadRunMachine(id: string): { spec: MachineSpec; patterns: PatternTable } {
  if (id.length === 0 || id.length > 64 || id.includes('/') || id.includes('.')) {
    throw new Error('invalid run: bad machine id');
  }
  const spec = parseMachineText(readText(new URL(id + '.json', MACHINES_DIR)));
  if (spec.id !== id) {
    throw new Error('invalid run: machine id mismatch');
  }
  const patterns = parsePatternsText(readText(new URL(spec.spinPatterns, MACHINES_DIR)));
  return { spec, patterns };
}

/** Atlas の key に対応する結果コードの位置（core の Atlas 形式に従う）。 */
function atlasKindOffset(key: number): number {
  return ATLAS_HEADER_BYTES + key * ATLAS_ENTRY_BYTES;
}

/**
 * 現行の既定盤面に対応する Atlas（`default.<hash16>.bin`）を読み込む。
 * ヘッダ（マジック・版数・件数）と盤面ハッシュ全体を検証し、古い盤面の .bin では計測しない。
 */
export function loadRunAtlas(): { buffer: ArrayBuffer; hesoRate: number } {
  const board = parseBoardText(readText(new URL(RUN_BOARD_ID + '.json', BOARDS_DIR)));
  const hashHex = boardHashHex(board);
  const url = new URL(RUN_BOARD_ID + '.' + hashHex.slice(0, 16) + '.bin', ATLAS_DIR);
  if (!existsSync(url)) {
    throw new Error('invalid run: atlas for current board not found (run `pnpm sim atlas --board default` first)');
  }
  const buf = readFileSync(url);
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  const header = decodeAtlasHeader(ab);
  if (bytesToHex(header.boardHash) !== hashHex) {
    throw new Error('invalid run: atlas board hash mismatch (regenerate with `pnpm sim atlas --board default`)');
  }
  const view = new DataView(ab);
  let heso = 0;
  for (let key = 0; key < ATLAS_ENTRY_COUNT; key = key + 1) {
    if (view.getUint8(atlasKindOffset(key)) === ATLAS_KIND_START1) {
      heso = heso + 1;
    }
  }
  return { buffer: ab, hesoRate: heso / ATLAS_ENTRY_COUNT };
}

/** 理論値（モード遷移のマルコフ連鎖。normal/jitan/st/lt の `next` と各モード重みをそのまま使う。P2-T9）。 */
export interface RunTheory {
  readonly hatsuariProb: number;
  readonly hatsuari1In: number;
  /** 実質 RUSH 突入率（初当たり1回が st/lt に入る確率。jitan 経由を含む）。 */
  readonly rushEntryRate: number;
  /** 時短の継続率（jitan 突入が RUSH に繋がる確率。jitan なしは 0）。 */
  readonly jitanContinuation: number;
  readonly stContinuation: number;
  /** LT の継続率（lt 突入が RUSH に繋がる確率。lt なしは 0）。 */
  readonly ltContinuation: number;
  /** LT 到達率（初当たり1回が lt に届く確率。lt なしは 0）。 */
  readonly ltArrivalPerHatsuari: number;
  /** LT 到達率（RUSH 突入あたり。st 突入が lt に届く確率。lt なしは 0）。 */
  readonly ltArrivalPerRush: number;
  readonly avgJackpot: number;
  readonly avgPerHatsuari: number;
  readonly perNormalSpin: number;
  readonly spinsPer1000: number;
  readonly payoutPerBall: number;
}

function weightForMode(
  spec: MachineSpec,
  branchIndex: number,
  mode: LotteryMode,
): number {
  const b = spec.jackpotSplit[branchIndex];
  if (b === undefined) {
    throw new Error('invalid run: branch out of range');
  }
  if (mode === 'normal') {
    return b.weight;
  }
  if (mode === 'jitan') {
    return b.weightJitan === undefined ? b.weight : b.weightJitan;
  }
  if (mode === 'st') {
    return b.weightSt;
  }
  const ltW = b.weightLt === undefined ? b.weightSt : b.weightLt;
  return ltW;
}

function nextForBranch(spec: MachineSpec, branchIndex: number): LotteryMode {
  const b = spec.jackpotSplit[branchIndex];
  if (b === undefined) {
    throw new Error('invalid run: branch out of range');
  }
  const next = b.next === undefined ? defaultNextForKind(b.kind) : b.next;
  return next;
}

function spinsForTheoryMode(spec: MachineSpec, mode: LotteryMode): number {
  if (mode === 'normal') {
    return 0;
  }
  if (mode === 'jitan') {
    return spec.jitan === undefined ? 0 : spec.jitan.stSpins;
  }
  if (mode === 'st') {
    return spec.st.stSpins;
  }
  return spec.lt === undefined ? 0 : spec.lt.stSpins;
}

function hitRateForTheoryMode(spec: MachineSpec, mode: LotteryMode): number {
  if (mode === 'normal') {
    return 1 / spec.normal.jackpot1In;
  }
  if (mode === 'jitan') {
    return spec.jitan === undefined ? 0 : 1 / spec.jitan.jackpot1In;
  }
  if (mode === 'st') {
    return 1 / spec.st.jackpot1In;
  }
  return spec.lt === undefined ? 0 : 1 / spec.lt.jackpot1In;
}

/** 上位の枝の上乗せ回数の期待値 E[K] = Σ_{k=1..max} (1/loop_1_in)^k（upper でない枝は 0, D-120）。 */
export function expectedUpperLoops(spec: MachineSpec, branchIndex: number): number {
  const b = spec.jackpotSplit[branchIndex];
  if (b === undefined) {
    throw new Error('invalid run: branch out of range');
  }
  if (b.upper === undefined) {
    return 0;
  }
  let e = 0;
  for (let k = 1; k <= b.upper.loopMax; k = k + 1) {
    e = e + Math.pow(1 / b.upper.loop1In, k);
  }
  return e;
}

/** 枝の平均出玉（unit 1。上位は rounds + bonus_rounds + add_rounds × E[K] ラウンド分）。 */
export function expectedPayoutBalls(spec: MachineSpec, branchIndex: number): number {
  const b = spec.jackpotSplit[branchIndex];
  const add = b === undefined || b.upper === undefined ? 0 : b.upper.addRounds;
  return jackpotPayoutBalls(spec, branchIndex, 1) + add * expectedUpperLoops(spec, branchIndex) * spec.roundCount * spec.payoutPerBall;
}

/** 3x3 連立（(I - H Q) x = b）をガウス消去で解く。特異時は 0 ベクトル。 */
function solve3(a: readonly (readonly number[])[], b: readonly number[]): number[] {
  const m: number[][] = [
    [a[0]![0] as number, a[0]![1] as number, a[0]![2] as number, b[0] as number],
    [a[1]![0] as number, a[1]![1] as number, a[1]![2] as number, b[1] as number],
    [a[2]![0] as number, a[2]![1] as number, a[2]![2] as number, b[2] as number],
  ];
  for (let col = 0; col < 3; col = col + 1) {
    let pivot = col;
    let best = Math.abs(m[col]![col] as number);
    for (let row = col + 1; row < 3; row = row + 1) {
      const v = Math.abs(m[row]![col] as number);
      if (v > best) {
        best = v;
        pivot = row;
      }
    }
    if (best < 1e-12) {
      return [0, 0, 0];
    }
    if (pivot !== col) {
      const tmp = m[col] as number[];
      m[col] = m[pivot] as number[];
      m[pivot] = tmp;
    }
    const div = m[col]![col] as number;
    for (let k = col; k < 4; k = k + 1) {
      (m[col] as number[])[k] = ((m[col] as number[])[k] as number) / div;
    }
    for (let row = 0; row < 3; row = row + 1) {
      if (row === col) {
        continue;
      }
      const factor = (m[row] as number[])[col] as number;
      if (factor === 0) {
        continue;
      }
      for (let k = col; k < 4; k = k + 1) {
        (m[row] as number[])[k] = ((m[row] as number[])[k] as number) - factor * ((m[col] as number[])[k] as number);
      }
    }
  }
  return [m[0]![3] as number, m[1]![3] as number, m[2]![3] as number];
}

/** 2x2 連立を解く。特異時は [0, 0]。 */
function solve2(a11: number, a12: number, b1: number, a21: number, a22: number, b2: number): number[] {
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-12) {
    return [0, 0];
  }
  return [(b1 * a22 - b2 * a12) / det, (a11 * b2 - a21 * b1) / det];
}

export function computeTheory(spec: MachineSpec, hesoRate: number): RunTheory {
  const modes: readonly LotteryMode[] = ['normal', 'jitan', 'st', 'lt'];
  const sumW: number[] = [0, 0, 0, 0];
  const sumPay: number[] = [0, 0, 0, 0];
  // next 行列 Q[m][n]（m,n は modes 順）。normal 行も初当たりの遷移として使う。
  const q: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  for (let m = 0; m < modes.length; m = m + 1) {
    const mode = modes[m] as LotteryMode;
    if ((mode === 'jitan' && spec.jitan === undefined) || (mode === 'lt' && spec.lt === undefined)) {
      continue;
    }
    let s = 0;
    let sp = 0;
    const toNext: number[] = [0, 0, 0, 0];
    for (let i = 0; i < spec.jackpotSplit.length; i = i + 1) {
      const w = weightForMode(spec, i, mode);
      const pay = expectedPayoutBalls(spec, i);
      s = s + w;
      sp = sp + w * pay;
      const next = nextForBranch(spec, i);
      let n = 0;
      if (next === 'jitan') {
        n = 1;
      } else if (next === 'st') {
        n = 2;
      } else if (next === 'lt') {
        n = 3;
      }
      toNext[n] = (toNext[n] as number) + w;
    }
    sumW[m] = s;
    sumPay[m] = sp;
    if (s > 0) {
      for (let n = 0; n < 4; n = n + 1) {
        (q[m] as number[])[n] = ((toNext[n] as number) / s);
      }
    }
  }
  if ((sumW[0] as number) <= 0 || (sumW[2] as number) <= 0) {
    throw new Error('invalid run: split weights must be positive');
  }
  if (spec.jitan !== undefined && (sumW[1] as number) <= 0) {
    throw new Error('invalid run: split weights must be positive');
  }
  if (spec.lt !== undefined && (sumW[3] as number) <= 0) {
    throw new Error('invalid run: split weights must be positive');
  }
  const avgPay = [0, 0, 0, 0];
  for (let m = 0; m < 4; m = m + 1) {
    avgPay[m] = (sumW[m] as number) > 0 ? ((sumPay[m] as number) / (sumW[m] as number)) : 0;
  }
  const pN = 1 / spec.normal.jackpot1In;
  const hasJitan = spec.jitan !== undefined;
  const hasLt = spec.lt !== undefined;
  // 各モード突入時の当たり率 h（jitan/st/lt。なしは 0）
  const h: number[] = [0, 0, 0];
  const ps: LotteryMode[] = ['jitan', 'st', 'lt'];
  for (let k = 0; k < 3; k = k + 1) {
    const mode = ps[k] as LotteryMode;
    if ((mode === 'jitan' && !hasJitan) || (mode === 'lt' && !hasLt)) {
      h[k] = 0;
      continue;
    }
    const p = hitRateForTheoryMode(spec, mode);
    const spins = spinsForTheoryMode(spec, mode);
    h[k] = spins <= 0 ? 0 : 1 - Math.pow(1 - p, spins);
  }
  const hJ = h[0] as number;
  const hS = h[1] as number;
  const hL = h[2] as number;
  // Q の部分行列（jitan/st/lt 間。modes index 1..3 → 0..2）
  const qq: number[][] = [
    [(q[1] as number[])[1] as number, (q[1] as number[])[2] as number, (q[1] as number[])[3] as number],
    [(q[2] as number[])[1] as number, (q[2] as number[])[2] as number, (q[2] as number[])[3] as number],
    [(q[3] as number[])[1] as number, (q[3] as number[])[2] as number, (q[3] as number[])[3] as number],
  ];
  const eyeMinus = (hh: readonly number[]): number[][] => [
    [1 - (hh[0] as number) * ((qq[0] as number[])[0] as number), -(hh[0] as number) * ((qq[0] as number[])[1] as number), -(hh[0] as number) * ((qq[0] as number[])[2] as number)],
    [-(hh[1] as number) * ((qq[1] as number[])[0] as number), 1 - (hh[1] as number) * ((qq[1] as number[])[1] as number), -(hh[1] as number) * ((qq[1] as number[])[2] as number)],
    [-(hh[2] as number) * ((qq[2] as number[])[0] as number), -(hh[2] as number) * ((qq[2] as number[])[1] as number), 1 - (hh[2] as number) * ((qq[2] as number[])[2] as number)],
  ];
  const aMat = eyeMinus(h);
  // V: 突入後の期待将来出玉
  const vSol = solve3(aMat, [hJ * (avgPay[1] as number), hS * (avgPay[2] as number), hL * (avgPay[3] as number)]);
  // J: 突入後の期待将来当たり回数
  const jSol = solve3(aMat, [hJ, hS, hL]);
  // S: 突入後の期待将来回転数（突入内訳の E[visit] = h/p）
  const eVisit = [0, 0, 0];
  for (let k = 0; k < 3; k = k + 1) {
    const mode = ps[k] as LotteryMode;
    if ((mode === 'jitan' && !hasJitan) || (mode === 'lt' && !hasLt)) {
      eVisit[k] = 0;
      continue;
    }
    const p = hitRateForTheoryMode(spec, mode);
    eVisit[k] = p > 0 ? ((h[k] as number) / p) : 0;
  }
  const sSol = solve3(aMat, eVisit);
  // E: RUSH 到達（st/lt は 1 固定。jitan のみ求める）
  let eJitan = 0;
  if (hasJitan) {
    const qRush = ((qq[0] as number[])[1] as number) + ((qq[0] as number[])[2] as number);
    const denomE = 1 - hJ * ((qq[0] as number[])[0] as number);
    eJitan = denomE > 1e-12 ? (hJ * qRush) / denomE : 0;
    if (eJitan < 0) {
      eJitan = 0;
    }
    if (eJitan > 1) {
      eJitan = 1;
    }
  }
  // L: LT 到達（lt は 1 固定。jitan/st を 2x2 で解く。lt なしは 0）
  let lJitan = 0;
  let lSt = 0;
  if (hasLt) {
    const qJl = (qq[0] as number[])[2] as number;
    const qJs = (qq[0] as number[])[1] as number;
    const qJj = (qq[0] as number[])[0] as number;
    const qSl = (qq[1] as number[])[2] as number;
    const qSs = (qq[1] as number[])[1] as number;
    const qSj = (qq[1] as number[])[0] as number;
    if (hasJitan) {
      const sol = solve2(1 - hJ * qJj, -hJ * qJs, hJ * qJl, -hS * qSj, 1 - hS * qSs, hS * qSl);
      lJitan = sol[0] as number;
      lSt = sol[1] as number;
    } else {
      const denomL = 1 - hS * qSs;
      lJitan = 0;
      lSt = denomL > 1e-12 ? (hS * qSl) / denomL : 0;
    }
    if (!(lJitan >= 0 && lJitan <= 1)) {
      lJitan = lJitan < 0 ? 0 : 1;
    }
    if (!(lSt >= 0 && lSt <= 1)) {
      lSt = lSt < 0 ? 0 : 1;
    }
  }
  const qN = q[0] as number[];
  const vJ = vSol[0] as number;
  const vS = vSol[1] as number;
  const vL = vSol[2] as number;
  const jJ = jSol[0] as number;
  const jS = jSol[1] as number;
  const jL = jSol[2] as number;
  const sJ = sSol[0] as number;
  const sS = sSol[1] as number;
  const sL = sSol[2] as number;
  const totalPayout = (avgPay[0] as number) + (qN[1] as number) * vJ + (qN[2] as number) * vS + (qN[3] as number) * vL;
  const totalJackpots = 1 + (qN[1] as number) * jJ + (qN[2] as number) * jS + (qN[3] as number) * jL;
  const totalSpins = 1 / pN + (qN[1] as number) * sJ + (qN[2] as number) * sS + (qN[3] as number) * sL;
  const avgJackpot = totalJackpots > 0 ? totalPayout / totalJackpots : 0;
  const perNormalSpin = totalPayout * pN;
  const perSpinJackpot = totalSpins > 0 ? totalPayout / totalSpins : 0;
  const rushEntryRate = (qN[1] as number) * eJitan + (qN[2] as number) * 1 + (qN[3] as number) * 1;
  const ltArrivalPerHatsuari = (qN[1] as number) * lJitan + (qN[2] as number) * lSt + (qN[3] as number) * 1;
  const qJ = q[1] as number[];
  const qS = q[2] as number[];
  const qL = q[3] as number[];
  return {
    hatsuariProb: pN,
    hatsuari1In: spec.normal.jackpot1In,
    rushEntryRate,
    jitanContinuation: hasJitan ? hJ * ((qJ[2] as number) + (qJ[3] as number)) : 0,
    stContinuation: hS * ((qS[2] as number) + (qS[3] as number)),
    ltContinuation: hasLt ? hL * ((qL[2] as number) + (qL[3] as number)) : 0,
    ltArrivalPerHatsuari,
    ltArrivalPerRush: hasLt ? lSt : 0,
    avgJackpot,
    avgPerHatsuari: totalPayout,
    perNormalSpin,
    spinsPer1000: hesoRate * 1000,
    payoutPerBall: hesoRate * (perSpinJackpot + spec.hesoPayout),
  };
}

/** 観測値（玉レベルの純抽選シミュレーション。保留溢れ・変動時間は無視。P2-T9 で jitan/lt・連チャン分布を追加）。 */
export interface RunObserved {
  readonly balls: number;
  readonly spins: number;
  readonly normalSpins: number;
  readonly normalHits: number;
  readonly jitanSpins: number;
  readonly jitanHits: number;
  readonly jitanEntries: number;
  readonly jitanContinued: number;
  readonly stSpins: number;
  readonly stHits: number;
  readonly stEntries: number;
  readonly stContinued: number;
  readonly ltSpins: number;
  readonly ltHits: number;
  readonly ltEntries: number;
  readonly ltContinued: number;
  readonly jackpots: number;
  readonly jackpotPayout: number;
  readonly hesoPayout: number;
  readonly spinsPer1000: number;
  readonly hatsuariProb: number;
  readonly hatsuari1In: number;
  readonly rushEntryRate: number;
  readonly jitanContinuation: number;
  readonly stContinuation: number;
  readonly ltContinuation: number;
  readonly ltArrivalPerHatsuari: number;
  readonly ltArrivalPerRush: number;
  readonly avgJackpot: number;
  readonly avgPerHatsuari: number;
  readonly perNormalSpin: number;
  readonly payoutPerBall: number;
  readonly maxHama: number;
  /** 大当たり1回の最大出玉（unit 1）。 */
  readonly maxJackpot: number;
  /** 上位の枝が付いた機種で、上位になり得たモードの当たり数（upper の枝の重みが正のモードの当たり）。 */
  readonly upperEligibleHits: number;
  /** 上位の当たり数（D-120）。 */
  readonly upperHits: number;
  /** 上位の当たりの上乗せ回数 K の度数（index = K）。 */
  readonly upperLoopCounts: readonly number[];
  /** RUSH に届いた初当たり連チャンの数。 */
  readonly chainsReachedRush: number;
  /** LT に届いた初当たり連チャンの数。 */
  readonly chainsReachedLt: number;
  /** 初当たり連チャン出玉が 5万玉以上の数。 */
  readonly chainGe50k: number;
  /** 初当たり連チャン出玉が 10万玉以上の数。 */
  readonly chainGe100k: number;
  readonly chainGe50kRate: number;
  readonly chainGe100kRate: number;
  /** 大当たり1回ごとの出玉の二乗和（標準誤差用）。 */
  readonly jackpotPaySumSq: number;
  /** 初当たり1回（とそれに続く jitan/ST/LT 連チャン）ごとの出玉の二乗和（標準誤差用）。 */
  readonly chainPaySumSq: number;
}

/** 50k/100k のしきい値（初当たり連チャン出玉の裾。spec/21 の lt 例: 約0.75%/約0.09%）。 */
export const CHAIN_GE_50K = 50000;
export const CHAIN_GE_100K = 100000;

function spinsForObservedMode(spec: MachineSpec, mode: LotteryMode): number {
  if (mode === 'normal') {
    return 0;
  }
  if (mode === 'jitan') {
    return spec.jitan === undefined ? 0 : spec.jitan.stSpins;
  }
  if (mode === 'st') {
    return spec.st.stSpins;
  }
  return spec.lt === undefined ? 0 : spec.lt.stSpins;
}

function isRushMode(mode: LotteryMode): boolean {
  return mode === 'st' || mode === 'lt';
}

/** そのモードの当たりで上位の枝が選ばれ得るか（upper の枝の重みが正）。 */
function upperEligibleMode(spec: MachineSpec, mode: LotteryMode): boolean {
  for (let i = 0; i < spec.jackpotSplit.length; i = i + 1) {
    const b = spec.jackpotSplit[i] as (typeof spec.jackpotSplit)[number];
    if (b.upper !== undefined && weightForMode(spec, i, mode) > 0) {
      return true;
    }
  }
  return false;
}

export function simulateBalls(
  seed: number,
  spec: MachineSpec,
  patterns: PatternTable,
  atlas: ArrayBuffer,
  balls: number,
): RunObserved {
  if (Math.floor(seed) !== seed || seed < 0) {
    throw new Error('invalid run: seed must be a non-negative int');
  }
  if (Math.floor(balls) !== balls || balls < 1) {
    throw new Error('invalid run: balls must be a positive int');
  }
  decodeAtlasHeader(atlas);
  const view = new DataView(atlas);
  let mode: LotteryMode = 'normal';
  let modeLeft = 0;
  let spins = 0;
  let normalSpins = 0;
  let normalHits = 0;
  let jitanSpins = 0;
  let jitanHits = 0;
  let jitanEntries = 0;
  let jitanContinued = 0;
  let stSpins = 0;
  let stHits = 0;
  let stEntries = 0;
  let stContinued = 0;
  let ltSpins = 0;
  let ltHits = 0;
  let ltEntries = 0;
  let ltContinued = 0;
  let jackpots = 0;
  let jackpotPayout = 0;
  let curHama = 0;
  let maxHama = 0;
  let maxJackpot = 0;
  let upperEligibleHits = 0;
  let upperHits = 0;
  const upperLoopCounts: number[] = [];
  let upperLoopMax = 0;
  for (let i = 0; i < spec.jackpotSplit.length; i = i + 1) {
    const u = (spec.jackpotSplit[i] as (typeof spec.jackpotSplit)[number]).upper;
    if (u !== undefined && u.loopMax > upperLoopMax) {
      upperLoopMax = u.loopMax;
    }
  }
  const hasUpper = spec.jackpotSplit.some((b) => b.upper !== undefined);
  if (hasUpper) {
    for (let k = 0; k <= upperLoopMax; k = k + 1) {
      upperLoopCounts.push(0);
    }
  }
  let jackpotPaySumSq = 0;
  // 初当たり連チャン（通常当たり〜通常復帰まで）の追跡
  let inChain = false;
  let curChainPay = 0;
  let curReachedRush = false;
  let curReachedLt = false;
  let chainPaySumSq = 0;
  let chainsReachedRush = 0;
  let chainsReachedLt = 0;
  let chainGe50k = 0;
  let chainGe100k = 0;
  const finishChain = (): void => {
    if (!inChain) {
      return;
    }
    chainPaySumSq = chainPaySumSq + curChainPay * curChainPay;
    if (curReachedRush) {
      chainsReachedRush = chainsReachedRush + 1;
    }
    if (curReachedLt) {
      chainsReachedLt = chainsReachedLt + 1;
    }
    if (curChainPay >= CHAIN_GE_50K) {
      chainGe50k = chainGe50k + 1;
    }
    if (curChainPay >= CHAIN_GE_100K) {
      chainGe100k = chainGe100k + 1;
    }
    inChain = false;
    curChainPay = 0;
    curReachedRush = false;
    curReachedLt = false;
  };
  for (let ball = 0; ball < balls; ball = ball + 1) {
    const key = atlasKeyForBall(seed >>> 0, ball);
    if (view.getUint8(atlasKindOffset(key)) !== ATLAS_KIND_START1) {
      continue;
    }
    const entry = drawHold(spec, patterns, seed >>> 0, mode, ball, 1);
    const spinMode = mode;
    spins = spins + 1;
    if (spinMode === 'normal') {
      normalSpins = normalSpins + 1;
    } else if (spinMode === 'jitan') {
      jitanSpins = jitanSpins + 1;
    } else if (spinMode === 'st') {
      stSpins = stSpins + 1;
    } else {
      ltSpins = ltSpins + 1;
    }
    if (entry.isHit) {
      curHama = 0;
      if (entry.branchIndex === null) {
        throw new Error('invalid run: hit without branch');
      }
      const loops = entry.loops === undefined ? 0 : entry.loops;
      const pay = jackpotPayoutBalls(spec, entry.branchIndex, 1, loops);
      if (pay > maxJackpot) {
        maxJackpot = pay;
      }
      if (hasUpper && upperEligibleMode(spec, spinMode)) {
        upperEligibleHits = upperEligibleHits + 1;
      }
      if (entry.upper === true) {
        upperHits = upperHits + 1;
        upperLoopCounts[loops] = (upperLoopCounts[loops] as number) + 1;
      }
      jackpots = jackpots + 1;
      jackpotPayout = jackpotPayout + pay;
      jackpotPaySumSq = jackpotPaySumSq + pay * pay;
      const next = nextForBranch(spec, entry.branchIndex);
      const nextRush = isRushMode(next);
      const nextLt = next === 'lt';
      if (spinMode === 'normal') {
        normalHits = normalHits + 1;
        inChain = true;
        curChainPay = pay;
        curReachedRush = nextRush;
        curReachedLt = nextLt;
      } else {
        if (!inChain) {
          throw new Error('invalid run: hit outside chain');
        }
        if (spinMode === 'jitan') {
          jitanHits = jitanHits + 1;
          if (nextRush) {
            jitanContinued = jitanContinued + 1;
          }
        } else if (spinMode === 'st') {
          stHits = stHits + 1;
          if (nextRush) {
            stContinued = stContinued + 1;
          }
        } else {
          ltHits = ltHits + 1;
          if (nextRush) {
            ltContinued = ltContinued + 1;
          }
        }
        curChainPay = curChainPay + pay;
        if (nextRush) {
          curReachedRush = true;
        }
        if (nextLt) {
          curReachedLt = true;
        }
      }
      if (next === 'jitan') {
        jitanEntries = jitanEntries + 1;
        mode = 'jitan';
        modeLeft = spinsForObservedMode(spec, 'jitan');
      } else if (next === 'st') {
        stEntries = stEntries + 1;
        mode = 'st';
        modeLeft = spinsForObservedMode(spec, 'st');
      } else if (next === 'lt') {
        ltEntries = ltEntries + 1;
        mode = 'lt';
        modeLeft = spinsForObservedMode(spec, 'lt');
      } else {
        mode = 'normal';
        modeLeft = 0;
        finishChain();
      }
    } else {
      curHama = curHama + 1;
      if (curHama > maxHama) {
        maxHama = curHama;
      }
      if (spinMode !== 'normal') {
        modeLeft = modeLeft - 1;
        if (modeLeft <= 0) {
          mode = 'normal';
          modeLeft = 0;
          finishChain();
        }
      }
    }
  }
  // 末尾の未完突入は分母から除外（P2-T6 の ST と同じ扱いを jitan/st/lt に一般化）
  if (mode === 'jitan') {
    jitanEntries = jitanEntries - 1;
    if (jitanEntries < 0) {
      jitanEntries = 0;
    }
  } else if (mode === 'st') {
    stEntries = stEntries - 1;
    if (stEntries < 0) {
      stEntries = 0;
    }
  } else if (mode === 'lt') {
    ltEntries = ltEntries - 1;
    if (ltEntries < 0) {
      ltEntries = 0;
    }
  }
  // 未完連チャンは裾・到達率の集計には含めず、分散用にだけ平方を足す
  // （末尾1連チャンの有無は 1M 球では誤差1件分で無視できるが、継続率と同様に除外する）
  let tailChainPaySumSq = chainPaySumSq;
  if (inChain) {
    tailChainPaySumSq = tailChainPaySumSq + curChainPay * curChainPay;
  }
  const hesoPayout = spins * spec.hesoPayout;
  const chainsForRate = normalHits;
  return {
    balls,
    spins,
    normalSpins,
    normalHits,
    jitanSpins,
    jitanHits,
    jitanEntries,
    jitanContinued,
    stSpins,
    stHits,
    stEntries,
    stContinued,
    ltSpins,
    ltHits,
    ltEntries,
    ltContinued,
    jackpots,
    jackpotPayout,
    hesoPayout,
    spinsPer1000: balls > 0 ? (spins * 1000) / balls : 0,
    hatsuariProb: normalSpins > 0 ? normalHits / normalSpins : 0,
    hatsuari1In: normalHits > 0 ? normalSpins / normalHits : 0,
    rushEntryRate: chainsForRate > 0 ? chainsReachedRush / chainsForRate : 0,
    jitanContinuation: jitanEntries > 0 ? jitanContinued / jitanEntries : 0,
    stContinuation: stEntries > 0 ? stContinued / stEntries : 0,
    ltContinuation: ltEntries > 0 ? ltContinued / ltEntries : 0,
    ltArrivalPerHatsuari: chainsForRate > 0 ? chainsReachedLt / chainsForRate : 0,
    ltArrivalPerRush: chainsReachedRush > 0 ? chainsReachedLt / chainsReachedRush : 0,
    avgJackpot: jackpots > 0 ? jackpotPayout / jackpots : 0,
    avgPerHatsuari: normalHits > 0 ? jackpotPayout / normalHits : 0,
    perNormalSpin: normalSpins > 0 ? jackpotPayout / normalSpins : 0,
    payoutPerBall: balls > 0 ? (jackpotPayout + hesoPayout) / balls : 0,
    maxHama,
    maxJackpot,
    upperEligibleHits,
    upperHits,
    upperLoopCounts,
    chainsReachedRush,
    chainsReachedLt,
    chainGe50k,
    chainGe100k,
    chainGe50kRate: chainsForRate > 0 ? chainGe50k / chainsForRate : 0,
    chainGe100kRate: chainsForRate > 0 ? chainGe100k / chainsForRate : 0,
    jackpotPaySumSq,
    chainPaySumSq: tailChainPaySumSq,
  };
}

/** 観測値の標準誤差（標本分散と二項分布から。デルタ法で比の誤差を合成する）。 */
export interface RunStdErrors {
  readonly avgJackpot: number;
  readonly avgPerHatsuari: number;
  readonly perNormalSpin: number;
  readonly payoutPerBall: number;
}

function sampleVariance(sum: number, sumSq: number, n: number): number {
  if (n < 2) {
    return 0;
  }
  const mean = sum / n;
  const v = (sumSq - n * mean * mean) / (n - 1);
  return v > 0 ? v : 0;
}

export function observedStdErrors(o: RunObserved, hesoPayoutPerSpin: number): RunStdErrors {
  const nJ = o.jackpots;
  const nH = o.normalHits;
  const varJ = sampleVariance(o.jackpotPayout, o.jackpotPaySumSq, nJ);
  const varC = sampleVariance(o.jackpotPayout, o.chainPaySumSq, nH);
  const meanC = nH > 0 ? o.jackpotPayout / nH : 0;
  // 初当たり1回あたり出玉の相対分散（/nH 済み）
  const relVarC = nH > 0 && meanC > 0 ? varC / (meanC * meanC * nH) : 0;
  const p = o.hatsuariProb;
  const relVarP = o.normalSpins > 0 && p > 0 ? (1 - p) / (p * o.normalSpins) : 0;
  const q = o.balls > 0 ? o.spins / o.balls : 0;
  const hitPart = o.balls > 0 ? o.jackpotPayout / o.balls : 0;
  const seHitPart = nH > 0 ? hitPart * Math.sqrt(1 / nH + relVarC) : 0;
  const seHesoPart = o.balls > 0 ? hesoPayoutPerSpin * Math.sqrt((q * (1 - q)) / o.balls) : 0;
  return {
    avgJackpot: nJ > 0 ? Math.sqrt(varJ / nJ) : 0,
    avgPerHatsuari: nH > 0 ? Math.sqrt(varC / nH) : 0,
    perNormalSpin: o.perNormalSpin * Math.sqrt(relVarP + relVarC),
    payoutPerBall: Math.sqrt(seHitPart * seHitPart + seHesoPart * seHesoPart),
  };
}

/** 1機種分の理論×観測レポート。 */
export interface MachineReport {
  readonly machine: string;
  readonly seed: number;
  readonly balls: number;
  readonly hesoRate: number;
  readonly theory: RunTheory;
  readonly observed: RunObserved;
}

export function runMachines(seed: number, balls: number, ids: readonly string[]): MachineReport[] {
  const { buffer, hesoRate } = loadRunAtlas();
  const out: MachineReport[] = [];
  for (let i = 0; i < ids.length; i = i + 1) {
    const id = ids[i] as string;
    const { spec, patterns } = loadRunMachine(id);
    out.push({
      machine: id,
      seed,
      balls,
      hesoRate,
      theory: computeTheory(spec, hesoRate),
      observed: simulateBalls(seed, spec, patterns, buffer, balls),
    });
  }
  return out;
}

function fmt(n: number, digits: number): string {
  return n.toFixed(digits);
}

/** 人間向けの表（理論×観測。P2-T9: light/rush/lt の3機種比較）。 */
export function formatReports(reports: readonly MachineReport[]): string {
  const lines: string[] = [];
  for (let i = 0; i < reports.length; i = i + 1) {
    const r = reports[i] as MachineReport;
    const t = r.theory;
    const o = r.observed;
    lines.push(`machine=${r.machine} seed=${r.seed} balls=${r.balls} spins=${o.spins} hesoRate=${(r.hesoRate * 100).toFixed(2)}%`);
    lines.push('metric | theory | observed | diff');
    lines.push(
      `spins/1000balls | ${fmt(t.spinsPer1000, 2)} | ${fmt(o.spinsPer1000, 2)} | ${fmt(o.spinsPer1000 - t.spinsPer1000, 2)}`,
    );
    lines.push(
      `hatsuari 1/in | ${fmt(t.hatsuari1In, 1)} | ${o.normalHits > 0 ? fmt(o.hatsuari1In, 1) : '-'} | ${o.normalHits > 0 ? fmt((o.hatsuari1In - t.hatsuari1In) / t.hatsuari1In * 100, 2) + '%' : '-'}`,
    );
    lines.push(
      `rush entry/hatsuari | ${fmt(t.rushEntryRate * 100, 2)}% | ${o.normalHits > 0 ? fmt(o.rushEntryRate * 100, 2) + '%' : '-'} (n=${o.normalHits}) | ${o.normalHits > 0 ? fmt((o.rushEntryRate - t.rushEntryRate) * 100, 2) + 'pp' : '-'}`,
    );
    lines.push(
      `jitan continuation | ${fmt(t.jitanContinuation * 100, 2)}% | ${o.jitanEntries > 0 ? fmt(o.jitanContinuation * 100, 2) + '%' : '-'} (n=${o.jitanEntries}) | ${o.jitanEntries > 0 ? fmt((o.jitanContinuation - t.jitanContinuation) * 100, 2) + 'pp' : '-'}`,
    );
    lines.push(
      `st continuation | ${fmt(t.stContinuation * 100, 2)}% | ${o.stEntries > 0 ? fmt(o.stContinuation * 100, 2) + '%' : '-'} (n=${o.stEntries}) | ${o.stEntries > 0 ? fmt((o.stContinuation - t.stContinuation) * 100, 2) + 'pp' : '-'}`,
    );
    lines.push(
      `lt continuation | ${fmt(t.ltContinuation * 100, 2)}% | ${o.ltEntries > 0 ? fmt(o.ltContinuation * 100, 2) + '%' : '-'} (n=${o.ltEntries}) | ${o.ltEntries > 0 ? fmt((o.ltContinuation - t.ltContinuation) * 100, 2) + 'pp' : '-'}`,
    );
    lines.push(
      `lt arrival/hatsuari | ${fmt(t.ltArrivalPerHatsuari * 100, 2)}% | ${o.normalHits > 0 ? fmt(o.ltArrivalPerHatsuari * 100, 2) + '%' : '-'} (n=${o.normalHits}) | ${o.normalHits > 0 ? fmt((o.ltArrivalPerHatsuari - t.ltArrivalPerHatsuari) * 100, 2) + 'pp' : '-'}`,
    );
    lines.push(
      `lt arrival/rush | ${fmt(t.ltArrivalPerRush * 100, 2)}% | ${o.chainsReachedRush > 0 ? fmt(o.ltArrivalPerRush * 100, 2) + '%' : '-'} (n=${o.chainsReachedRush}) | ${o.chainsReachedRush > 0 ? fmt((o.ltArrivalPerRush - t.ltArrivalPerRush) * 100, 2) + 'pp' : '-'}`,
    );
    lines.push(
      `avg jackpot | ${fmt(t.avgJackpot, 1)} | ${o.jackpots > 0 ? fmt(o.avgJackpot, 1) : '-'} | ${o.jackpots > 0 && t.avgJackpot > 0 ? fmt((o.avgJackpot - t.avgJackpot) / t.avgJackpot * 100, 2) + '%' : '-'}`,
    );
    lines.push(
      `avg per hatsuari | ${fmt(t.avgPerHatsuari, 1)} | ${o.normalHits > 0 ? fmt(o.avgPerHatsuari, 1) : '-'} | ${o.normalHits > 0 && t.avgPerHatsuari > 0 ? fmt((o.avgPerHatsuari - t.avgPerHatsuari) / t.avgPerHatsuari * 100, 2) + '%' : '-'}`,
    );
    lines.push(
      `per normal spin | ${fmt(t.perNormalSpin, 2)} | ${fmt(o.perNormalSpin, 2)} | ${t.perNormalSpin > 0 ? fmt((o.perNormalSpin - t.perNormalSpin) / t.perNormalSpin * 100, 2) + '%' : '-'}`,
    );
    lines.push(
      `payout/ball | ${fmt(t.payoutPerBall, 4)} | ${fmt(o.payoutPerBall, 4)} | ${t.payoutPerBall > 0 ? fmt((o.payoutPerBall - t.payoutPerBall) / t.payoutPerBall * 100, 2) + '%' : '-'}`,
    );
    lines.push(
      `payout/ball target(spec/21) | ${fmt(PAYOUT_PER_BALL_TARGET, 4)} | - | theory ${fmt((t.payoutPerBall - PAYOUT_PER_BALL_TARGET) / PAYOUT_PER_BALL_TARGET * 100, 2)}%`,
    );
    lines.push(
      `chain >=50k/hatsuari | - | ${o.normalHits > 0 ? fmt(o.chainGe50kRate * 100, 3) + '%' : '-'} (n=${o.chainGe50k}/${o.normalHits}) | -`,
    );
    lines.push(
      `chain >=100k/hatsuari | - | ${o.normalHits > 0 ? fmt(o.chainGe100kRate * 100, 3) + '%' : '-'} (n=${o.chainGe100k}/${o.normalHits}) | -`,
    );
    lines.push(`max hama | - | ${o.maxHama} | -`);
    lines.push(`max jackpot | - | ${o.maxJackpot} | -`);
    if (o.upperLoopCounts.length > 0) {
      lines.push(
        `upper/eligible hits | - | ${o.upperEligibleHits > 0 ? fmt(o.upperHits / o.upperEligibleHits * 100, 2) + '%' : '-'} (n=${o.upperHits}/${o.upperEligibleHits}) | -`,
      );
      const dist = o.upperLoopCounts.map((c, k) => `K${k}=${c}(${o.upperHits > 0 ? fmt(c / o.upperHits * 100, 2) : '-'}%)`).join(' ');
      lines.push(`upper loops | - | ${dist} | -`);
    }
  }
  return lines.join('\n');
}
