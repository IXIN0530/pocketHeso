import { readFileSync } from 'node:fs';
import { BallSimulator, CORE_VERSION, parseBoardText, parseLaunchDirs } from '@ph/core';

/** 性能しきい値（発/秒・単スレッド）。未達は終了コード 1（Blockers に計測値を記録する）。 */
const BENCH_THRESHOLD_PER_SEC = 2000;

const BOARDS_DIR = new URL('../../../resources/boards/', import.meta.url);

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

const [command = 'help', arg] = process.argv.slice(2);
switch (command) {
  case 'version':
    console.log(`pachisim (core v${CORE_VERSION})`);
    break;
  case 'bench':
    bench(arg);
    break;
  default:
    console.log('usage: pachisim <version|bench [count]>');
}
