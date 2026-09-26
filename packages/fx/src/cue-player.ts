import type { Cue } from '@ph/shared';

/** キューの実行先。offsetMs はキューの予定時刻からの遅れ（途中から再生した時の頭出し量）、nowMs は実行時の時刻。 */
export type CueSink = (cue: Cue, offsetMs: number, nowMs: number) => void;

/**
 * キューが効いている長さ（ms）。これを過ぎてから再生位置に来たキューは鳴らさない。
 * 音は素材の長さを SoundBus が知っているので、ms 指定が無ければ判断を任せる（Infinity）。
 */
export function cueSpanMs(cue: Cue): number {
  switch (cue.kind) {
    case 'sound':
      return cue.loop ? Infinity : (cue.ms ?? Infinity);
    case 'haptic': {
      let total = 0;
      for (const p of cue.pattern) total += p;
      return Math.max(1, total);
    }
    default:
      return cue.ms;
  }
}

/**
 * CueSheet を表示時刻に合わせて実行する（spec/43）。時計は呼び出し側が持つ（SimTime を表示用に遅らせた時刻など）。
 * start の origin が過去なら途中から再生: 既に終わったキューは飛ばし、効いている最中のキューは遅れ付きで実行する。
 */
export class CuePlayer {
  private cues: readonly Cue[] = [];
  private origin = 0;
  private next = 0;

  constructor(private readonly sink: CueSink) {}

  /** cues は at 昇順（resolveCueSheet の結果）。originMs は at=0 に当たる時刻。 */
  start(cues: readonly Cue[], originMs: number): void {
    this.cues = cues;
    this.origin = originMs;
    this.next = 0;
  }

  /** nowMs までに予定時刻が来たキューを実行する。 */
  update(nowMs: number): void {
    while (this.next < this.cues.length) {
      const cue = this.cues[this.next]!;
      const due = this.origin + cue.at;
      if (due > nowMs) break;
      this.next += 1;
      const offset = nowMs - due;
      if (offset < cueSpanMs(cue)) this.sink(cue, offset, nowMs);
    }
  }

  /** 残りのキューを捨てる（鳴っている音・光の停止は実行先で行う）。 */
  stop(): void {
    this.cues = [];
    this.next = 0;
  }

  get done(): boolean {
    return this.next >= this.cues.length;
  }
}
