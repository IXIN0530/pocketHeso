// IndexedDB `pocketheso`（spec/10 の保存）。台帳は追記のみ・キー = claimId。YOLP の結果は保存しない（spec/32）。
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CheckinSession, ClaimRecord, OwnPlace } from '@ph/claims';
import type { Action } from '@ph/core';

export const DB_NAME = 'pocketheso';
export const DB_VERSION = 1;
/** 保存データのスキーマ版数（meta に書く）。1 = P4（台帳のみ）、2 = P5（seed・開始時刻・機種つき）。 */
export const SAVE_SCHEMA = 2;
/** 既定機種（人間の決定待ち。新規セーブにだけ使い、既存セーブは meta の機種を使い続ける）。 */
export const DEFAULT_MACHINE_ID = 'light-middle-01';

/** 保存するチェックインのセッション（YOLP は Gid だけ。yolpCalls はこのセッションで YOLP に問い合わせた回数）。 */
export interface StoredSession {
  readonly session: CheckinSession;
  readonly yolpCalls: number;
}

/** 設定（settings store に1項目1行で置く）。 */
export interface Settings {
  /** ショートカット連携のペアリング鍵（spec/31）。 */
  readonly pairingKey?: string | undefined;
  /** 進行中のチェックイン（同時に1つ）。 */
  readonly session?: StoredSession | undefined;
  /** 位置情報と YOLP 問い合わせの説明を読んだ（spec/32 のプライバシー）。 */
  readonly locationNoticeAck?: boolean | undefined;
  /** 最後にセーブを書き出した時刻（spec/41 の週1回の案内）。 */
  readonly lastExportAt?: number | undefined;
}

/** ゲームの起点（Engine の真実 = seed + 機種 + 台帳 + ActionLog, spec/10）。 */
export interface GameMeta {
  readonly schema: number;
  readonly seed: number;
  /** Engine の開始時刻（UNIX ms）。台帳・ActionLog はすべてこれ以降。 */
  readonly createdAt: number;
  readonly machineId: string;
}

interface Schema extends DBSchema {
  meta: { key: string; value: unknown };
  claims: { key: string; value: ClaimRecord; indexes: { receivedAt: number } };
  actions: { key: number; value: Action };
  snapshot: { key: string; value: unknown };
  places: { key: string; value: OwnPlace };
  settings: { key: string; value: unknown };
}

export type Db = IDBPDatabase<Schema>;

/**
 * DB を開く（store の構成は DB_VERSION で段階的に作る）。UI と Engine Worker が別々に開くので、
 * 版上げを妨げないよう古い接続は閉じる。meta の版数移行は ensureGameMeta。
 */
export async function openStorage(name: string = DB_NAME): Promise<Db> {
  return openDB<Schema>(name, DB_VERSION, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('meta');
        d.createObjectStore('claims', { keyPath: 'claimId' }).createIndex('receivedAt', 'receivedAt');
        d.createObjectStore('actions', { autoIncrement: true });
        d.createObjectStore('snapshot');
        d.createObjectStore('places', { keyPath: 'placeId' });
        d.createObjectStore('settings');
      }
    },
    blocking(_cur, _next, event) {
      (event.target as IDBDatabase).close();
    },
  });
}

/**
 * meta を最新の版数にする（純関数。old は meta store の中身）。
 * 版1（P4: 台帳のみ）→ 版2: seed と開始時刻を足す。開始時刻は既存の台帳より後にならないよう最古の受け取り時刻に揃える。
 */
export function migrateMeta(
  old: Readonly<Record<string, unknown>>,
  firstClaimAt: number | undefined,
  now: number,
  newSeed: number,
): GameMeta {
  const schema = typeof old['schema'] === 'number' ? old['schema'] : 1;
  if (schema > SAVE_SCHEMA) {
    throw new Error(`このセーブは新しい版（${schema}）です。アプリを更新してください`);
  }
  const seed = old['seed'];
  const createdAt = old['createdAt'];
  const machineId = old['machineId'];
  if (schema >= 2 && typeof seed === 'number' && typeof createdAt === 'number' && typeof machineId === 'string') {
    return { schema, seed, createdAt, machineId };
  }
  return {
    schema: SAVE_SCHEMA,
    seed: newSeed >>> 0,
    createdAt: firstClaimAt === undefined ? now : Math.min(firstClaimAt, now),
    machineId: DEFAULT_MACHINE_ID,
  };
}

