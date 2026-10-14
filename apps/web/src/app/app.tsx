import { Suspense, lazy, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { TabBar } from '../components/tab-bar.tsx';
import { isStandalone, setupServiceWorker } from '../platform/pwa.ts';
import { ActivityScreen } from '../screens/activity-screen.tsx';
import { AwayBanner, AwayModal } from '../screens/away-modal.tsx';
import { EngineStatus } from '../screens/engine-status.tsx';
import { HallScreen } from '../screens/hall-screen.tsx';
import { OnboardingGate } from '../screens/onboarding-sheet.tsx';
import { RecordsScreen } from '../screens/records-screen.tsx';
import { AutoOpenedBanner, RestBanner } from '../screens/rest-banner.tsx';
import { SettingsScreen } from '../screens/settings-screen.tsx';
import { ShopScreen } from '../screens/shop-screen.tsx';
import { startEngine } from '../stores/engine.ts';
import { usePreview } from '../stores/preview.ts';
import styles from './app.module.css';

// Debug 画面は `?debug=1` の時だけ読む（spec/40）。正式版には含めない（D-087、lazy import ごと落とす）。
const DebugScreen = __DEV_TOOLS__ ? lazy(() => import('../screens/debug-screen.tsx')) : null;
const showDebug =
  __DEV_TOOLS__ && typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';

type Tab = 'hall' | 'shop' | 'activity' | 'records' | 'settings' | 'debug';

const TABS: readonly (readonly [Tab, string])[] = [
  ['hall', 'ホール'],
  ['shop', '強化'],
  ['activity', '行動'],
  ['records', '記録'],
  ['settings', '設定'],
  ...(showDebug ? [['debug', 'Debug'] as const] : []),
];

const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/**
 * 画面の枠（spec/40）: 下部タブ。ホールは盤面を作り直さないよう常に置き、他のタブの間は描画だけ止める。
 * ホール以外は iOS の大きな見出しを付ける。タブの切り替えは View Transitions で短くクロスフェードする。
 */
export function App() {
  const [tab, setTab] = useState<Tab>('hall');

  // 今のタブをもう一度押すと先頭へ戻る（iOS と同じ）。
  const changeTab = (next: Tab) => {
    if (next === tab) {
      window.scrollTo({ top: 0, behavior: reducedMotion?.matches ? 'auto' : 'smooth' });
      return;
    }
    const swap = () => {
      setTab(next);
      window.scrollTo(0, 0);
    };
    if (typeof document.startViewTransition !== 'function' || reducedMotion?.matches) {
      swap();
      return;
    }
    document.startViewTransition(() => flushSync(swap));
  };
  const [applyUpdate, setApplyUpdate] = useState<(() => Promise<void>) | null>(null);
  // ホーム画面追加の案内は起動時の値で決める（P8-T4）。
  const [standalone] = useState(() => isStandalone());

  useEffect(() => {
    void startEngine();
  }, []);

  useEffect(() => {
    const update = setupServiceWorker(() => setApplyUpdate(() => update));
  }, []);

  // Debug の演出プレビューはホールの液晶で流す。
  useEffect(
    () =>
      usePreview.subscribe((s, prev) => {
        if (s.request !== prev.request) setTab('hall');
      }),
    [],
  );

  return (
    <main className={styles.main}>
      <EngineStatus />
      {applyUpdate && (
        <button className={styles.update} onClick={() => void applyUpdate()}>
          更新があります — 再読み込み
        </button>
      )}
      {tab !== 'hall' && <h1 className={styles.title}>{TABS.find(([id]) => id === tab)?.[1]}</h1>}
      <div hidden={tab !== 'hall'}>
        <HallScreen active={tab === 'hall'} />
      </div>
      {tab === 'shop' && <ShopScreen />}
      {tab === 'activity' && <ActivityScreen />}
      {tab === 'records' && <RecordsScreen />}
      {tab === 'settings' && <SettingsScreen />}
      {__DEV_TOOLS__ && tab === 'debug' && DebugScreen && (
        <Suspense>
          <DebugScreen />
        </Suspense>
      )}
      <TabBar tabs={TABS} value={tab} onChange={changeTab} />
      <RestBanner />
      <AutoOpenedBanner />
      <AwayBanner />
      <AwayModal />
      <OnboardingGate standalone={standalone} />
    </main>
  );
}
