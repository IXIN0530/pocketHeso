/** 抽選ストリームの用途別ID（演出乱数が当否に影響しないよう分離）。 */
export type RNGStreamID =
  | 'launch'
  | 'launchJitter'
  | 'jackpot'
  | 'split'
  | 'pattern'
  | 'holdColor'
  | 'presentation'
  | 'holdChange'
  | 'notice'
  | 'grantHold'
  | 'economy'
  | 'uwanose';

/** 全ストリームID（順序固定。反復順に依存する処理はこの配列を使う）。 */
export const RNG_STREAM_IDS: readonly RNGStreamID[] = [
  'launch',
  'launchJitter',
  'jackpot',
  'split',
  'pattern',
  'holdColor',
  'presentation',
  'holdChange',
  'notice',
  'grantHold',
  'economy',
  'uwanose',
];

/** 2^32（nextUnit の除数。`**`禁止のため数値リテラル）。 */
const UINT32_RANGE = 4294967296;

/** FNV-1a 32bit ハッシュ（ASCII範囲では公開ベクタと一致）。 */
export function fnv1a32(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i = i + 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** ストリーム初期化用ハッシュ: FNV-1a(`seed:id:index`)。 */
export function streamSeedU32(seed: number, id: RNGStreamID, index: number): number {
  const seedU32 = seed >>> 0;
  const indexInt = Math.floor(index);
  return fnv1a32(seedU32 + ':' + id + ':' + indexInt);
}

/** splitmix32 生成器（状態はクロージャ内。決定的）。 */
export function splitmix32(seedU32: number): { nextU32(): number } {
  let a = seedU32 >>> 0;
  return {
    nextU32(): number {
      a = (a + 0x9e3779b9) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0);
    },
  };
}

/** 32bit 左ローテート（xoshiro内部用）。 */
function rotl32(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** xoshiro128** 生成器（sは全ゼロ禁止。決定的）。 */
export function xoshiro128ss(
  s0: number,
  s1: number,
  s2: number,
  s3: number,
): { nextU32(): number } {
  let a0 = s0 >>> 0;
  let a1 = s1 >>> 0;
  let a2 = s2 >>> 0;
  let a3 = s3 >>> 0;
  return {
    nextU32(): number {
      const result = Math.imul(rotl32(Math.imul(a1, 5) >>> 0, 7), 9) >>> 0;
      const t = (a1 << 9) >>> 0;
      a2 = (a2 ^ a0) >>> 0;
      a3 = (a3 ^ a1) >>> 0;
      a1 = (a1 ^ a2) >>> 0;
      a0 = (a0 ^ a3) >>> 0;
      a2 = (a2 ^ t) >>> 0;
      a3 = rotl32(a3, 11);
      return result >>> 0;
    },
  };
}

/** 決定論乱数ストリーム（seed,id,index から一意に初期化）。 */
export class RNGStream {
  private readonly gen: { nextU32(): number };

  constructor(seed: number, id: RNGStreamID, index: number) {
    const h = streamSeedU32(seed, id, index);
    const mixer = splitmix32(h);
    let s0 = mixer.nextU32();
    const s1 = mixer.nextU32();
    const s2 = mixer.nextU32();
    const s3 = mixer.nextU32();
    if ((s0 | s1 | s2 | s3) === 0) {
      s0 = 1;
    }
    this.gen = xoshiro128ss(s0, s1, s2, s3);
  }

  /** [0, 2^32) の整数を返す。 */
  nextU32(): number {
    return this.gen.nextU32();
  }

  /** [0, 1) の小数を返す（u32 / 2^32）。 */
  nextUnit(): number {
    return this.nextU32() / UINT32_RANGE;
  }

  /** 整数重みから1件選ぶ（戻り値は index）。 */
  pick(weights: readonly number[]): number {
    let total = 0;
    for (let i = 0; i < weights.length; i = i + 1) {
      const w = weights[i];
      if (w === undefined) {
        continue;
      }
      total = total + w;
    }
    if (weights.length === 0 || total <= 0) {
      throw new Error('pick requires non-empty weights with positive total');
    }
    const r = this.nextUnit() * total;
    let acc = 0;
    for (let i = 0; i < weights.length; i = i + 1) {
      const w = weights[i];
      if (w === undefined) {
        continue;
      }
      acc = acc + w;
      if (r < acc) {
        return i;
      }
    }
    return weights.length - 1;
  }
}
