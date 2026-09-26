// ローカル日付文字列（YYYY-MM-DD）の算術。Date を使わず暦日番号で計算する（決定論）。

/** 'YYYY-MM-DD' → 1970-01-01 からの日数。不正なら null。 */
export function dayNumber(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    return null;
  }
  // days_from_civil（H. Hinnant）
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = m > 2 ? m - 3 : m + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** 日数 → 'YYYY-MM-DD'。 */
export function dayString(n: number): string {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** day に delta 日を足す（day は検証済みであること）。 */
export function addDays(day: string, delta: number): string {
  const n = dayNumber(day);
  if (n === null) {
    throw new Error('invalid day: ' + day);
  }
  return dayString(n + delta);
}

/** 週番号（月曜始まり）。1970-01-01 は木曜。 */
export function weekOf(day: string): number {
  const n = dayNumber(day);
  if (n === null) {
    throw new Error('invalid day: ' + day);
  }
  return Math.floor((n + 3) / 7);
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return leap ? 29 : 28;
  }
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}
