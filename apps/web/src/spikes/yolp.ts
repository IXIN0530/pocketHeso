/** スパイク用: Yahoo!ローカルサーチ API（YOLP）で近くのジム・公園を探す。CORS 非対応のため JSONP で呼ぶ。 */
import type { Facility } from './geo-overpass.ts';

export const YOLP_ENDPOINT = 'https://map.yahooapis.jp/search/local/V1/localSearch';

/** 使う業種コードと範囲判定の半径（m）。YOLP は点しか返さないので全て半径で判定する。公園の 100m は仮置き。 */
export const YOLP_GENRES: ReadonlyArray<{ code: string; label: string; radiusM: number }> = [
  { code: '0405003', label: 'スポーツクラブ', radiusM: 60 },
  { code: '0301001', label: 'スポーツ施設', radiusM: 120 },
  { code: '0301013', label: 'スポーツ（その他）', radiusM: 120 },
  { code: '0303010', label: 'プール', radiusM: 60 },
  { code: '0305007', label: '公園', radiusM: 100 },
];

export function buildYolpUrl(appid: string, lat: number, lon: number, radiusM: number, callback: string): string {
  const q = new URLSearchParams({
    appid,
    lat: String(lat),
    lon: String(lon),
    dist: String(radiusM / 1000),
    gc: YOLP_GENRES.map((g) => g.code).join(','),
    sort: 'dist',
    results: '100',
    output: 'json',
    callback,
  });
  return `${YOLP_ENDPOINT}?${q.toString()}`;
}

interface RawFeature {
  Gid?: unknown;
  Name?: unknown;
  Geometry?: { Coordinates?: unknown };
  Property?: { Genre?: Array<{ Code?: unknown; Name?: unknown }> };
}

/** YOLP の JSON 応答から施設一覧を作る。座標（"lon,lat"）の読めない要素は捨てる。 */
export function parseYolp(json: unknown): Facility[] {
  const features = (json as { Feature?: unknown } | null)?.Feature;
  if (!Array.isArray(features)) return [];
  const out: Facility[] = [];
  for (const f of features as RawFeature[]) {
    const coords = typeof f.Geometry?.Coordinates === 'string' ? f.Geometry.Coordinates.split(',').map(Number) : [];
    const [lon, lat] = coords;
    if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // 複数の業種を持つ施設があるので、対象の業種のうち最初に一致したものを使う。
    const codes = (f.Property?.Genre ?? []).map((g) => String(g.Code));
    const genre = YOLP_GENRES.find((g) => codes.includes(g.code));
    out.push({
      id: `yolp/${String(f.Gid)}`,
      leisure: genre?.label ?? `?${codes.join('|')}`,
      name: typeof f.Name === 'string' ? f.Name : '',
      lat,
      lon,
      bounds: null,
      ...(genre ? { radiusM: genre.radiusM } : {}),
    });
  }
  return out;
}

let seq = 0;

/** JSONP で1回問い合わせる。timeoutMs を過ぎたら失敗にする。 */
export function fetchJsonp(build: (callback: string) => string, timeoutMs = 15000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const name = `__phYolp${Date.now()}_${seq++}`;
    const w = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    const done = () => {
      clearTimeout(timer);
      delete w[name];
      script.remove();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`JSONP timeout ${timeoutMs}ms`));
    }, timeoutMs);
    w[name] = (data: unknown) => {
      done();
      resolve(data);
    };
    script.onerror = () => {
      done();
      reject(new Error('JSONP script load failed'));
    };
    script.src = build(name);
    document.head.appendChild(script);
  });
}
