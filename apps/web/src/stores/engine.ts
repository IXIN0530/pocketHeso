// Engine Worker の窓口（spec/40 状態管理）: 最新の HallProjection を持ち、前面中は 1Hz で前進、前面/背面を記録する。
import type { ClaimRecord } from '@ph/claims';
import type { AwaySummary, HallProjection } from '@ph/core';
import { create } from 'zustand';
import type { ActionInput, BootResult, EngineView } from '../engine/engine-host.ts';
import { wrap, type Port, type Remote } from '../engine/rpc.ts';
import type { EngineApi } from '../engine.worker.ts';

export interface EngineState {
  readonly status: 'idle' | 'booting' | 'ready' | 'error';
  readonly error: string | null;
  readonly projection: HallProjection | null;
  /** 端末時計が戻っていて前進を止めている。 */
  readonly clockBack: boolean;
  /** 未読の留守中サマリー。 */
  readonly away: AwaySummary | null;
  readonly restoredFrom: BootResult['restoredFrom'] | null;
}

export const useEngine = create<EngineState>(() => ({
  status: 'idle',
  error: null,
  projection: null,
  clockBack: false,
  away: null,
  restoredFrom: null,
}));

let remote: Remote<EngineApi> | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function show(v: EngineView): void {
  useEngine.setState({ projection: v.projection, clockBack: v.clockBack });
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
      .tick(Date.now())
      .then(show, (e: unknown) => useEngine.setState({ error: message(e) }));
  }, 1000);
}

async function onVisibility(): Promise<void> {
  const fg = document.visibilityState === 'visible';
  if (!fg) {
    clearInterval(timer);
  }
  try {
    const r = await need().presence(fg, Date.now());
    show(r);
    if (r.away !== null) {
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
  const worker = new Worker(new URL('../engine.worker.ts', import.meta.url), { type: 'module' });
  remote = wrap<EngineApi>(worker as unknown as Port);
  useEngine.setState({ status: 'booting' });
  try {
    const boot = await remote.boot(Date.now());
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
  show(await need().receive(records, closesSession, Date.now()));
}

export async function act(input: ActionInput): Promise<void> {
  show(await need().act(input, Date.now()));
}

export function exportSave(): Promise<string> {
  return need().exportSave(Date.now());
}

export async function importSave(text: string): Promise<void> {
  const boot = await need().importSave(text, Date.now());
  show(boot);
  useEngine.setState({ away: boot.away, restoredFrom: boot.restoredFrom });
}

export function dismissAway(): void {
  useEngine.setState({ away: null });
}
