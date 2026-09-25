import { LAUNCH_DIR_COUNT, type Board, type SensorKind } from './board.ts';
import type { Vec2 } from './vec2.ts';

/** 玉の半径 mm（直径 11.0）。 */
export const BALL_RADIUS_MM = 5.5;

/** 固定ステップ s（spec/20）。 */
export const PHYS_DT_S = 1 / 960;

/** 速度クランプ mm/s（1ステップ移動は 6.25mm < 半径）。 */
export const PHYS_MAX_SPEED_MM_S = 6000;

/** 速度クランプの2乗（比較用。`**`禁止のため乗算）。 */
const MAX_SPEED_SQ = 6000 * 6000;

/** タイムアウト 20s のステップ数（20 * 960）。 */
export const PHYS_MAX_STEPS = 19200;

/** ブロードフェーズの一様グリッドのセル mm。 */
export const PHYS_CELL_MM = 16;

/** speedQ の最大値（0..65535）。 */
export const MAX_SPEED_Q = 65535;

/** 1発の初期条件。dirIndex は launch_dirs 表の添字、speedQ は速度の量子化。 */
export interface LaunchParams {
  readonly dirIndex: number;
  readonly speedQ: number;
}

/** 玉の終了種別（センサー種別＋タイムアウト lost）。 */
export type BallOutcomeKind = SensorKind | 'lost';

/** 1発の結果。flightMs は steps * 1000 / 960。 */
export interface BallOutcome {
  readonly kind: BallOutcomeKind;
  readonly flightMs: number;
  readonly steps: number;
}

/** 描画用の軌跡サンプル（位置とステップ番号）。 */
export interface TrajectorySample {
  readonly x: number;
  readonly y: number;
  readonly step: number;
}

/** 描画用の軌跡（サンプル列と `run` と一致する結果）。 */
export interface Trajectory {
  readonly samples: readonly TrajectorySample[];
  readonly outcome: BallOutcome;
}

/**
 * 玉の可変状態（1ステップの計算用。速度性能のため破壊的更新する。
 * Vec2 の不変契約とは別物で、物理内部の一時値）。
 */
export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** セル添字を盤面内に収める（負・超過の玉にも対応）。 */
function clampCell(c: number, max: number): number {
  if (c < 0) {
    return 0;
  }
  if (c > max) {
    return max;
  }
  return c;
}

/** 整数か（範囲チェック用。小数は拒否する）。 */
function isInt(n: number): boolean {
  return Math.floor(n) === n;
}

/**
 * 玉の物理シミュレータ（spec/20）。
 * 方向表はコンストラクタで注入する（Core は表を読むだけ。生成は pachisim 側）。
 * 使う演算は `+ - * /`・`Math.sqrt`・`Math.floor`・比較のみ。
 */
export class BallSimulator {
  private readonly gravity: number;
  private readonly originX: number;
  private readonly originY: number;
  private readonly speedMin: number;
  private readonly speedMax: number;
  private readonly dirsX: Float64Array;
  private readonly dirsY: Float64Array;
  private readonly pinX: Float64Array;
  private readonly pinY: Float64Array;
  private readonly pinR: Float64Array;
  private readonly pinE: number;
  private readonly pinMu: number;
  private readonly segAx: Float64Array;
  private readonly segAy: Float64Array;
  private readonly segAbx: Float64Array;
  private readonly segAby: Float64Array;
  private readonly segLenSq: Float64Array;
  private readonly segE: Float64Array;
  private readonly segMu: Float64Array;
  private readonly sensors: Board['sensors'];
  private readonly cols: number;
  private readonly rows: number;
  private readonly pinCellStart: Int32Array;
  private readonly pinCellEntries: Int32Array;
  private readonly segCellStart: Int32Array;
  private readonly segCellEntries: Int32Array;

