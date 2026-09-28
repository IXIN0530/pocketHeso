import { expect, test, vi } from 'vitest';
import { getFix } from './geo.ts';
import { generatePairingKey, isShortcutReady, PAIRING_KEY_ALPHABET, SHORTCUT_ICLOUD_URL, shortcutIcloudUrl, shortcutUrl } from './shortcut.ts';
import { canQueryYolp, searchYolp, yolpUrl } from './yolp.ts';

const fix = { lat: 35.1, lon: 139.2, accuracyM: 12 };

test('shortcut URL passes the key as text input', () => {
  const url = shortcutUrl('abc+def/ghi?');
  expect(url).toBe(`shortcuts://run-shortcut?name=PocketHeso%20Sync&input=text&text=${encodeURIComponent('abc+def/ghi?')}`);
  expect(url).toContain('input=text&text=');
});

test('shortcut iCloud URL defaults to empty (until P8-T3) and ready flag is the presence of shortcutReadyAt', () => {
  expect(SHORTCUT_ICLOUD_URL).toBe('');
  expect(shortcutIcloudUrl()).toBe('');
  expect(isShortcutReady(undefined)).toBe(false);
  expect(isShortcutReady(123)).toBe(true);
});

test('pairing key is 16 chars from the alphabet and rejects biased bytes', () => {
  const key = generatePairingKey();
  expect(key).toHaveLength(16);
  expect([...key].every((c) => PAIRING_KEY_ALPHABET.includes(c))).toBe(true);
  // 248 以上（31 の倍数を超える）は捨てて引き直す。
  let call = 0;
  const bytes = (n: number) => new Uint8Array(n).fill(call++ === 0 ? 255 : 32);
  expect(generatePairingKey(bytes)).toBe(PAIRING_KEY_ALPHABET[1]?.repeat(16));
});

test('YOLP URL: 0.3km, sorted by distance, JSONP callback, target genres', () => {
  const u = new URL(yolpUrl('ID', fix, 'cb'));
  expect(u.origin + u.pathname).toBe('https://map.yahooapis.jp/search/local/V1/localSearch');
  expect(u.searchParams.get('dist')).toBe('0.3');
  expect(u.searchParams.get('sort')).toBe('dist');
  expect(u.searchParams.get('results')).toBe('100');
  expect(u.searchParams.get('output')).toBe('json');
  expect(u.searchParams.get('callback')).toBe('cb');
  expect(u.searchParams.get('gc')).toBe('0405003,0301001,0301013,0303010,0305007');
});

test('YOLP: at most 2 calls per session', () => {
  expect([0, 1, 2].map(canQueryYolp)).toEqual([true, true, false]);
});

test('searchYolp parses, and is null without an ID or on failure', async () => {
  const ok = vi.fn(async () => ({
    ResultInfo: { Count: 1 },
    Feature: [{ Gid: 'g', Name: 'ジム', Geometry: { Coordinates: '139.2,35.1' }, Property: { Genre: [{ Code: '0405003' }] } }],
  }));
  expect(await searchYolp(fix, 'ID', ok)).toEqual([{ gid: 'g', name: 'ジム', genre: 'スポーツクラブ', lat: 35.1, lon: 139.2, radiusM: 60 }]);
  expect(ok).toHaveBeenCalledTimes(1);
  const never = vi.fn(async () => ({}));
  expect(await searchYolp(fix, null, never)).toBeNull();
  expect(never).not.toHaveBeenCalled();
  expect(await searchYolp(fix, 'ID', async () => Promise.reject(new Error('timeout')))).toBeNull();
  expect(await searchYolp(fix, 'ID', async () => ({ Error: { Message: 'bad appid' } }))).toBeNull();
});

test('getFix maps position and error codes, with the spec options', async () => {
  const seen: PositionOptions[] = [];
  const geo = (r: { ok: boolean; code?: number }) =>
    ({
      getCurrentPosition: (ok: PositionCallback, ng: PositionErrorCallback, opt: PositionOptions) => {
        seen.push(opt);
        if (r.ok) ok({ coords: { latitude: 1, longitude: 2, accuracy: 30 } } as GeolocationPosition);
        else ng({ code: r.code } as GeolocationPositionError);
      },
    }) as unknown as Geolocation;
  expect(await getFix(geo({ ok: true }))).toEqual({ k: 'fix', fix: { lat: 1, lon: 2, accuracyM: 30 } });
  expect(await getFix(geo({ ok: false, code: 1 }))).toEqual({ k: 'error', code: 'denied' });
  expect(await getFix(geo({ ok: false, code: 3 }))).toEqual({ k: 'error', code: 'timeout' });
  expect(seen[0]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
});
