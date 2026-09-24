import { useEffect, useRef, useState } from 'react';
import { isStandalone } from '../platform/pwa.ts';
import { decodeShortcutCode } from './shortcut-code.ts';
import styles from './spike.module.css';

const DEFAULT_NAME = 'PocketHeso Sync';

const stamp = () => new Date().toISOString().slice(11, 23);

/** P0-T3: PWA → ショートカット起動 → 復帰検知 → クリップボード読み取りの実測画面。 */
export function ShortcutSpike() {
  const [name, setName] = useState(DEFAULT_NAME);
  const [log, setLog] = useState<string[]>([]);
  const [raw, setRaw] = useState('');
  const openedAt = useRef<number | null>(null);

  const add = (line: string) => setLog((l) => [`${stamp()} ${line}`, ...l].slice(0, 50));

  useEffect(() => {
    const since = () => (openedAt.current === null ? '' : ` (+${Date.now() - openedAt.current}ms)`);
    const onVis = () => add(`visibilitychange → ${document.visibilityState}${since()}`);
    const onShow = (e: PageTransitionEvent) => add(`pageshow persisted=${e.persisted}${since()}`);
    const onHide = () => add(`pagehide${since()}`);
    const onFocus = () => add(`focus${since()}`);
    const onBlur = () => add(`blur${since()}`);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onShow);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    add(`起動 standalone=${isStandalone()} clipboard.readText=${typeof navigator.clipboard?.readText}`);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const open = () => {
    const url = `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
    openedAt.current = Date.now();
    add(`open ${url}`);
    window.location.href = url;
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      add(`readText OK (${text.length} 文字)`);
      setRaw(text);
    } catch (e) {
      add(`readText 失敗: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    }
  };

  const decoded = raw ? decodeShortcutCode(raw) : null;

  return (
    <main className={styles.main}>
      <a className={styles.back} href="/">← 本体へ</a>
      <h1>spike: shortcut</h1>
      <label>
        ショートカット名
        <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className={styles.row}>
        <button className={styles.button} onClick={open}>ショートカットを開く</button>
        <button className={styles.button} onClick={() => void paste()}>貼り付け</button>
        <button className={styles.button} onClick={() => setLog([])}>ログ消去</button>
      </div>
      <label>
        生テキスト（readText が失敗したら手で貼る）
        <textarea className={styles.textarea} value={raw} onChange={(e) => setRaw(e.target.value)} />
      </label>
      {decoded && (
        <>
          <h2>デコード</h2>
          <pre className={styles.pre}>
            {decoded.ok ? `sig=${decoded.sig}\n${JSON.stringify(decoded.json, null, 2)}` : decoded.reason}
          </pre>
        </>
      )}
      <h2>ログ（新しい順）</h2>
      <pre className={styles.pre}>{log.join('\n')}</pre>
    </main>
  );
}
