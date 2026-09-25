/** P3で差し込む経済の接続口（P2-T5では仮実装のStubを使う）。 */
export interface EconomyPort {
  /** 状態の複写（Engineのsnapshotに含める）。 */
  snapshot(): unknown;
  /** 複写から復元する。 */
  restore(s: unknown): void;
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
}
