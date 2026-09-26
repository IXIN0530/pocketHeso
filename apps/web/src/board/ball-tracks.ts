// 盤面の玉の再生（spec/50）。Engine の Shot（発射・センサー時刻・入賞先・Atlas キー）から、
// Core の BallSimulator で正準条件の軌跡を計算し、表示時刻で補間する。Three に依存しない（テスト用）。
import { BallSimulator, canonicalParamsForKey, type Board, type Trajectory, type Vec2 } from '@ph/core';
import type { Shot } from '../engine/engine-host.ts';

/** 軌跡のサンプル間隔（ステップ数）。spec/50 の `trajectory(canonicalParams, 4)`。 */
export const TRAJ_EVERY = 4;
/**
 * 表示の遅れ（実時間 ms。Debug の時間倍率を掛けて使う）。Engine は 1Hz で進むので、発射を知るのは最大1秒後。
 * 玉は「時計 − 遅れ」の時刻で描き、発射の瞬間から見せる（保留などの表示も同じ遅れで揃える, D-063）。
 */
export const DISPLAY_LAG_MS = 1300;
/** 同時に描く玉の上限（spec/50 の性能目標は同時 20 玉）。 */
export const MAX_BALLS = 20;
/** 開いた瞬間に途中から再生する範囲（発射がこれより前の玉は描かない, spec/50）。 */
export const PREROLL_MS = 5000;
const CACHE_SIZE = 512;
const QUEUE_SIZE = 512;
/** 差し替え用の軌跡を1回に探す上限と、ためておく本数。 */
const SEARCH_TRIES = 64;
const POOL_SIZE = 16;

export interface FlyingBall {
  active: boolean;
  x: number;
  y: number;
  shot: Shot | null;
  traj: Trajectory | null;
  cursor: number;
}

type EndKind = Shot['kind'];

export class BallTracks {
  readonly balls: FlyingBall[] = [];
  private readonly sim: BallSimulator;
  private readonly cache = new Map<number, Trajectory>();
  /** 入賞先ごとの差し替え用軌跡（釘の強化で out→start1 になった玉など）。 */
  private readonly pools: Record<'start1' | 'out', Trajectory[]> = { start1: [], out: [] };
  private searchKey = 0;
  /** 発射待ち（fireAt 昇順）と、受け取り済みの玉番号（重複除去）。 */
  private queue: Shot[] = [];
  private readonly seen = new Map<number, number>();

  constructor(board: Board, dirs: readonly Vec2[], maxBalls = MAX_BALLS) {
    this.sim = new BallSimulator(board, dirs);
    for (let i = 0; i < maxBalls; i++) {
      this.balls.push({ active: false, x: 0, y: 0, shot: null, traj: null, cursor: 0 });
    }
  }

  /** 表示時刻 now の時点でまだ着いていない玉を受け取る（同じ玉は1回だけ）。 */
  add(shots: readonly Shot[], now: number, prerollMs = PREROLL_MS): void {
    for (const s of shots) {
      if (this.seen.has(s.ball) || s.sensorAt <= now || s.fireAt < now - prerollMs || s.sensorAt <= s.fireAt) {
        continue;
      }
      this.seen.set(s.ball, s.sensorAt);
      this.queue.push(s);
    }
    this.queue.sort((a, b) => a.fireAt - b.fireAt || a.ball - b.ball);
    if (this.queue.length > QUEUE_SIZE) {
      this.queue.splice(0, this.queue.length - QUEUE_SIZE);
    }
  }

  /** 表示時刻 now まで進める。今回着いた玉ごとに onEnd を呼ぶ（ヘソ入賞の光など）。 */
  update(now: number, onEnd: (kind: EndKind, x: number, y: number) => void): void {
    let n = 0;
    while (n < this.queue.length && (this.queue[n] as Shot).fireAt <= now) n++;
    if (n > 0) {
      for (const s of this.queue.splice(0, n)) this.launch(s, now);
    }
    for (const b of this.balls) {
      if (!b.active || !b.shot || !b.traj) continue;
      const s = b.traj.samples;
      const last = s[s.length - 1];
      if (!last) continue;
      if (now >= b.shot.sensorAt) {
        b.active = false;
        b.x = last.x;
        b.y = last.y;
        onEnd(b.shot.kind, last.x, last.y);
        continue;
      }
      // 軌跡の長さを Engine のセンサー時刻に合わせて伸縮する（正準の軌跡ならほぼ等倍）。
      const step = ((now - b.shot.fireAt) / (b.shot.sensorAt - b.shot.fireAt)) * last.step;
      while (b.cursor < s.length - 1 && (s[b.cursor + 1] as { step: number }).step <= step) b.cursor++;
      const a = s[b.cursor];
      const c = s[b.cursor + 1];
      if (!a) continue;
      if (!c) {
        b.x = a.x;
        b.y = a.y;
        continue;
      }
      const k = Math.max(0, Math.min(1, (step - a.step) / (c.step - a.step)));
      b.x = a.x + (c.x - a.x) * k;
      b.y = a.y + (c.y - a.y) * k;
    }
    for (const [ball, end] of this.seen) {
      if (end < now) this.seen.delete(ball);
    }
  }

  /** 正準条件の軌跡（キャッシュ付き）。入賞先が Engine と違えば、その入賞先の軌跡に差し替える。 */
  trajectoryFor(shot: Shot): Trajectory {
    const t = this.canonical(shot.key);
    if (t.outcome.kind === shot.kind || shot.kind === 'lost') return t;
    return this.substitute(shot.kind, shot.sensorAt - shot.fireAt) ?? t;
  }

  get pending(): number {
    return this.queue.length;
  }

  get cached(): number {
    return this.cache.size;
  }

  private launch(s: Shot, now: number): void {
    if (s.sensorAt <= now) return;
    const b = this.balls.find((x) => !x.active);
    if (!b) return;
    b.shot = s;
    b.traj = this.trajectoryFor(s);
    b.cursor = 0;
    b.active = true;
    const first = b.traj.samples[0];
    b.x = first?.x ?? 0;
    b.y = first?.y ?? 0;
  }

  private canonical(key: number): Trajectory {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const t = this.sim.trajectory(canonicalParamsForKey(key), TRAJ_EVERY);
    if (this.cache.size >= CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, t);
    return t;
  }

  /** kind に着く軌跡のうち、飛行時間が flightMs に最も近いもの（足りなければ少し探す）。 */
  private substitute(kind: 'start1' | 'out', flightMs: number): Trajectory | null {
    const pool = this.pools[kind];
    for (let i = 0; i < SEARCH_TRIES && pool.length < POOL_SIZE; i++) {
      // 方向を散らしつつ全キーを一巡する順（素数の刻み）。
      this.searchKey = (this.searchKey + 7919) % 65536;
      const t = this.sim.trajectory(canonicalParamsForKey(this.searchKey), TRAJ_EVERY);
      const p = t.outcome.kind === 'start1' || t.outcome.kind === 'out' ? this.pools[t.outcome.kind] : null;
      if (p && p.length < POOL_SIZE) p.push(t);
    }
    let best: Trajectory | null = null;
    for (const t of pool) {
      if (!best || Math.abs(t.outcome.flightMs - flightMs) < Math.abs(best.outcome.flightMs - flightMs)) best = t;
    }
    return best;
  }
}
