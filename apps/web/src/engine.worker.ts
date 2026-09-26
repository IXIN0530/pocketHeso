// Engine を UI スレッドの外で回す（spec/40）。中身は EngineHost、ここは Atlas の読み込みと RPC の公開だけ。
import type { ClaimRecord } from '@ph/claims';
import atlasUrl from '../../../resources/atlas/default.9489bfc699495d5a.bin?url';
import { EngineHost, type ActionInput } from './engine/engine-host.ts';
import { expose, type Port } from './engine/rpc.ts';
import { openStorage } from './platform/storage.ts';

let host: EngineHost | null = null;

function need(): EngineHost {
  if (host === null) {
    throw new Error('Engine がまだ起動していません');
  }
  return host;
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

async function loadAtlas(): Promise<ArrayBuffer> {
  const res = await fetch(atlasUrl);
  if (!res.ok) {
    throw new Error(`盤面データを読めません（${res.status}）`);
  }
  return res.arrayBuffer();
}

const api = {
  /** dbName は Debug の時間倍率用（本番のセーブと分ける）。 */
  async boot(now: number, dbName?: string) {
    const [db, atlas] = await Promise.all([openStorage(dbName), loadAtlas()]);
    const opened = await EngineHost.open(db, atlas, now, randomSeed);
    host = opened.host;
    return opened.boot;
  },
  tick: (now: number) => need().tick(now),
  act: (input: ActionInput, now: number) => need().act(input, now),
  presence: (fg: boolean, now: number) => need().presence(fg, now),
  receive: (records: readonly ClaimRecord[], closesSession: boolean, now: number) => need().receive(records, closesSession, now),
  exportSave: (now: number) => need().exportSave(now),
  importSave: (text: string, now: number) => need().importSave(text, now),
};

export type EngineApi = typeof api;

expose(api, self as unknown as Port);
