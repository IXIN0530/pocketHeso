import { useEffect, useRef, useState } from 'react';
import { isStandalone } from '../platform/pwa.ts';
import { PerfBoard, type FrameStats, type PerfOptions } from './perf-board.ts';
import styles from './spike.module.css';

const stamp = () => new Date().toISOString().slice(11, 23);
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const mb = (n: number | undefined) => (n === undefined ? '?' : `${(n / 1024 / 1024).toFixed(1)}MB`);

/** Safari 17+ の Audio Session API（lib.dom に未収録）。 */
type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';
interface AudioSessionLike {
  type: AudioSessionType;
  state?: string;
}
const audioSession = (): AudioSessionLike | undefined =>
  (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;

const DPR = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));

/** P0-T5: Pixi の描画性能・`storage.persist()`・Web Audio と消音モードの実測画面。 */
export function PerfSpike() {
  const [log, setLog] = useState<string[]>([]);
  const add = (line: string) => setLog((l) => [`${stamp()} ${line}`, ...l].slice(0, 60));

  useEffect(() => {
    add(`起動 standalone=${isStandalone()} dpr=${window.devicePixelRatio} ua=${navigator.userAgent}`);
  }, []);

  return (
    <main className={styles.main}>
      <p>
        <a className={styles.back} href="/">
          ← 戻る
        </a>
      </p>
      <h1>P0-T5 描画・保存・音</h1>
      <RenderSection add={add} />
      <StorageSection add={add} />
      <AudioSection add={add} />
      <h2>ログ（新しい順）</h2>
      <pre className={styles.pre}>{log.join('\n')}</pre>
    </main>
  );
}

type Add = (line: string) => void;

function RenderSection({ add }: { add: Add }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<PerfBoard | null>(null);
  const [opts, setOpts] = useState<PerfOptions>({ balls: 20, yakumono: 8, rainbow: true, hueFilter: true });
  const [resolution, setResolution] = useState(DPR);
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [worst, setWorst] = useState<number | null>(null);
  const [renderer, setRenderer] = useState('-');
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const board = new PerfBoard(optsRef.current);
    boardRef.current = board;
    setWorst(null);
    let windows = 0;
    board
      .init(host, resolution)
      .then(() => {
        setRenderer(board.rendererName);
        add(`Pixi 初期化 renderer=${board.rendererName} resolution=${resolution}`);
      })
      .catch((e: unknown) => add(`Pixi 初期化失敗: ${errText(e)}`));
    const timer = window.setInterval(() => {
      const s = board.takeStats();
      if (s.frames === 0) return;
      setStats(s);
      // 起動直後（Pixi 初期化・テクスチャ生成）の2窓は最低値に含めない。
      if (++windows <= 2) return;
      setWorst((w) => (w === null ? s.fps : Math.min(w, s.fps)));
    }, 1000);
    const onVis = () => board.setRunning(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      board.destroy();
      boardRef.current = null;
    };
  }, [resolution]);

  useEffect(() => boardRef.current?.apply(opts), [opts]);

  const toggle = (key: 'rainbow' | 'hueFilter') => setOpts((o) => ({ ...o, [key]: !o[key] }));
  const report = () =>
    add(
      `計測 fps=${stats?.fps.toFixed(1) ?? '-'} p95=${stats?.p95Ms.toFixed(1) ?? '-'}ms max=${stats?.maxMs.toFixed(1) ?? '-'}ms ` +
        `最低fps=${worst?.toFixed(1) ?? '-'} 玉${opts.balls} 役物${opts.yakumono} 虹=${opts.rainbow} 色相フィルタ=${opts.hueFilter} ` +
        `res=${resolution} renderer=${renderer}`,
    );

  return (
    <section>
      <h2>描画（spec/50 の性能目標）</h2>
      <div ref={hostRef} style={{ width: '100%', height: '55dvh', borderRadius: 12, overflow: 'hidden' }} />
      <p style={{ fontVariantNumeric: 'tabular-nums', fontSize: 18 }}>
        {stats ? `${stats.fps.toFixed(1)} fps / p95 ${stats.p95Ms.toFixed(1)}ms / max ${stats.maxMs.toFixed(1)}ms` : '計測中…'}
        <br />
        最低 {worst?.toFixed(1) ?? '-'} fps（1秒窓）/ renderer {renderer} / dpr {window.devicePixelRatio}
      </p>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => toggle('rainbow')}>
          虹 {opts.rainbow ? 'ON' : 'OFF'}
        </button>
        <button className={styles.button} onClick={() => toggle('hueFilter')}>
          色相フィルタ {opts.hueFilter ? 'ON' : 'OFF'}
        </button>
        <button className={styles.button} onClick={() => setOpts((o) => ({ ...o, balls: o.balls === 20 ? 100 : 20 }))}>
          玉 {opts.balls}
        </button>
        {[1, 2, 3].map((r) => (
          <button key={r} className={styles.button} disabled={r === resolution} onClick={() => setResolution(r)}>
            res {r}
          </button>
        ))}
        <button className={styles.button} onClick={() => setWorst(null)}>
          最低値リセット
        </button>
        <button className={styles.button} onClick={report}>
          ログに記録
        </button>
      </div>
      <p>
        既定 = 玉20・役物8・液晶の図柄スクロール・全画面の虹（加算合成）・画面全体の色相フィルタ。30秒ほど置いてから「ログに記録」。
      </p>
    </section>
  );
}

