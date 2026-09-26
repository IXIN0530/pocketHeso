// 演出の実行（spec/43）: 既定パックの CueSheet を CuePlayer で再生し、音・光・振動へ振り分ける。
import { CuePlayer, FlashLayer, Haptics, SoundBus, createCueRouter, resolveCueSheet } from '@ph/fx';
import { parseCuePack, type CueSheet } from '@ph/shared';
import packJson from '../../../../resources/packs/default/pack.json';
import { usePrefs } from '../stores/prefs.ts';

export const pack = parseCuePack(packJson);
const sheets = new Map<string, CueSheet>(pack.sheets.map((s) => [s.pattern, s]));
/** ファイルの音素材はここから読む（SW がプリキャッシュ, spec/41）。MVP の既定パックは合成音のみ。 */
const PACK_BASE = typeof location === 'undefined' ? 'http://localhost/packs/default/' : new URL('/packs/default/', location.origin).href;

/** 設定の強度（spec/43 `fx.intensity`）。設定画面は P6-T2 以降。 */
const INTENSITY = 2;

export const sound = new SoundBus();
export const haptics = new Haptics();
for (const name of Object.keys(pack.sounds)) sound.add(name, pack.sounds[name]!, PACK_BASE);

const applyVolume = (volume: number) => sound.setVolume('master', volume / 100);
applyVolume(usePrefs.getState().volume);
usePrefs.subscribe((p, prev) => {
  if (p.volume !== prev.volume) applyVolume(p.volume);
});

/** 最初のタップで音を解錠する（iOS はユーザー操作の中でないと鳴らない）。以後のタップは中断からの復帰。 */
export function installAudioUnlock(): () => void {
  const unlock = () => sound.unlock();
  const opts = { capture: true, passive: true } as const;
  document.addEventListener('pointerdown', unlock, opts);
  document.addEventListener('touchend', unlock, opts);
  return () => {
    document.removeEventListener('pointerdown', unlock, opts);
    document.removeEventListener('touchend', unlock, opts);
  };
}

// テスト（Node）では matchMedia が無い。
const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** 盤面が表示されている間だけ光の出し先がある（無い時のフラッシュは捨てる）。 */
let flashTarget: FlashLayer | null = null;
export function setFlashTarget(layer: FlashLayer, on: boolean): void {
  if (on) {
    flashTarget = layer;
    layer.reducedMotion = reducedMotion?.matches ?? false;
  } else if (flashTarget === layer) {
    flashTarget = null;
  }
}
reducedMotion?.addEventListener('change', () => {
  if (flashTarget) flashTarget.reducedMotion = reducedMotion.matches;
});

const route = createCueRouter({
  sound,
  haptics,
  flash: {
    flash: (style, ms, now, off) => flashTarget?.flash(style, ms, now, off) ?? false,
    bloom: (strength, ms, now, off) => flashTarget?.bloom(strength, ms, now, off),
  },
});
const player = new CuePlayer(route);
let raf = 0;

function tick(): void {
  player.update(performance.now());
  raf = player.done ? 0 : requestAnimationFrame(tick);
}

/**
 * パックの演出を今から再生する（startedAgoMs > 0 なら途中から）。時計は performance.now（FlashLayer.render と同じ）。
 * 分岐は RNGStream(seed, 'presentation', serial)。
 */
export function playCue(pattern: string, seed: number, serial: number, startedAgoMs = 0): boolean {
  const sheet = sheets.get(pattern);
  if (!sheet) return false;
  stopCue();
  player.start(resolveCueSheet(sheet, { seed, serial, intensity: INTENSITY }).cues, performance.now() - startedAgoMs);
  tick();
  return true;
}

export function stopCue(): void {
  player.stop();
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  sound.stop();
  flashTarget?.clear();
}
