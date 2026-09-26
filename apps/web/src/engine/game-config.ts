// meta（seed・機種・開始時刻）と Atlas から EngineConfig を作る。経済は Engine ごとに新しく作る。
import { IdleEconomy, parseEconomy, parseMachine, parsePatterns, type EngineConfig } from '@ph/core';
import economyJson from '../../../../resources/economy/default.json';
import lightMiddle from '../../../../resources/machines/light-middle-01.json';
import ltMiddle from '../../../../resources/machines/lt-middle-01.json';
import patternsJson from '../../../../resources/machines/patterns.json';
import rushMiddle from '../../../../resources/machines/rush-middle-01.json';
import type { GameMeta } from '../platform/storage.ts';

const MACHINES: Readonly<Record<string, unknown>> = {
  'light-middle-01': lightMiddle,
  'lt-middle-01': ltMiddle,
  'rush-middle-01': rushMiddle,
};

const ECONOMY = parseEconomy(economyJson);
const PATTERNS = parsePatterns(patternsJson);

export function engineConfig(meta: GameMeta, atlas: ArrayBuffer): EngineConfig {
  const machine = MACHINES[meta.machineId];
  if (machine === undefined) {
    throw new Error(`機種 ${meta.machineId} がありません`);
  }
  const economy = new IdleEconomy(ECONOMY);
  return {
    seed: meta.seed,
    spec: parseMachine(machine),
    patterns: PATTERNS,
    atlas,
    initialBalls: economy.startBalls(),
    economy,
    startMs: meta.createdAt,
  };
}
