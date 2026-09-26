import { CORE_VERSION } from '@ph/core';

/** @ph/shared が前提とする Core のスキーマ版数。 */
export const SHARED_CORE_VERSION = CORE_VERSION;

export type {
  BloomCue,
  CameraCue,
  Cue,
  CueBranch,
  CueBranchOption,
  CueBus,
  CueKind,
  CuePack,
  CueSheet,
  FlashCue,
  FlashStyle,
  HapticCue,
  ParticleCue,
  ShakeCue,
  SoundAsset,
  SoundCue,
  SynthSpec,
} from './cue-sheet.ts';
export { CUE_BUSES, parseCuePack, parseCueSheet } from './cue-sheet.ts';