function StorageSection({ add }: { add: Add }) {
  const [text, setText] = useState('-');

  const check = async () => {
    try {
      const persisted = (await navigator.storage?.persisted?.()) ?? 'API なし';
      const est = await navigator.storage?.estimate?.();
      const line = `persisted=${persisted} usage=${mb(est?.usage)} quota=${mb(est?.quota)}`;
      setText(line);
      add(`storage ${line}`);
    } catch (e) {
      add(`storage 確認失敗: ${errText(e)}`);
    }
  };

  const request = async () => {
    try {
      if (!navigator.storage?.persist) {
        add('storage.persist API なし');
        return;
      }
      const t0 = performance.now();
      const ok = await navigator.storage.persist();
      add(`storage.persist() → ${ok} (${Math.round(performance.now() - t0)}ms)`);
      await check();
    } catch (e) {
      add(`storage.persist 失敗: ${errText(e)}`);
    }
  };

  useEffect(() => {
    void check();
  }, []);

  return (
    <section>
      <h2>保存（spec/41）</h2>
      <p>{text}</p>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => void request()}>
          persist() を要求
        </button>
        <button className={styles.button} onClick={() => void check()}>
          再確認
        </button>
      </div>
    </section>
  );
}

function AudioSection({ add }: { add: Add }) {
  const ctxRef = useRef<AudioContext | null>(null);
  const [state, setState] = useState('未作成');
  const [session, setSession] = useState(audioSession()?.type ?? 'API なし');

  const ensure = async (): Promise<AudioContext> => {
    let ctx = ctxRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      ctxRef.current = ctx;
      const c = ctx;
      c.addEventListener('statechange', () => {
        setState(c.state);
        add(`AudioContext state → ${c.state}`);
      });
      add(`AudioContext 作成 state=${ctx.state} sampleRate=${ctx.sampleRate}`);
    }
    if (ctx.state !== 'running') await ctx.resume();
    setState(ctx.state);
    return ctx;
  };

  const beep = async () => {
    try {
      const ctx = await ensure();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      add(`Web Audio ビープ state=${ctx.state} session=${audioSession()?.type ?? '-'}`);
    } catch (e) {
      add(`Web Audio 失敗: ${errText(e)}`);
    }
  };

  const htmlAudio = async () => {
    try {
      const a = new Audio(URL.createObjectURL(toneWav(660, 0.4)));
      await a.play();
      add(`<audio> 再生 session=${audioSession()?.type ?? '-'}`);
    } catch (e) {
      add(`<audio> 失敗: ${errText(e)}`);
    }
  };

  const setSessionType = (t: AudioSessionType) => {
    const s = audioSession();
    if (!s) {
      add('navigator.audioSession なし');
      return;
    }
    try {
      s.type = t;
      setSession(s.type);
      add(`audioSession.type = ${s.type}`);
    } catch (e) {
      add(`audioSession.type 設定失敗: ${errText(e)}`);
    }
  };

  useEffect(() => () => void ctxRef.current?.close(), []);

  return (
    <section>
      <h2>音（spec/43）</h2>
      <p>
        AudioContext: {state} / audioSession.type: {session}
      </p>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => void beep()}>
          Web Audio ビープ
        </button>
        <button className={styles.button} onClick={() => void htmlAudio()}>
          &lt;audio&gt; 再生
        </button>
      </div>
      <div className={styles.row}>
        {(['auto', 'ambient', 'playback'] as const).map((t) => (
          <button key={t} className={styles.button} disabled={t === session} onClick={() => setSessionType(t)}>
            session {t}
          </button>
        ))}
      </div>
      <p>
        消音モード（16e はアクションボタンかコントロールセンター）の ON/OFF それぞれで、session ごとに両ボタンを押して「鳴った / 鳴らない」を確認する。
        背面→前面に戻した後の state もログに出る。
      </p>
    </section>
  );
}

/** 指定周波数の 16bit モノラル WAV（`<audio>` 比較用）。 */
function toneWav(freq: number, seconds: number): Blob {
  const rate = 44100;
  const n = Math.floor(rate * seconds);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const env = 1 - i / n;
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * env * 0.3 * 32767), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
