// クリップボード（spec/41）。読み取りはユーザー操作の中で呼ぶ。失敗時は画面のテキスト欄で手貼り。

/** 読めなければ null（許可拒否・非対応）。 */
export async function readClipboard(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
