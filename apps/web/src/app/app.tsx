import { useEffect, useState } from 'react';
import { CORE_VERSION } from '@ph/core';
import { isStandalone, setupServiceWorker } from '../platform/pwa.ts';
import { ActivityScreen } from '../screens/activity-screen.tsx';
import { SPIKE_NAMES } from '../spikes/spike-names.ts';
import styles from './app.module.css';

export function App() {
  const [applyUpdate, setApplyUpdate] = useState<(() => Promise<void>) | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = setupServiceWorker(() => setApplyUpdate(() => update));
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return (
    <main className={styles.main}>
      <h1>PocketHeso</h1>
      <dl className={styles.status}>
        <dt>起動方法</dt>
        <dd>{isStandalone() ? 'ホーム画面（standalone）' : 'ブラウザ'}</dd>
        <dt>通信</dt>
        <dd>{online ? 'オンライン' : 'オフライン'}</dd>
        <dt>Core</dt>
        <dd>v{CORE_VERSION}</dd>
      </dl>
      <ActivityScreen />
      {applyUpdate && (
        <button className={styles.update} onClick={() => void applyUpdate()}>
          更新があります — 再読み込み
        </button>
      )}
      {__SHOW_SPIKES__ && (
        <ul className={styles.spikes}>
          {SPIKE_NAMES.map((name) => (
            <li key={name}>
              <a href={`/?spike=${name}`}>spike: {name}</a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