  constructor(board: Board, dirs: readonly Vec2[]) {
    if (dirs.length !== LAUNCH_DIR_COUNT) {
      throw new Error('BallSimulator requires ' + LAUNCH_DIR_COUNT + ' dirs');
    }
    this.gravity = board.gravityMmS2;
    this.originX = board.launch.origin.x;
    this.originY = board.launch.origin.y;
    this.speedMin = board.launch.speedMinMmS;
    this.speedMax = board.launch.speedMaxMmS;
    const dirsX = new Float64Array(LAUNCH_DIR_COUNT);
    const dirsY = new Float64Array(LAUNCH_DIR_COUNT);
    for (let i = 0; i < LAUNCH_DIR_COUNT; i = i + 1) {
      const d = dirs[i] as Vec2;
      dirsX[i] = d.x;
      dirsY[i] = d.y;
    }
    this.dirsX = dirsX;
    this.dirsY = dirsY;

    const pinCount = board.pins.length;
    const pinX = new Float64Array(pinCount);
    const pinY = new Float64Array(pinCount);
    const pinR = new Float64Array(pinCount);
    for (let i = 0; i < pinCount; i = i + 1) {
      const pin = board.pins[i] as Board['pins'][number];
      pinX[i] = pin.p.x;
      pinY[i] = pin.p.y;
      pinR[i] = pin.r;
    }
    this.pinX = pinX;
    this.pinY = pinY;
    this.pinR = pinR;
    this.pinE = board.pinRestitution;
    this.pinMu = board.pinFriction;

    const segCount = board.segments.length;
    const segAx = new Float64Array(segCount);
    const segAy = new Float64Array(segCount);
    const segAbx = new Float64Array(segCount);
    const segAby = new Float64Array(segCount);
    const segLenSq = new Float64Array(segCount);
    const segE = new Float64Array(segCount);
    const segMu = new Float64Array(segCount);
    for (let i = 0; i < segCount; i = i + 1) {
      const s = board.segments[i] as Board['segments'][number];
      const abx = s.b.x - s.a.x;
      const aby = s.b.y - s.a.y;
      segAx[i] = s.a.x;
      segAy[i] = s.a.y;
      segAbx[i] = abx;
      segAby[i] = aby;
      segLenSq[i] = abx * abx + aby * aby;
      segE[i] = s.restitution;
      segMu[i] = s.friction;
    }
    this.segAx = segAx;
    this.segAy = segAy;
    this.segAbx = segAbx;
    this.segAby = segAby;
    this.segLenSq = segLenSq;
    this.segE = segE;
    this.segMu = segMu;
    this.sensors = board.sensors;

    const cols = Math.floor(board.widthMm / PHYS_CELL_MM) + 1;
    const rows = Math.floor(board.heightMm / PHYS_CELL_MM) + 1;
    this.cols = cols;
    this.rows = rows;
    const cellCount = cols * rows;
    const maxCx = cols - 1;
    const maxCy = rows - 1;

    const pinCellOf = new Int32Array(pinCount);
    const pinCounts = new Int32Array(cellCount);
    for (let i = 0; i < pinCount; i = i + 1) {
      const cx = clampCell(Math.floor((pinX[i] as number) / PHYS_CELL_MM), maxCx);
      const cy = clampCell(Math.floor((pinY[i] as number) / PHYS_CELL_MM), maxCy);
      const cell = cx + cy * cols;
      pinCellOf[i] = cell;
      pinCounts[cell] = (pinCounts[cell] as number) + 1;
    }
    const pinCellStart = new Int32Array(cellCount + 1);
    for (let c = 0; c < cellCount; c = c + 1) {
      pinCellStart[c + 1] = (pinCellStart[c] as number) + (pinCounts[c] as number);
    }
    const pinCellEntries = new Int32Array(pinCount);
    const pinFill = new Int32Array(cellCount);
    for (let c = 0; c < cellCount; c = c + 1) {
      pinFill[c] = pinCellStart[c] as number;
    }
    for (let i = 0; i < pinCount; i = i + 1) {
      const cell = pinCellOf[i] as number;
      const at = pinFill[cell] as number;
      pinCellEntries[at] = i;
      pinFill[cell] = at + 1;
    }
    this.pinCellStart = pinCellStart;
    this.pinCellEntries = pinCellEntries;

    const segCx0 = new Int32Array(segCount);
    const segCx1 = new Int32Array(segCount);
    const segCy0 = new Int32Array(segCount);
    const segCy1 = new Int32Array(segCount);
    const segCounts = new Int32Array(cellCount);
    for (let i = 0; i < segCount; i = i + 1) {
      const ax = segAx[i] as number;
      const ay = segAy[i] as number;
      const abx = segAbx[i] as number;
      const aby = segAby[i] as number;
      const loX = ax < ax + abx ? ax : ax + abx;
      const hiX = ax < ax + abx ? ax + abx : ax;
      const loY = ay < ay + aby ? ay : ay + aby;
      const hiY = ay < ay + aby ? ay + aby : ay;
      const cx0 = clampCell(Math.floor((loX - BALL_RADIUS_MM) / PHYS_CELL_MM), maxCx);
      const cx1 = clampCell(Math.floor((hiX + BALL_RADIUS_MM) / PHYS_CELL_MM), maxCx);
      const cy0 = clampCell(Math.floor((loY - BALL_RADIUS_MM) / PHYS_CELL_MM), maxCy);
      const cy1 = clampCell(Math.floor((hiY + BALL_RADIUS_MM) / PHYS_CELL_MM), maxCy);
      segCx0[i] = cx0;
      segCx1[i] = cx1;
      segCy0[i] = cy0;
      segCy1[i] = cy1;
      for (let cy = cy0; cy <= cy1; cy = cy + 1) {
        for (let cx = cx0; cx <= cx1; cx = cx + 1) {
          const cell = cx + cy * cols;
          segCounts[cell] = (segCounts[cell] as number) + 1;
        }
      }
    }
    const segCellStart = new Int32Array(cellCount + 1);
    for (let c = 0; c < cellCount; c = c + 1) {
      segCellStart[c + 1] = (segCellStart[c] as number) + (segCounts[c] as number);
    }
    const totalSegRefs = segCellStart[cellCount] as number;
    const segCellEntries = new Int32Array(totalSegRefs);
    const segFill = new Int32Array(cellCount);
    for (let c = 0; c < cellCount; c = c + 1) {
      segFill[c] = segCellStart[c] as number;
    }
    for (let i = 0; i < segCount; i = i + 1) {
      for (let cy = segCy0[i] as number; cy <= (segCy1[i] as number); cy = cy + 1) {
        for (let cx = segCx0[i] as number; cx <= (segCx1[i] as number); cx = cx + 1) {
          const cell = cx + cy * cols;
          const at = segFill[cell] as number;
          segCellEntries[at] = i;
          segFill[cell] = at + 1;
        }
      }
    }
    this.segCellStart = segCellStart;
    this.segCellEntries = segCellEntries;
  }

