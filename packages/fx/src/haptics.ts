type Vibrate = (pattern: number[]) => boolean;

function defaultVibrate(): Vibrate | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  return (p) => navigator.vibrate(p);
}

/** 振動（spec/43）。navigator.vibrate がある端末（Android）だけ動き、iOS は no-op。 */
export class Haptics {
  /** 設定 `fx.haptics`。 */
  enabled = true;

  constructor(private readonly vibrate: Vibrate | null = defaultVibrate()) {}

  get supported(): boolean {
    return this.vibrate !== null;
  }

  play(pattern: readonly number[]): void {
    if (this.enabled && this.vibrate && pattern.length > 0) this.vibrate([...pattern]);
  }

  stop(): void {
    if (this.vibrate) this.vibrate([]);
  }
}
