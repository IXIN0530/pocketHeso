import { useState } from 'react';
import { writeClipboard } from '../platform/clipboard.ts';
import { exportSave, importSave } from '../stores/engine.ts';
import styles from './activity.module.css';

/** セーブの書き出し/読み込み（spec/41）。P5-T4 で設定画面へ移す。 */
export function SavePanel({ lastExportAt, onImported }: { lastExportAt: number | undefined; onImported: () => Promise<void> }) {
  const [exported, setExported] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      const s = await exportSave();
      const copied = await writeClipboard(s);
      setExported(copied ? null : s);
      setMessage(copied ? 'セーブをコピーしました。メモなど安全な場所に貼って保管してください' : 'コピーできませんでした。下の文字列を全部選んでコピーしてください');
      await onImported();
    } catch (e) {
      setMessage(`書き出せませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      await importSave(text);
      await onImported();
      setText('');
      setMessage('読み込みました');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <section className={styles.card}>
      <h2>セーブ</h2>
      <p className={styles.note}>
        機種変更やデータ消失に備えて書き出しておけます（最後の書き出し:{' '}
        {lastExportAt === undefined ? 'まだ' : new Date(lastExportAt).toLocaleDateString('ja-JP')}）。
      </p>
      <div className={styles.row}>
        <button className={styles.sub} disabled={busy} onClick={() => void doExport()}>
          書き出す（コピー）
        </button>
      </div>
      {exported !== null && <textarea className={styles.textarea} readOnly value={exported} onFocus={(e) => e.currentTarget.select()} />}
      <textarea
        className={styles.textarea}
        value={text}
        placeholder="PH-SAVE1:…"
        onChange={(e) => {
          setText(e.target.value);
          setConfirming(false);
        }}
      />
      <div className={styles.row}>
        {confirming ? (
          <>
            <button className={styles.button} disabled={busy} onClick={() => void doImport()}>
              置き換える
            </button>
            <button className={styles.sub} disabled={busy} onClick={() => setConfirming(false)}>
              やめる
            </button>
          </>
        ) : (
          <button className={styles.sub} disabled={busy || text.trim() === ''} onClick={() => setConfirming(true)}>
            読み込む
          </button>
        )}
      </div>
      {confirming && <p className={styles.error}>今のデータはすべてこのセーブで置き換わります。</p>}
      {message && <p className={styles.note}>{message}</p>}
    </section>
  );
}
