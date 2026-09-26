// 位置の取得（spec/32）。前面で1回ずつ取り、結果は保存しない。
import type { Fix } from '@ph/claims';

export const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

export type GeoErrorCode = 'denied' | 'unavailable' | 'timeout' | 'unsupported';
export type GeoResult = { readonly k: 'fix'; readonly fix: Fix } | { readonly k: 'error'; readonly code: GeoErrorCode };

const CODES: Record<number, GeoErrorCode> = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

export const GEO_ERROR_TEXT: Record<GeoErrorCode, string> = {
  denied: '位置情報が許可されていません。チェックインは使えないので、自己申告で記録できます',
  unavailable: '現在地を取得できませんでした。屋外に近づいてもう一度試してください',
  timeout: '現在地の取得が時間切れになりました。もう一度試してください',
  unsupported: 'この端末では位置情報を使えません',
};

/** 現在地を1回取る（許可はホーム画面アプリでも起動のたびに聞かれる）。 */
export function getFix(geo: Geolocation | undefined = navigator.geolocation): Promise<GeoResult> {
  if (geo === undefined) {
    return Promise.resolve({ k: 'error', code: 'unsupported' });
  }
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (p) => resolve({ k: 'fix', fix: { lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy } }),
      (e) => resolve({ k: 'error', code: CODES[e.code] ?? 'unavailable' }),
      GEO_OPTIONS,
    );
  });
}
