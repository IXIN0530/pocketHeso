// トレーニングのチェックイン判定（spec/32）。位置取得と YOLP 通信は apps/web、ここは純関数だけ。
// 生の座標は引数で受け取るだけで、戻り値のセッション・結果には入れない（登録地点の中心を除く）。
import type { SimTime } from '@ph/core';
import type { CheckinResult } from './ledger.ts';
import type { ClaimRules } from './rules.ts';

const MIN_MS = 60000;
const EARTH_R = 6371008.8;
const DEG = Math.PI / 180;

/** これより accuracy が悪い位置は判定に使わない（「屋外に近づいて再取得」を促す）。 */
export const RETRY_ACCURACY_M = 150;
/** 再取得を促す回数。これを超えて悪い位置しか取れなければ諦める。 */
export const MAX_RETRIES = 3;
/** 開始からこの時間で未終了のセッションは失効する。 */
export const EXPIRE_MS = 3 * 60 * MIN_MS;
/** 登録地点の既定の半径（m）。 */
export const DEFAULT_OWN_RADIUS_M = 80;

/** getCurrentPosition の結果（保存しない）。 */
export interface Fix {
  readonly lat: number;
  readonly lon: number;
  readonly accuracyM: number;
}

/** 利用者が登録した地点（中心は登録時の端末の実測位置）。 */
export interface OwnPlace {
  readonly placeId: string;
  readonly name: string;
  readonly kind: string;
  readonly lat: number;
  readonly lon: number;
  readonly radiusM: number;
}

/** YOLP の施設（parseYolp の結果。保存しない）。 */
export interface YolpPlace {
  readonly gid: string;
  readonly name: string;
  /** 業種名（半径を決めた業種）。 */
  readonly genre: string;
  readonly lat: number;
  readonly lon: number;
  readonly radiusM: number;
}

/** セッションが指す施設（YOLP は Gid だけを終了まで持つ）。 */
export type PlaceRef = { readonly k: 'own'; readonly placeId: string } | { readonly k: 'yolp'; readonly gid: string };

/** 開始時の候補（近い順）。 */
export interface Candidate {
  readonly ref: PlaceRef;
  readonly name: string;
  readonly kind: string;
  readonly distanceM: number;
}

/** 保存するセッション（生の座標・YOLP の座標は持たない）。 */
export interface CheckinSession {
  readonly sessionId: string;
  readonly place: PlaceRef;
  readonly startAt: SimTime;
  readonly startAccuracyM: number;
  /** 開始時の端末のローカル日付（報酬を数える日）。 */
  readonly day: string;
}

/** 終了時の判定（spec/32 の判定表）。 */
export type EndOutcome =
  | { readonly k: 'ok'; readonly minutes: number; readonly result: CheckinResult }
  /** 20分未満: 報酬なし（台帳には入れない）。 */
  | { readonly k: 'short'; readonly minutes: number }
  /** 施設外で終了: 成立させない。selfCheckin で自己申告に切り替えられる。 */
  | { readonly k: 'outside'; readonly minutes: number }
  /** 開始から3時間で未終了: 自動失効。selfCheckin で「終了し忘れ」を申告できる。 */
  | { readonly k: 'expired' };

/** YOLP の業種コードと範囲判定の半径（m）。公園の 100m は仮（P4 の実機で見直す）。 */
export const YOLP_GENRES: readonly { readonly code: string; readonly label: string; readonly radiusM: number }[] = [
  { code: '0405003', label: 'スポーツクラブ', radiusM: 60 },
  { code: '0301001', label: 'スポーツ施設', radiusM: 120 },
  { code: '0301013', label: 'スポーツ（その他）', radiusM: 120 },
  { code: '0303010', label: 'プール', radiusM: 60 },
  { code: '0305007', label: '公園', radiusM: 100 },
];

function fail(message: string): never {
  throw new Error('invalid checkin: ' + message);
}

function checkFix(fix: Fix): void {
  if (
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lon) ||
    fix.lat < -90 ||
    fix.lat > 90 ||
    fix.lon < -180 ||
    fix.lon > 180 ||
    !Number.isFinite(fix.accuracyM) ||
    fix.accuracyM < 0
  ) {
    fail('fix');
  }
}

/** 位置を判定に使えるか（usable）、再取得を促すか（retry）、諦めるか（give-up）。attempt はこの位置が何回目の取得か。 */
export function accuracyVerdict(fix: Fix, attempt: number): 'usable' | 'retry' | 'give-up' {
  checkFix(fix);
  if (fix.accuracyM <= RETRY_ACCURACY_M) {
    return 'usable';
  }
  return attempt <= MAX_RETRIES ? 'retry' : 'give-up';
}

