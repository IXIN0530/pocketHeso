import type { SynthSpec } from '@ph/shared';

/** 立ち上がり・立ち下がり（クリック音を避ける）。 */
const EDGE_MS = 5;

/**
 * 合成音を PCM（-1〜1, モノラル）にする。素材ファイルなしで鳴らす自作音（spec/43「素材」）。
 * 周波数は hz[0] → hz[1] へ直線、音量は EDGE_MS の立ち上げの後に直線で減衰。
 */
export function renderSynth(spec: SynthSpec, sampleRate: number): Float32Array {
  const n = Math.max(1, Math.round((spec.ms / 1000) * sampleRate));
  const out = new Float32Array(n);
  const edge = Math.max(1, Math.round((EDGE_MS / 1000) * sampleRate));
  const [f0, f1] = spec.hz;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    phase += (f0 + (f1 - f0) * t) / sampleRate;
    phase -= Math.floor(phase);
    let v: number;
    switch (spec.wave) {
      case 'sine':
        v = Math.sin(phase * 2 * Math.PI);
        break;
      case 'square':
        v = phase < 0.5 ? 1 : -1;
        break;
      case 'triangle':
        v = 1 - 4 * Math.abs(phase - 0.5);
        break;
      case 'sawtooth':
        v = 2 * phase - 1;
        break;
    }
    const env = Math.min(1, i / edge, (n - i) / edge) * (1 - 0.6 * t);
    out[i] = v * env * spec.gain;
  }
  return out;
}
