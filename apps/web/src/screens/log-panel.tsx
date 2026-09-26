import { useState } from 'react';
import { writeClipboard } from '../platform/clipboard.ts';
import { stateDump } from '../stores/engine.ts';
import styles from './activity.module.css';

/** 計測ログ・記録のコピー（設定画面。Debug の URL にせずに P7-T2 のログ解析へ渡す）。 */
export function LogPanel() {
  const [text, setText] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    setBusy(true);
    try {
      const s = await stateDump();
      const copied = await writeClipboard(s);
      setText(copied ? null : s);
      setMessage(copied ? `コピーしました（${Math.ceil(s.length / 1024)}KB）` : 'コピーできませんでした。下の文字列を全部選んでコピーしてください');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.card}>
      <h2>計測ログ</h2>
      <p className={styles.note}>
        起動・前進の時間、保存の大きさ、受け取りと行動の記録、玉や統計をまとめてコピーします（位置は含みません）。自動では送りません。
      </p>
      <div className={styles.row}>
        <button className={styles.sub} disabled={busy} onClick={() => void copy()}>
          計測ログ・記録をコピー
        </button>
      </div>
      {message && <p className={styles.note}>{message}</p>}
      {text !== null && <textarea className={styles.textarea} readOnly value={text} rows={8} />}
    </section>
  );
}
