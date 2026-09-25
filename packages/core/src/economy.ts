/** P3で差し込む経済の接続口（P2-T5では仮実装のStubを使う）。 */
export interface EconomyPort {
  /** 状態の複写（Engineのsnapshotに含める）。 */
  snapshot(): unknown;
  /** 複写から復元する。 */
  restore(s: unknown): void;
  /** 同じ状態を持つ独立した複製（lookaheadが本体を汚さないために使う）。 */
  fork(): EconomyPort;
}

/** 何もしない経済（P2-T5の仮実装。tickは空で燃料・生産はEngine側で保持）。 */
export class StubEconomy implements EconomyPort {
  /** 空の状態を返す。 */
  snapshot(): unknown {
    return {};
  }

  /** 空の状態を受け入れる（中身は無視する）。 */
  restore(s: unknown): void {
    void s;
  }

  /** 新しいStubを返す（状態がないので複製と同じ）。 */
  fork(): EconomyPort {
    return new StubEconomy();
  }
}
