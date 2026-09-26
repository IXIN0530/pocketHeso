// ローカル計測ログ（P7-T1）: 起動時の追いつき・Worker の advance・IndexedDB の大きさ・受け取り回数を `metrics` store に残す。
// 端末の外には出さない（セーブの書き出しにも含めない）。書き込みの失敗はゲームを止めない。
import type { Db } from '../platform/storage.ts';

/** 起動の記録は新しい方からこの件数だけ残す。 */
export const BOOT_KEEP = 30;

/** 1回の起動（Worker の boot）。時間は performance.now() の ms。 */
export interface BootSample {
  /** 起動で追いついた時刻（UNIX ms, Engine の時刻。時計の巻き戻しで止めた時は Engine の時刻のまま）。 */
  readonly at: number;
  readonly from: 'snapshot' | 'recompute';
  /** Worker の boot 全体（DB を開く・Atlas 読み込み・復元・追いつき・保存）。 */
  readonly totalMs: number;
  /** 台帳・ActionLog・スナップショットの読み込みと復元/再計算。 */
  readonly loadMs: number;
  /** now までの advance（追いつき）。 */
  readonly catchUpMs: number;
  /** 追いついたゲーム内の時間（前回の Engine 時刻 → now）。 */
  readonly spanMs: number;
  /** Grant + Action の件数。 */
  readonly inputs: number;
  /** 起動時の IndexedDB（取れなければオリジン全体）の使用量。非対応なら null。 */
  readonly dbBytes: number | null;
}

/** 前面中・操作時の advance（起動時の追いつきは BootSample 側）。 */
export interface AdvanceStats {
  /** 集計を始めた時刻（UNIX ms）。 */
  readonly since: number;
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly lastMs: number;
}

export interface ReceiveStats {
  /** 受け取りを確定した回数。 */
  readonly count: number;
  /** 台帳に足した行の数。 */
  readonly claims: number;
  readonly lastAt: number | null;
}

export interface Metrics {
  /** 新しい順。 */
  readonly boots: readonly BootSample[];
  readonly advance: AdvanceStats;
  readonly receives: ReceiveStats;
}

export function emptyMetrics(now: number): Metrics {
  return {
    boots: [],
    advance: { since: now, count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
    receives: { count: 0, claims: 0, lastAt: null },
  };
}

export function addBoot(m: Metrics, s: BootSample): Metrics {
  return { ...m, boots: [s, ...m.boots].slice(0, BOOT_KEEP) };
}

export function addAdvance(m: Metrics, ms: number): Metrics {
  const a = m.advance;
  return { ...m, advance: { ...a, count: a.count + 1, totalMs: a.totalMs + ms, maxMs: Math.max(a.maxMs, ms), lastMs: ms } };
}

export function addReceive(m: Metrics, claims: number, at: number): Metrics {
  const r = m.receives;
  return { ...m, receives: { count: r.count + 1, claims: r.claims + claims, lastAt: at } };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** store の中身を読む（形が違う項目は空に戻す）。 */
export function parseMetrics(raw: Readonly<Record<string, unknown>>, now: number): Metrics {
  const empty = emptyMetrics(now);
  const boots = Array.isArray(raw['boots']) ? (raw['boots'] as unknown[]).filter((b): b is BootSample => isObj(b) && isNum(b['at'])) : [];
  const a = raw['advance'];
  const r = raw['receives'];
  return {
    boots: boots.slice(0, BOOT_KEEP),
    advance: isObj(a) && isNum(a['since']) && isNum(a['count']) && isNum(a['totalMs']) && isNum(a['maxMs']) && isNum(a['lastMs'])
      ? (a as unknown as AdvanceStats)
      : empty.advance,
    receives: isObj(r) && isNum(r['count']) && isNum(r['claims']) ? (r as unknown as ReceiveStats) : empty.receives,
  };
}

export async function loadMetrics(db: Db, now: number): Promise<Metrics> {
  const [keys, values] = await Promise.all([db.getAllKeys('metrics'), db.getAll('metrics')]);
  const raw: Record<string, unknown> = {};
  keys.forEach((k, i) => (raw[k] = values[i]));
  return parseMetrics(raw, now);
}

/** 指定した項目だけ書く。 */
export async function putMetrics(db: Db, m: Metrics, keys: readonly (keyof Metrics)[]): Promise<void> {
  const tx = db.transaction('metrics', 'readwrite');
  await Promise.all([...keys.map((k) => tx.store.put(m[k], k)), tx.done]);
}

export async function clearMetrics(db: Db): Promise<void> {
  await db.clear('metrics');
}
