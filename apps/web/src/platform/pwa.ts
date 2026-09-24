import { registerSW } from 'virtual:pwa-register';

/** Service Worker を登録し、新しい版が待機したら onNeedRefresh を呼ぶ。戻り値で更新を適用する。 */
export function setupServiceWorker(onNeedRefresh: () => void): () => Promise<void> {
  const update = registerSW({ onNeedRefresh });
  return () => update(true);
}

/** ホーム画面から standalone で起動しているか。 */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}
