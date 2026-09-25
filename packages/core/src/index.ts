/** Core のスキーマ版数。保存データと Atlas の互換判定に使う。 */
export const CORE_VERSION = 1;

export type { Vec2 } from './vec2.ts';
export { addVec2, dotVec2, lengthSquaredVec2, lengthVec2, scaleVec2, subVec2, vec2 } from './vec2.ts';
export type { RNGStreamID } from './rng.ts';
export { RNG_STREAM_IDS, RNGStream, fnv1a32, splitmix32, streamSeedU32, xoshiro128ss } from './rng.ts';