  /** 初期状態を作る（速度は speedMin..Max を speedQ で線形に量子化）。 */
  initialState(p: LaunchParams): BallState {
    if (!isInt(p.dirIndex) || p.dirIndex < 0 || p.dirIndex >= LAUNCH_DIR_COUNT) {
      throw new Error('invalid dirIndex');
    }
    if (!isInt(p.speedQ) || p.speedQ < 0 || p.speedQ > MAX_SPEED_Q) {
      throw new Error('invalid speedQ');
    }
    const speed = this.speedMin + (this.speedMax - this.speedMin) * (p.speedQ / MAX_SPEED_Q);
    return {
      x: this.originX,
      y: this.originY,
      vx: (this.dirsX[p.dirIndex] as number) * speed,
      vy: (this.dirsY[p.dirIndex] as number) * speed,
    };
  }

  /**
   * 1ステップ進める（P1-T4 の trajectory と共有する内部関数。
   * センサー判定は含まない。`run` が step＋判定を回す）。
   */
  step(s: BallState): void {
    const dt = PHYS_DT_S;
    s.vy = s.vy + this.gravity * dt;
    const sp2 = s.vx * s.vx + s.vy * s.vy;
    if (sp2 > MAX_SPEED_SQ) {
      const k = PHYS_MAX_SPEED_MM_S / Math.sqrt(sp2);
      s.vx = s.vx * k;
      s.vy = s.vy * k;
    }
    s.x = s.x + s.vx * dt;
    s.y = s.y + s.vy * dt;

    const cols = this.cols;
    const rows = this.rows;
    const maxCx = cols - 1;
    const maxCy = rows - 1;
    const cx = clampCell(Math.floor(s.x / PHYS_CELL_MM), maxCx);
    const cy = clampCell(Math.floor(s.y / PHYS_CELL_MM), maxCy);

    const pinX = this.pinX;
    const pinY = this.pinY;
    const pinR = this.pinR;
    const pinCellStart = this.pinCellStart;
    const pinCellEntries = this.pinCellEntries;
    for (let oy = -1; oy <= 1; oy = oy + 1) {
      const yy = cy + oy;
      if (yy < 0 || yy >= rows) {
        continue;
      }
      for (let ox = -1; ox <= 1; ox = ox + 1) {
        const xx = cx + ox;
        if (xx < 0 || xx >= cols) {
          continue;
        }
        const cell = xx + yy * cols;
        const begin = pinCellStart[cell] as number;
        const end = pinCellStart[cell + 1] as number;
        for (let k = begin; k < end; k = k + 1) {
          const pi = pinCellEntries[k] as number;
          const px = pinX[pi] as number;
          const py = pinY[pi] as number;
          const dx = s.x - px;
          const dy = s.y - py;
          const rr = BALL_RADIUS_MM + (pinR[pi] as number);
          const d2 = dx * dx + dy * dy;
          if (d2 < rr * rr) {
            let nx: number;
            let ny: number;
            if (d2 > 0) {
              const d = Math.sqrt(d2);
              nx = dx / d;
              ny = dy / d;
            } else {
              nx = 1;
              ny = 0;
            }
            s.x = px + nx * rr;
            s.y = py + ny * rr;
            const vn = s.vx * nx + s.vy * ny;
            if (vn < 0) {
              const keep = 1 - this.pinMu;
              const tx = s.vx - vn * nx;
              const ty = s.vy - vn * ny;
              const bounce = -(this.pinE * vn);
              s.vx = tx * keep + nx * bounce;
              s.vy = ty * keep + ny * bounce;
            }
          }
        }
      }
    }

    const segAx = this.segAx;
    const segAy = this.segAy;
    const segAbx = this.segAbx;
    const segAby = this.segAby;
    const segLenSq = this.segLenSq;
    const segE = this.segE;
    const segMu = this.segMu;
    const segCellStart = this.segCellStart;
    const segCellEntries = this.segCellEntries;
    const ownCell = cx + cy * cols;
    const segBegin = segCellStart[ownCell] as number;
    const segEnd = segCellStart[ownCell + 1] as number;
    for (let k = segBegin; k < segEnd; k = k + 1) {
      const si = segCellEntries[k] as number;
      const ax = segAx[si] as number;
      const ay = segAy[si] as number;
      const abx = segAbx[si] as number;
      const aby = segAby[si] as number;
      const lenSq = segLenSq[si] as number;
      let t: number;
      if (lenSq > 0) {
        t = ((s.x - ax) * abx + (s.y - ay) * aby) / lenSq;
        if (t < 0) {
          t = 0;
        } else if (t > 1) {
          t = 1;
        }
      } else {
        t = 0;
      }
      const qx = ax + abx * t;
      const qy = ay + aby * t;
      const dx = s.x - qx;
      const dy = s.y - qy;
      const d2 = dx * dx + dy * dy;
      if (d2 < BALL_RADIUS_MM * BALL_RADIUS_MM) {
        let nx: number;
        let ny: number;
        if (d2 > 0) {
          const d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
        } else if (lenSq > 0) {
          const len = Math.sqrt(lenSq);
          nx = -(aby / len);
          ny = abx / len;
        } else {
          nx = 1;
          ny = 0;
        }
        s.x = qx + nx * BALL_RADIUS_MM;
        s.y = qy + ny * BALL_RADIUS_MM;
        const vn = s.vx * nx + s.vy * ny;
        if (vn < 0) {
          const e = segE[si] as number;
          const keep = 1 - (segMu[si] as number);
          const tx = s.vx - vn * nx;
          const ty = s.vy - vn * ny;
          const bounce = -(e * vn);
          s.vx = tx * keep + nx * bounce;
          s.vy = ty * keep + ny * bounce;
        }
      }
    }
  }

