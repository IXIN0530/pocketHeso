import {
  LOTTERY_HOLD_COLORS,
  drawHold,
  holdColorWeights,
  modeOf,
  type LotteryHoldColor,
  type LotteryMode,
  type MachineSpec,
  type PatternTable,
} from '@ph/core';
import { DEFAULT_RUN_MACHINES, loadRunMachine } from './run.ts';

const HOLDS_USAGE = 'usage: pachisim holds [--spins <n>] [--seed <s>] [--machine <id>]... [--json]';

/** 既定の回転数（金の出現が 1/250〜1/1000 でも数千回は出る）。 */
export const HOLDS_DEFAULT_SPINS = 2000000;

/** 許容幅（P7-T4）: 信頼度は理論値 ±2 ポイント、出現率（1/N の N）は ±8%。既定回転数で約3σ以上の余裕。 */
export const HOLDS_REL_TOL = 0.02;
export const HOLDS_RATE_TOL = 0.08;

/** 表ごとに測るモード（通常・時短は hold_colors、ST・LT は hold_colors_st）。 */
const HOLDS_MODES: readonly LotteryMode[] = ['normal', 'st'];

export interface HoldsArgs {
  readonly spins: number;
  readonly seed: number;
  readonly machines: readonly string[];
  readonly json: boolean;
}

export interface HoldColorStat {
  readonly color: LotteryHoldColor;
  /** 理論の信頼度（その色が出た時に当たる割合）。 */
  readonly theoryRel: number;
  /** 理論の出現率の逆数（1/N の N）。 */
  readonly theoryOneIn: number;
  readonly count: number;
  readonly hits: number;
  readonly rel: number;
  readonly oneIn: number;
  readonly ok: boolean;
}

export interface HoldModeReport {
  readonly machine: string;
  readonly mode: LotteryMode;
  readonly spins: number;
  readonly hits: number;
  readonly colors: readonly HoldColorStat[];
  /** 色付き（白以外）の出現率の逆数（実測）。 */
  readonly coloredOneIn: number;
  readonly ok: boolean;
}

function intOption(value: string | undefined, min: number): number {
  const n = Math.floor(Number(value));
  if (value === undefined || !Number.isFinite(n) || n < min) {
    throw new Error(HOLDS_USAGE);
  }
  return n;
}

/** `holds` コマンドの引数を解釈する（省略時は 200万回転・seed 1・3機種）。 */
export function parseHoldsArgs(argv: string[]): HoldsArgs {
  let spins = HOLDS_DEFAULT_SPINS;
  let seed = 1;
  const machines: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i = i + 1) {
    const a = argv[i] as string;
    if (a === '--spins') {
      spins = intOption(argv[i + 1], 1);
      i = i + 1;
    } else if (a === '--seed') {
      seed = intOption(argv[i + 1], 0);
      i = i + 1;
    } else if (a === '--machine') {
      const v = argv[i + 1];
      if (v === undefined || v.length === 0) {
        throw new Error(HOLDS_USAGE);
      }
      machines.push(v);
      i = i + 1;
    } else if (a === '--json') {
      json = true;
    } else {
      throw new Error(HOLDS_USAGE);
    }
  }
  return { spins, seed, machines: machines.length > 0 ? machines : DEFAULT_RUN_MACHINES, json };
}

function sum(ws: readonly number[]): number {
  let s = 0;
  for (const w of ws) s = s + w;
  return s;
}

/** 取得時判定を spins 回だけ引き、色ごとの出現率と信頼度を理論値と比べる。 */
export function measureHoldColors(
  machine: string,
  spec: MachineSpec,
  patterns: PatternTable,
  mode: LotteryMode,
  seed: number,
  spins: number,
): HoldModeReport {
  const p = modeOf(spec, mode).thresholdU32 / 4294967296;
  const wHit = holdColorWeights(spec, mode, true);
  const wMiss = holdColorWeights(spec, mode, false);
  const sHit = sum(wHit);
  const sMiss = sum(wMiss);
  const n = LOTTERY_HOLD_COLORS.length;
  const count = new Array<number>(n).fill(0);
  const hitCount = new Array<number>(n).fill(0);
  let hits = 0;
  for (let s = 0; s < spins; s = s + 1) {
    const e = drawHold(spec, patterns, seed, mode, s, 1);
    const ci = LOTTERY_HOLD_COLORS.indexOf(e.color);
    count[ci] = (count[ci] as number) + 1;
    if (e.isHit) {
      hits = hits + 1;
      hitCount[ci] = (hitCount[ci] as number) + 1;
    }
  }
  const colors: HoldColorStat[] = [];
  let colored = 0;
  for (let i = 0; i < n; i = i + 1) {
    const color = LOTTERY_HOLD_COLORS[i] as LotteryHoldColor;
    const h = (p * (wHit[i] as number)) / sHit;
    const m = ((1 - p) * (wMiss[i] as number)) / sMiss;
    const c = count[i] as number;
    const rel = c > 0 ? (hitCount[i] as number) / c : 0;
    const theoryRel = h + m > 0 ? h / (h + m) : 0;
    const theoryOneIn = h + m > 0 ? 1 / (h + m) : Number.POSITIVE_INFINITY;
    const oneIn = c > 0 ? spins / c : Number.POSITIVE_INFINITY;
    const ok =
      h + m === 0 ? c === 0 : c > 0 && Math.abs(rel - theoryRel) <= HOLDS_REL_TOL && Math.abs(oneIn / theoryOneIn - 1) <= HOLDS_RATE_TOL;
    if (color !== 'white') colored = colored + c;
    colors.push({ color, theoryRel, theoryOneIn, count: c, hits: hitCount[i] as number, rel, oneIn, ok });
  }
  return {
    machine,
    mode,
    spins,
    hits,
    colors,
    coloredOneIn: colored > 0 ? spins / colored : Number.POSITIVE_INFINITY,
    ok: colors.every((c) => c.ok),
  };
}

/** 機種ごとに通常時と ST 中の表を測る。 */
export function runHolds(args: HoldsArgs): HoldModeReport[] {
  const out: HoldModeReport[] = [];
  for (const id of args.machines) {
    const { spec, patterns } = loadRunMachine(id);
    for (const mode of HOLDS_MODES) {
      out.push(measureHoldColors(id, spec, patterns, mode, args.seed, args.spins));
    }
  }
  return out;
}

const pct = (x: number) => (x * 100).toFixed(1).padStart(5) + '%';
const oneIn = (x: number) => (Number.isFinite(x) ? '1/' + x.toFixed(1) : '-').padStart(9);

export function formatHolds(reports: readonly HoldModeReport[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    const table = r.mode === 'normal' ? 'hold_colors（通常・時短）' : 'hold_colors_st（ST・LT）';
    lines.push(`${r.machine} ${r.mode} ${table}: ${r.spins} 回転 当たり ${r.hits}  色付き ${oneIn(r.coloredOneIn).trim()}  ${r.ok ? 'OK' : 'NG'}`);
    lines.push('  色     信頼度(理論)      出現(理論)            回数   判定');
    for (const c of r.colors) {
      lines.push(
        `  ${c.color.padEnd(5)} ${pct(c.rel)} (${pct(c.theoryRel)})  ${oneIn(c.oneIn)} (${oneIn(c.theoryOneIn)})  ${String(c.count).padStart(8)}   ${c.ok ? 'OK' : 'NG'}`,
      );
    }
  }
  lines.push(`許容幅: 信頼度 ±${HOLDS_REL_TOL * 100}pt、出現率 ±${HOLDS_RATE_TOL * 100}%`);
  return lines.join('\n');
}
