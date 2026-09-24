/** スパイク用: 貼り付けたテキストを `PH1.<b64>.<sig>` として分解し、JSON を読めれば返す（署名は検証しない）。 */
export type DecodedCode =
  | { ok: true; json: unknown; sig: string }
  | { ok: false; reason: string };

export function decodeShortcutCode(raw: string): DecodedCode {
  const text = raw.trim();
  const parts = text.split('.');
  if (parts.length !== 3 || parts[0] !== 'PH1') return { ok: false, reason: 'PH1.<b64>.<sig> の形式ではない' };
  const [, b64 = '', sig = ''] = parts;
  let json: string;
  try {
    const bin = atob(b64.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: 'Base64 / UTF-8 として読めない' };
  }
  try {
    return { ok: true, json: JSON.parse(json) as unknown, sig };
  } catch {
    return { ok: false, reason: `JSON として読めない: ${json.slice(0, 200)}` };
  }
}
