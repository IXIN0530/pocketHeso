import { CORE_VERSION } from '@ph/core';

/** @ph/fx が前提とする Core のスキーマ版数。 */
export const FX_CORE_VERSION = CORE_VERSION;

export type { CueSink } from './cue-player.ts';
export { CuePlayer, cueSpanMs } from './cue-player.ts';
export { FADE_MAX_ALPHA, FLASH_MAX_ALPHA, FLASH_MAX_PER_SEC, FLASH_RAMP_MS, FlashLimiter, flashAlpha } from './flash.ts';
export { FlashLayer } from './flash-layer.ts';
export { Haptics } from './haptics.ts';
export type { HoldChangePlan } from './hold-change.ts';
export {
  HOLD_BREAK_MS,
  HOLD_CRACK_CUE,
  HOLD_RANKED,
  SAKIBARE_CUE,
  SAKIBARE_DELAY_MS,
  holdChangeCue,
  holdColorAt,
  holdRank,
  planHoldChange,
  sakibareAt,
} from './hold-change.ts';
export type { ResolveOptions, ResolvedCues } from './resolve.ts';
export { resolveCueSheet } from './resolve.ts';
export type { CueTargets, SceneCue } from './router.ts';
export { createCueRouter } from './router.ts';
export type { ActiveScene, SpinPlan, SpinPlanOptions } from './spin-plan.ts';
export { EMPTY_SPIN_PLAN, activeScenes, planSpin } from './spin-plan.ts';
export type { VolumeKey } from './sound-bus.ts';
export { SoundBus } from './sound-bus.ts';
export { renderSynth } from './synth.ts';