export async function loadMetaRecord(db: Db): Promise<Record<string, unknown>> {
  const [keys, values] = await Promise.all([db.getAllKeys('meta'), db.getAll('meta')]);
  const out: Record<string, unknown> = {};
  keys.forEach((k, i) => (out[k] = values[i]));
  return out;
}

/** meta store に書く行（キー, 値）。 */
export function metaEntries(meta: GameMeta): [string, unknown][] {
  return [
    ['schema', meta.schema],
    ['seed', meta.seed],
    ['createdAt', meta.createdAt],
    ['machineId', meta.machineId],
  ];
}

/** ゲームの meta を読み、古い版・新規なら移行して書く。 */
export async function ensureGameMeta(db: Db, now: number, newSeed: number): Promise<GameMeta> {
  const old = await loadMetaRecord(db);
  const first = (await db.transaction('claims').store.index('receivedAt').openCursor())?.value.receivedAt;
  const meta = migrateMeta(old, first, now, newSeed);
  const entries = metaEntries(meta);
  if (entries.some(([k, v]) => old[k] !== v)) {
    const tx = db.transaction('meta', 'readwrite');
    await Promise.all([...entries.map(([k, v]) => tx.store.put(v, k)), tx.done]);
  }
  return meta;
}

/** ActionLog の全件（追記順 = 時刻昇順）。 */
export function loadActions(db: Db): Promise<Action[]> {
  return db.getAll('actions');
}

export async function appendAction(db: Db, a: Action): Promise<void> {
  await db.add('actions', a);
}

/** スナップショット（キー: latest と day:YYYY-MM-DD）。中身は壊れていてもよいので unknown で読む。 */
export function getSnapshot(db: Db, key: string): Promise<unknown> {
  return db.get('snapshot', key);
}

/** スナップショットを書き、日毎の分は新しい順に keepDays 件だけ残す。 */
export async function putSnapshot(db: Db, key: string, value: unknown, keepDays = 7): Promise<void> {
  const tx = db.transaction('snapshot', 'readwrite');
  await tx.store.put(value, key);
  const days = (await tx.store.getAllKeys()).filter((k) => k.startsWith('day:')).sort();
  await Promise.all([...days.slice(0, Math.max(0, days.length - keepDays)).map((k) => tx.store.delete(k)), tx.done]);
}

/** 台帳の全行（受け取り時刻順）。 */
export function loadLedger(db: Db): Promise<ClaimRecord[]> {
  return db.getAllFromIndex('claims', 'receivedAt');
}

/** 台帳に追記する。同じ claimId が既にあれば全体を取り消して失敗する（追記のみ）。 */
export async function appendClaims(db: Db, records: readonly ClaimRecord[]): Promise<void> {
  const tx = db.transaction('claims', 'readwrite');
  await Promise.all([...records.map((r) => tx.store.add(r)), tx.done]);
}

export function loadPlaces(db: Db): Promise<OwnPlace[]> {
  return db.getAll('places');
}

export async function putPlace(db: Db, place: OwnPlace): Promise<void> {
  await db.put('places', place);
}

export async function loadSettings(db: Db): Promise<Settings> {
  const [pairingKey, session, locationNoticeAck, lastExportAt] = await Promise.all([
    db.get('settings', 'pairingKey'),
    db.get('settings', 'session'),
    db.get('settings', 'locationNoticeAck'),
    db.get('settings', 'lastExportAt'),
  ]);
  return {
    pairingKey: pairingKey as string | undefined,
    session: session as StoredSession | undefined,
    locationNoticeAck: locationNoticeAck as boolean | undefined,
    lastExportAt: lastExportAt as number | undefined,
  };
}

/** 設定を1項目書く。undefined なら消す。 */
export async function putSetting<K extends keyof Settings>(db: Db, key: K, value: Settings[K]): Promise<void> {
  if (value === undefined) {
    await db.delete('settings', key);
  } else {
    await db.put('settings', value, key);
  }
}

/** セッションを閉じて台帳に追記する（1トランザクション。二重確定を防ぐ）。 */
export async function closeSessionWithClaims(db: Db, records: readonly ClaimRecord[]): Promise<void> {
  const tx = db.transaction(['claims', 'settings'], 'readwrite');
  const claims = tx.objectStore('claims');
  await Promise.all([...records.map((r) => claims.add(r)), tx.objectStore('settings').delete('session'), tx.done]);
}

/** 端末に保存を残すよう要求する（spec/41）。非対応なら null。 */
export async function requestPersist(): Promise<boolean | null> {
  try {
    return (await navigator.storage?.persist?.()) ?? null;
  } catch {
    return null;
  }
}
