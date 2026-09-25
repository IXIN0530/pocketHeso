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
  default:
    console.log(
      'usage: pachisim <version|bench [count]|atlas --board <id> [--jobs <n>]|run --balls <n> --seed <s> [--machine <id>]... [--json]>',
    );
}
