// ショートカットの受け取りコード `PH1.<b64>.<sig16>` の検証（spec/31）。純関数（時刻・鍵は引数）。
import type { SimTime } from '@ph/core';
import { dayNumber } from './day.ts';
import type { HealthDay, ParsedHealth } from './ledger.ts';
import { sha256Hex } from './sha256.ts';

/**
 * 受け取りコードを弾いた理由。format: 壊れたコード（コピー漏れ・JSON 不正）/ version: 未対応の版 /
 * signature: 鍵が違う（別端末・別人・鍵の貼り間違い）/ stale: gen が now の ±30分外（古いコードの貼り間違い）。
 */
export type ClaimErrorCode = 'format' | 'version' | 'signature' | 'stale';

/** parseShortcutCode の失敗結果。 */
export interface ClaimError {
  readonly k: 'error';
  readonly code: ClaimErrorCode;
  readonly message: string;
}

const PREFIX = 'PH1.';
const FRESH_MS = 30 * 60000;
const MAX_DAYS = 3;
const MAX_STEPS = 100000;
const MAX_DIST_M = 100000;
const DAY_MS = 86400000;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function error(code: ClaimErrorCode, message: string): ClaimError {
  return { k: 'error', code, message };
}

/** 標準 Base64（パディング省略可）→ バイト列。不正なら null。 */
function decodeBase64(s: string): Uint8Array | null {
  const body = s.replace(/=+$/, '');
  if (body.length % 4 === 1 || s.length - body.length > 2) {
    return null;
  }
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (const ch of body) {
    const v = B64.indexOf(ch);
    if (v < 0) {
      return null;
    }
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n] = (acc >> bits) & 0xff;
      n += 1;
    }
  }
  return out;
}

/** ISO 8601（秒まで・小数秒可・オフセット必須）→ UNIX ms と、端末ローカルの日付。 */
function parseGen(gen: string): { atMs: number; localDay: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[.,]\d+)?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(gen);
  const day = m?.[1];
  const dn = day === undefined ? null : dayNumber(day);
  if (m === null || day === undefined || dn === null) {
    return null;
  }
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  const ss = Number(m[4]);
  if (hh > 23 || mm > 59 || ss > 60) {
    return null;
  }
  const sign = m[6] === '-' ? -1 : 1;
  const offsetMin = m[5] === 'Z' ? 0 : sign * (Number(m[7]) * 60 + Number(m[8]));
  const atMs = dn * DAY_MS + ((hh * 60 + mm - offsetMin) * 60 + ss) * 1000;
  return { atMs, localDay: day };
}

/** 0 以上の数（数値か数字だけの文字列）→ 切り捨て整数。それ以外は null。 */
function count(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 値の欠けた項目（`"steps":,` — 統計が空の日）を 0 にして読む。 */
function parseJson(text: string): { value: unknown; repaired: boolean } | null {
  try {
    return { value: JSON.parse(text) as unknown, repaired: false };
  } catch {
    try {
      return { value: JSON.parse(text.replace(/:(\s*)(?=[,}])/g, ':0')) as unknown, repaired: true };
    } catch {
      return null;
    }
  }
}

/** 受け取りコードを検証し、日ごとの歩数・距離を返す（範囲外の項目は捨てて warnings に書く）。 */
export function parseShortcutCode(text: string, pairingKey: string, now: SimTime): ParsedHealth | ClaimError {
  const code = text.trim();
  const broken = error('format', '受け取りコードが壊れています。もう一度 運動を受け取る を実行して貼り直してください');
  if (!code.startsWith(PREFIX)) {
    return broken;
  }
  const rest = code.slice(PREFIX.length);
  const dot = rest.lastIndexOf('.');
  const b64 = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);
  if (dot <= 0 || !/^[0-9a-fA-F]{16}$/.test(sig)) {
    return broken;
  }
  // Base64 の改行（エンコードの既定設定）は署名対象には含まれるが、デコード時は無視する。
  const bytes = decodeBase64(b64.replace(/\s+/g, ''));
  let json: string;
  try {
    json = bytes === null ? '' : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return broken;
  }
  const parsed = parseJson(json);
  if (parsed === null || !isRecord(parsed.value)) {
    return broken;
  }
  const o = parsed.value;
  if (o['v'] !== 1) {
    return error('version', 'このコードの版には対応していません。アプリとショートカットを最新にしてください');
  }
  const expected = sha256Hex(new TextEncoder().encode(pairingKey.trim() + b64)).slice(0, 16);
  if (sig.toLowerCase() !== expected) {
    return error('signature', 'ペアリング鍵が一致しません。ショートカットを追加し直してください');
  }
  const gen = typeof o['gen'] === 'string' ? parseGen(o['gen']) : null;
  if (gen === null || !Array.isArray(o['days'])) {
    return broken;
  }
  if (gen.atMs < now - FRESH_MS || gen.atMs > now + FRESH_MS) {
    return error('stale', '古いコードです。もう一度 運動を受け取る を実行してすぐ貼ってください');
  }

  const warnings: string[] = [];
  if (parsed.repaired) {
    warnings.push('値の無い項目を 0 として読みました');
  }
  const days: HealthDay[] = [];
  for (const raw of o['days'] as unknown[]) {
    const d = isRecord(raw) && typeof raw['d'] === 'string' ? raw['d'] : '';
    if (dayNumber(d) === null) {
      warnings.push('日付の読めない記録を捨てました');
      continue;
    }
    if (days.some((h) => h.day === d)) {
      warnings.push(d + ' の重複を捨てました');
      continue;
    }
    if (days.length >= MAX_DAYS) {
      warnings.push(d + ' は ' + MAX_DAYS + ' 日を超えるため捨てました');
      continue;
    }
    const r = raw as Record<string, unknown>;
    const steps = count(r['steps']);
    if (steps === null || steps > MAX_STEPS) {
      warnings.push(d + ' の歩数が範囲外のため捨てました');
      continue;
    }
    const distM = r['distM'] === undefined ? null : count(r['distM']);
    if (r['distM'] !== undefined && (distM === null || distM > MAX_DIST_M)) {
      warnings.push(d + ' の距離が範囲外のため捨てました');
    }
    days.push(distM === null || distM > MAX_DIST_M ? { day: d, steps } : { day: d, steps, distanceM: distM });
  }
  return { k: 'health', receivedAt: now, today: gen.localDay, days, warnings };
}
