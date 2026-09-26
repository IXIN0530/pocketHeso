// YOLP ローカルサーチ（output=json）の応答形式に合わせた合成 fixture。座標・名前は架空（実在の地点ではない）。
// 基準点 BASE から: ジム（2業種で重複）約 45m 北、公園 約 90m 東、飲食店（対象外業種）、座標の壊れた施設。

export const BASE = { lat: 35.68, lon: 139.76 } as const;

export const YOLP_RESPONSE: unknown = {
  ResultInfo: { Count: 5, Total: 5, Start: 1, Status: 200, Description: '', Copyright: '', Latency: 0.012 },
  Feature: [
    {
      Id: '20001',
      Gid: 'gymA',
      Name: 'テストフィットネス',
      Geometry: { Type: 'point', Coordinates: '139.7600,35.6804' },
      Category: [],
      Description: '',
      Style: [],
      Property: { Uid: 'u1', CassetteId: 'c', Yomi: 'テストフィットネス', Genre: [{ Code: '0405003', Name: 'スポーツクラブ' }] },
    },
    {
      Id: '20002',
      Gid: 'gymA',
      Name: 'テストフィットネス',
      Geometry: { Type: 'point', Coordinates: '139.7600,35.6804' },
      Property: { Genre: [{ Code: '0301001', Name: 'スポーツ施設' }] },
    },
    {
      Id: '20003',
      Gid: 'parkB',
      Name: 'テスト公園',
      Geometry: { Type: 'point', Coordinates: '139.7610,35.6800' },
      Property: { Genre: [{ Code: '0305007', Name: '公園' }] },
    },
    {
      Id: '20004',
      Gid: 'cafeC',
      Name: 'テストカフェ',
      Geometry: { Type: 'point', Coordinates: '139.7601,35.6800' },
      Property: { Genre: [{ Code: '0110001', Name: 'カフェ' }] },
    },
    {
      Id: '20005',
      Gid: 'brokenD',
      Name: '座標なし',
      Geometry: { Type: 'point', Coordinates: '' },
      Property: { Genre: [{ Code: '0305007', Name: '公園' }] },
    },
  ],
};

/** 0件の応答（Feature が無い）。 */
export const YOLP_EMPTY: unknown = { ResultInfo: { Count: 0, Total: 0, Start: 1, Status: 200 } };

/** エラー応答（appid 不正など）。 */
export const YOLP_ERROR: unknown = { Error: { Message: 'Invalid appid' } };
