import { BallSimulator, MAX_SPEED_Q, atlasKeyForParams, canonicalParamsForKey, type Board, type Vec2 } from '@ph/core';
import type { Shot } from '../engine/engine-host.ts';

/** ヘソに入る玉を選ぶ割合（見た目用に自然な率より高くする）。 */
const HESO_SHARE = 0.12;

/**
 * Engine なしで盤面を見るためのデモの玉（`?spike=bakeoff`）。ランダムな Atlas キーの結果を
 * BallSimulator.run で求め、本番と同じ Shot にして BoardScene に渡す。
 */
export class DemoShots {
  private readonly sim: BallSimulator;
  private readonly heso: Shot[] = [];
  private ball = 0;

  constructor(board: Board, dirs: readonly Vec2[]) {
    this.sim = new BallSimulator(board, dirs);
  }

  /** 時刻 at に発射する1発。 */
  next(at: number): Shot | null {
    const pick = Math.random() < HESO_SHARE ? this.findHeso() : this.random();
    if (!pick) return null;
    const flight = pick.sensorAt - pick.fireAt;
    return { ...pick, ball: this.ball++, fireAt: at, sensorAt: at + flight };
  }

  private random(): Shot | null {
    const key = atlasKeyForParams({ dirIndex: Math.floor(Math.random() * 1024), speedQ: Math.floor(Math.random() * (MAX_SPEED_Q + 1)) });
    const o = this.sim.run(canonicalParamsForKey(key));
    if (o.kind !== 'start1' && o.kind !== 'out') return null;
    const s: Shot = { ball: 0, fireAt: 0, sensorAt: Math.round(o.flightMs), kind: o.kind, key };
    if (o.kind === 'start1' && this.heso.length < 24) this.heso.push(s);
    return s;
  }

  private findHeso(): Shot | null {
    for (let i = 0; i < 40 && this.heso.length < 4; i++) this.random();
    return this.heso[Math.floor(Math.random() * this.heso.length)] ?? this.random();
  }
}
