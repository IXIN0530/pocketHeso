/// <reference lib="webworker" />
// Service Worker: アプリ本体と素材のプリキャッシュのみ。Engine は回さない（spec/41）。
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// workbox-window の messageSkipWaiting() は文字列ではなく `{ type: 'SKIP_WAITING' }` を送る。
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
