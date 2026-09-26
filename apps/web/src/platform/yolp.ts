// Yahoo!ローカルサーチ API（YOLP, spec/32）。CORS 非対応なので JSONP。結果は保存しない（規約）。
import { parseYolp, YOLP_GENRES, type Fix, type YolpPlace } from '@ph/claims';

export const YOLP_ENDPOINT = 'https://map.yahooapis.jp/search/local/V1/localSearch';
/** 1セッションで問い合わせてよい回数（開始・終了）。 */
export const YOLP_MAX_CALLS = 2;
export const YOLP_TIMEOUT_MS = 15000;
/** 施設一覧の下に出すクレジット（利用規約）。 */
export const YOLP_CREDIT = { text: 'Webサービス by Yahoo! JAPAN', href: 'https://developer.yahoo.co.jp/sitemap/' } as const;

/** プレビューで Vercel の環境変数が無いとき、spike: geo で入れた ID を使う（この端末の localStorage のみ）。 */
const SPIKE_APPID_KEY = 'ph.spike.yolpAppid';

/** Client ID（ビルド時の VITE_YOLP_APPID）。無ければ null（YOLP を使わず登録地点だけで判定）。 */
export function yolpAppId(): string | null {
  const env = import.meta.env.VITE_YOLP_APPID as string | undefined;
  if (env !== undefined && env.trim() !== '') {
    return env.trim();
  }
  try {
    const v = localStorage.getItem(SPIKE_APPID_KEY)?.trim();
    return v ? v : null;
  } catch {
    return null;
  }
}

export function yolpUrl(appid: string, fix: Fix, callback: string): string {
  const q = new URLSearchParams({
    appid,
    lat: String(fix.lat),
    lon: String(fix.lon),
    dist: '0.3',
    gc: YOLP_GENRES.map((g) => g.code).join(','),
    sort: 'dist',
    results: '100',
    output: 'json',
    callback,
  });
  return `${YOLP_ENDPOINT}?${q.toString()}`;
}

let seq = 0;

/** JSONP で1回問い合わせる。timeoutMs を過ぎたら失敗。 */
export function fetchJsonp(build: (callback: string) => string, timeoutMs: number = YOLP_TIMEOUT_MS): Promise<unknown> {
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

/** まだ問い合わせてよいか（1セッション2回まで）。 */
export function canQueryYolp(calls: number): boolean {
  return calls < YOLP_MAX_CALLS;
}

/** 近くの施設を問い合わせる。Client ID が無い・失敗・オフラインは null（登録地点だけで判定する）。 */
export async function searchYolp(
  fix: Fix,
  appid: string | null = yolpAppId(),
  fetcher: typeof fetchJsonp = fetchJsonp,
): Promise<YolpPlace[] | null> {
  if (appid === null) {
    return null;
  }
  try {
    return parseYolp(await fetcher((cb) => yolpUrl(appid, fix, cb)));
  } catch {
    return null;
  }
}
