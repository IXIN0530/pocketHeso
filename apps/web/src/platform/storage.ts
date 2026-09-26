// IndexedDB `pocketheso`（spec/10 の保存）。台帳は追記のみ・キー = claimId。YOLP の結果は保存しない（spec/32）。
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CheckinSession, ClaimRecord, OwnPlace } from '@ph/claims';

export const DB_NAME = 'pocketheso';
export const DB_VERSION = 1;
/** 保存データのスキーマ版数（meta に書く）。 */
export const SAVE_SCHEMA = 1;

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
}

interface Schema extends DBSchema {
  meta: { key: string; value: unknown };
  claims: { key: string; value: ClaimRecord; indexes: { receivedAt: number } };
  actions: { key: number; value: unknown };
  snapshot: { key: string; value: unknown };
  places: { key: string; value: OwnPlace };
  settings: { key: string; value: unknown };
}

export type Db = IDBPDatabase<Schema>;

/** DB を開く（無ければ全 store を作る。actions/snapshot は P5 で使う）。 */
export async function openStorage(name: string = DB_NAME): Promise<Db> {
  const db = await openDB<Schema>(name, DB_VERSION, {
    upgrade(d) {
      d.createObjectStore('meta');
      d.createObjectStore('claims', { keyPath: 'claimId' }).createIndex('receivedAt', 'receivedAt');
      d.createObjectStore('actions', { autoIncrement: true });
      d.createObjectStore('snapshot');
      d.createObjectStore('places', { keyPath: 'placeId' });
      d.createObjectStore('settings');
    },
  });
  if ((await db.get('meta', 'schema')) === undefined) {
    await db.put('meta', SAVE_SCHEMA, 'schema');
  }
  return db;
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
  const [pairingKey, session, locationNoticeAck] = await Promise.all([
    db.get('settings', 'pairingKey'),
    db.get('settings', 'session'),
    db.get('settings', 'locationNoticeAck'),
  ]);
  return {
    pairingKey: pairingKey as string | undefined,
    session: session as StoredSession | undefined,
    locationNoticeAck: locationNoticeAck as boolean | undefined,
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
