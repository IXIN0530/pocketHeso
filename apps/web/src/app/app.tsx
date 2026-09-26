import { Suspense, lazy, useEffect, useState } from 'react';
import { setupServiceWorker } from '../platform/pwa.ts';
import { ActivityScreen } from '../screens/activity-screen.tsx';
import { AwayModal } from '../screens/away-modal.tsx';
import { EngineStatus } from '../screens/engine-status.tsx';
import { HallScreen } from '../screens/hall-screen.tsx';
import { RecordsScreen } from '../screens/records-screen.tsx';
import { SettingsScreen } from '../screens/settings-screen.tsx';
import { ShopScreen } from '../screens/shop-screen.tsx';
import { startEngine } from '../stores/engine.ts';
import styles from './app.module.css';

// Debug 画面は `?debug=1` の時だけ読む（spec/40）。
const DebugScreen = lazy(() => import('../screens/debug-screen.tsx'));
const showDebug = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';

type Tab = 'hall' | 'shop' | 'activity' | 'records' | 'settings' | 'debug';

const TABS: readonly (readonly [Tab, string])[] = [
  ['hall', 'ホール'],
  ['shop', '強化'],
  ['activity', '行動'],
  ['records', '記録'],
  ['settings', '設定'],
  ...(showDebug ? [['debug', 'Debug'] as const] : []),
];

/** 画面の枠（spec/40）: 下部タブ。ホールは盤面を作り直さないよう常に置き、他のタブの間は描画だけ止める。 */
export function App() {
  const [tab, setTab] = useState<Tab>('hall');
  const [applyUpdate, setApplyUpdate] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    void startEngine();
  }, []);

  useEffect(() => {
    const update = setupServiceWorker(() => setApplyUpdate(() => update));
  }, []);

  return (
    <main className={styles.main}>
      <EngineStatus />
      {applyUpdate && (
        <button className={styles.update} onClick={() => void applyUpdate()}>
          更新があります — 再読み込み
        </button>
      )}
      <div hidden={tab !== 'hall'}>
        <HallScreen active={tab === 'hall'} />
      </div>
      {tab === 'shop' && <ShopScreen />}
      {tab === 'activity' && <ActivityScreen />}
      {tab === 'records' && <RecordsScreen />}
      {tab === 'settings' && <SettingsScreen />}
      {tab === 'debug' && (
        <Suspense>
          <DebugScreen />
        </Suspense>
      )}
      <nav className={styles.tabs} role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? styles.picked : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <AwayModal />
    </main>
  );
}
