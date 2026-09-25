import { parseBoard, type Board } from './board.ts';
import type { BallOutcome, LaunchParams } from './physics.ts';
import { vec2, type Vec2 } from './vec2.ts';

/** ゴールデンに使う発射条件の件数（P1-T5 で固定）。 */
export const GOLDEN_LAUNCH_COUNT = 1000;

/**
 * 固定 1,000 LaunchParams のゴールデンハッシュ（SHA-256 先頭16桁）。
 * `encodeOutcomes` の出力を Node の `node:crypto` でハッシュした値。
 * ブラウザ（P5 以降）は同じ正規化列を `crypto.subtle` でハッシュし、同じ値になる前提。
 */
export const GOLDEN_OUTCOMES_HASH = '57bb3c081e328c78';

/** dir 表の巡回幅（1024 件）。剰余は `+ - * /` と `Math.floor` だけで求める（決定論）。 */
function mod1024(i: number): number {
  return i - Math.floor(i / 1024) * 1024;
}

/** speedQ の巡回幅（0..65535）。剰余は `+ - * /` と `Math.floor` だけで求める（決定論）。 */
function mod65536(n: number): number {
  return n - Math.floor(n / 65536) * 65536;
}

/** i 番目の固定発射条件（dir は 1024 を巡回、speedQ は 37 刻みで分散）。 */
export function goldenLaunchParams(index: number): LaunchParams {
  if (Math.floor(index) !== index) {
    throw new Error('goldenLaunchParams index must be an int');
  }
  if (index < 0 || index >= GOLDEN_LAUNCH_COUNT) {
    throw new Error('goldenLaunchParams index out of range');
  }
  return { dirIndex: mod1024(index), speedQ: mod65536(index * 37) };
}

/**
 * ゴールデン用の固定盤面（既定盤面と同規模の合成盤面: 釘 322 本・壁 2・センサー 2・右下発射）。
 * Node とブラウザで同じ `Board` を作るため、ファイル読み込みなしで生成する。
 */
export function goldenBoard(): Board {
  const pins: Array<{ p: [number, number]; r: number }> = [];
  for (let row = 0; row < 14; row = row + 1) {
    for (let col = 0; col < 23; col = col + 1) {
      pins.push({ p: [40 + (360 * col) / 22, 60 + (340 * row) / 13], r: 1.1 });
    }
  }
  return parseBoard({
    id: 'golden',
    version: 1,
    size_mm: [420, 460],
    gravity_mm_s2: 9000,
    pins,
    segments: [
      { a: [0, 0], b: [0, 460], restitution: 0.35, friction: 0.1 },
      { a: [420, 0], b: [420, 460], restitution: 0.35, friction: 0.1 },
    ],
    sensors: [
      { id: 'heso', kind: 'start1', rect: [190, 300, 24, 10] },
      { id: 'out', kind: 'out', rect: [0, 452, 420, 8] },
    ],
    launch: { origin: [405, 440], dir_table: 'launch_dirs', speed_mm_s: [3200, 3600] },
    pin_restitution: 0.45,
    pin_friction: 0.05,
    yakumono: [],
  });
}

/**
 * ゴールデン用の固定方向表（真上中心±0.1rad 相当の 1024 件）。
 * `Math.sqrt` のみで生成する（Core は生成表を読むだけ、という契約のテスト側の再現）。
 */
export function goldenDirs(): readonly Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < 1024; i = i + 1) {
    const x = -0.099833 + (0.199666 * i) / 1023;
    out.push(vec2(x, -Math.sqrt(1 - x * x)));
  }
  return out;
}

/**
 * 成果列を決定的な ASCII 列にする（`kind:steps:flightMs;` の繰り返し）。
 * Node とブラウザで同一文字列になる前提（数値→文字列は ECMA 仕様で決定的）。
 */
export function encodeOutcomes(outcomes: readonly BallOutcome[]): string {
  let out = '';
  for (let i = 0; i < outcomes.length; i = i + 1) {
    const o = outcomes[i] as BallOutcome;
    out = out + o.kind + ':' + o.steps + ':' + o.flightMs + ';';
  }
  return out;
}

/**
 * 成果列のハッシュ（SHA-256 の先頭 16 桁）。SHA-256 実装は引数で注入する
 *（Node は `node:crypto`、ブラウザは `crypto.subtle` で `encodeOutcomes` をハッシュする）。
 */
export function hashOutcomes(
  outcomes: readonly BallOutcome[],
  sha256Hex: (canonical: string) => string,
): string {
  return sha256Hex(encodeOutcomes(outcomes)).slice(0, 16);
}
