// 演出の CueSheet と演出パック（spec/43）。純データ型と JSON の検査だけを置く（再生は @ph/fx）。

/** 音のバス（バス別に音量を持つ）。 */
export type CueBus = 'bgm' | 'se' | 'voice';
export const CUE_BUSES: readonly CueBus[] = ['bgm', 'se', 'voice'];

export type FlashStyle = 'rainbow' | 'white';

interface CueCommon {
  /** 演出開始からの時刻（ms）。 */
  readonly at: number;
  /** 設定の強度（1〜3）がこれ未満ならスキップ（省略は 1）。 */
  readonly min_intensity?: number;
}

export interface SoundCue extends CueCommon {
  readonly kind: 'sound';
  readonly bus: CueBus;
  readonly asset: string;
  readonly loop?: boolean;
  /** 鳴らす長さ（省略は素材の長さ。loop は演出の停止まで）。 */
  readonly ms?: number;
}
export interface FlashCue extends CueCommon {
  readonly kind: 'flash';
  readonly style: FlashStyle;
  readonly ms: number;
}
export interface ParticleCue extends CueCommon {
  readonly kind: 'particle';
  readonly effect: string;
  readonly ms: number;
}
export interface HapticCue extends CueCommon {
  readonly kind: 'haptic';
  /** navigator.vibrate の形式（振動, 休み, 振動…の ms）。 */
  readonly pattern: readonly number[];
}
export interface ShakeCue extends CueCommon {
  readonly kind: 'shake';
  readonly ms: number;
  readonly amp: number;
}
/** 数秒だけブルームを ON（常時は重い, spec/50）。 */
export interface BloomCue extends CueCommon {
  readonly kind: 'bloom';
  readonly ms: number;
  readonly strength: number;
}
/** 寄り・引き。終了後は定位置へ戻す。 */
export interface CameraCue extends CueCommon {
  readonly kind: 'camera';
  readonly shot: string;
  readonly ms: number;
}

export type Cue = SoundCue | FlashCue | ParticleCue | HapticCue | ShakeCue | BloomCue | CameraCue;
export type CueKind = Cue['kind'];

/** 分岐（群予告の有無など）。options から重みで1つ選ぶ（乱数は RNGStream(seed, 'presentation', serial)）。 */
export interface CueBranch {
  readonly name: string;
  readonly options: readonly CueBranchOption[];
}
export interface CueBranchOption {
  readonly weight: number;
  readonly cues: readonly Cue[];
}

export interface CueSheet {
  /** 変動パターン id（patterns.json）または演出名（jackpot など）。 */
  readonly pattern: string;
  readonly cues: readonly Cue[];
  readonly branches: readonly CueBranch[];
}

/** 自作の合成音（素材ファイルなしで鳴らす）。周波数は hz[0] → hz[1] へ直線で動かす。 */
export interface SynthSpec {
  readonly wave: 'sine' | 'square' | 'triangle' | 'sawtooth';
  readonly hz: readonly [number, number];
  readonly ms: number;
  readonly gain: number;
}
/** 音素材: パック内のファイル（`sounds/*.m4a`）か合成音。 */
export type SoundAsset = { readonly file: string } | { readonly synth: SynthSpec };

export interface CuePack {
  readonly name: string;
  readonly theme: { readonly primary: string; readonly accent: string };
  /** asset 名 → 素材（キー順は JSON の記述順）。 */
  readonly sounds: Readonly<Record<string, SoundAsset>>;
  readonly sheets: readonly CueSheet[];
}

const WAVES: readonly SynthSpec['wave'][] = ['sine', 'square', 'triangle', 'sawtooth'];
const FLASH_STYLES: readonly FlashStyle[] = ['rainbow', 'white'];

type Obj = Record<string, unknown>;

function fail(path: string, what: string): never {
  throw new Error(`pack.json ${path}: ${what}`);
}
function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'object が必要');
  return v as Obj;
}
function arr(v: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(v)) fail(path, 'array が必要');
  return v;
}
function num(v: unknown, path: string, min = 0): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) fail(path, `${min} 以上の数が必要`);
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v === '') fail(path, '文字列が必要');
  return v;
}
function oneOf<T extends string>(v: unknown, list: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) fail(path, list.join(' | '));
  return v as T;
}

