import { readFileSync } from 'node:fs';
import { BallSimulator, CORE_VERSION, parseBoardText, parseLaunchDirs } from '@ph/core';
import {
  buildAtlasParallel,
  buildAtlasSingle,
  encodeAtlasStats,
  loadBoardAndDirs,
  parseAtlasArgs,
  writeAtlasFile,
} from './atlas.ts';
import { ECON_PROFILES, burstStats, formatEcon, hatsuariProdHours, lastRegular, measurePachinkoEv, parseEconArgs, runEcon } from './econ.ts';
import { formatHolds, parseHoldsArgs, runHolds } from './holds.ts';
import { formatReports, parseRunArgs, runMachines } from './run.ts';

/** 性能しきい値（発/秒・単スレッド）。未達は終了コード 1（Blockers に計測値を記録する）。 */
const BENCH_THRESHOLD_PER_SEC = 2000;

const BOARDS_DIR = new URL('../../../resources/boards/', import.meta.url);
const ATLAS_DIR = new URL('../../../resources/atlas/', import.meta.url);

function loadText(name: string): string {
  return readFileSync(new URL(name, BOARDS_DIR), 'utf8');
}

/** 既定盤面で N 発回して throughput を測る（`pnpm sim bench [count]`）。 */
function bench(countArg: string | undefined): void {
  const count = countArg === undefined ? 5000 : Math.floor(Number(countArg));
  if (!(count >= 1)) {
    console.error('usage: pachisim bench [count>=1]');
    process.exit(2);
  }
  const board = parseBoardText(loadText('default.json'));
  const dirs = parseLaunchDirs(JSON.parse(loadText('launch_dirs.json')) as unknown);
  const sim = new BallSimulator(board, dirs);
  for (let i = 0; i < 200; i = i + 1) {
    sim.run({ dirIndex: i % 1024, speedQ: (i * 37) % 65536 });
  }
  const t0 = Date.now();
  for (let i = 0; i < count; i = i + 1) {
    sim.run({ dirIndex: i % 1024, speedQ: (i * 37) % 65536 });
  }
  const sec = (Date.now() - t0) / 1000;
  const perSec = sec > 0 ? count / sec : Number.POSITIVE_INFINITY;
  console.log(`bench: ${count} shots in ${sec.toFixed(2)}s = ${Math.floor(perSec)}/s (threshold ${BENCH_THRESHOLD_PER_SEC}/s)`);
  if (perSec < BENCH_THRESHOLD_PER_SEC) {
    process.exit(1);
  }
}

/** Outcome Atlas を生成する（`pnpm sim atlas --board <id> [--jobs <n>]`）。 */
async function atlas(argv: string[]): Promise<void> {
  const { boardId, jobs } = parseAtlasArgs(argv);
  const boardJson = JSON.parse(loadText(boardId + '.json')) as unknown;
  const dirsJson = JSON.parse(loadText('launch_dirs.json')) as unknown;
  const { board, dirs } = loadBoardAndDirs(boardJson, dirsJson);
  const t0 = Date.now();
  const stats =
    jobs === 1 ? buildAtlasSingle(board, dirs) : await buildAtlasParallel(boardJson, dirsJson, jobs);
  const sec = (Date.now() - t0) / 1000;
  const { buffer, hashHex } = encodeAtlasStats(board, stats);
  const out = writeAtlasFile(ATLAS_DIR, boardId, hashHex, buffer);
  const rate = stats.heso / stats.entries.length;
  const avgMs = stats.flightSumMs / stats.entries.length;
  const inRange = rate >= 0.05 && rate <= 0.08 ? 'OK' : 'WARN outside 5-8%';
  console.log(
    `atlas: board=${boardId} hash=${hashHex.slice(0, 16)} entries=${stats.entries.length} size=${buffer.byteLength}B`,
  );
  console.log(
    `atlas: heso=${stats.heso} (${(rate * 100).toFixed(2)}% ${inRange}) out=${stats.out} lost=${stats.lost} avgFlight=${(avgMs / 1000).toFixed(2)}s jobs=${jobs} in=${sec.toFixed(1)}s`,
  );
  console.log(`atlas: wrote ${out}`);
}

/** 抽選レポート（`pnpm sim run --balls <n> --seed <s> [--machine <id>]... [--json]`）。 */
function run(argv: string[]): void {
  const args = parseRunArgs(argv);
  const reports = runMachines(args.seed, args.balls, args.machines);
  if (args.json) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }
  console.log(formatReports(reports));
}