  /** 玉中心が矩形に入った最初のセンサーを返す（盤面順。境界を含む）。 */
  sense(s: BallState): BallOutcomeKind | null {
    const sensors = this.sensors;
    for (let i = 0; i < sensors.length; i = i + 1) {
      const sensor = sensors[i] as (typeof sensors)[number];
      if (s.x >= sensor.x && s.x <= sensor.x + sensor.w && s.y >= sensor.y && s.y <= sensor.y + sensor.h) {
        return sensor.kind;
      }
    }
    return null;
  }

  /** 最速の実行（軌跡を保持しない）。同じ条件では常に同じ結果。 */
  run(p: LaunchParams): BallOutcome {
    const s = this.initialState(p);
    for (let step = 1; step <= PHYS_MAX_STEPS; step = step + 1) {
      this.step(s);
      const kind = this.sense(s);
      if (kind !== null) {
        return { kind, flightMs: (step * 1000) / 960, steps: step };
      }
    }
    return { kind: 'lost', flightMs: 20000, steps: PHYS_MAX_STEPS };
  }

  /**
   * 描画用の軌跡（`run` と同じ `step`＋`sense` の循環で進める。コピペではなく共有）。
   * `every` ごとの位置と開始点（step 0）、終了点を必ず含む。
   * 終了点は `every` の倍数でなくても含み、`outcome` は `run` と一致する。
   */
  trajectory(p: LaunchParams, every: number): Trajectory {
    if (!isInt(every) || every <= 0) {
      throw new Error('invalid every');
    }
    const s = this.initialState(p);
    const samples: TrajectorySample[] = [{ x: s.x, y: s.y, step: 0 }];
    let nextAt = every;
    for (let step = 1; step <= PHYS_MAX_STEPS; step = step + 1) {
      this.step(s);
      const kind = this.sense(s);
      if (kind !== null) {
        if (step === nextAt) {
          samples.push({ x: s.x, y: s.y, step });
        } else {
          const last = samples[samples.length - 1] as TrajectorySample;
          if (last.step !== step) {
            samples.push({ x: s.x, y: s.y, step });
          }
        }
        return { samples, outcome: { kind, flightMs: (step * 1000) / 960, steps: step } };
      }
      if (step === nextAt) {
        samples.push({ x: s.x, y: s.y, step });
        nextAt = nextAt + every;
      }
    }
    const last = samples[samples.length - 1] as TrajectorySample;
    if (last.step !== PHYS_MAX_STEPS) {
      samples.push({ x: s.x, y: s.y, step: PHYS_MAX_STEPS });
    }
    return { samples, outcome: { kind: 'lost', flightMs: 20000, steps: PHYS_MAX_STEPS } };
  }
}
