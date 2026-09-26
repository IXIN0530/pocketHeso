// Engine Worker の窓口（spec/40 状態管理）: 最新の HallProjection を持ち、前面中は 1Hz で前進、前面/背面を記録する。
import type { ClaimRecord } from '@ph/claims';
import type { AwaySummary, EngineSimEvent, HallProjection } from '@ph/core';
import { create } from 'zustand';
import type { ActionInput, BootResult, EngineView, Shot } from '../engine/engine-host.ts';
import { wrap, type Port, type Remote } from '../engine/rpc.ts';
import type { EngineApi } from '../engine.worker.ts';
import { deleteDB } from 'idb';
import { DB_NAME } from '../platform/storage.ts';
import { clock, dbNameFor } from './clock.ts';

export interface EngineState {
  readonly status: 'idle' | 'booting' | 'ready' | 'error';
  readonly error: string | null;
  readonly projection: HallProjection | null;
  /** 端末時計が戻っていて前進を止めている。 */
  readonly clockBack: boolean;
  /** 未読の留守中サマリー。 */
  readonly away: AwaySummary | null;
  readonly restoredFrom: BootResult['restoredFrom'] | null;
  /** 演出の分岐に使う seed（spec/43）。 */
  readonly seed: number;
}

export const useEngine = create<EngineState>(() => ({
  status: 'idle',
  error: null,
  projection: null,
  clockBack: false,
  away: null,
  restoredFrom: null,
  seed: 0,
}));

let remote: Remote<EngineApi> | null = null;
let worker: Worker | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
/** 直近の留守中サマリー（閉じた後も Debug から出し直せる）。 */
let lastAway: AwaySummary | null = null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type ShotListener = (shots: readonly Shot[]) => void;
const shotListeners = new Set<ShotListener>();
let lastShots: readonly Shot[] = [];

/**
 * 盤面の玉（spec/50）。React の再レンダーを通さずに描画へ渡す。戻り値で解除。
 * 登録時に直近の結果（飛行中の玉を含む）を渡すので、盤面を後から開いても途中から再生できる。
 */
export function onShots(fn: ShotListener): () => void {
  shotListeners.add(fn);
  fn(lastShots);
  return () => shotListeners.delete(fn);
}

type ViewListener = (projection: HallProjection, events: readonly EngineSimEvent[]) => void;
const viewListeners = new Set<ViewListener>();

/**
 * 前進ごとの Projection とイベント（液晶の保留・変動の再生用, spec/40）。戻り値で解除。
 * 登録時に最新の Projection を（イベント無しで）渡す。
 */
export function onView(fn: ViewListener): () => void {
  viewListeners.add(fn);
  const p = useEngine.getState().projection;
  if (p !== null) fn(p, []);
  return () => viewListeners.delete(fn);
}

function show(v: EngineView & { readonly events?: readonly EngineSimEvent[] }): void {
  useEngine.setState({ projection: v.projection, clockBack: v.clockBack, seed: v.seed });
  lastShots = v.shots;
  if (v.shots.length > 0) {
    shotListeners.forEach((fn) => fn(v.shots));
  }
  const events = v.events ?? [];
  viewListeners.forEach((fn) => fn(v.projection, events));
}

function need(): Remote<EngineApi> {
  if (remote === null) {
    throw new Error('Engine がまだ起動していません');
  }
  return remote;
}

function startTicking(): void {
  clearInterval(timer);
  timer = setInterval(() => {
    void need()
      .tick(clock.now())
      .then(show, (e: unknown) => useEngine.setState({ error: message(e) }));
  }, 1000);
}

async function onVisibility(): Promise<void> {
  const fg = document.visibilityState === 'visible';
  if (!fg) {
    clearInterval(timer);
  }
  try {
    const r = await need().presence(fg, clock.now());
    show(r);
    if (r.away !== null) {
      lastAway = r.away;
      useEngine.setState({ away: r.away });
    }
  } catch (e) {
    useEngine.setState({ error: message(e) });
  }
  if (fg) {
    startTicking();
  }
}

/** Worker を起動して復元・追いつきを行う（2回目以降は何もしない）。 */
export async function startEngine(): Promise<void> {
  if (remote !== null) {
    return;
  }
  worker = new Worker(new URL('../engine.worker.ts', import.meta.url), { type: 'module' });
  remote = wrap<EngineApi>(worker as unknown as Port);
  useEngine.setState({ status: 'booting' });
  try {
    const boot = await remote.boot(clock.now(), dbNameFor(clock.scale));
    clock.catchUp(boot.projection.at);
    show(boot);
    useEngine.setState({ status: 'ready', away: boot.away, restoredFrom: boot.restoredFrom });
  } catch (e) {
    useEngine.setState({ status: 'error', error: message(e) });
    return;
  }
  document.addEventListener('visibilitychange', () => void onVisibility());
  if (document.visibilityState === 'visible') {
    startTicking();
  } else {
    await onVisibility();
  }
}

/** 受け取りを確定する（台帳への追記は Worker が行う）。 */
export async function receiveClaims(records: readonly ClaimRecord[], closesSession: boolean): Promise<void> {
  show(await need().receive(records, closesSession, clock.now()));
}

export async function act(input: ActionInput): Promise<void> {
  show(await need().act(input, clock.now()));
}

export function exportSave(): Promise<string> {
  return need().exportSave(clock.now());
}

export async function importSave(text: string): Promise<void> {
  const boot = await need().importSave(text, clock.now());
  show(boot);
  useEngine.setState({ away: boot.away, restoredFrom: boot.restoredFrom });
}

export function debugInfo() {
  return need().debugInfo();
}

export function resetMetrics() {
  return need().resetMetrics(clock.now());
}

export function verifyAtlas() {
  return need().verifyAtlas();
}

/** 全データを消して起動し直す（Engine を止めてから DB を消す。Debug の時間倍率なら Debug の DB だけ）。 */
export async function resetGame(): Promise<void> {
  clearInterval(timer);
  worker?.terminate();
  worker = null;
  remote = null;
  await deleteDB(dbNameFor(clock.scale) ?? DB_NAME);
  location.reload();
}

export function dismissAway(): void {
  useEngine.setState({ away: null });
}


/** Debug: 直近の留守中サマリーをもう一度出す（無ければ false）。 */
export function showLastAway(): boolean {
  if (lastAway === null) return false;
  useEngine.setState({ away: lastAway });
  return true;
}
