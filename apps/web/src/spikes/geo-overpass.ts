/** スパイク用: spec/32 の Overpass クエリ組み立て・応答の解釈・範囲判定（純関数）。本実装では packages/claims/checkin へ移す。 */

/** overpass-api.de は 2026-09 の実機で全リクエストが 406（CORS 無し）で使えなかったため、スパイクでは mail.ru のミラーを既定にする。 */
export const DEFAULT_ENDPOINT = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';

/** spec/32 の最大件数。Overpass の `out N` は近い順ではなく ID 順で切るので、到達したら取りこぼしがあり得る。 */
export const QUERY_LIMIT = 50;

const LEISURE = 'fitness_centre|fitness_station|sports_centre|park|pitch|track|swimming_pool';
/** 日本の小さな公園（児童公園・街区公園）は playground で載っていることが多い（P0-T4 の比較用、spec/32 には無い）。 */
const PLAYGROUND = '|playground';

/** 種類別の既定半径（m）。載っていない種類は bbox が必須。 */
export const TYPE_RADIUS_M: Readonly<Record<string, number>> = {
  fitness_centre: 60,
  sports_centre: 120,
  fitness_station: 40,
};

const EARTH_R = 6371008.8;
const DEG = Math.PI / 180;

export function buildQuery(lat: number, lon: number, radiusM = 300, limit = QUERY_LIMIT, playground = false): string {
  return `[out:json][timeout:10];nwr["leisure"~"^(${LEISURE}${playground ? PLAYGROUND : ''})$"](around:${radiusM},${lat},${lon});out tags center bb ${limit};`;
}

export interface Bounds {
  minlat: number;
  minlon: number;
  maxlat: number;
  maxlon: number;
}

export interface Facility {
  id: string;
  leisure: string;
  name: string;
  lat: number;
  lon: number;
  bounds: Bounds | null;
  /** 提供元が決めた範囲判定の半径（m）。無ければ TYPE_RADIUS_M を使う */
  radiusM?: number;
}

interface RawElement {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  center?: { lat?: unknown; lon?: unknown };
  bounds?: Partial<Record<keyof Bounds, unknown>>;
  tags?: Record<string, unknown>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Overpass の JSON 応答から施設一覧を作る。座標の無い要素は捨てる。 */
export function parseOverpass(json: unknown): Facility[] {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const out: Facility[] = [];
  for (const e of elements as RawElement[]) {
    const lat = num(e.lat) ?? num(e.center?.lat);
    const lon = num(e.lon) ?? num(e.center?.lon);
    if (lat === null || lon === null) continue;
    const b = e.bounds;
    const minlat = num(b?.minlat);
    const minlon = num(b?.minlon);
    const maxlat = num(b?.maxlat);
    const maxlon = num(b?.maxlon);
    const bounds =
      minlat !== null && minlon !== null && maxlat !== null && maxlon !== null ? { minlat, minlon, maxlat, maxlon } : null;
    const tags = e.tags ?? {};
    out.push({
      id: `${String(e.type)}/${String(e.id)}`,
      leisure: typeof tags.leisure === 'string' ? tags.leisure : '?',
      name: typeof tags.name === 'string' ? tags.name : '',
      lat,
      lon,
      bounds,
    });
  }
  return out;
}

/** 正距円筒近似の距離（m）。cosLat は基準点で1回だけ計算して渡す。 */
export function distanceM(lat0: number, lon0: number, cosLat: number, lat: number, lon: number): number {
  const dy = (lat - lat0) * DEG * EARTH_R;
  const dx = (lon - lon0) * DEG * EARTH_R * cosLat;
  return Math.sqrt(dx * dx + dy * dy);
}

export type RangeRule = 'bbox' | 'radius' | 'none';

export interface Evaluated extends Facility {
  /** 中心までの距離（m） */
  centerM: number;
  /** bbox の対角長（m）。bbox 無しは null */
  bboxDiagM: number | null;
  rule: RangeRule;
  inRange: boolean;
  /** 比較用: 種類別半径に accuracy を足した場合の判定（spec/32 に明記なし。bbox / none は inRange と同じ） */
  inRangePlusAcc: boolean;
}

/** spec/32 の OSM 施設の範囲判定: bbox を accuracy+30m 広げた範囲内、bbox が無ければ種類別半径。 */
export function evaluate(lat: number, lon: number, accuracyM: number, list: readonly Facility[]): Evaluated[] {
  const cosLat = Math.cos(lat * DEG);
  const marginM = accuracyM + 30;
  const dLat = marginM / (DEG * EARTH_R);
  const dLon = dLat / cosLat;
  return list
    .map((f): Evaluated => {
      const centerM = distanceM(lat, lon, cosLat, f.lat, f.lon);
      const b = f.bounds;
      if (b) {
        const inRange =
          lat >= b.minlat - dLat && lat <= b.maxlat + dLat && lon >= b.minlon - dLon && lon <= b.maxlon + dLon;
        const bboxDiagM = distanceM(b.minlat, b.minlon, cosLat, b.maxlat, b.maxlon);
        return { ...f, centerM, bboxDiagM, rule: 'bbox', inRange, inRangePlusAcc: inRange };
      }
      const r = f.radiusM ?? TYPE_RADIUS_M[f.leisure];
      if (r === undefined) return { ...f, centerM, bboxDiagM: null, rule: 'none', inRange: false, inRangePlusAcc: false };
      return { ...f, centerM, bboxDiagM: null, rule: 'radius', inRange: centerM <= r, inRangePlusAcc: centerM <= r + accuracyM };
    })
    .sort((a, b) => a.centerM - b.centerM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
