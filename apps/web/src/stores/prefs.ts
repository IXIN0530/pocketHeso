// 端末ごとの表示の好み（セーブに含めない）。localStorage が使えない時は既定値のまま動く。
import { create } from 'zustand';

export interface Prefs {
  /** 当たり演出の光のにじみ（ブルーム）。OFF で描画が軽くなる（spec/50）。 */
  readonly bloom: boolean;
  /** 音量 0〜100（SoundBus の master。0 でアプリ内ミュート, spec/43）。 */
  readonly volume: number;
  /** 操作の触覚（iPhone はスイッチの触覚を借りる, platform/haptic.ts）。 */
  readonly haptics: boolean;
  /** 見た目の解放のうち「使わない」ものの key（常連ツリーで開けても選んで外せる, spec/25）。 */
  readonly looksOff: readonly string[];
}

const KEY = 'pocketheso.prefs';
const DEFAULTS: Prefs = { bloom: true, volume: 70, haptics: true, looksOff: [] };

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      bloom: typeof raw.bloom === 'boolean' ? raw.bloom : DEFAULTS.bloom,
      volume: typeof raw.volume === 'number' ? Math.min(100, Math.max(0, raw.volume)) : DEFAULTS.volume,
      haptics: typeof raw.haptics === 'boolean' ? raw.haptics : DEFAULTS.haptics,
      looksOff: Array.isArray(raw.looksOff) ? raw.looksOff.filter((k): k is string => typeof k === 'string') : DEFAULTS.looksOff,
    };
  } catch {
    return DEFAULTS;
  }
}

export const usePrefs = create<Prefs>(() => (typeof localStorage === 'undefined' ? DEFAULTS : load()));

export function setPrefs(patch: Partial<Prefs>): void {
  usePrefs.setState(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(usePrefs.getState()));
  } catch {
    // 保存できなくてもこの起動の間は効く
  }
}
