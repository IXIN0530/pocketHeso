import { useCallback, useEffect, useState } from 'react';
import { CORE_VERSION } from '@ph/core';
import { isStandalone } from '../platform/pwa.ts';
import { loadSettings, openStorage, type Db } from '../platform/storage.ts';
import { formatFuel } from '../stores/activity.ts';
import { clock, dbNameFor } from '../stores/clock.ts';
import { act, resetGame, useEngine } from '../stores/engine.ts';
import { setPrefs, usePrefs } from '../stores/prefs.ts';
import { SPIKE_NAMES } from '../spikes/spike-names.ts';
import { SavePanel } from './save-panel.tsx';
import styles from './activity.module.css';

/** オート打ちで選べる割合（発射の枠のうち何割を打つか, spec/22）。 */
export const AUTO_SHARES: readonly (readonly [number, string])[] = [
  [0, '止める'],
  [0.25, '25%'],
  [0.5, '50%'],
  [1, '100%'],
];

const report = (e: unknown) => useEngine.setState({ error: e instanceof Error ? e.message : String(e) });

/** 設定画面（spec/40）: オート打ち・ブースト・演出・セーブ・リセット・アプリの情報。 */
export function SettingsScreen() {
  const p = useEngine((s) => s.projection);
  const prefs = usePrefs();
  const [db, setDb] = useState<Db | null>(null);
  const [lastExportAt, setLastExportAt] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [resetStep, setResetStep] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);

  const reload = useCallback(async (d: Db) => {
    setLastExportAt((await loadSettings(d)).lastExportAt);
  }, []);

  useEffect(() => {
    let opened: Db | null = null;
    openStorage(dbNameFor(clock.scale))
      .then(async (d) => {
        opened = d;
        await reload(d);
        setDb(d);
      })
      .catch(report);
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      opened?.close();
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [reload]);

  const send = (input: Parameters<typeof act>[0]) => {
    setBusy(true);
    act(input)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const autoOwned = (p?.shop?.upgrades.find((u) => u.id === 'auto')?.value ?? 0) > 0;
  const tomeuchi = (p?.shop?.upgrades.find((u) => u.id === 'tomeuchi')?.value ?? 0) > 0;
  const debugDb = clock.scale !== 1;

  return (
    <div className={styles.screen}>
      {p && (
        <section className={styles.card}>
          <h2>オート打ち</h2>
          {autoOwned ? (
            <>
              <p className={styles.note}>
                打たない間も自動で打ちます（燃料が切れると止まります{tomeuchi ? '。保留が満タンの間は止め打ち' : ''}）。
              </p>
              <div className={styles.row} role="radiogroup" aria-label="オート打ちの割合">
                {AUTO_SHARES.map(([share, label]) => (
                  <button
                    key={share}
                    role="radio"
                    aria-checked={p.auto.share === share}
                    className={p.auto.share === share ? styles.button : styles.sub}
                    disabled={busy}
                    onClick={() => send({ k: 'auto', share, rate: p.auto.rate })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {p.rates.length > 1 && (
                <div className={styles.row} role="radiogroup" aria-label="オート打ちのレート">
                  {p.rates.map((r) => (
                    <button
                      key={r}
                      role="radio"
                      aria-checked={p.auto.rate === r}
                      className={p.auto.rate === r ? styles.button : styles.sub}
                      disabled={busy}
                      onClick={() => send({ k: 'auto', share: p.auto.share, rate: r })}
                    >
                      {r}パチ
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className={styles.note}>強化タブの「オート打ち」を買うと使えます。</p>
          )}
        </section>
      )}
      {p?.shop && (
        <section className={styles.card}>
          <h2>ブースト</h2>
          <p className={styles.note}>
            燃料タンクから溢れた分がブーストになり、前面にいる間の生産が ×2 になります（残り {formatFuel(p.boostMs)}）。
          </p>
          <div className={styles.row}>
            <button className={p.shop.boostOn ? styles.button : styles.sub} disabled={busy} onClick={() => send({ k: 'boost', on: !p.shop!.boostOn })}>
              {p.shop.boostOn ? '使う（ON）' : '使わない（OFF）'}
            </button>
          </div>
        </section>
      )}
      <section className={styles.card}>
        <h2>演出</h2>
        <label className={styles.check}>
          <input type="checkbox" checked={prefs.bloom} onChange={(e) => setPrefs({ bloom: e.target.checked })} />
          当たりの光のにじみ（OFF で軽くなります）
        </label>
        <label>
          音量 {prefs.volume}
          <input className={styles.input} type="range" min={0} max={100} step={10} value={prefs.volume} onChange={(e) => setPrefs({ volume: Number(e.target.value) })} />
        </label>
        <p className={styles.note}>音は今後の更新で付きます。</p>
      </section>
      <section className={styles.card}>
        <h2>連携と登録地点</h2>
        <p className={styles.note}>ショートカット連携（ペアリング鍵）とトレーニングの登録地点は行動タブにあります。</p>
      </section>
      {db && <SavePanel lastExportAt={lastExportAt} onImported={() => reload(db)} />}
      <section className={styles.card}>
        <h2>リセット{debugDb && '（Debug のデータ）'}</h2>
        <p className={styles.note}>
          {debugDb ? 'Debug の時間倍率用のデータだけを消します。' : '玉・役物・行動の記録・設定をすべて消して最初から始めます。先にセーブを書き出しておくと戻せます。'}
        </p>
        <div className={styles.row}>
          {resetStep === 0 && (
            <button className={styles.sub} onClick={() => setResetStep(1)}>
              リセット…
            </button>
          )}
          {resetStep === 1 && (
            <>
              <button className={styles.danger} onClick={() => void resetGame().catch(report)}>
                すべて消す
              </button>
              <button className={styles.sub} onClick={() => setResetStep(0)}>
                やめる
              </button>
            </>
          )}
        </div>
      </section>
      <section className={styles.card}>
        <h2>アプリ</h2>
        <dl className={styles.facts}>
          <dt>起動方法</dt>
          <dd>{isStandalone() ? 'ホーム画面（standalone）' : 'ブラウザ'}</dd>
          <dt>通信</dt>
          <dd>{online ? 'オンライン' : 'オフライン'}</dd>
          <dt>Core</dt>
          <dd>v{CORE_VERSION}</dd>
        </dl>
        {__SHOW_SPIKES__ && (
          <ul className={styles.list}>
            {SPIKE_NAMES.map((name) => (
              <li key={name}>
                <a className={styles.link} href={`/?spike=${name}`}>
                  spike: {name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