/** 経済試算（`pnpm sim econ --profile standard|none|heavy --days <n> [--seed <s>] [--machine <id>] [--economy <path>] [--ev-hours <h>] [--play-rate <r>] [--play-min <m>] [--tree off|greedy|all] [--start-rank <n>] [--bantou on|off] [--json]`）。 */
function econ(argv: string[]): void {
  const args = parseEconArgs(argv);
  const play = { rate: args.playRate, min: args.playMin };
  const treeOpts = { tree: args.tree, startRank: args.startRank, bantou: args.bantou };
  const result = runEcon(args.profile, args.days, args.seed, args.machine, args.economy, play, treeOpts);
  const standard = ECON_PROFILES.find((p) => p.id === 'standard');
  const baseline =
    args.profile.id === 'heavy' && standard !== undefined ? runEcon(standard, args.days, args.seed, args.machine, args.economy, play, treeOpts) : null;
  const ev =
    args.evHours > 0
      ? {
          init: measurePachinkoEv(args.machine, args.seed, args.evHours, false, args.economy),
          full: measurePachinkoEv(args.machine, args.seed, args.evHours, true, args.economy, args.tree === 'all'),
        }
      : null;
  if (args.json) {
    const h1 = hatsuariProdHours(args.machine, 1, args.economy);
    const h100 = hatsuariProdHours(args.machine, 100, args.economy);
    const burst = burstStats(args.machine, args.economy);
    console.log(
      JSON.stringify(
        { ...result, ev, baselineRegular: baseline === null ? null : lastRegular(baseline), play, hatsuari: { rate1h: h1.hours, rate100h: h100.hours, avg: h1.avg }, burst },
        null,
        2,
      ),
    );
    return;
  }
  console.log(formatEcon(result, ev, baseline));
  // P8-T9 その2・その3（前面の打ち方のバランス。3機種とも確認する）。
  const h1 = hatsuariProdHours(args.machine, 1, args.economy);
  const h100 = hatsuariProdHours(args.machine, 100, args.economy);
  const okH1 = h1.hours >= 4 && h1.hours <= 8;
  const okH100 = h100.hours >= 400 && h100.hours <= 800;
  console.log(
    `play: rate1 hatsuari ${h1.hours.toFixed(2)}h (target 4-8h: ${okH1 ? 'OK' : 'NG'}) / rate100 ${h100.hours.toFixed(0)}h (target 400-800h: ${okH100 ? 'OK' : 'NG'}) (avg ${h1.avg.toFixed(0)} balls)`,
  );
  const burst = burstStats(args.machine, args.economy);
  const okBurst = burst.avgMin >= 2 && burst.avgMin <= 5;
  console.log(
    `burst: 56h holdings + rate100 until broke avg ${burst.avgMin.toFixed(2)}min (target 2-5min: ${okBurst ? 'OK' : 'NG'}) / hatsuari prob ${(burst.hatsuariProb * 100).toFixed(1)}% (100 trials seeds 1-100)`,
  );
  if (args.playMin > 0) {
    const okMin = result.minBalls > 0;
    console.log(
      `front play: rate${play.rate} x ${play.min}min/day x ${args.days}d min balls ${result.minBalls.toFixed(0)} (${okMin ? 'OK not broke' : 'NG broke'})`,
    );
  }
}

/** 保留色の実測（`pnpm sim holds [--spins <n>] [--seed <s>] [--machine <id>]... [--json]`）。許容幅を外れたら終了コード 1。 */
function holds(argv: string[]): void {
  const reports = runHolds(parseHoldsArgs(argv));
  console.log(argv.includes('--json') ? JSON.stringify(reports, null, 2) : formatHolds(reports));
  if (!reports.every((r) => r.ok)) {
    process.exit(1);
  }
}

const [command = 'help', ...rest] = process.argv.slice(2);
switch (command) {
  case 'version':
    console.log(`pachisim (core v${CORE_VERSION})`);
    break;
  case 'bench':
    bench(rest[0]);
    break;
  case 'atlas':
    await atlas(rest);
    break;
  case 'run':
    run(rest);
    break;
  case 'econ':
    econ(rest);
    break;
  case 'holds':
    holds(rest);
    break;
  default:
    console.log(
      'usage: pachisim <version|bench [count]|atlas --board <id> [--jobs <n>]|run --balls <n> --seed <s> [--machine <id>]... [--json]|econ --profile standard|none|heavy --days <n> [--seed <s>] [--machine <id>] [--economy <path>] [--ev-hours <h>] [--play-rate <r>] [--play-min <m>] [--tree off|greedy|all] [--start-rank <n>] [--bantou on|off] [--json]|holds [--spins <n>] [--seed <s>] [--machine <id>]... [--json]>',
    );
}
