import { useState } from 'react';
import { readClipboard, writeClipboard } from '../platform/clipboard.ts';
import { runShortcut } from '../platform/shortcut.ts';
import styles from './activity.module.css';

const GUIDE_URL = 'https://github.com/IXIN0530/pocketHeso/blob/main/resources/shortcut/README.md';

/** 「運動を受け取る」（spec/31）: ショートカット起動 → 戻って貼り付け → 確認画面。 */
export function ShortcutPanel({
  pairingKey,
  onCreateKey,
  onCode,
}: {
  pairingKey: string | undefined;
  onCreateKey: () => Promise<void>;
  /** 貼り付けたコードを検証する。エラーなら文言を返す。 */
  onCode: (text: string) => string | null;
}) {
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const submit = (text: string) => {
    const err = onCode(text);
    setMessage(err);
    if (err === null) {
      setManual('');
    }
  };

  const paste = async () => {
    const text = await readClipboard();
    if (text === null) {
      setShowManual(true);
      setMessage('貼り付けできませんでした。下の欄を長押し →「ペースト」で貼ってください');
      return;
    }
    submit(text);
  };

  const copyKey = async () => {
    setMessage((await writeClipboard(pairingKey ?? '')) ? '鍵をコピーしました' : 'コピーできませんでした。鍵を長押しして選んでください');
  };

  if (pairingKey === undefined) {
    return (
      <section className={styles.card}>
        <h2>運動を受け取る（ヘルスケア）</h2>
        <p>iPhone のショートカットで今日・昨日・一昨日の歩数を読み、燃料に換えます。はじめに連携の鍵を作ります。</p>
        <div className={styles.row}>
          <button className={styles.button} onClick={() => void onCreateKey()}>
            ショートカット連携を始める
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <h2>運動を受け取る（ヘルスケア）</h2>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => runShortcut()}>
          運動を受け取る
        </button>
        <button className={styles.button} onClick={() => void paste()}>
          貼り付けて受け取る
        </button>
      </div>
      <p className={styles.note}>ショートカットの通知が出たら PocketHeso に戻り「貼り付けて受け取る」。</p>
      {message && <p className={styles.error}>{message}</p>}
      {showManual && (
        <>
          <textarea
            className={styles.textarea}
            value={manual}
            placeholder="PH1.…"
            onChange={(e) => setManual(e.target.value)}
          />
          <div className={styles.row}>
            <button className={styles.sub} disabled={manual.trim() === ''} onClick={() => submit(manual)}>
              この内容で受け取る
            </button>
          </div>
        </>
      )}
      <details open={showKey} onToggle={(e) => setShowKey(e.currentTarget.open)}>
        <summary>ショートカット連携（ペアリング鍵）</summary>
        <p>ショートカットを追加するときに、この鍵をそのまま貼ります。</p>
        <p className={styles.key}>{pairingKey}</p>
        <div className={styles.row}>
          <button className={styles.sub} onClick={() => void copyKey()}>
            鍵をコピー
          </button>
          <button className={styles.sub} onClick={() => setShowManual((v) => !v)}>
            手で貼る欄
          </button>
        </div>
        <p className={styles.note}>
          追加の手順:{' '}
          <a className={styles.link} href={GUIDE_URL} target="_blank" rel="noreferrer">
            ショートカットの使い方
          </a>
        </p>
      </details>
    </section>
  );
}
