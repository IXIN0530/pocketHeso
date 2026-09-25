import { parentPort, workerData } from 'node:worker_threads';
import {
  ATLAS_ENTRY_COUNT,
  BallSimulator,
  canonicalParamsForKey,
  parseBoard,
  parseLaunchDirs,
} from '@ph/core';

/**
 * Atlas 生成ワーカー（`atlas.ts` の `buildAtlasParallel` から起動する）。
 * 範囲内の正準条件を `run` し、kind 列と flightMs 列を返す。結合は親が行う。
 */
const data = workerData as {
  boardJson: unknown;
  dirsJson: unknown;
  startKey: unknown;
  endKey: unknown;
};
const startKey = data.startKey as number;
const endKey = data.endKey as number;
if (
  Math.floor(startKey) !== startKey ||
  Math.floor(endKey) !== endKey ||
  startKey < 0 ||
  endKey > ATLAS_ENTRY_COUNT ||
  startKey >= endKey
) {
  throw new Error('atlas worker got bad range');
}
const board = parseBoard(data.boardJson);
const dirs = parseLaunchDirs(data.dirsJson);
const sim = new BallSimulator(board, dirs);
const kinds: string[] = [];
const flightMs: number[] = [];
for (let key = startKey; key < endKey; key = key + 1) {
  const o = sim.run(canonicalParamsForKey(key));
  kinds.push(o.kind);
  flightMs.push(o.flightMs);
}
parentPort?.postMessage({ startKey, kinds, flightMs });
