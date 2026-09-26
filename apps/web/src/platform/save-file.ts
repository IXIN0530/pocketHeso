// セーブの書き出し/読み込み（spec/41）: `PH-SAVE1:` + base64(gzip(JSON{meta, claims, actions, settings, places}))。
// スナップショットは含めない（読み込み後に seed + 台帳 + ActionLog から再計算する）。
import type { ClaimRecord, OwnPlace } from '@ph/claims';
import type { Action } from '@ph/core';
import { loadActions, loadLedger, loadMetaRecord, loadPlaces, metaEntries, type Db, type GameMeta } from './storage.ts';

export const SAVE_PREFIX = 'PH-SAVE1:';

export interface SaveData {
  readonly meta: Readonly<Record<string, unknown>>;
  readonly claims: readonly ClaimRecord[];
  readonly actions: readonly Action[];
  readonly settings: Readonly<Record<string, unknown>>;
  readonly places: readonly OwnPlace[];
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export async function encodeSave(data: SaveData): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(data));
  return SAVE_PREFIX + toBase64(await pipe(json, new CompressionStream('gzip')));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkSave(v: unknown): SaveData {
  const bad = (what: string): never => {
    throw new Error(`セーブの中身が正しくありません（${what}）`);
  };
  if (!isObj(v)) {
    return bad('全体');
  }
  const { meta, claims, actions, settings, places } = v;
  if (!isObj(meta)) bad('meta');
  if (!isObj(settings)) bad('settings');
  if (!Array.isArray(claims) || !claims.every((c) => isObj(c) && typeof c['claimId'] === 'string' && typeof c['receivedAt'] === 'number' && isObj(c['grant']))) {
    bad('台帳');
  }
  if (!Array.isArray(actions) || !actions.every((a) => isObj(a) && typeof a['t'] === 'number' && typeof a['k'] === 'string')) {
    bad('操作の記録');
  }
  if (!Array.isArray(places) || !places.every((p) => isObj(p) && typeof p['placeId'] === 'string')) {
    bad('登録地点');
  }
  return v as unknown as SaveData;
}

/** 貼り付けた文字列を読む（前後の空白・途中の改行は無視）。形が違えば日本語のメッセージで throw。 */
export async function decodeSave(text: string): Promise<SaveData> {
  const s = text.replace(/\s+/g, '');
  if (!s.startsWith(SAVE_PREFIX)) {
    throw new Error(`セーブの文字列ではありません（${SAVE_PREFIX} で始まるものを貼り付けてください）`);
  }
  let json: string;
  try {
    json = new TextDecoder().decode(await pipe(fromBase64(s.slice(SAVE_PREFIX.length)), new DecompressionStream('gzip')));
  } catch {
    throw new Error('セーブの文字列が途中で切れているか壊れています');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('セーブの文字列が壊れています');
  }
  return checkSave(parsed);
}

/** DB の中身をセーブにする（snapshot 以外の全 store）。 */
export async function dumpSave(db: Db): Promise<SaveData> {
  const [meta, claims, actions, places, keys, values] = await Promise.all([
    loadMetaRecord(db),
    loadLedger(db),
    loadActions(db),
    loadPlaces(db),
    db.getAllKeys('settings'),
    db.getAll('settings'),
  ]);
  const settings: Record<string, unknown> = {};
  keys.forEach((k, i) => (settings[k] = values[i]));
  return { meta, claims, actions, settings, places };
}

/** DB を全消去してセーブの中身で置き換える（1トランザクション。meta は移行済みのものを書く）。 */
export async function replaceWithSave(db: Db, data: SaveData, meta: GameMeta): Promise<void> {
  const tx = db.transaction(['meta', 'claims', 'actions', 'snapshot', 'places', 'settings'], 'readwrite');
  const stores = ['meta', 'claims', 'actions', 'snapshot', 'places', 'settings'] as const;
  await Promise.all(stores.map((n) => tx.objectStore(n).clear()));
  const ops: Promise<unknown>[] = [];
  for (const [k, v] of metaEntries(meta)) ops.push(tx.objectStore('meta').put(v, k));
  for (const c of data.claims) ops.push(tx.objectStore('claims').put(c));
  for (const a of data.actions) ops.push(tx.objectStore('actions').add(a));
  for (const p of data.places) ops.push(tx.objectStore('places').put(p));
  for (const [k, v] of Object.entries(data.settings)) ops.push(tx.objectStore('settings').put(v, k));
  await Promise.all([...ops, tx.done]);
}
