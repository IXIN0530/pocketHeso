/** Core のスキーマ版数。保存データと Atlas の互換判定に使う。 */
export const CORE_VERSION = 1;

export type { Vec2 } from './vec2.ts';
export { addVec2, dotVec2, lengthSquaredVec2, lengthVec2, scaleVec2, subVec2, vec2 } from './vec2.ts';
export type { RNGStreamID } from './rng.ts';
export { RNG_STREAM_IDS, RNGStream, fnv1a32, splitmix32, streamSeedU32, xoshiro128ss } from './rng.ts';
export type { BallOutcome, BallOutcomeKind, BallState, LaunchParams } from './physics.ts';
export {
  BALL_RADIUS_MM,
  BallSimulator,
  MAX_SPEED_Q,
  PHYS_CELL_MM,
  PHYS_DT_S,
  PHYS_MAX_SPEED_MM_S,
  PHYS_MAX_STEPS,
} from './physics.ts';
export type {
  Board,
  BoardLaunch,
  BoardPin,
  BoardSegment,
  BoardSensor,
  BoardYakumono,
  SensorKind,
} from './board.ts';
export {
  LAUNCH_DIR_COUNT,
  LAUNCH_DIR_TABLE_ID,
  MAX_LAUNCH_SPEED_MM_S,
  SENSOR_KINDS,
  bytesToHex,
  canonicalBoardJson,
  hashBoard,
  parseBoard,
  parseBoardText,
  parseLaunchDirs,
} from './board.ts';
