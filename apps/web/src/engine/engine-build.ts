// Engine の組み立て: スナップショットから復元し、だめなら seed + 台帳 + ActionLog から再計算する（spec/10）。
import type { ClaimRecord } from '@ph/claims';
import { Engine, type Action, type EngineSnapshot } from '@ph/core';
import { getSnapshot, loadActions, loadLedger, type Db, type GameMeta } from '../platform/storage.ts';
import { engineConfig } from './game-config.ts';

/** 3 = P7-T7（大当たりボーナス・Totals bonusBalls・Projection refPerSec・EngineSnapshot jackpotBonus）。 */
export const SNAPSHOT_VERSION = 3;

export type RestoredFrom = 'snapshot' | 'recompute';

/** 保存するスナップショット（meta と一致しなければ使わない）。 */
export interface SnapshotRecord {
  readonly v: number;
  readonly seed: number;
  readonly machineId: string;
  readonly createdAt: number;
  readonly savedAt: number;
  readonly engine: EngineSnapshot;
}

/** 台帳の並び（IndexedDB の receivedAt 索引と同じ: 受け取り時刻→claimId）。 */
export function ledgerOrder(a: ClaimRecord, b: ClaimRecord): number {
  return a.receivedAt - b.receivedAt || (a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0);
}

function lastFg(actions: readonly Action[]): boolean {
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i];
    if (a?.k === 'presence') {
      return a.fg;
    }
  }
  return true;
}

/** スナップショットから復元し、その後の台帳・操作を足す。使えなければ null。 */
function restoreFrom(raw: unknown, meta: GameMeta, atlas: ArrayBuffer, claims: readonly ClaimRecord[], actions: readonly Action[]): Engine | null {
  const rec = raw as Partial<SnapshotRecord> | undefined;
  if (
    rec?.v !== SNAPSHOT_VERSION ||
    rec.seed !== meta.seed ||
    rec.machineId !== meta.machineId ||
    rec.createdAt !== meta.createdAt ||
    rec.engine === undefined
  ) {
    return null;
  }
  try {
    const s = rec.engine;
    if (s.grants.length > claims.length || s.actions.length > actions.length) {
      return null;
    }
    if (s.grants.some((g, i) => g.claimId !== claims[i]?.claimId)) {
      return null;
    }
    if (s.actions.some((a, i) => a.t !== actions[i]?.t || a.k !== actions[i]?.k)) {
      return null;
    }
    const eng = Engine.restore(s, engineConfig(meta, atlas));
    claims.slice(s.grants.length).forEach((c) => eng.appendGrant(c.grant));
    actions.slice(s.actions.length).forEach((a) => eng.appendAction(a));
    return eng;
  } catch {
    return null;
  }
}

export async function buildEngine(db: Db, meta: GameMeta, atlas: ArrayBuffer): Promise<{ engine: Engine; from: RestoredFrom; fg: boolean }> {
  const [claims, actions, snap] = await Promise.all([loadLedger(db), loadActions(db), getSnapshot(db, 'latest')]);
  const fg = lastFg(actions);
  const restored = restoreFrom(snap, meta, atlas, claims, actions);
  if (restored !== null) {
    return { engine: restored, from: 'snapshot', fg };
  }
  const engine = new Engine(engineConfig(meta, atlas), claims.map((c) => c.grant), actions);
  return { engine, from: 'recompute', fg };
}
