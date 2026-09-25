import { existsSync, readFileSync } from 'node:fs';
import {
  ATLAS_ENTRY_BYTES,
  ATLAS_ENTRY_COUNT,
  ATLAS_HEADER_BYTES,
  ATLAS_KIND_START1,
  atlasKeyForBall,
  bytesToHex,
  decodeAtlasHeader,
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

/** 既定で比べる機種（P2-T6: light/rush 比較）。 */
export const DEFAULT_RUN_MACHINES: readonly string[] = ['light-middle-01', 'rush-middle-01'];

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

/** 理論値（マルコフ連鎖の closed-form。kakuhen→st・tsujo→normal を仮定。P2-T6 は normal/st のみ）。 */
export interface RunTheory {
  readonly hatsuariProb: number;
  readonly hatsuari1In: number;
  readonly stContinuation: number;
  readonly avgJackpot: number;
  readonly avgPerHatsuari: number;
  readonly perNormalSpin: number;
  readonly spinsPer1000: number;
  readonly payoutPerBall: number;
}

export function computeTheory(spec: MachineSpec, hesoRate: number): RunTheory {
  const pN = 1 / spec.normal.jackpot1In;
  const pS = 1 / spec.st.jackpot1In;
  let sumWN = 0;
  let sumPayN = 0;
  let sumKakuN = 0;
  for (let i = 0; i < spec.jackpotSplit.length; i = i + 1) {
    const b = spec.jackpotSplit[i];
    if (b === undefined) {
      continue;
    }
    const pay = jackpotPayoutBalls(spec, i, 1);
    sumWN = sumWN + b.weight;
    sumPayN = sumPayN + b.weight * pay;
    if (b.kind === 'kakuhen') {
      sumKakuN = sumKakuN + b.weight;
    }
  }
  let sumWS = 0;
  let sumPayS = 0;
  let sumKakuS = 0;
  for (let i = 0; i < spec.jackpotSplit.length; i = i + 1) {
    const b = spec.jackpotSplit[i];
    if (b === undefined) {
      continue;
    }
    const pay = jackpotPayoutBalls(spec, i, 1);
    sumWS = sumWS + b.weightSt;
    sumPayS = sumPayS + b.weightSt * pay;
    if (b.kind === 'kakuhen') {
      sumKakuS = sumKakuS + b.weightSt;
    }
  }
  if (sumWN <= 0 || sumWS <= 0) {
    throw new Error('invalid run: split weights must be positive');
  }
  const avgPayN = sumPayN / sumWN;
  const avgPayS = sumPayS / sumWS;
  const cN = sumKakuN / sumWN;
  const cS = sumKakuS / sumWS;
  const missS = 1 - pS;
  const stSpins = spec.st.stSpins;
  const h1 = stSpins <= 0 ? 0 : 1 - Math.pow(missS, stSpins);
  const cont = h1 * cS;
  const denom = 1 - cont;
  const eHits = denom <= 0 ? 0 : h1 / denom;
  const ePay = denom <= 0 ? 0 : (h1 * avgPayS) / denom;
  const eSpins = denom <= 0 || pS <= 0 ? 0 : h1 / pS / denom;
  const totalPayout = avgPayN + cN * ePay;
  const totalJackpots = 1 + cN * eHits;
  const totalSpins = 1 / pN + cN * eSpins;
  const avgJackpot = totalJackpots > 0 ? totalPayout / totalJackpots : 0;
  const perNormalSpin = totalPayout * pN;
  const perSpinJackpot = totalSpins > 0 ? totalPayout / totalSpins : 0;
  return {
    hatsuariProb: pN,
    hatsuari1In: spec.normal.jackpot1In,
    stContinuation: cont,
    avgJackpot,
    avgPerHatsuari: totalPayout,
    perNormalSpin,
    spinsPer1000: hesoRate * 1000,
    payoutPerBall: hesoRate * (perSpinJackpot + spec.hesoPayout),
  };
}

/** 観測値（玉レベルの純抽選シミュレーション。保留溢れ・変動時間は無視）。 */
export interface RunObserved {
  readonly balls: number;
  readonly spins: number;
  readonly normalSpins: number;
  readonly normalHits: number;
  readonly stSpins: number;
  readonly stHits: number;
  readonly stEntries: number;
  readonly stContinued: number;
  readonly jackpots: number;
  readonly jackpotPayout: number;
  readonly hesoPayout: number;
  readonly spinsPer1000: number;
  readonly hatsuariProb: number;
  readonly hatsuari1In: number;
  readonly stContinuation: number;
  readonly avgJackpot: number;
  readonly avgPerHatsuari: number;
  readonly perNormalSpin: number;
  readonly payoutPerBall: number;
  readonly maxHama: number;
  /** 大当たり1回ごとの出玉の二乗和（標準誤差用）。 */
  readonly jackpotPaySumSq: number;
  /** 初当たり1回（とそれに続く ST 連チャン）ごとの出玉の二乗和（標準誤差用）。 */
  readonly chainPaySumSq: number;
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
  let stLeft = 0;
  let spins = 0;
  let normalSpins = 0;
  let normalHits = 0;
  let stSpins = 0;
  let stHits = 0;
  let stEntries = 0;
  let stContinued = 0;
  let jackpots = 0;
  let jackpotPayout = 0;
  let curHama = 0;
  let maxHama = 0;
  let jackpotPaySumSq = 0;
  let chainPay = 0;
  let chainPaySumSq = 0;
  for (let ball = 0; ball < balls; ball = ball + 1) {
    const key = atlasKeyForBall(seed >>> 0, ball);
    if (view.getUint8(atlasKindOffset(key)) !== ATLAS_KIND_START1) {
      continue;
    }
    const entry = drawHold(spec, patterns, seed >>> 0, mode, ball, 1);
    const isStSpin = mode === 'st';
    spins = spins + 1;
    if (isStSpin) {
      stSpins = stSpins + 1;
    } else {
      normalSpins = normalSpins + 1;
    }
    if (entry.isHit) {
      curHama = 0;
      if (entry.branchIndex === null) {
        throw new Error('invalid run: hit without branch');
      }
      const pay = jackpotPayoutBalls(spec, entry.branchIndex, 1);
      jackpots = jackpots + 1;
      jackpotPayout = jackpotPayout + pay;
      jackpotPaySumSq = jackpotPaySumSq + pay * pay;
      if (!isStSpin) {
        chainPaySumSq = chainPaySumSq + chainPay * chainPay;
        chainPay = 0;
      }
      chainPay = chainPay + pay;
      const branch = spec.jackpotSplit[entry.branchIndex];
      if (branch === undefined) {
        throw new Error('invalid run: branch out of range');
      }
      const toSt = branch.kind === 'kakuhen';
      if (isStSpin) {
        stHits = stHits + 1;
        if (toSt) {
          stContinued = stContinued + 1;
          stEntries = stEntries + 1;
          mode = 'st';
          stLeft = spec.st.stSpins;
        } else {
          mode = 'normal';
          stLeft = 0;
        }
      } else {
        normalHits = normalHits + 1;
        if (toSt) {
          stEntries = stEntries + 1;
          mode = 'st';
          stLeft = spec.st.stSpins;
        }
      }
    } else {
      curHama = curHama + 1;
      if (curHama > maxHama) {
        maxHama = curHama;
      }
      if (isStSpin) {
        stLeft = stLeft - 1;
        if (stLeft <= 0) {
          mode = 'normal';
          stLeft = 0;
        }
      }
    }
  }
  if (mode === 'st') {
    stEntries = stEntries - 1;
    if (stEntries < 0) {
      stEntries = 0;
    }
  }
  chainPaySumSq = chainPaySumSq + chainPay * chainPay;
  const hesoPayout = spins * spec.hesoPayout;
  return {
    balls,
    spins,
    normalSpins,
    normalHits,
    stSpins,
    stHits,
    stEntries,
    stContinued,
    jackpots,
    jackpotPayout,
    hesoPayout,
    spinsPer1000: balls > 0 ? (spins * 1000) / balls : 0,
    hatsuariProb: normalSpins > 0 ? normalHits / normalSpins : 0,
    hatsuari1In: normalHits > 0 ? normalSpins / normalHits : 0,
    stContinuation: stEntries > 0 ? stContinued / stEntries : 0,
    avgJackpot: jackpots > 0 ? jackpotPayout / jackpots : 0,
    avgPerHatsuari: normalHits > 0 ? jackpotPayout / normalHits : 0,
    perNormalSpin: normalSpins > 0 ? jackpotPayout / normalSpins : 0,
    payoutPerBall: balls > 0 ? (jackpotPayout + hesoPayout) / balls : 0,
    maxHama,
    jackpotPaySumSq,
    chainPaySumSq,
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

/** 人間向けの表（理論×観測）。 */
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
      `st continuation | ${fmt(t.stContinuation * 100, 2)}% | ${o.stEntries > 0 ? fmt(o.stContinuation * 100, 2) + '%' : '-'} (n=${o.stEntries}) | ${o.stEntries > 0 ? fmt((o.stContinuation - t.stContinuation) * 100, 2) + 'pp' : '-'}`,
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
    lines.push(`max hama | - | ${o.maxHama} | -`);
  }
  return lines.join('\n');
}
