// 店と台の表示名（web に1か所, P14-T2）。台名・一言は仮で、ここだけ直せば画面に反映される。
import { machineSpec } from './game-config.ts';

export interface MachineInfo {
  readonly id: string;
  readonly shop: string;
  readonly name: string;
  readonly blurb: string;
  /** 開放する常連ツリーのノード（最初の台は null）。 */
  readonly node: string | null;
}

/** 店の並び順（Core の machinesOpen と同じ）。 */
export const MACHINE_INFO: readonly MachineInfo[] = [
  { id: 'light-middle-01', shop: '駅前店', name: 'ライトミドル', blurb: '当たりやすく、ST も長い定番の台', node: null },
  { id: 'rush-middle-01', shop: '国道店', name: 'ラッシュミドル', blurb: '通常は重いが RUSH が強く、RUSH 中の当たりは上位RUSH（上乗せ）になることも', node: 'shop_kokudo_open' },
  { id: 'lt-middle-01', shop: '港町店', name: 'LT ミドル', blurb: '時短から ST・LT へ続く台', node: 'shop_minato_open' },
];

export function machineInfo(id: string): MachineInfo | null {
  for (const m of MACHINE_INFO) {
    if (m.id === id) return m;
  }
  return null;
}

/** 「駅前店 ライトミドル」。知らない id は id のまま。 */
export function machineLabel(id: string): string {
  const m = machineInfo(id);
  return m === null ? id : `${m.shop} ${m.name}`;
}

/** 1行の性能: 「大当たり 1/185.0 ・ ST 100回」。 */
export function machineLine(id: string): string {
  const spec = machineSpec(id);
  if (spec === null) return '';
  const parts = [`大当たり 1/${spec.normal.jackpot1In.toFixed(1)}`];
  if (spec.jitan !== undefined) parts.push(`時短 ${spec.jitan.stSpins}回`);
  parts.push(`ST ${spec.st.stSpins}回`);
  if (spec.lt !== undefined) parts.push(`LT ${spec.lt.stSpins}回`);
  return parts.join('・');
}
