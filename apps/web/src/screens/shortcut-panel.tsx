import { useState } from 'react';
import { readClipboard, writeClipboard } from '../platform/clipboard.ts';
import { isShortcutReady, runShortcut, shortcutIcloudUrl } from '../platform/shortcut.ts';
import styles from './activity.module.css';

const GUIDE_URL = 'https://github.com/IXIN0530/pocketHeso/blob/main/resources/shortcut/README.md';

/** 「運動を受け取る」（spec/31）: ショートカット起動 → 戻って貼り付け → 確認画面。 */
export function ShortcutPanel({
  pairingKey,
  shortcutReadyAt,
  onEnsureKey,
  onCode,
  onFirstSuccess,
  onResetReady,
}: {
  pairingKey: string | undefined;
  /** 初めての受け取り成功時刻。無い間は準備の3手順（spec/31）。 */
  shortcutReadyAt: number | undefined;
  /** 鍵が無ければ作って保存して返す（初回の受け取りで自動生成）。 */
  onEnsureKey: () => Promise<string>;
  /** 貼り付けたコードを検証する。エラーなら文言を返す。 */
  onCode: (text: string) => string | null;
  /** 初めての受け取り成功で shortcutReadyAt を保存する。 */
  onFirstSuccess: () => void;
  /** 準備をやり直す（shortcutReadyAt を消す）。 */
  onResetReady: () => void;
}) {
  const [manual, setManual] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const ready = isShortcutReady(shortcutReadyAt);
  const icloudUrl = shortcutIcloudUrl();

  const submit = (text: string) => {
    const err = onCode(text);
    setMessage(err);
    if (err === null) {
      setManual('');
      if (!ready) {
        onFirstSuccess();
      }
    }
  };

  const receive = async () => {
    const key = await onEnsureKey();
    runShortcut(key);
  };

  const paste = async () => {
    const text = await readClipboard();
    if (text === null) {
      setDetailsOpen(true);
      setMessage('貼り付けできませんでした。下の詳細の欄を長押し →「ペースト」で貼ってください');
      return;
    }
    submit(text);
  };

  const copyKey = async () => {
    setMessage((await writeClipboard(pairingKey ?? '')) ? '鍵をコピーしました' : 'コピーできませんでした。鍵を長押しして選んでください');
  };

  const advanced = (
    <details open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
      <summary>詳細（手作り・旧版のショートカット用）</summary>
      <p className={styles.note}>鍵は初回の受け取りで自動で作られます。通常は見る必要はありません。</p>
      {pairingKey === undefined ? (
        <p className={styles.note}>まだ鍵がありません。「運動を受け取る」で作られます。</p>
      ) : (
        <p className={styles.key}>{pairingKey}</p>
      )}
      <div className={styles.row}>
        <button className={styles.sub} disabled={pairingKey === undefined} onClick={() => void copyKey()}>
          鍵をコピー
        </button>
      </div>
      <textarea
        className={styles.textarea}
        value={manual}
        placeholder="PH1.…"
        aria-label="受け取りコードを手で貼る欄"
        onChange={(e) => setManual(e.target.value)}
      />
      <div className={styles.row}>
        <button className={styles.sub} disabled={manual.trim() === ''} onClick={() => submit(manual)}>
          この内容で受け取る
        </button>
      </div>
      <p className={styles.note}>
        追加の手順:{' '}
        <a className={styles.link} href={GUIDE_URL} target="_blank" rel="noreferrer">
          ショートカットの使い方
        </a>
      </p>
    </details>
  );

  if (!ready) {
    return (
      <section className={styles.card}>
        <h2>運動を受け取る（ヘルスケア）</h2>
        <ol className={styles.list}>
          <li>
            ① ショートカットを追加
            <div className={styles.row}>
              {icloudUrl === '' ? (
                <p className={styles.note}>
                  準備中（配布リンクは P8-T3 で用意します）。作り方は{' '}
                  <a className={styles.link} href={GUIDE_URL} target="_blank" rel="noreferrer">
                    ショートカットの使い方
                  </a>{' '}
                  を見てください。
                </p>
              ) : (
                <a className={styles.button} href={icloudUrl} target="_blank" rel="noreferrer">
                  ショートカットを追加
                </a>
              )}
            </div>
          </li>
          <li>② iPhone の設定 → アプリ → ショートカット → 詳細 →「大量のデータの共有を許可」をオン</li>
          <li>
            ③ 試しに受け取る
            <div className={styles.row}>
              <button className={styles.button} onClick={() => void receive()}>
                運動を受け取る
              </button>
              <button className={styles.button} onClick={() => void paste()}>
                貼り付けて受け取る
              </button>
            </div>
            <p className={styles.note}>ショートカットの通知が出たら PocketHeso に戻り「貼り付けて受け取る」。</p>
          </li>
        </ol>
        {message && <p className={styles.error}>{message}</p>}
        {advanced}
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <h2>運動を受け取る（ヘルスケア）</h2>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => void receive()}>
          運動を受け取る
        </button>
        <button className={styles.button} onClick={() => void paste()}>
          貼り付けて受け取る
        </button>
      </div>
      <p className={styles.note}>ショートカットの通知が出たら PocketHeso に戻り「貼り付けて受け取る」。</p>
      {message && <p className={styles.error}>{message}</p>}
      <div className={styles.row}>
        <button className={styles.sub} onClick={onResetReady}>
          準備をやり直す
        </button>
      </div>
      {advanced}
    </section>
  );
}