/** 1キューを検査する。未知の kind は null（前方互換で無視）。 */
function parseCue(v: unknown, path: string): Cue | null {
  const o = obj(v, path);
  const common: { at: number; min_intensity?: number } = { at: num(o.at, `${path}.at`) };
  if (o.min_intensity !== undefined) common.min_intensity = num(o.min_intensity, `${path}.min_intensity`, 1);
  switch (o.kind) {
    case 'sound': {
      const c: { -readonly [K in keyof SoundCue]: SoundCue[K] } = {
        ...common,
        kind: 'sound',
        bus: oneOf(o.bus, CUE_BUSES, `${path}.bus`),
        asset: str(o.asset, `${path}.asset`),
      };
      if (o.loop !== undefined) c.loop = o.loop === true;
      if (o.ms !== undefined) c.ms = num(o.ms, `${path}.ms`, 1);
      return c;
    }
    case 'flash':
      return { ...common, kind: 'flash', style: oneOf(o.style, FLASH_STYLES, `${path}.style`), ms: num(o.ms, `${path}.ms`, 1) };
    case 'particle':
      return { ...common, kind: 'particle', effect: str(o.effect, `${path}.effect`), ms: num(o.ms, `${path}.ms`, 1) };
    case 'haptic':
      return { ...common, kind: 'haptic', pattern: arr(o.pattern, `${path}.pattern`).map((p, i) => num(p, `${path}.pattern[${i}]`)) };
    case 'shake':
      return { ...common, kind: 'shake', ms: num(o.ms, `${path}.ms`, 1), amp: num(o.amp, `${path}.amp`) };
    case 'bloom':
      return { ...common, kind: 'bloom', ms: num(o.ms, `${path}.ms`, 1), strength: num(o.strength, `${path}.strength`) };
    case 'camera':
      return { ...common, kind: 'camera', shot: str(o.shot, `${path}.shot`), ms: num(o.ms, `${path}.ms`, 1) };
    default:
      if (typeof o.kind !== 'string') fail(`${path}.kind`, '文字列が必要');
      return null;
  }
}

function parseCues(v: unknown, path: string): Cue[] {
  const out: Cue[] = [];
  arr(v, path).forEach((c, i) => {
    const cue = parseCue(c, `${path}[${i}]`);
    if (cue) out.push(cue);
  });
  return out;
}

export function parseCueSheet(v: unknown, path = 'sheet'): CueSheet {
  const o = obj(v, path);
  const branches = o.branches === undefined ? [] : arr(o.branches, `${path}.branches`);
  return {
    pattern: str(o.pattern, `${path}.pattern`),
    cues: parseCues(o.cues, `${path}.cues`),
    branches: branches.map((b, i) => {
      const bp = `${path}.branches[${i}]`;
      const bo = obj(b, bp);
      const options = arr(bo.options, `${bp}.options`).map((opt, j) => {
        const op = obj(opt, `${bp}.options[${j}]`);
        return { weight: num(op.weight, `${bp}.options[${j}].weight`), cues: parseCues(op.cues, `${bp}.options[${j}].cues`) };
      });
      if (!options.some((opt) => opt.weight > 0)) fail(`${bp}.options`, '正の重みが1つ以上必要');
      return { name: str(bo.name, `${bp}.name`), options };
    }),
  };
}

function parseSound(v: unknown, path: string): SoundAsset {
  const o = obj(v, path);
  if (o.file !== undefined) return { file: str(o.file, `${path}.file`) };
  const s = obj(o.synth, `${path}.synth`);
  const hz = arr(s.hz, `${path}.synth.hz`);
  if (hz.length !== 2) fail(`${path}.synth.hz`, '[開始, 終了] が必要');
  return {
    synth: {
      wave: oneOf(s.wave, WAVES, `${path}.synth.wave`),
      hz: [num(hz[0], `${path}.synth.hz[0]`, 1), num(hz[1], `${path}.synth.hz[1]`, 1)],
      ms: num(s.ms, `${path}.synth.ms`, 1),
      gain: s.gain === undefined ? 1 : num(s.gain, `${path}.synth.gain`),
    },
  };
}

/** `resources/packs/<name>/pack.json` を検査する。形が崩れていれば例外、未知の kind のキューは捨てる。 */
export function parseCuePack(v: unknown): CuePack {
  const o = obj(v, '');
  const theme = obj(o.theme, 'theme');
  const soundsIn = obj(o.sounds, 'sounds');
  const sounds: Record<string, SoundAsset> = {};
  for (const key of Object.keys(soundsIn)) sounds[key] = parseSound(soundsIn[key], `sounds.${key}`);
  const sheets = arr(o.sheets, 'sheets').map((s, i) => parseCueSheet(s, `sheets[${i}]`));
  for (const sheet of sheets) {
    const all = [...sheet.cues, ...sheet.branches.flatMap((b) => b.options.flatMap((opt) => opt.cues))];
    for (const c of all) {
      if (c.kind === 'sound' && !(c.asset in sounds)) fail(`sheets(${sheet.pattern})`, `未定義の音 ${c.asset}`);
    }
  }
  return {
    name: str(o.name, 'name'),
    theme: { primary: str(theme.primary, 'theme.primary'), accent: str(theme.accent, 'theme.accent') },
    sounds,
    sheets,
  };
}