/** 正距円筒近似の距離（m）。cosLat は基準点で1回だけ計算して渡す。 */
export function distanceM(from: Fix, cosLat: number, lat: number, lon: number): number {
  const dy = (lat - from.lat) * DEG * EARTH_R;
  const dx = (lon - from.lon) * DEG * EARTH_R * cosLat;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 中心からの距離 ≤ 半径 + accuracy なら範囲内（accuracy が悪すぎる位置は常に範囲外）。 */
export function inRange(fix: Fix, lat: number, lon: number, radiusM: number): boolean {
  checkFix(fix);
  if (fix.accuracyM > RETRY_ACCURACY_M) {
    return false;
  }
  return distanceM(fix, Math.cos(fix.lat * DEG), lat, lon) <= radiusM + fix.accuracyM;
}

function refKey(r: PlaceRef): string {
  return r.k === 'own' ? 'own/' + r.placeId : 'yolp/' + r.gid;
}

/** 開始時の候補: 範囲内の登録地点と YOLP 施設を近い順に（同距離は登録地点→ID 順）。 */
export function candidates(fix: Fix, own: readonly OwnPlace[], yolp: readonly YolpPlace[]): Candidate[] {
  checkFix(fix);
  if (fix.accuracyM > RETRY_ACCURACY_M) {
    return [];
  }
  const cosLat = Math.cos(fix.lat * DEG);
  const out: Candidate[] = [];
  for (const p of own) {
    const d = distanceM(fix, cosLat, p.lat, p.lon);
    if (d <= p.radiusM + fix.accuracyM) {
      out.push({ ref: { k: 'own', placeId: p.placeId }, name: p.name, kind: p.kind, distanceM: d });
    }
  }
  for (const p of yolp) {
    const d = distanceM(fix, cosLat, p.lat, p.lon);
    if (d <= p.radiusM + fix.accuracyM) {
      out.push({ ref: { k: 'yolp', gid: p.gid }, name: p.name, kind: p.genre, distanceM: d });
    }
  }
  return out.sort((a, b) => {
    if (a.distanceM !== b.distanceM) {
      return a.distanceM - b.distanceM;
    }
    const ka = refKey(a.ref);
    const kb = refKey(b.ref);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** 「ここを登録」: 中心は今の実測位置。accuracy が悪い位置では登録しない。 */
export function registerPlace(
  placeId: string,
  name: string,
  kind: string,
  fix: Fix,
  radiusM: number = DEFAULT_OWN_RADIUS_M,
): OwnPlace {
  checkFix(fix);
  if (placeId.length === 0 || fix.accuracyM > RETRY_ACCURACY_M || !Number.isFinite(radiusM) || radiusM <= 0) {
    fail('register');
  }
  return { placeId, name, kind, lat: fix.lat, lon: fix.lon, radiusM };
}

/** 候補を選んでセッションを始める（保存するのは placeRef・開始時刻・accuracy・日付だけ）。 */
export function startSession(sessionId: string, c: Candidate, fix: Fix, at: SimTime, day: string): CheckinSession {
  checkFix(fix);
  if (sessionId.length === 0 || fix.accuracyM > RETRY_ACCURACY_M) {
    fail('start');
  }
  return { sessionId, place: c.ref, startAt: at, startAccuracyM: fix.accuracyM, day };
}

/** 開始から3時間で失効（起動時の表示に使う）。 */
export function sessionState(s: CheckinSession, now: SimTime): 'open' | 'expired' {
  return now - s.startAt >= EXPIRE_MS ? 'expired' : 'open';
}

function elapsedMinutes(s: CheckinSession, now: SimTime): number {
  return now > s.startAt ? Math.floor((now - s.startAt) / MIN_MS) : 0;
}

export interface EndInput {
  readonly session: CheckinSession;
  readonly fix: Fix;
  readonly own: readonly OwnPlace[];
  /** 終了時に再問い合わせした YOLP の結果。失敗・オフラインは null（YOLP 施設は施設外扱い）。 */
  readonly yolp: readonly YolpPlace[] | null;
  readonly now: SimTime;
  /** 端末の今日（受け取れる日の基準）。 */
  readonly today: string;
}

/** 「トレーニング終了」の判定。失効 → 20分未満 → 範囲外 → 成立 の順に見る。 */
export function endSession(input: EndInput, rules: ClaimRules): EndOutcome {
  const { session: s, fix, now } = input;
  checkFix(fix);
  if (sessionState(s, now) === 'expired') {
    return { k: 'expired' };
  }
  const minutes = elapsedMinutes(s, now);
  if (minutes < rules.checkin.minMinutes) {
    return { k: 'short', minutes };
  }
  const ref = s.place;
  let center: { lat: number; lon: number; radiusM: number } | undefined;
  if (ref.k === 'own') {
    center = input.own.find((p) => p.placeId === ref.placeId);
  } else if (input.yolp !== null) {
    center = input.yolp.find((p) => p.gid === ref.gid);
  }
  if (center === undefined || !inRange(fix, center.lat, center.lon, center.radiusM)) {
    return { k: 'outside', minutes };
  }
  const base = {
    k: 'checkin' as const,
    receivedAt: now,
    today: input.today,
    sessionId: s.sessionId,
    day: s.day,
    minutes,
    span: [s.startAt, now] as const,
  };
  const result: CheckinResult = ref.k === 'own' ? { ...base, own: true, placeId: ref.placeId } : { ...base, own: false };
  return { k: 'ok', minutes, result };
}

/**
 * 施設外で終了・失効したセッションを自己申告に切り替える（trust 0.3、上限 selfMaxMinutes）。
 * minutes は利用者が入力した分。経過時間も超えない。0 分なら null。
 */
export function selfCheckin(
  s: CheckinSession,
  minutes: number,
  now: SimTime,
  today: string,
  rules: ClaimRules,
): CheckinResult | null {
  if (!Number.isFinite(minutes) || minutes < 0) {
    fail('minutes');
  }
  let m = Math.floor(minutes);
  const cap = rules.checkin.selfMaxMinutes;
  const elapsed = elapsedMinutes(s, now);
  m = m > cap ? cap : m;
  m = m > elapsed ? elapsed : m;
  if (m === 0) {
    return null;
  }
  return {
    k: 'checkin',
    receivedAt: now,
    today,
    sessionId: s.sessionId,
    day: s.day,
    own: s.place.k === 'own',
    selfReported: true,
    minutes: m,
    span: [s.startAt, s.startAt + m * MIN_MS],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * YOLP の JSON 応答を施設一覧にする。対象業種（YOLP_GENRES）に無い施設・座標の読めない施設は捨てる。
 * 同じ Gid が複数業種で重複して返るので1件にまとめ、半径は一致した業種のうち最大を使う。
 * 応答が壊れている・エラー応答なら null（失敗扱い）。0件は []。
 */
export function parseYolp(json: unknown): YolpPlace[] | null {
  if (!isRecord(json) || !isRecord(json['ResultInfo'])) {
    return null;
  }
  const features = json['Feature'];
  if (features === undefined) {
    return [];
  }
  if (!Array.isArray(features)) {
    return null;
  }
  const out: YolpPlace[] = [];
  for (const f of features as unknown[]) {
    if (!isRecord(f)) {
      continue;
    }
    const gid = f['Gid'];
    const geo = f['Geometry'];
    const coords = isRecord(geo) ? geo['Coordinates'] : undefined;
    if (typeof gid !== 'string' || gid.length === 0 || typeof coords !== 'string') {
      continue;
    }
    const parts = coords.split(',');
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (parts.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    const prop = f['Property'];
    const genres = isRecord(prop) && Array.isArray(prop['Genre']) ? (prop['Genre'] as unknown[]) : [];
    let best: (typeof YOLP_GENRES)[number] | undefined;
    for (const g of genres) {
      const code = isRecord(g) ? g['Code'] : undefined;
      const hit = YOLP_GENRES.find((t) => t.code === code);
      if (hit !== undefined && (best === undefined || hit.radiusM > best.radiusM)) {
        best = hit;
      }
    }
    if (best === undefined) {
      continue;
    }
    const name = typeof f['Name'] === 'string' ? f['Name'] : '';
    const i = out.findIndex((p) => p.gid === gid);
    const place: YolpPlace = { gid, name, genre: best.label, lat, lon, radiusM: best.radiusM };
    if (i < 0) {
      out.push(place);
    } else if (best.radiusM > (out[i] as YolpPlace).radiusM) {
      out[i] = { ...(out[i] as YolpPlace), genre: best.label, radiusM: best.radiusM };
    }
  }
  return out;
}
