/** 2次元ベクトル（mm単位想定。不変: 関数は新値を返す）。 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Vec2 を作る。 */
export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

/** a + b（新値を返す）。 */
export function addVec2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** a - b（新値を返す）。 */
export function subVec2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** v * s（新値を返す）。 */
export function scaleVec2(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

/** 内積。 */
export function dotVec2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 長さの2乗（sqrt不要の比較用）。 */
export function lengthSquaredVec2(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

/** 長さ。 */
export function lengthVec2(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}
