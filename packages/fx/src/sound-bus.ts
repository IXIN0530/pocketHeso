import type { CueBus, SoundAsset, SoundCue } from '@ph/shared';
import { CUE_BUSES } from '@ph/shared';
import { renderSynth } from './synth.ts';

export type VolumeKey = CueBus | 'master';

interface Playing {
  readonly src: AudioBufferSourceNode;
  readonly bus: CueBus;
}

/**
 * Web Audio の音（spec/43）。master → bgm/se/voice のバス。デコード済みバッファをキャッシュする。
 * iOS は最初のユーザー操作の中で AudioContext を作って resume しないと鳴らない（unlock）。
 * 解錠前（または iOS の中断中）に来た再生は捨てる（遅れて鳴らさない）。
 */
export class SoundBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly gains = new Map<CueBus, GainNode>();
  private readonly volumes = new Map<VolumeKey, number>([
    ['master', 0.8],
    ['bgm', 0.8],
    ['se', 0.8],
    ['voice', 0.8],
  ]);
  private readonly sources = new Map<string, { readonly asset: SoundAsset; readonly baseUrl: string }>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly playing = new Set<Playing>();
  /** resume の完了待ち（この間の再生は resume 後に鳴る）。 */
  private resuming = false;

  constructor(private readonly createContext: () => AudioContext = () => new AudioContext()) {}

  /** ユーザー操作のハンドラ内で呼ぶ。何度呼んでもよい（iOS の中断からの復帰も兼ねる）。 */
  unlock(): void {
    if (!this.ctx) {
      const ctx = this.createContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volumes.get('master')!;
      this.master.connect(ctx.destination);
      for (const bus of CUE_BUSES) {
        const g = ctx.createGain();
        g.gain.value = this.volumes.get(bus)!;
        g.connect(this.master);
        this.gains.set(bus, g);
      }
      // iOS: 操作中に何か鳴らすと以後の再生が許される（無音1サンプル）。
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      silent.connect(ctx.destination);
      silent.start();
      for (const name of this.sources.keys()) void this.decode(name);
    }
    if (this.ctx.state !== 'running' && !this.resuming) {
      this.resuming = true;
      this.ctx
        .resume()
        .catch(() => {})
        .finally(() => {
          this.resuming = false;
        });
    }
  }

  /** 鳴らせる状態か（解錠のタップ直後で resume 待ちの間も true）。 */
  get ready(): boolean {
    return this.ctx !== null && (this.ctx.state === 'running' || this.resuming);
  }

  /** 音量 0〜1。master = 0 がアプリ内ミュート。 */
  setVolume(key: VolumeKey, v: number): void {
    const vol = Math.min(1, Math.max(0, v));
    this.volumes.set(key, vol);
    const node = key === 'master' ? this.master : this.gains.get(key);
    if (node) node.gain.value = vol;
  }

  /** 素材を登録する（file は baseUrl からの相対）。解錠前でもよい（デコードは解錠後）。 */
  add(name: string, asset: SoundAsset, baseUrl: string): void {
    this.sources.set(name, { asset, baseUrl });
    this.buffers.delete(name);
    if (this.ctx) void this.decode(name);
  }

  isLoaded(name: string): boolean {
    return this.buffers.has(name);
  }

  private async decode(name: string): Promise<void> {
    const ctx = this.ctx;
    const src = this.sources.get(name);
    if (!ctx || !src) return;
    try {
      let buf: AudioBuffer;
      if ('synth' in src.asset) {
        const pcm = renderSynth(src.asset.synth, ctx.sampleRate);
        buf = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
        buf.getChannelData(0).set(pcm);
      } else {
        const res = await fetch(new URL(src.asset.file, src.baseUrl));
        buf = await ctx.decodeAudioData(await res.arrayBuffer());
      }
      if (this.sources.get(name) === src) this.buffers.set(name, buf);
    } catch {
      // 読めない素材は鳴らさないだけ（演出は光・振動で続く）
    }
  }

  /** キューの音を鳴らす。offsetMs は途中からの頭出し（ループでない音は素材の長さを過ぎていれば鳴らさない）。 */
  play(cue: SoundCue, offsetMs = 0): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(cue.asset);
    const bus = this.gains.get(cue.bus);
    if (!ctx || !buf || !bus || !this.ready) return;
    const off = offsetMs / 1000;
    if (!cue.loop && off >= buf.duration) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = cue.loop === true;
    src.connect(bus);
    src.start(ctx.currentTime, cue.loop ? off % buf.duration : off);
    if (cue.ms !== undefined) src.stop(ctx.currentTime + Math.max(0, cue.ms / 1000 - off));
    const p: Playing = { src, bus: cue.bus };
    this.playing.add(p);
    src.onended = () => this.playing.delete(p);
  }

  /** 鳴っている音を止める（bus 省略で全部）。 */
  stop(bus?: CueBus): void {
    for (const p of [...this.playing]) {
      if (bus !== undefined && p.bus !== bus) continue;
      try {
        p.src.stop();
      } catch {
        // 既に止まっている
      }
      this.playing.delete(p);
    }
  }
}
