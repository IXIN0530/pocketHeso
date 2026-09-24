/** スパイク用: 施設までの距離と範囲判定（純関数）。本実装では packages/claims/checkin へ移す。 */

const EARTH_R = 6371008.8;
const DEG = Math.PI / 180;

export interface Facility {
  id: string;
  /** 表示用の種類（YOLP の業種名） */
  kind: string;
  name: string;
  lat: number;
  lon: number;
  /** 範囲判定の半径（m）。対象外の業種は null */
  radiusM: number | null;
}

/** 正距円筒近似の距離（m）。cosLat は基準点で1回だけ計算して渡す。 */
export function distanceM(lat0: number, lon0: number, cosLat: number, lat: number, lon: number): number {
  const dy = (lat - lat0) * DEG * EARTH_R;
  const dx = (lon - lon0) * DEG * EARTH_R * cosLat;
  return Math.sqrt(dx * dx + dy * dy);
}

export interface Evaluated extends Facility {
  /** 中心までの距離（m） */
  centerM: number;
  /** 中心からの距離 ≤ 半径 */
  inRange: boolean;
  /** 中心からの距離 ≤ 半径 + accuracy（spec/32 の判定, D-025） */
  inRangePlusAcc: boolean;
}

/** 近い順に並べ、半径だけの判定と半径 + accuracy の判定を付ける。 */
export function evaluate(lat: number, lon: number, accuracyM: number, list: readonly Facility[]): Evaluated[] {
  const cosLat = Math.cos(lat * DEG);
  return list
    .map((f): Evaluated => {
      const centerM = distanceM(lat, lon, cosLat, f.lat, f.lon);
      const r = f.radiusM;
      return { ...f, centerM, inRange: r !== null && centerM <= r, inRangePlusAcc: r !== null && centerM <= r + accuracyM };
    })
    .sort((a, b) => a.centerM - b.centerM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
