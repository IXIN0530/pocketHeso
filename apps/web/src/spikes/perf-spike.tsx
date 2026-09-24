import { useEffect, useRef, useState } from 'react';
import { isStandalone } from '../platform/pwa.ts';
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

/** P0-T5: `storage.persist()`・Web Audio と消音モードの実測画面（Pixi の描画計測は D-026 で削除）。 */
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
      <h1>P0-T5 保存・音</h1>
      <StorageSection add={add} />
      <AudioSection add={add} />
      <h2>ログ（新しい順）</h2>
      <pre className={styles.pre}>{log.join('\n')}</pre>
    </main>
  );
}

type Add = (line: string) => void;

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
