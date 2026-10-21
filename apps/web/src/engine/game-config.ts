// meta（seed・機種・開始時刻）と Atlas から EngineConfig を作る。経済は Engine ごとに新しく作る。
import { sakibareOdds, type SakibareOdds } from '@ph/fx';
import { IdleEconomy, parseEconomy, parseMachine, parsePatterns, type EngineConfig, type LotteryMode } from '@ph/core';
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
const rounds = new Map<string, { count: number; payoutPerBall: number; msPerRound: number }>();

/** 機種のラウンドの中身（大当たり中の液晶の表示, D-077）。知らない機種は null。 */
export function machineRound(machineId: string): { count: number; payoutPerBall: number; msPerRound: number } | null {
  const machine = MACHINES[machineId];
  if (machine === undefined) return null;
  let r = rounds.get(machineId);
  if (!r) {
    const spec = parseMachine(machine);
    r = { count: spec.roundCount, payoutPerBall: spec.payoutPerBall, msPerRound: spec.msPerRound };
    rounds.set(machineId, r);
  }
  return r;
}

const odds = new Map<string, SakibareOdds>();
const NO_ODDS: SakibareOdds = { p: 0, hitW: [], missW: [] };

/** 機種の取得時のモードごとの先バレの材料（当選確率と保留色の重み, P13-T8b）。知らない機種・モードは p = 0（先バレしない）。 */
export function machineSakibareOdds(machineId: string, mode: LotteryMode): SakibareOdds {
  const key = machineId + '/' + mode;
  const hit = odds.get(key);
  if (hit) return hit;
  const machine = MACHINES[machineId];
  let v = NO_ODDS;
  if (machine !== undefined) {
    try {
      v = sakibareOdds(parseMachine(machine), mode);
    } catch {
      v = NO_ODDS;
    }
  }
  odds.set(key, v);
  return v;
}
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
