import { BallSimulator, MAX_SPEED_Q, type Board, type Trajectory, type Vec2 } from '@ph/core';

/** 軌跡のサンプル間隔（ステップ数）。spec/50 の `trajectory(canonicalParams, 4)`。 */
const EVERY = 4;
const STEPS_PER_MS = 960 / 1000;
/** 同時に飛ぶ玉の上限と発射間隔。実機（毎分100発）より速く打ち、盤面をにぎやかにする。 */
export const MAX_BALLS = 20;
const FIRE_MS = 150;
/** ヘソに入る軌跡を選ぶ割合（見た目用に自然な率より高くする）。 */
const HESO_SHARE = 0.12;
/** 開いた瞬間に「直近この時間内に打った玉」を途中から再生する（spec/50）。 */
const PREROLL_MS = 5000;

export interface FlyingBall {
  traj: Trajectory;
  startMs: number;
  cursor: number;
  x: number;
  y: number;
  active: boolean;
}

/**
 * 軌跡プールと再生。軌跡は Core の BallSimulator で事前計算し、毎フレーム線形補間する。
 * プールは少しずつ（1フレーム数本）作るので、起動時に長く止まらない。
 */
export class BallPlayer {
  readonly balls: FlyingBall[] = [];
  private readonly sim: BallSimulator;
  private readonly normal: Trajectory[] = [];
  private readonly heso: Trajectory[] = [];
  private tries = 0;
  private nextFireMs: number;

  constructor(board: Board, dirs: readonly Vec2[], nowMs: number) {
    this.sim = new BallSimulator(board, dirs);
    for (let i = 0; i < MAX_BALLS; i++) {
      this.balls.push({ traj: { samples: [], outcome: { kind: 'lost', flightMs: 0, steps: 0 } }, startMs: 0, cursor: 0, x: 0, y: 0, active: false });
    }
    this.grow(48);
    this.nextFireMs = nowMs - PREROLL_MS;
  }

  /** プールを少し増やす（毎フレーム呼ぶ。十分たまったら何もしない）。 */
  grow(n: number): void {
    if (this.normal.length >= 160 && this.heso.length >= 24) return;
    if (this.tries > 6000) return;
    for (let i = 0; i < n; i++) {
      this.tries++;
      const t = this.sim.trajectory(
        { dirIndex: Math.floor(Math.random() * 1024), speedQ: Math.floor(Math.random() * (MAX_SPEED_Q + 1)) },
        EVERY,
      );
      // レーンから盤面に出ない玉・タイムアウトは見栄えが悪いので使わない。
      if (t.outcome.kind === 'lost' || !t.samples.some((s) => s.x < 380)) continue;
      if (t.outcome.kind === 'start1') {
        if (this.heso.length < 24) this.heso.push(t);
      } else if (this.normal.length < 160) {
        this.normal.push(t);
      }
    }
  }

  /**
   * 時刻 now まで進める。今のフレームで飛び終わった玉ごとに onEnd（ヘソ入賞の演出用）を呼ぶ。
   * 発射は FIRE_MS ごと。上限に達している時はその発射を見送る。
   */
  update(nowMs: number, onEnd: (kind: string, x: number, y: number) => void): void {
    // 背面から戻った時も、巻き戻して打つのは直近 PREROLL_MS だけ。
    if (nowMs - this.nextFireMs > PREROLL_MS) this.nextFireMs = nowMs - PREROLL_MS;
    while (this.nextFireMs <= nowMs) {
      this.fire(this.nextFireMs);
      this.nextFireMs += FIRE_MS;
    }
    for (const b of this.balls) {
      if (!b.active) continue;
      const step = (nowMs - b.startMs) * STEPS_PER_MS;
      const s = b.traj.samples;
      while (b.cursor < s.length - 1 && (s[b.cursor + 1]?.step ?? Infinity) <= step) b.cursor++;
      const a = s[b.cursor];
      const n = s[b.cursor + 1];
      if (!a) continue;
      if (!n) {
        b.active = false;
        onEnd(b.traj.outcome.kind, a.x, a.y);
        continue;
      }
      const k = (step - a.step) / (n.step - a.step);
      b.x = a.x + (n.x - a.x) * k;
      b.y = a.y + (n.y - a.y) * k;
    }
  }

  private fire(atMs: number): void {
    const pool = Math.random() < HESO_SHARE && this.heso.length > 0 ? this.heso : this.normal;
    const traj = pool[Math.floor(Math.random() * pool.length)];
    if (!traj) return;
    // 巻き戻し中に飛び終わっている玉は、演出なしで空きに戻す。
    const b = this.balls.find((x) => !x.active || x.startMs + x.traj.outcome.flightMs < atMs);
    if (!b) return;
    b.traj = traj;
    b.startMs = atMs;
    b.cursor = 0;
    b.active = true;
    const first = traj.samples[0];
    b.x = first?.x ?? 0;
    b.y = first?.y ?? 0;
  }
}
