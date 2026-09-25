import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import {
  ATLAS_ENTRY_COUNT,
  BallSimulator,
  canonicalBoardJson,
  canonicalParamsForKey,
  encodeAtlas,
  parseBoard,
  parseLaunchDirs,
  type AtlasEntry,
  type BallOutcome,
  type Board,
  type Vec2,
} from '@ph/core';

/** 盤面ハッシュ16進（SHA-256。正規化 JSON をハッシュする）。 */
export function boardHashHex(board: Board): string {
  return createHash('sha256').update(canonicalBoardJson(board), 'utf8').digest('hex');
}

/** Atlas 集計（ヘソ/アウト/ロスト件数と滞空合計 ms）。 */
export interface AtlasStats {
  readonly entries: AtlasEntry[];
  readonly heso: number;
  readonly out: number;
  readonly lost: number;
  readonly flightSumMs: number;
}

/** チャンクの計算結果（ワーカーと親の受け渡し形式）。 */
export interface AtlasChunk {
  readonly startKey: number;
  readonly kinds: string[];
  readonly flightMs: number[];
}

/** 範囲計算を決定的に分割する（並列度によらずキー順を保つ）。 */
export function splitRanges(total: number, jobs: number): Array<{ startKey: number; endKey: number }> {
  if (Math.floor(total) !== total || total < 1) {
    throw new Error('total must be a positive int');
  }
  if (Math.floor(jobs) !== jobs || jobs < 1 || jobs > 64) {
    throw new Error('jobs must be an int in [1, 64]');
  }
  const base = Math.floor(total / jobs);
  const rest = total - base * jobs;
  const out: Array<{ startKey: number; endKey: number }> = [];
  let at = 0;
  for (let j = 0; j < jobs; j = j + 1) {
    const size = base + (j < rest ? 1 : 0);
    out.push({ startKey: at, endKey: at + size });
    at = at + size;
  }
  return out;
}

/** 単一範囲の全件計算（単スレッドとワーカーで共有する。順序はキー順）。 */
export function computeChunkOutcomes(
  sim: BallSimulator,
  startKey: number,
  endKey: number,
): BallOutcome[] {
  if (Math.floor(startKey) !== startKey || Math.floor(endKey) !== endKey) {
    throw new Error('chunk range must be ints');
  }
  if (startKey < 0 || endKey > ATLAS_ENTRY_COUNT || startKey >= endKey) {
    throw new Error('chunk range out of bounds');
  }
  const out: BallOutcome[] = [];
  for (let key = startKey; key < endKey; key = key + 1) {
    out.push(sim.run(canonicalParamsForKey(key)));
  }
  return out;
}

function toStats(outcomes: readonly BallOutcome[]): AtlasStats {
  if (outcomes.length !== ATLAS_ENTRY_COUNT) {
    throw new Error('outcomes must have ' + ATLAS_ENTRY_COUNT + ' items');
  }
  const entries: AtlasEntry[] = [];
  let heso = 0;
  let out = 0;
  let lost = 0;
  let flightSumMs = 0;
  for (let key = 0; key < ATLAS_ENTRY_COUNT; key = key + 1) {
    const o = outcomes[key] as BallOutcome;
    if (o.kind === 'start1') {
      heso = heso + 1;
    } else if (o.kind === 'out') {
      out = out + 1;
    } else {
      lost = lost + 1;
    }
    flightSumMs = flightSumMs + o.flightMs;
    entries.push({ kind: o.kind, flightMs: o.flightMs, params: canonicalParamsForKey(key) });
  }
  return { entries, heso, out, lost, flightSumMs };
}

/** 単スレッドで全件計算する（並列結果の一致基準）。 */
export function buildAtlasSingle(board: Board, dirs: readonly Vec2[]): AtlasStats {
  const sim = new BallSimulator(board, dirs);
  return toStats(computeChunkOutcomes(sim, 0, ATLAS_ENTRY_COUNT));
}

function runChunkWorker(
  boardJson: unknown,
  dirsJson: unknown,
  startKey: number,
  endKey: number,
): Promise<AtlasChunk> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./atlas-worker.ts', import.meta.url), {
      workerData: { boardJson, dirsJson, startKey, endKey },
    });
    worker.on('message', (m: unknown) => {
      resolve(m as AtlasChunk);
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error('atlas worker exited with ' + code));
      }
    });
  });
}

