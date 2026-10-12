/** 設定 JSON の手書きバリデータの共通部品（経済定義・常連ツリー）。 */

export function fail(message: string): never {
  throw new Error('invalid economy: ' + message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(what + ' must be an object');
  }
  return value;
}

export function asArray(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(what + ' must be an array');
  }
  return value;
}

export function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(what + ' must be a finite number');
  }
  return value;
}

export function asString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(what + ' must be a non-empty string');
  }
  return value;
}

export function asInt(value: unknown, what: string): number {
  const n = asNumber(value, what);
  if (Math.floor(n) !== n) {
    fail(what + ' must be an int');
  }
  return n;
}

export function asPositive(value: unknown, what: string): number {
  const n = asNumber(value, what);
  if (n <= 0) {
    fail(what + ' must be > 0');
  }
  return n;
}

export function asIntRange(value: unknown, what: string, lo: number, hi: number): number {
  const n = asInt(value, what);
  if (n < lo || n > hi) {
    fail(what + ' out of range');
  }
  return n;
}

export function asNumberArray(value: unknown, what: string): readonly number[] {
  const raw = asArray(value, what);
  const out: number[] = [];
  for (let i = 0; i < raw.length; i = i + 1) {
    out.push(asNumber(raw[i], what + '[' + i + ']'));
  }
  return out;
}

/** 全要素が [lo, hi] に入り、狭義単調増加であることを検証する。 */
export function checkAscending(values: readonly number[], what: string, lo: number, hi: number): void {
  let prev = 0;
  for (let i = 0; i < values.length; i = i + 1) {
    const v = values[i] ?? Number.NaN;
    if (!(v >= lo && v <= hi)) {
      fail(what + '[' + i + '] out of range');
    }
    if (i > 0 && v <= prev) {
      fail(what + ' must be strictly ascending');
    }
    prev = v;
  }
}
