import type { CameraCue, FlashStyle, LcdCue, ParticleCue, ShakeCue, SoundCue } from '@ph/shared';
import type { CueSink } from './cue-player.ts';

/** 盤面側が受け持つキュー（パーティクル・揺れ・カメラ・液晶）。 */
export type SceneCue = ParticleCue | ShakeCue | CameraCue | LcdCue;

export interface CueTargets {
  readonly sound?: { play(cue: SoundCue, offsetMs: number): void };
  readonly flash?: {
    flash(style: FlashStyle, ms: number, nowMs: number, offsetMs: number): boolean;
    bloom(strength: number, ms: number, nowMs: number, offsetMs: number): void;
  };
  readonly haptics?: { play(pattern: readonly number[]): void };
  readonly scene?: (cue: SceneCue, offsetMs: number, nowMs: number) => void;
}

/** キューを種類ごとの実行先へ振り分ける CueSink。実行先が無い種類は捨てる。 */
export function createCueRouter(t: CueTargets): CueSink {
  return (cue, offsetMs, nowMs) => {
    switch (cue.kind) {
      case 'sound':
        t.sound?.play(cue, offsetMs);
        return;
      case 'flash':
        t.flash?.flash(cue.style, cue.ms, nowMs, offsetMs);
        return;
      case 'bloom':
        t.flash?.bloom(cue.strength, cue.ms, nowMs, offsetMs);
        return;
      case 'haptic':
        t.haptics?.play(cue.pattern);
        return;
      default:
        t.scene?.(cue, offsetMs, nowMs);
    }
  };
}