/**
 * ワーカー並列で全件計算する（チャンクをキー順に結合し単スレッドと同一にする）。
 * boardJson / dirsJson はファイルから読んだ素の JSON（検証はワーカー側でも行う）。
 */
export async function buildAtlasParallel(
  boardJson: unknown,
  dirsJson: unknown,
  jobs: number,
): Promise<AtlasStats> {
  const ranges = splitRanges(ATLAS_ENTRY_COUNT, jobs);
  const chunks = await Promise.all(
    ranges.map((r) => runChunkWorker(boardJson, dirsJson, r.startKey, r.endKey)),
  );
  chunks.sort((a, b) => a.startKey - b.startKey);
  const outcomes: BallOutcome[] = [];
  for (let j = 0; j < chunks.length; j = j + 1) {
    const c = chunks[j] as AtlasChunk;
    const r = ranges[j] as { startKey: number; endKey: number };
    if (c.startKey !== r.startKey || c.kinds.length !== r.endKey - r.startKey) {
      throw new Error('atlas worker returned out-of-order chunk');
    }
    for (let i = 0; i < c.kinds.length; i = i + 1) {
      const kind = c.kinds[i] as BallOutcome['kind'];
      const flightMs = c.flightMs[i] as number;
      if (
        kind !== 'start1' &&
        kind !== 'out' &&
        kind !== 'start2' &&
        kind !== 'attacker' &&
        kind !== 'v' &&
        kind !== 'lost'
      ) {
        throw new Error('atlas worker returned unknown kind');
      }
      if (!(flightMs >= 0)) {
        throw new Error('atlas worker returned bad flightMs');
      }
      outcomes.push({ kind, flightMs, steps: 0 });
    }
  }
  return toStats(outcomes);
}

/** Atlas バイナリを検証済みの盤面・方向表から符号化する。 */
export function encodeAtlasStats(board: Board, stats: AtlasStats): {
  buffer: ArrayBuffer;
  hashHex: string;
} {
  const hashHex = boardHashHex(board);
  const hashBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i = i + 1) {
    hashBytes[i] = parseInt(hashHex.slice(i * 2, i * 2 + 2), 16);
  }
  return { buffer: encodeAtlas(hashBytes, stats.entries), hashHex };
}

/** Atlas ファイルを書き出す（`resources/atlas/<id>.<hash16>.bin`）。 */
export function writeAtlasFile(atlasDir: URL, boardId: string, hashHex: string, buffer: ArrayBuffer): URL {
  mkdirSync(atlasDir, { recursive: true });
  const out = new URL(boardId + '.' + hashHex.slice(0, 16) + '.bin', atlasDir);
  writeFileSync(out, Buffer.from(buffer));
  return out;
}

/** `atlas` コマンドの引数（`--board <id> [--jobs <n>]`）。 */
export function parseAtlasArgs(argv: string[]): { boardId: string; jobs: number } {
  let boardId = 'default';
  let jobs = 1;
  for (let i = 0; i < argv.length; i = i + 1) {
    const a = argv[i] as string;
    if (a === '--board') {
      const v = argv[i + 1] as string | undefined;
      if (v === undefined || v.length === 0) {
        throw new Error('usage: pachisim atlas --board <id> [--jobs <n>]');
      }
      boardId = v;
      i = i + 1;
    } else if (a === '--jobs') {
      const v = argv[i + 1] as string | undefined;
      if (v === undefined) {
        throw new Error('usage: pachisim atlas --board <id> [--jobs <n>]');
      }
      jobs = Math.floor(Number(v));
      if (!(jobs >= 1) || jobs > 64) {
        throw new Error('usage: pachisim atlas --board <id> [--jobs <n>]');
      }
      i = i + 1;
    } else {
      throw new Error('usage: pachisim atlas --board <id> [--jobs <n>]');
    }
  }
  if (boardId.length === 0 || boardId.length > 64) {
    throw new Error('usage: pachisim atlas --board <id> [--jobs <n>]');
  }
  return { boardId, jobs };
}

/** 素の JSON から盤面と方向表を検証して読む（CLI とテストで共有）。 */
export function loadBoardAndDirs(boardJson: unknown, dirsJson: unknown): { board: Board; dirs: readonly Vec2[] } {
  return { board: parseBoard(boardJson), dirs: parseLaunchDirs(dirsJson) };
}
