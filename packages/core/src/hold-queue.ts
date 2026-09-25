/** 保留キュー（`hold_max` 可変。満タン時は overflow）と取得処理（spec/21）。 */
import type { MachineSpec, PatternTable } from './machine.ts';
import type { HoldEntry, LotteryMode } from './lottery.ts';
import { drawHold, hesoPayoutBalls } from './lottery.ts';

/** 取得結果（賞球は満タン時も支払い、`entry` は `null`）。 */
export interface AcquireResult {
  readonly hesoPayoutBalls: number;
  readonly entry: HoldEntry | null;
  readonly overflow: boolean;
}

/** 上限（`hold_max`）を検証する。 */
function assertHoldMax(holdMax: number): number {
  if (typeof holdMax !== 'number' || !Number.isFinite(holdMax) || Math.floor(holdMax) !== holdMax || holdMax < 1 || holdMax > 8) {
    throw new Error('invalid lottery: holdMax must be an int in 1..8');
  }
  return holdMax;
}

/** 保留キュー（先入れ先出し。`hold_max` は可変）。 */
export class HoldQueue {
  private readonly entries: HoldEntry[] = [];
  private maxHold: number;

  constructor(holdMax: number) {
    this.maxHold = assertHoldMax(holdMax);
  }

  /** 上限。 */
  get max(): number {
    return this.maxHold;
  }

  /** 現在の保留数。 */
  get size(): number {
    return this.entries.length;
  }

  /** 満タンか。 */
  isFull(): boolean {
    return this.entries.length >= this.maxHold;
  }

  /** 上限を変える（縮小で溢れた分は捨てない。呼び出し側で消化する）。 */
  setMax(holdMax: number): void {
    this.maxHold = assertHoldMax(holdMax);
  }

  /** 末尾に追加する。満タンなら `false`（overflow）。 */
  tryAdd(entry: HoldEntry): boolean {
    if (this.isFull()) {
      return false;
    }
    this.entries.push(entry);
    return true;
  }

  /** 先頭を取り出す（空なら `null`）。 */
  takeFirst(): HoldEntry | null {
    const first = this.entries.shift();
    return first === undefined ? null : first;
  }

  /** 中身を先頭順に覗く（複写）。 */
  peekAll(): readonly HoldEntry[] {
    return [...this.entries];
  }

  /** 全消去。 */
  clear(): void {
    this.entries.length = 0;
  }
}

/** ヘソ入賞の取得処理（賞球＋保留追加。満タンなら overflow）。 */
export function acquireHold(
  spec: MachineSpec,
  patterns: PatternTable,
  seed: number,
  mode: LotteryMode,
  serial: number,
  rate: number,
  queue: HoldQueue,
): AcquireResult {
  const payout = hesoPayoutBalls(spec, rate);
  if (queue.isFull()) {
    return { hesoPayoutBalls: payout, entry: null, overflow: true };
  }
  const entry = drawHold(spec, patterns, seed, mode, serial, rate);
  queue.tryAdd(entry);
  return { hesoPayoutBalls: payout, entry, overflow: false };
}
